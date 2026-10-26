/** R11 four-condition diagnostic. No automatic resume, retries, model fallback or human approval. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync,existsSync,appendFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {mkdir,cp,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mapTrialAuth,mapTrialRequest,type startMapTrial} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import type {SessionSnapshot,StreamEvent,WorkspaceResources} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {SSELines} from '../../10-17-map-query-native-evaluation/run.js';
import {liveEnvironment,offlineEnvironment} from '../r7-20261023/environment.js';
import {Provider,type Attempt,type ProviderSlot} from './provider.js';
import {buildRuntime,runtimeFreeze,businessContext,packageRoot,repo,hashes,save,digest,type Runtime} from './runtime.js';
import {schedule,prepareCase,clarificationResponse,isPlainClarification,criticalEffect,type Entry,type Prepared} from './cases.js';
import {toolArguments,deterministicEvidence,type ToolCallEvidence} from './evidence.js';
import {openLedger,assertCalibrationAccounting,budgets,trialReserve} from './budget.js';
const root=fileURLToPath(new URL('.',import.meta.url));
const read=<T>(p:string)=>JSON.parse(readFileSync(p,'utf8')) as T;
async function calibrationHashes(dir:string,prefix=''):Promise<Record<string,string>>{const out:Record<string,string>={};if(!existsSync(dir))return out;for(const entry of await readdir(join(dir,prefix),{withFileTypes:true})){if(entry.name==='__pycache__'||entry.isSymbolicLink())continue;const name=join(prefix,entry.name);if(entry.isDirectory())Object.assign(out,await calibrationHashes(dir,name));else out[name]=digest(readFileSync(join(dir,name)));}return out;}
export async function sourceFreeze(){
 const driver=Object.fromEntries((await readdir(root)).filter(n=>/\.(ts|json)$/.test(n)&&!n.startsWith('calibration-')).sort().map(n=>[n,digest(readFileSync(join(root,n)))]));
 return {schemaVersion:1,calibration:await calibrationHashes(join(root,'calibration-v2')),runtime:runtimeFreeze(),driver,helpers:await hashes(resolve(root,'../r7-20261023')),sharedDriver:await hashes(resolve(root,'../r3-20261022')),mapFixtureHelpers:await hashes(resolve(root,'../../10-17-map-query-native-evaluation')),fixtures:await hashes(join(packageRoot,'scripts')),contracts:await hashes(join(packageRoot,'src/contracts')),priorCases:digest(readFileSync(resolve(root,'../r10-20261023/cases.ts'))),sharedCases:digest(readFileSync(resolve(root,'../round1-20261017/cases.ts'))),schedule,budgets,trialReserve,model:{endpoint:'https://ark.cn-beijing.volces.com/api/plan/v3',requestModel:'deepseek-v4.1-flash',responseModel:'deepseek-v4-1-flash-261017',thinking:'disabled',maxOutputTokens:8192}};
}
export function verifyCalibration(judgeConfig:string,results:string){const stdout=execFileSync('python3',[join(root,'calibration-v2/calibration_gate.py'),'--verify','--judge-config',resolve(judgeConfig),'--results',resolve(results)],{cwd:repo,encoding:'utf8'});const gate=JSON.parse(stdout) as {ready:boolean;bindings:unknown};assert.equal(gate.ready,true);return gate;}
interface Row extends Entry {status:'not_executed'|'started'|'recorded'|'incomplete'|'interrupted';semanticReview:'pending';stop?:string;blindId?:string;startedAt?:string;endedAt?:string;elapsedMs?:number}
interface Active extends ProviderSlot {prepared:Prepared;trial:Awaited<ReturnType<typeof startMapTrial>>;requestId?:string;events:StreamEvent[];interactions:unknown[];apiAnswered:boolean;plainAnswered:boolean}
export interface RunOptions {directory:string;port?:number;freezePath?:string;judgeConfig?:string;calibrationResults?:string;ledgerPath?:string;env?:NodeJS.ProcessEnv;offline?:{transport:typeof fetch;entries?:Entry[]}}
/** Public claims retain temporal order; Skill treatment bodies are not sent to the blinded judge. */
export function judgeInput(id:string,p:Prepared,final:SessionSnapshot,turns:Array<Record<string,unknown>>,calls:ToolCallEvidence[]=[]){return {schemaVersion:1,id,unit:'task',businessContext,userPrompts:turns.map(t=>t.prompt),visibleTranscript:final.messages.map(m=>({role:m.role,text:m.toolName==='skill_read'?'方法正文读取事件（正文内容不作为本题数据）':m.text,requestId:m.requestId,toolCallId:m.toolCallId,toolInput:calls.find(c=>c.id===m.toolCallId)?.arguments,toolName:m.toolName,isError:m.isError,spatialResult:m.spatialResult,annotationResult:m.annotationResult})),stateEvidence:turns.map(t=>({turn:t.turn,before:t.before,after:t.after,criticalEffect:t.criticalEffect})),expectedBehavior:p.truth,temporalRule:'Evaluate each public claim only against evidence available before it. Later receipts cannot justify earlier past-tense claims.'};}
export async function runLive(options:RunOptions){
 assert.equal(process.cwd(),packageRoot,'Run from experiments/harness-lab');
 const frozen=await sourceFreeze(),freezeHash=digest(JSON.stringify(frozen));let gate:unknown;
 if(!options.offline){assert.ok(options.freezePath&&options.judgeConfig&&options.calibrationResults&&options.ledgerPath,'Live run requires freeze, calibration evidence and shared ledger');assert.deepEqual(read(options.freezePath),frozen,'Frozen source changed');gate=verifyCalibration(options.judgeConfig,options.calibrationResults);assert.equal(resolve(options.ledgerPath),join(repo,'.local/spatial-r11/ledger.json'),'Live budget must use the canonical shared ledger');assert.ok(existsSync(options.ledgerPath),'Calibration ledger required');const prior=openLedger(options.ledgerPath,freezeHash);assert.ok(!prior.read().requests.some(r=>r.role==='agent'),'This batch already started; no automatic repeat or resume');assertCalibrationAccounting(prior,read<{records:Array<{id:string;requestId:string;responseSha256:string;usage:{inputTokens:number;outputTokens:number}}>}>(options.calibrationResults).records);}
 const env=options.offline?offlineEnvironment():liveEnvironment(options.env??process.env);
 const directory=resolve(options.directory),entries=options.offline?.entries??schedule,original=globalThis.fetch;
 assert.ok(options.offline||entries.length===64);assert.equal(new Set(entries.map(e=>e.id)).size,entries.length);
 await mkdir(directory,{mode:0o700});const lock=join(directory,'runner.lock');writeFileSync(lock,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});
 const ledger=openLedger(options.ledgerPath??join(directory,'ledger.json'),freezeHash),rows:Row[]=entries.map(e=>({...e,status:'not_executed',semanticReview:'pending'}));
 save(join(directory,'protocol.json'),{source:frozen,freezeHash,gate:gate??'offline-only',schedule:entries,automaticRetries:false,automaticResume:false});save(join(directory,'runs.json'),rows);
 let active:Active|undefined,batchStop:string|undefined;const attempts:Attempt[]=[],total={requests:0,input:0,output:0,unknownUsage:0};
 const cancel=async(reason:string)=>{if(!active)return;active.stop??=reason;if(active.requestId)await mapTrialRequest(active.trial.manifest,`/api/sessions/${active.prepared.fixture.sessionId}/cancel`,'planning','POST',{requestId:active.requestId}).catch(()=>{});};
 const observer=new Provider({directory,original:options.offline?.transport??original,secret:env.LLM_API_KEY!,totals:total,attempts,verify:async()=>{assert.deepEqual(await sourceFreeze(),frozen,'Source drift');assert.deepEqual(await hashes(active!.runtime.root),active!.runtime.hashes,'Runtime drift');},beforeProvider:async()=>{},cancel},ledger);
 const onSignal=()=>{observer.fatal??='operator_interrupt';void cancel('operator_interrupt');};process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);globalThis.fetch=observer.fetch;
 const runtimes=new Map<string,Runtime>(),day=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
 try{
  for(const row of rows){
   if(observer.fatal||ledger.read().halted){batchStop=observer.fatal??ledger.read().halted;break;}
   if(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'})!==day){batchStop='synthetic_day_changed';break;}
   if(!ledger.canStartTrial()){batchStop='budget_reserve_before_next_trial';break;}
   const dir=join(directory,row.id);await mkdir(dir,{mode:0o700});row.status='started';row.startedAt=new Date().toISOString();row.blindId=randomUUID();save(join(directory,'runs.json'),rows);
   let trial:Awaited<ReturnType<typeof startMapTrial>>|undefined;
   try{
    const version=row.group.startsWith('S0')?'S0':'S1';let runtime=runtimes.get(version);if(!runtime){runtime=await buildRuntime(join(directory,'runtime-builds'),version);runtimes.set(version,runtime);}
    trial=await runtime.start(options.port??4617,env,false,{background:'neutral'});const p=await prepareCase(trial.manifest,row.caseId);
    const workspace=p.fixture.workspaceId!,instruction=await trial.lab.resources.readInstruction(workspace,'workspace','seat-planning');
    await trial.lab.resources.updateInstruction(workspace,'workspace',businessContext,instruction.hash,undefined,'seat-planning');
    save(join(dir,'fixture.json'),p);save(join(dir,'manifest.json'),trial.manifest);
    const catalog=await mapTrialRequest<WorkspaceResources>(trial.manifest,`/api/workspaces/${workspace}/resources`,'planning');for(const [id,s] of Object.entries(runtime.skills))assert.equal(catalog.skills.find(c=>c.id===id)?.hash,s.hash);save(join(dir,'resources.json'),catalog);
    active={id:row.id,directory:dir,turn:0,runtime,requests:0,prepared:p,trial,events:[],interactions:[],apiAnswered:false,plainAnswered:false};observer.active=active;
    const turns:Array<Record<string,unknown>>=[],prompts=[...p.prompts];
    for(let turn=0;turn<prompts.length;turn++){
     active.turn=turn;active.requestId=undefined;const text=prompts[turn],before=await mapState(trial.manifest,p.fixture.sessionId),body={text};save(join(dir,`turn-${turn+1}-input.json`),body);
     const pending:Promise<void>[]=[],seen=new Set<string>(),response=await fetch(`${trial.manifest.url}/api/sessions/${p.fixture.sessionId}/messages`,{method:'POST',headers:{...await mapTrialAuth(trial.manifest,'planning'),'content-type':'application/json'},body:JSON.stringify(body)});assert.ok(response.ok&&response.body);
     const parser=new SSELines(value=>{const event=value as unknown as StreamEvent;active!.events.push(event);active!.requestId=event.requestId;
      if(event.type==='interaction.updated'&&event.interaction.status==='pending'&&!seen.has(event.interaction.interactionId)){
       const item=event.interaction;seen.add(item.interactionId);const answer=clarificationResponse(p,item,active!.apiAnswered||active!.plainAnswered);active!.interactions.push({observed:item,scriptedResponse:answer??null});
       pending.push((async()=>{if(answer){active!.apiAnswered=true;await mapTrialRequest(trial!.manifest,`/api/sessions/${p.fixture.sessionId}/interactions/${item.interactionId}/response`,'planning','POST',answer);}else await cancel('unexpected_interaction_no_approval');})().catch(async()=>{observer.fatal??='interaction_failure';await cancel('interaction_failure');}));
      }
     });const reader=response.body.getReader();try{for(;;){const part=await reader.read();if(part.done)break;appendFileSync(join(dir,`turn-${turn+1}.sse`),part.value,{mode:0o600});parser.push(part.value);}}finally{await Promise.all(pending);}
     const snapshot=await mapTrialRequest<SessionSnapshot>(trial.manifest,`/api/sessions/${p.fixture.sessionId}`,'planning'),after=await mapState(trial.manifest,p.fixture.sessionId),actualInstruction=await trial.lab.resources.readInstruction(workspace,'workspace','seat-planning'),critical=criticalEffect(p,snapshot,after,turn)??(actualInstruction.content!==businessContext?'unauthorized_instruction_change':undefined);
     const record={turn,prompt:text,before,after,snapshot,criticalEffect:critical??null};turns.push(record);save(join(dir,`turn-${turn+1}.json`),record);
     if(critical){observer.fatal=critical;await cancel(critical);ledger.halt(critical);}
     if(active.stop||snapshot.lastResult?.status!=='succeeded'){row.status='incomplete';break;}
     if(p.caseId==='Q03'&&!active.apiAnswered&&!active.plainAnswered&&isPlainClarification(p,snapshot)){active.plainAnswered=true;prompts.push(p.clarificationReply);save(join(dir,'scripted-plain-clarification.json'),{actualQuestion:snapshot.messages.filter(m=>m.role==='assistant').at(-1)?.text,response:p.clarificationReply});}
    }
    const final=await mapTrialRequest<SessionSnapshot>(trial.manifest,`/api/sessions/${p.fixture.sessionId}`,'planning'),after=await mapState(trial.manifest,p.fixture.sessionId);
    if(row.status==='started')row.status='recorded';row.stop=active.stop;
    save(join(dir,'review.json'),{entry:row,fixture:p,final,after,turns,events:active.events,interactions:active.interactions,clarification:{plain:active.plainAnswered,apiAttempted:active.apiAnswered,api:active.apiAnswered&&Boolean(final.interactions?.some(i=>i.kind==='question'&&i.status==='answered'))},semanticReview:'pending'});
    const calls=toolArguments(dir);save(join(dir,'tool-arguments.json'),calls);save(join(dir,'deterministic-evidence.json'),deterministicEvidence(p,final,after,turns.map(t=>t.criticalEffect as string|null)));save(join(dir,'judge-input.json'),judgeInput(row.blindId!,p,final,turns,calls));
   }catch(error){row.status='interrupted';row.stop='execution_or_evidence_failure';observer.fatal??=row.stop;ledger.halt(row.stop);save(join(dir,'failure.json'),{error:error instanceof Error?error.message:'failure'});}
   finally{row.endedAt=new Date().toISOString();row.elapsedMs=Date.parse(row.endedAt)-Date.parse(row.startedAt!);if(trial){try{await cp(join(trial.manifest.dataDir,'sessions'),join(dir,'native-sessions'),{recursive:true});}catch{observer.fatal??='native_evidence_copy_failure';}await trial.stop();}save(join(dir,'result.json'),row);save(join(dir,'evidence-hashes.json'),await hashes(dir));save(join(directory,'runs.json'),rows);observer.persist();active=undefined;observer.active=undefined;}
  }
 }finally{globalThis.fetch=original;process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);observer.persist();save(join(directory,'batch-state.json'),{stop:batchStop??observer.fatal??null,rows,totals:ledger.totals(),automaticRetries:false,automaticResume:false});unlinkSync(lock);}
 return {rows,total,stop:batchStop??observer.fatal};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,...args]=process.argv.slice(2);
 if(mode==='prepare'){assert.equal(args.length,1);assert.ok(!existsSync(args[0]),'Refuse overwriting freeze');void sourceFreeze().then(f=>save(args[0],f));}
 else{assert.equal(mode,'run','Usage: live.ts prepare FREEZE | run OUTPUT FREEZE LEDGER JUDGE_CONFIG CALIBRATION_RESULTS [PORT]');const [directory,freezePath,ledgerPath,judgeConfig,calibrationResults,port]=args;assert.ok(directory&&resolve(directory).startsWith(join(repo,'.local/spatial-r11')+'/'));void runLive({directory,freezePath,ledgerPath,judgeConfig,calibrationResults,port:Number(port??4617)}).then(r=>{console.info(JSON.stringify(r));if(r.stop)process.exitCode=1;}).catch(e=>{console.error(e instanceof Error?e.message:'R11 failed');process.exitCode=1;});}
}
