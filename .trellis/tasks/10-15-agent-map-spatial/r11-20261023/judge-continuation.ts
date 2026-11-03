/** User-authorized repairs preserve the 260/262/270-request history; returned responses are never sent again. */
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync,statSync,readdirSync} from 'node:fs';
import {join,resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceFreeze} from './live.js';
import {digest,repo,packageRoot} from './runtime.js';
import {openLedger,assertCalibrationAccounting,formatHalt,type LedgerData,type FormatRecovery,type Ledger} from './budget.js';
import {gate,requestBody,requestJudgment,validateProviderResponse,normalizeStoredJudgment,loadTaskWork,taskScore,taskJudgeError,JudgeOutputError,validateJudgment,type JudgeConfig,type JudgeRecord,type Judgment,type JudgeWork} from './judge.js';
import {normalizeJudgment} from './judge-format.js';
import {liveEnvironment} from '../r7-20261023/environment.js';
const read=<T>(path:string)=>JSON.parse(readFileSync(path,'utf8')) as T;
const save=(path:string,value:unknown)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const materials=fileURLToPath(new URL('./calibration-v2/',import.meta.url));
type Freeze=Awaited<ReturnType<typeof sourceFreeze>>;
const repairFiles=new Set(['judge.ts','judge.test.ts','budget.ts','judge-format.ts','judge-continuation.ts','judge-continuation.test.ts']);
export function assertRepairScope(original:Freeze,current:Freeze){
 const {driver:oldDriver,...oldRest}=original,{driver:newDriver,...newRest}=current;assert.deepEqual(newRest,oldRest,'Only reviewed grading files may change');
 for(const name of new Set([...Object.keys(oldDriver),...Object.keys(newDriver)])){
  if(repairFiles.has(name)){assert.ok(newDriver[name],`Repair cannot delete ${name}`);continue;}
  assert.equal(newDriver[name],oldDriver[name],`Unapproved source change: ${name}`);
 }
 return [...repairFiles].filter(name=>oldDriver[name]!==newDriver[name]);
}
interface Paths {directory:string;originalFreeze:string;ledger:string;config:string;calibration:string;batch:string;failedGrading:string;previousContinuation?:string}
interface Prepared {schemaVersion:1;paths:Paths;originalFreezeHash:string;graderFreeze:Freeze;graderFreezeHash:string;changedFiles:string[];artifacts:Record<string,string>;recovery:FormatRecovery;reusedRecords:JudgeRecord[];reusedOutputs:Array<Judgment|null>;calibrationBindings:unknown}
function checkPaths(p:Paths){assert.equal(process.cwd(),packageRoot);assert.equal(p.ledger,join(repo,'.local/spatial-r11/ledger.json'));assert.ok(p.directory.startsWith(join(repo,'.local/spatial-r11')+'/'));}
function verifyArtifacts(artifacts:Record<string,string>){for(const [path,hash] of Object.entries(artifacts))assert.equal(digest(readFileSync(path)),hash,`Evidence changed: ${path}`);}
export function assertOriginalLedger(data:LedgerData,firstBlindId:string,additionalBlindIds:string[]=[]){
 const ids=[firstBlindId,...additionalBlindIds];assert.ok([1,3,11].includes(ids.length),'Only the reviewed returned prefix may be reused');const second=ids.length===3,third=ids.length===11;
 assert.equal(data.halted,second?'Unsupported additional judgment field reasonDetail':formatHalt);assert.equal(data.recoveries?.length??0,third?2:second?1:0);assert.equal(data.requests.length,259+ids.length);
 assert.equal(data.requests.filter(r=>r.role==='agent').length,235);assert.equal(data.requests.filter(r=>r.role==='judge').length,24+ids.length);
 assert.ok(data.requests.every(r=>r.status==='finished'&&r.usage&&Number.isSafeInteger(r.usage.inputTokens)&&r.usage.inputTokens>0&&Number.isSafeInteger(r.usage.outputTokens)&&r.usage.outputTokens>0&&r.usage.responseModel==='deepseek-v4-1-flash-261017'),'Every original request must have known finished usage');
 const priorTaskScores=data.requests.filter(r=>r.role==='judge'&&!/^C\d+$/.test(r.trialId));assert.deepEqual(priorTaskScores.map(r=>r.trialId),ids);assert.equal(data.requests.at(-1)?.id,priorTaskScores.at(-1)?.id);return priorTaskScores.at(-1)!;
}
/** Offline only: verify all original artifacts and the approved 24+returned-prefix responses; do not mutate the shared ledger. */
export async function prepareContinuation(options:Paths){
 const p=Object.fromEntries(Object.entries(options).filter(([,value])=>value!==undefined).map(([key,value])=>[key,resolve(value)])) as unknown as Paths;checkPaths(p);assert.ok(!existsSync(p.directory),'Preparation output must be new');
 const original=read<Freeze>(p.originalFreeze),current=await sourceFreeze(),changedFiles=assertRepairScope(original,current),originalFreezeHash=digest(JSON.stringify(original));
 const approved=gate('verify',p.config,p.calibration),config=read<JudgeConfig>(p.config),rubric=readFileSync(join(materials,'rubric.md'),'utf8');
 const {work,rows,batchHash}=loadTaskWork(p.batch,original);assert.equal(work.length,64);assert.ok(rows.every(r=>r.status==='recorded'));assert.equal(new Set(work.map(w=>w.input.id)).size,64);for(const w of work)requestBody(config,rubric,w.input);
 const originalBytes=readFileSync(p.ledger),data=read<LedgerData>(p.ledger);assert.equal(data.freezeHash,originalFreezeHash);const prefix=data.requests.length-259;assert.equal(Boolean(p.previousContinuation),prefix>1);const last=assertOriginalLedger(data,work[0].input.id,work.slice(1,prefix).map(w=>w.input.id)),ledger=openLedger(p.ledger,originalFreezeHash);
 const calibration=read<{records:JudgeRecord[]}>(p.calibration);assertCalibrationAccounting(ledger,calibration.records);
 const oldProtocol=read<{freezeHash:string;batchHash:string;bindings:unknown;planned:number}>(join(p.failedGrading,'protocol.json'));assert.equal(oldProtocol.freezeHash,originalFreezeHash);assert.equal(oldProtocol.batchHash,batchHash);assert.equal(oldProtocol.planned,64);assert.deepEqual(oldProtocol.bindings,approved.bindings);
 const progress=read<{records:unknown[];scores:unknown[];halted:string;totals:unknown}>(join(p.failedGrading,'progress.json'));assert.equal(progress.records.length,0);assert.equal(progress.scores.length,0);assert.equal(progress.halted,formatHalt);assert.deepEqual(progress.totals,{requests:260,input:data.requests.slice(0,260).reduce((n,r)=>n+r.usage!.inputTokens,0),output:data.requests.slice(0,260).reduce((n,r)=>n+r.usage!.outputTokens,0),unknown:0});
 assert.deepEqual(readdirSync(p.failedGrading).filter(n=>/^\d+$/.test(n)),['001']);assert.ok(!existsSync(join(p.failedGrading,'scores.json')));
 const firstDir=join(p.failedGrading,'001'),returnedDirs=[firstDir];
 const inheritedArtifacts:Record<string,string>={};
 if(p.previousContinuation){
  const latest=read<Prepared>(join(p.previousContinuation,'continuation.json'));
  const stages=prefix===11?[latest.paths.previousContinuation,p.previousContinuation]:[p.previousContinuation];
  assert.ok(stages.every(Boolean),'The fixed third repair must retain both earlier continuations');
  for(const [stage,directory] of stages.entries()){
   const dir=directory!,prior=read<Prepared>(join(dir,'continuation.json')),start=stage===0?1:3,end=stage===0?3:11,priorCount=259+start,endCount=259+end;
   assert.equal(prior.paths.directory,dir);for(const key of ['batch','calibration','config','originalFreeze','failedGrading','ledger'] as const)assert.equal(prior.paths[key],p[key]);verifyArtifacts(prior.artifacts);Object.assign(inheritedArtifacts,prior.artifacts);
   assert.equal(data.recoveries![stage].repairedFreezeHash,prior.graderFreezeHash);const event=Object.fromEntries(Object.entries(data.recoveries![stage]).filter(([key])=>key!=='at'&&key!=='previousHalt'));assert.deepEqual(event,prior.recovery);
   const backup=read<LedgerData>(prior.recovery.backupPath);assert.equal(digest(readFileSync(prior.recovery.backupPath)),prior.recovery.originalLedgerSha256);assert.deepEqual(backup.requests,data.requests.slice(0,priorCount));assert.deepEqual(backup.recoveries??[],data.recoveries!.slice(0,stage));
   const previousProgress=read<{records:JudgeRecord[];scores:unknown[];halted:string;totals:unknown}>(join(dir,'progress.json')),halt=end===3?'Unsupported additional judgment field reasonDetail':formatHalt;
   assert.equal(previousProgress.records.length,end-1);assert.equal(previousProgress.scores.length,end-1);assert.equal(previousProgress.halted,halt);assert.deepEqual(previousProgress.totals,{requests:endCount,input:data.requests.slice(0,endCount).reduce((n,r)=>n+r.usage!.inputTokens,0),output:data.requests.slice(0,endCount).reduce((n,r)=>n+r.usage!.outputTokens,0),unknown:0});assert.deepEqual(previousProgress.records.map(r=>r.id),work.slice(0,end-1).map(w=>w.input.id));
   const names=Array.from({length:end-start},(_,i)=>String(start+i+1).padStart(3,'0'));assert.deepEqual(readdirSync(dir).filter(n=>/^\d+$/.test(n)).sort(),names);assert.ok(!existsSync(join(dir,'scores.json')));assert.equal(read<{reason:string}>(join(dir,String(end).padStart(3,'0'),'failure.json')).reason,halt);returnedDirs.push(...names.map(name=>join(dir,name)));
  }
 }

 const returned=returnedDirs.map((dir,index)=>{
  const rawPath=join(dir,'response.json'),raw=validateProviderResponse(read(rawPath),config),output=read<unknown>(join(dir,'output.json')),row=data.requests.find(r=>r.role==='judge'&&r.trialId===work[index].input.id)!;
  assert.deepEqual(read(join(dir,'input.json')),work[index].input);assert.deepEqual(read(join(dir,'request.json')),requestBody(config,rubric,work[index].input));assert.deepEqual(JSON.parse(raw.content),output);
  assert.equal(row.usage?.providerRequestId,raw.id);assert.equal(row.usage?.responseSha256,digest(readFileSync(rawPath)));assert.equal(row.usage?.inputTokens,raw.usage.inputTokens);assert.equal(row.usage?.outputTokens,raw.usage.outputTokens);return {dir,rawPath,raw,output,row};
 });
 assert.equal(read<{reason:string}>(join(firstDir,'failure.json')).reason,formatHalt);assert.deepEqual(Object.keys(normalizeJudgment(returned[0].output).extensions),['clarityNote']);
 if(prefix>=3)assert.deepEqual(Object.keys(normalizeJudgment(returned[2].output).extensions),['reasonDetail']);
 const artifacts:Record<string,string>={...inheritedArtifacts},seal=(path:string)=>{artifacts[resolve(path)]=digest(readFileSync(path));};
 for(const path of [p.originalFreeze,p.config,p.calibration,join(p.batch,'protocol.json'),join(p.batch,'runs.json'),join(p.batch,'batch-state.json'),join(p.failedGrading,'protocol.json'),join(p.failedGrading,'progress.json')])seal(path);
 for(const row of rows){const dir=join(p.batch,row.id),path=join(dir,'evidence-hashes.json');seal(path);for(const [name,hash] of Object.entries(read<Record<string,string>>(path))){const file=join(dir,name);assert.equal(digest(readFileSync(file)),hash,`Original sealed evidence drift: ${file}`);seal(file);}}
 for(const item of returned)for(const name of readdirSync(item.dir))seal(join(item.dir,name));
 if(p.previousContinuation){const sealDirectory=(dir:string)=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())sealDirectory(path);else seal(path);}};sealDirectory(p.previousContinuation);}
 for(const record of calibration.records)for(const name of [record.requestPath,record.responsePath,record.outputPath,join(dirname(record.requestPath),'input.json')])seal(join(dirname(p.calibration),name));
 mkdirSync(p.directory,{mode:0o700});const backupPath=join(p.directory,'original-ledger.json');writeFileSync(backupPath,originalBytes,{mode:0o600,flag:'wx'});seal(backupPath);
 const checks=[];mkdirSync(join(p.directory,'calibration-revalidation'));
 for(const record of calibration.records){
  const dir=join(p.directory,'calibration-revalidation',record.id);mkdirSync(dir);const rawOutput=join(dirname(p.calibration),record.outputPath),inputPath=join(dirname(p.calibration),dirname(record.requestPath),'input.json');
  assert.deepEqual(read(inputPath),JSON.parse(read<{messages:Array<{content:string}>}>(join(dirname(p.calibration),record.requestPath)).messages[1].content));
  const output=normalizeStoredJudgment(rawOutput,inputPath,dir);assert.deepEqual(output,read(rawOutput),'Calibration canonical values must remain identical');checks.push({id:record.id,unchanged:true,verdict:output.verdict,rawSha256:digest(readFileSync(rawOutput))});
 }
 save(join(p.directory,'calibration-revalidation.json'),{providerRequests:0,records:checks});
 const reusedRecords:JudgeRecord[]=[],reusedOutputs:Array<Judgment|null>=[];
 for(const [index,item] of returned.entries()){
  const reusedDir=join(p.directory,'reused-'+String(index+1).padStart(3,'0'));mkdirSync(reusedDir);let output:Judgment|null=null,judgeError:JudgeRecord['judgeError'];
  try{output=normalizeStoredJudgment(join(item.dir,'output.json'),join(item.dir,'input.json'),reusedDir);}catch(error){
   if(!(error instanceof JudgeOutputError)||index!==10||prefix!==11)throw error;
   assert.deepEqual(error.validationErrors,['verdict contradicts axes']);judgeError={validationErrors:error.validationErrors,rawJudgment:item.output};
   save(join(reusedDir,'judge-error.json'),{kind:'judge_error',validationErrors:error.validationErrors,rawJudgment:item.output,canonicalFieldsChanged:false,requiresReview:true});seal(join(reusedDir,'judge-error.json'));
  }
  const canonicalPath=join(reusedDir,'canonical-output.json');seal(canonicalPath);seal(join(reusedDir,'normalization.json'));reusedOutputs.push(output);
  if(existsSync(join(item.dir,'canonical-output.json')))assert.deepEqual(read(canonicalPath),read(join(item.dir,'canonical-output.json')),'Earlier canonical values must not change');
  const record:JudgeRecord={id:work[index].input.id,requestPath:relative(p.directory,join(item.dir,'request.json')),requestSha256:digest(readFileSync(join(item.dir,'request.json'))),responsePath:relative(p.directory,item.rawPath),responseSha256:digest(readFileSync(item.rawPath)),outputPath:relative(p.directory,canonicalPath),outputSha256:digest(readFileSync(canonicalPath)),requestId:item.raw.id,startedAt:item.row.startedAt,completedAt:statSync(item.rawPath).mtime.toISOString(),model:item.raw.model,usage:item.raw.usage,...(judgeError?{judgeError,outputKind:'canonical' as const}:{})};reusedRecords.push(record);
  save(join(reusedDir,'reuse.json'),{providerRequests:0,originalDirectory:item.dir,originalResponseSha256:record.responseSha256,completedAtSource:'original-response-file-mtime',canonicalizationAt:new Date().toISOString(),canonicalFieldsChanged:false,metadataReview:'pending_semantic_conflict_review'});
 }
 const recovery:FormatRecovery={authorization:'2026-10-25 user approved completing the same 64 judgments without resending any returned response',originalLedgerSha256:digest(originalBytes),backupPath,repairedFreezeHash:digest(JSON.stringify(current)),reusedRequestId:last.id,canonicalOutputSha256:reusedRecords.at(-1)!.outputSha256,remainingJudgeTrialIds:work.slice(prefix).map(w=>w.input.id),...(prefix>1?{parentRecoverySha256:digest(JSON.stringify(data.recoveries!.at(-1)))}:{})};
 const prepared:Prepared={schemaVersion:1,paths:p,originalFreezeHash,graderFreeze:current,graderFreezeHash:recovery.repairedFreezeHash,changedFiles,artifacts,recovery,reusedRecords,reusedOutputs,calibrationBindings:approved.bindings};
 save(join(p.directory,'grader-freeze.json'),{schemaVersion:1,originalFreezeHash,graderFreezeHash:prepared.graderFreezeHash,changedFiles,source:current,parentRecoverySha256:recovery.parentRecoverySha256??null});save(join(p.directory,'continuation.json'),prepared);
 assert.equal(digest(readFileSync(p.ledger)),recovery.originalLedgerSha256,'Offline prepare must not mutate ledger');return {directory:p.directory,calibrationRevalidated:checks.length,reused:prefix,judgeErrors:reusedRecords.filter(r=>r.judgeError).length,remaining:64-prefix,graderFreezeHash:prepared.graderFreezeHash};
}
interface ContinueOptions {directory:string;work:JudgeWork[];reusedRecords:JudgeRecord[];reusedOutputs:Array<Judgment|null>;ledger:Ledger;config:JudgeConfig;rubric:string;secret:string;verify:(item:JudgeWork)=>Promise<void>;transport?:typeof fetch}
/** Shared testable loop: the returned prefix is reused; each remaining slot gets one first-time request. */
export async function continueJudgments(o:ContinueOptions){
 const prefix=o.reusedRecords.length;assert.ok([1,3,11].includes(prefix));assert.equal(o.reusedOutputs.length,prefix);assert.equal(o.work.length,64);assert.deepEqual(o.reusedRecords.map(r=>r.id),o.work.slice(0,prefix).map(w=>w.input.id));
 const records=[...o.reusedRecords],scores:Array<ReturnType<typeof taskScore>|ReturnType<typeof taskJudgeError>>=o.reusedOutputs.map((output,index)=>output?taskScore(o.work[index],output):taskJudgeError(o.work[index],o.reusedRecords[index])),requestsBefore=o.ledger.totals('judge').requests;
 try{for(const [index,item] of o.work.slice(prefix).entries()){
  await o.verify(item);const child=join(o.directory,String(index+prefix+1).padStart(3,'0'));let record:JudgeRecord;
  try{
   const result=await requestJudgment({directory:child,input:item.input,config:o.config,rubric:o.rubric,secret:o.secret,ledger:o.ledger,transport:o.transport,isolateOutputErrors:true});record=result.record;scores.push(taskScore(item,result.output));
  }catch(error){if(!(error instanceof JudgeOutputError)||!error.record)throw error;record=error.record;scores.push(taskJudgeError(item,record));}
  records.push({...record,requestPath:relative(o.directory,join(child,record.requestPath)),responsePath:relative(o.directory,join(child,record.responsePath)),outputPath:relative(o.directory,join(child,record.outputPath))});
 }}finally{save(join(o.directory,'progress.json'),{records,scores,totals:o.ledger.totals(),halted:o.ledger.read().halted??null,reusedResponses:prefix,newRequests:o.ledger.totals('judge').requests-requestsBefore,judgeErrors:records.filter(r=>r.judgeError).length});}
 return {records,scores};
}

export async function runContinuation(directory:string,env:NodeJS.ProcessEnv=process.env){
 const prepared=read<Prepared>(join(resolve(directory),'continuation.json')),p=prepared.paths,prefix=prepared.reusedRecords.length;assert.ok([1,3,11].includes(prefix));assert.equal(Boolean(p.previousContinuation),prefix>1);checkPaths(p);assert.equal(p.directory,resolve(directory));assert.ok(!existsSync(join(p.directory,'execution-started.json')),'This continuation cannot be restarted');
 assert.equal(prepared.originalFreezeHash,digest(JSON.stringify(read(p.originalFreeze))));assert.deepEqual(await sourceFreeze(),prepared.graderFreeze,'Repaired grader source drift');assert.equal(prepared.graderFreezeHash,digest(JSON.stringify(prepared.graderFreeze)));assertRepairScope(read<Freeze>(p.originalFreeze),prepared.graderFreeze);verifyArtifacts(prepared.artifacts);
 const approved=gate('verify',p.config,p.calibration);assert.deepEqual(approved.bindings,prepared.calibrationBindings);const {work}=loadTaskWork(p.batch,read(p.originalFreeze));assert.equal(work.length,64);assert.ok(work.every(w=>w.trial?.status==='recorded'));
 assert.deepEqual(work.slice(prefix).map(w=>w.input.id),prepared.recovery.remainingJudgeTrialIds);assert.equal(prepared.recovery.repairedFreezeHash,prepared.graderFreezeHash);assert.equal(prepared.recovery.canonicalOutputSha256,prepared.reusedRecords.at(-1)!.outputSha256);
 for(const [index,record] of prepared.reusedRecords.entries()){
  assert.equal(record.id,work[index].input.id);assert.equal(digest(readFileSync(join(p.directory,record.outputPath))),record.outputSha256);
  const response=validateProviderResponse(read(join(p.directory,record.responsePath)),read<JudgeConfig>(p.config)),raw=JSON.parse(response.content),canonical=read(join(p.directory,record.outputPath));assert.deepEqual(canonical,normalizeJudgment(raw).canonical,'Reused canonical values must equal the original response');
  if(record.judgeError){assert.equal(index,10);assert.equal(prepared.reusedOutputs[index],null);assert.deepEqual(record.judgeError.rawJudgment,raw);assert.throws(()=>validateJudgment(join(p.directory,record.outputPath),join(p.batch,work[index].trial!.id,'judge-input.json')),(error:unknown)=>error instanceof JudgeOutputError&&JSON.stringify(error.validationErrors)===JSON.stringify(record.judgeError!.validationErrors));}
  else assert.deepEqual(prepared.reusedOutputs[index],canonical);
 }
 const ledger=openLedger(p.ledger,prepared.originalFreezeHash);assert.equal(assertOriginalLedger(ledger.read(),work[0].input.id,work.slice(1,prefix).map(w=>w.input.id)).id,prepared.recovery.reusedRequestId);assert.equal(digest(readFileSync(p.ledger)),prepared.recovery.originalLedgerSha256);assertCalibrationAccounting(ledger,read<{records:JudgeRecord[]}>(p.calibration).records);
 const config=read<JudgeConfig>(p.config),rubric=readFileSync(join(materials,'rubric.md'),'utf8');for(const w of work)requestBody(config,rubric,w.input);const environment=liveEnvironment(env);
 save(join(p.directory,'execution-started.json'),{at:new Date().toISOString(),authorization:prepared.recovery.authorization,reused:prefix,remaining:64-prefix,automaticRetry:false});ledger.recoverFormatHalt(prepared.recovery);
 const result=await continueJudgments({directory:p.directory,work,reusedRecords:prepared.reusedRecords,reusedOutputs:prepared.reusedOutputs,ledger,config,rubric,secret:environment.LLM_API_KEY!,verify:async item=>{assert.deepEqual(await sourceFreeze(),prepared.graderFreeze,'Repaired grader source drift');for(const artifact of item.artifacts??[])assert.equal(digest(readFileSync(artifact.path)),artifact.hash,'Task evidence drift');assert.equal(digest(readFileSync(join(p.batch,'runs.json'))),prepared.artifacts[join(p.batch,'runs.json')]);}});
 save(join(p.directory,'results.json'),{schemaVersion:1,kind:'task_grading',bindings:approved.bindings,records:result.records});save(join(p.directory,'scores.json'),{schemaVersion:1,planned:64,scored:result.scores.filter(s=>s.strict!=='judge_error').length,judgeErrors:result.records.filter(r=>r.judgeError).length,processed:result.records.length,unscored:64-result.scores.length,scope:'diagnostic_not_release_acceptance',humanAudit:'pending',reusedResponses:prefix,newRequests:64-prefix,previousContinuation:p.previousContinuation??null,originalFailureRetained:join(p.failedGrading,'001/failure.json'),records:result.scores});return {directory:p.directory,scored:result.scores.filter(s=>s.strict!=='judge_error').length,judgeErrors:result.records.filter(r=>r.judgeError).length,processed:result.records.length,newRequests:64-prefix,reused:prefix};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,directory,originalFreeze,ledger,config,calibration,batch,failedGrading,previousContinuation]=process.argv.slice(2);assert.ok(directory);
 const promise=mode==='prepare'?prepareContinuation({directory,originalFreeze,ledger,config,calibration,batch,failedGrading,previousContinuation}):mode==='run'?runContinuation(directory):Promise.reject(new Error('Usage: judge-continuation.ts prepare OUTPUT OLD_FREEZE LEDGER CONFIG CALIBRATION BATCH FAILED_GRADING [PREVIOUS_CONTINUATION] | run OUTPUT'));
 void promise.then(result=>console.info(JSON.stringify(result))).catch(error=>{console.error(error instanceof Error?error.message:'Continuation failed');process.exitCode=1;});
}
