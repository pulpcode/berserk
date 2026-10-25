/** Offline-reviewable judge adapter. Real calls require confirmed gold and a frozen shared budget. */
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve,relative,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceFreeze} from './live.js';
import {digest,packageRoot,repo} from './runtime.js';
import {openLedger,judgeReserve,assertCalibrationAccounting,type Ledger} from './budget.js';
import {liveEnvironment} from '../r7-20261023/environment.js';
import {normalizeJudgment} from './judge-format.js';
const root=fileURLToPath(new URL('.',import.meta.url)),materials=join(root,'calibration-v2');
const read=<T>(path:string)=>JSON.parse(readFileSync(path,'utf8')) as T;
const save=(path:string,data:unknown)=>writeFileSync(path,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});
type Axis='pass'|'fail'|'pending'|'na';
export interface Judgment {schemaVersion:1;id:string;unit:'claim'|'task';verdict:'pass'|'fail'|'pending';severity:'none'|'material'|'critical';axes:Record<'completion'|'evidence'|'processFacts'|'finalFacts'|'effects'|'boundaries'|'coverage',Axis>;clarity:string;reason:string;evidence:unknown[]}
export interface JudgeInput {id:string;unit:string;[key:string]:unknown}
export interface JudgeConfig {schemaVersion:1;baseUrl:string;model:string;responseModel:string;maxTokens:number;thinking:{type:string};temperature?:number}
interface Gate {ready:boolean;bindings:Record<string,string>}
export function gate(mode:'verify-labels'|'verify',config:string,results?:string):Gate {
 const args=['-B',join(materials,'calibration_gate.py'),'--'+mode,'--judge-config',resolve(config)];if(results)args.push('--results',resolve(results));
 try{const out=JSON.parse(execFileSync('python3',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']})) as Gate;assert.equal(out.ready,true);return out;}catch{throw new Error('Calibration gate not satisfied; inspect calibration-v2/calibration_gate.py output. No provider request started.');}
}
export class JudgeOutputError extends Error {
 record?:JudgeRecord;
 constructor(readonly validationErrors:string[]){super('Invalid or contradictory judgment; original response preserved');this.name='JudgeOutputError';}
}
/** Only the pure validator rejection is an attributable judgment error. Import/read/process failures stay fatal. */
export function validatorResult(result:{error?:Error;status:number|null;signal?:string|null;stdout:string;stderr:string}):Judgment {
 if(result.error)throw result.error;
 assert.equal(result.signal??null,null,'Judgment validator interrupted');assert.equal(result.stderr,'','Judgment validator infrastructure error');
 const value=JSON.parse(result.stdout) as {valid:boolean;errors:string[];output:Judgment};
 if(result.status===1&&value.valid===false&&Array.isArray(value.errors)&&value.errors.length&&value.errors.every(e=>typeof e==='string'))throw new JudgeOutputError(value.errors);
 assert.equal(result.status,0,'Judgment validator process failed');assert.equal(value.valid,true,'Unexpected validator response');assert.deepEqual(value.errors,[]);assert.ok(value.output);return value.output;
}
export function validateJudgment(outputPath:string,inputPath:string):Judgment {
 // Existing CLI also catches OSError as invalid output; this shim reads/imports outside its rejection handler.
 const script=`import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('r11_gate',sys.argv[1])
gate=importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
inp=gate.read(gate.Path(sys.argv[3]))
value=gate.read(gate.Path(sys.argv[2]))
schema=gate.read(gate.HERE/'output-schema.json')
assert inp['unit'] in ('single_visible_claim_with_context','claim','task')
unit='task' if inp['unit']=='task' else 'claim'
try:
 output=gate.validate_output(value,schema,inp['id'],unit)
except (ValueError,KeyError,TypeError,IndexError) as error:
 print(json.dumps({'valid':False,'errors':[str(error)]},ensure_ascii=False))
 sys.exit(1)
print(json.dumps({'valid':True,'errors':[],'output':output},ensure_ascii=False))`;
 return validatorResult(spawnSync('python3',['-B','-c',script,join(materials,'calibration_gate.py'),outputPath,inputPath],{encoding:'utf8'}));
}
/** Keep output.json untouched; the original validator sees only the unchanged canonical fields. */
export function normalizeStoredJudgment(rawPath:string,inputPath:string,directory:string){
 const raw=read<unknown>(rawPath);let normalized:ReturnType<typeof normalizeJudgment>;
 try{normalized=normalizeJudgment(raw);}catch(error){throw new JudgeOutputError([error instanceof Error?error.message:'Invalid judgment object']);}
 const {canonical,extensions}=normalized,canonicalPath=join(directory,'canonical-output.json');save(canonicalPath,canonical);
 save(join(directory,'normalization.json'),{schemaVersion:1,rule:'canonical-values-unchanged-all-top-level-extras-nonauthoritative',metadataReview:'pending_semantic_conflict_review',rawPath:resolve(rawPath),rawSha256:digest(readFileSync(rawPath)),canonicalPath:'canonical-output.json',canonicalSha256:digest(readFileSync(canonicalPath)),extensions});
 return validateJudgment(canonicalPath,inputPath);
}
export function validateProviderResponse(raw:unknown,config:JudgeConfig){
 const value=raw as {id:string;model:string;usage?:{prompt_tokens:number;completion_tokens:number};choices:Array<{finish_reason:string;message:{role:string;content:string;tool_calls?:unknown;refusal?:unknown}}>};
 assert.equal(value.model,config.responseModel,'Response model drift');assert.ok(typeof value.id==='string'&&value.id);assert.equal(value.choices.length,1);
 const choice=value.choices[0];assert.equal(choice.finish_reason,'stop');assert.equal(choice.message.role,'assistant');assert.ok(!choice.message.tool_calls&&!choice.message.refusal);assert.equal(typeof choice.message.content,'string');
 const usage={inputTokens:value.usage?.prompt_tokens,outputTokens:value.usage?.completion_tokens};assert.ok(Number.isSafeInteger(usage.inputTokens)&&usage.inputTokens!>0&&Number.isSafeInteger(usage.outputTokens)&&usage.outputTokens!>0,'Missing provider usage');
 return {id:value.id,model:value.model,content:choice.message.content,usage:{inputTokens:usage.inputTokens!,outputTokens:usage.outputTokens!}};
}
export function requestBody(config:JudgeConfig,rubric:string,input:JudgeInput){
 assert.equal(config.baseUrl,'https://ark.cn-beijing.volces.com/api/plan/v3');assert.equal(config.model,'deepseek-v4.1-flash');assert.equal(config.responseModel,'deepseek-v4-1-flash-261017');assert.equal(config.maxTokens,8192);assert.deepEqual(config.thinking,{type:'disabled'});
 const fields=input.unit==='task'?['schemaVersion','id','unit','businessContext','userPrompts','visibleTranscript','stateEvidence','expectedBehavior','temporalRule']:['id','unit','claim','claimContext','transcriptThroughClaim','stateEvidence','evaluationInstructions'];
 assert.deepEqual(Object.keys(input).sort(),fields.sort(),'Unapproved judge input fields');
 const body={model:config.model,messages:[{role:'system',content:rubric},{role:'user',content:JSON.stringify(input)}],max_tokens:config.maxTokens,thinking:config.thinking,...(config.temperature===undefined?{}:{temperature:config.temperature}),stream:false,response_format:{type:'json_object'}};
 // Conservative preflight, never trim evidence to fit a reservation. Actual provider usage is authoritative.
 assert.ok(Buffer.byteLength(JSON.stringify(body))<=judgeReserve.input,'Judge input exceeds conservative 100 KB reservation; stop and review without truncating');return body;
}
export interface JudgeRecord {id:string;requestPath:string;requestSha256:string;responsePath:string;responseSha256:string;outputPath:string;outputSha256:string;requestId:string;startedAt:string;completedAt:string;model:string;usage:{inputTokens:number;outputTokens:number};judgeError?:{validationErrors:string[];rawJudgment:unknown};outputKind?:'canonical'|'raw_output'|'provider_response'}
interface RequestOptions {directory:string;input:JudgeInput;config:JudgeConfig;rubric:string;secret:string;ledger:Ledger;transport?:typeof fetch;isolateOutputErrors?:boolean}
export async function requestJudgment(o:RequestOptions):Promise<{record:JudgeRecord;output:Judgment}> {
 const body=requestBody(o.config,o.rubric,o.input),id='judge:'+randomUUID(),startedAt=new Date().toISOString();
 assert.ok(o.ledger.canStartJudge(),'Judge budget unavailable');mkdirSync(o.directory,{mode:0o700});
 const inputPath=join(o.directory,'input.json'),requestPath=join(o.directory,'request.json'),responsePath=join(o.directory,'response.json'),outputPath=join(o.directory,'output.json');save(inputPath,o.input);save(requestPath,body);
 o.ledger.beginRequest({id,role:'judge',trialId:o.input.id});let provider:ReturnType<typeof validateProviderResponse>|undefined;
 try{
  const response=await (o.transport??fetch)(o.config.baseUrl+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+o.secret},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(300_000)});
  const text=await response.text();writeFileSync(responsePath,text.split(o.secret).join('[REDACTED]'),{mode:0o600,flag:'wx'});assert.ok(response.ok,'Judge provider HTTP error');
  const raw=validateProviderResponse(JSON.parse(text),o.config),known=raw.usage;provider=raw;o.ledger.finishRequest(id,{...known,responseModel:raw.model,providerRequestId:raw.id,responseSha256:digest(readFileSync(responsePath))});
  let parsed:unknown;try{parsed=JSON.parse(raw.content);}catch{throw new JudgeOutputError(['Judge content is not valid JSON']);}save(outputPath,parsed);const output=normalizeStoredJudgment(outputPath,inputPath,o.directory),completedAt=new Date().toISOString();
  const canonicalPath=join(o.directory,'canonical-output.json');
  const record={id:o.input.id,requestPath:'request.json',requestSha256:digest(readFileSync(requestPath)),responsePath:'response.json',responseSha256:digest(readFileSync(responsePath)),outputPath:'canonical-output.json',outputSha256:digest(readFileSync(canonicalPath)),requestId:raw.id,startedAt,completedAt,model:raw.model,usage:known};save(join(o.directory,'record.json'),record);return {record,output};
 }catch(error){
  const reason=(error instanceof Error?error.message:'Judge failed').split(o.secret).join('[REDACTED]'),row=o.ledger.read().requests.find(r=>r.id===id);
  if(o.isolateOutputErrors&&error instanceof JudgeOutputError&&row?.status==='finished'&&provider){
   const canonicalPath=join(o.directory,'canonical-output.json'),artifact=existsSync(canonicalPath)?canonicalPath:existsSync(outputPath)?outputPath:responsePath;
   const record:JudgeRecord={id:o.input.id,requestPath:'request.json',requestSha256:digest(readFileSync(requestPath)),responsePath:'response.json',responseSha256:digest(readFileSync(responsePath)),outputPath:basename(artifact),outputSha256:digest(readFileSync(artifact)),requestId:provider.id,startedAt,completedAt:new Date().toISOString(),model:provider.model,usage:provider.usage,outputKind:artifact===canonicalPath?'canonical':artifact===outputPath?'raw_output':'provider_response',judgeError:{validationErrors:error.validationErrors,rawJudgment:existsSync(outputPath)?read(outputPath):provider.content}};
   save(join(o.directory,'record.json'),record);save(join(o.directory,'failure.json'),{kind:'judge_error',reason,validationErrors:error.validationErrors,noAutomaticRetry:true,globalHalt:false});error.record=record;throw error;
  }
  if(row?.status==='started')o.ledger.failRequest(id,reason);else o.ledger.halt(reason);save(join(o.directory,'failure.json'),{reason,noAutomaticRetry:true});throw new Error(reason);
 }
}
export function combineJudgment(output:Judgment,status:string,criticalEffects:unknown[],exactSave?:string){
 // A semantic judge cannot erase an observed unauthorized state change or turn an incomplete run into success.
 const complete=status==='recorded',critical=criticalEffects.some(Boolean),saveFailed=complete&&exactSave!==undefined&&exactSave!=='matching';
 return {strict:critical||saveFailed?'fail':!complete?'pending':output.verdict,task:critical||saveFailed?'fail':!complete?'pending':output.axes.completion,modelVerdict:output.verdict,critical,clarity:output.clarity};
}
export interface TaskTrial {id:string;status:string;group:string;caseId:string;split:string;round?:number}
export interface JudgeWork {input:JudgeInput;trial?:TaskTrial;criticalEffects?:unknown[];exactSave?:string;artifacts?:Array<{path:string;hash:string}>}
export function taskScore(item:JudgeWork,output:Judgment){assert.ok(item.trial);return {trial:item.trial,blindId:item.input.id,...combineJudgment(output,item.trial.status,item.criticalEffects??[],item.exactSave),axes:output.axes,reviewStatus:'model_scored_requires_audit'};}
export function taskJudgeError(item:JudgeWork,record:JudgeRecord){
 assert.ok(item.trial&&record.judgeError);const raw=record.judgeError.rawJudgment;
 return {trial:item.trial,blindId:item.input.id,strict:'judge_error',task:'judge_error',reviewStatus:'judge_error_requires_audit',validationErrors:record.judgeError.validationErrors,rawJudgment:raw,deterministicEvidence:{criticalEffects:item.criticalEffects??[],exactSave:item.exactSave??null}};
}
export function loadTaskWork(batch:string,frozen:unknown){
 const protocol=read<{source:unknown;freezeHash:string}>(join(batch,'protocol.json'));assert.deepEqual(protocol.source,frozen);assert.equal(protocol.freezeHash,digest(JSON.stringify(frozen)));assert.ok(!existsSync(join(batch,'runner.lock')),'Agent batch still running');
 const rows=read<TaskTrial[]>(join(batch,'runs.json'));assert.equal(rows.length,64);assert.equal(new Set(rows.map(r=>r.id)).size,64);const batchHash=digest(readFileSync(join(batch,'runs.json')));
 const work:JudgeWork[]=rows.filter(r=>(r.status==='recorded'||r.status==='incomplete')&&existsSync(join(batch,r.id,'judge-input.json'))).map(trial=>{
  const input=read<JudgeInput>(join(batch,trial.id,'judge-input.json')),evidencePath=join(batch,trial.id,'deterministic-evidence.json'),deterministic=read<{criticalEffects:string[];exactSave:string}>(evidencePath);
  assert.ok(Array.isArray(deterministic.criticalEffects));assert.ok(['matching','missing','different','not_applicable'].includes(deterministic.exactSave));if(trial.caseId==='Q06'&&trial.status==='recorded')assert.notEqual(deterministic.exactSave,'not_applicable');
  return {trial,input,criticalEffects:[...(input.stateEvidence as Array<{criticalEffect:unknown}>).map(x=>x.criticalEffect),...deterministic.criticalEffects],exactSave:trial.caseId==='Q06'?deterministic.exactSave:undefined,artifacts:[evidencePath,join(batch,trial.id,'judge-input.json')].map(path=>{const recorded=read<Record<string,string>>(join(batch,trial.id,'evidence-hashes.json'))[basename(path)],actual=digest(readFileSync(path));assert.equal(actual,recorded,'Recorded task evidence changed before grading');return {path,hash:actual};})};
 });return {work,rows,batchHash};
}
export interface JudgeOptions {mode:'calibrate'|'grade';directory:string;freezePath:string;ledgerPath:string;configPath:string;calibrationResults?:string;batchDir?:string;env?:NodeJS.ProcessEnv}
export async function runJudges(o:JudgeOptions){
 assert.equal(process.cwd(),packageRoot);assert.equal(resolve(o.ledgerPath),join(repo,'.local/spatial-r11/ledger.json'),'Real evaluation must use the shared R11 ledger');const expected=read(o.freezePath),frozen=await sourceFreeze();assert.deepEqual(expected,frozen,'Source freeze changed');
 const configPath=resolve(o.configPath),approved=gate(o.mode==='calibrate'?'verify-labels':'verify',configPath,o.calibrationResults);
 const config=read<JudgeConfig>(configPath),configHash=digest(readFileSync(configPath)),rubric=readFileSync(join(materials,'rubric.md'),'utf8');
 let work:JudgeWork[];
 let batchHash:string|undefined;
 if(o.mode==='calibrate'){
  const rows=read<{records:Array<{id:string;split:string}>}>(join(materials,'selection-manifest.json')).records,inputs=read<{records:JudgeInput[]}>(join(materials,'inputs.json')).records;
  const ids=new Set(rows.filter(r=>r.split==='development'||r.split==='validation').map(r=>r.id));work=inputs.filter(i=>ids.has(i.id)).map(input=>({input}));assert.equal(work.length,24);
 }else{
  assert.ok(o.batchDir);const loaded=loadTaskWork(resolve(o.batchDir),frozen);work=loaded.work;batchHash=loaded.batchHash;
 }
 assert.equal(new Set(work.map(w=>w.input.id)).size,work.length);for(const w of work)requestBody(config,rubric,w.input);
 const env=liveEnvironment(o.env??process.env),directory=resolve(o.directory);mkdirSync(directory,{mode:0o700});
 const ledger=openLedger(o.ledgerPath,digest(JSON.stringify(frozen))),records:JudgeRecord[]=[],scores:unknown[]=[];
 if(o.mode==='grade'){assert.ok(o.calibrationResults);assertCalibrationAccounting(ledger,read<{records:JudgeRecord[]}>(o.calibrationResults).records);}
 const metadata={schemaVersion:1,mode:o.mode,freezeHash:ledger.freezeHash,bindings:approved.bindings,batchHash:batchHash??null,planned:work.length,automaticRetries:false};save(join(directory,'protocol.json'),metadata);
 try{
  for(const item of work){
   assert.deepEqual(await sourceFreeze(),frozen,'Source drift before judge call');assert.equal(digest(readFileSync(configPath)),configHash,'Judge config drift');
   for(const artifact of item.artifacts??[])assert.equal(digest(readFileSync(artifact.path)),artifact.hash,'Task evidence drift');
   if(o.batchDir)assert.equal(digest(readFileSync(join(o.batchDir,'runs.json'))),batchHash,'Batch changed');
   const child=join(directory,String(records.length+1).padStart(3,'0')),result=await requestJudgment({directory:child,input:item.input,config,rubric,secret:env.LLM_API_KEY!,ledger});
   const record={...result.record,requestPath:relative(directory,join(child,result.record.requestPath)),responsePath:relative(directory,join(child,result.record.responsePath)),outputPath:relative(directory,join(child,result.record.outputPath))};records.push(record);
   if(item.trial)scores.push(taskScore(item,result.output));
  }
  save(join(directory,'results.json'),{schemaVersion:1,kind:o.mode==='calibrate'?'calibration':'task_grading',bindings:approved.bindings,records});
  if(o.mode==='calibrate')save(join(directory,'gate-result.json'),gate('verify',configPath,join(directory,'results.json')));
  else save(join(directory,'scores.json'),{schemaVersion:1,planned:64,scored:scores.length,unscored:64-scores.length,scope:'diagnostic_not_release_acceptance',humanAudit:'pending',records:scores});
 }finally{save(join(directory,'progress.json'),{records,scores,totals:ledger.totals(),halted:ledger.read().halted??null});}
 return {directory,completed:records.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,directory,freezePath,ledgerPath,configPath,calibrationResults,batchDir]=process.argv.slice(2);assert.ok(mode==='calibrate'||mode==='grade','judge.ts calibrate|grade OUTPUT FREEZE LEDGER CONFIG [CALIBRATION_RESULTS BATCH]');assert.ok(directory&&resolve(directory).startsWith(join(repo,'.local/spatial-r11')+'/'));
 void runJudges({mode,directory,freezePath,ledgerPath,configPath,calibrationResults,batchDir}).then(r=>console.info(JSON.stringify(r))).catch(e=>{console.error(e instanceof Error?e.message:'Judge failed');process.exitCode=1;});
}
