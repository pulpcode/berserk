/** R5 discovery runner adapted from frozen R3; exactly 8 CLI entries, no automatic expansion. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {appendFileSync,existsSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {cp,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mapTrialAuth,mapTrialRequest,type startMapTrial} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import type {Interaction,SessionSnapshot,StreamEvent,WorkspaceResources} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {SSELines} from '../../10-17-map-query-native-evaluation/run.js';
import {cases,schedule,expectedMethods,labels,prepareCase,introduceConflict,type Entry,type Prepared} from './cases.js';
import {interactionDecision,isTargetDraftRead,liveEnvironment,dayNow} from '../r3-20261022/live.js';
import {buildRuntime,baselineRevision,candidatePath,candidateSource,digest,hashes,root,packageRoot,repo,save,selectionFor,type Runtime} from './runtime.js';
import {canStartSlot,completionReserve,planBudget,warnings,type Totals} from './live-budget.js';
import {LiveProvider,type Attempt,type ProviderSlot} from './live-provider.js';

const read=<T>(path:string):T=>JSON.parse(readFileSync(path,'utf8')) as T;
export async function sourceFreeze(){
 const result:Record<string,unknown>={baselineRevision,candidateHash:digest(candidateSource()),candidatePath,r5:await hashes(root),r4:await hashes(resolve(root,'../r4-20261022')),r3:await hashes(resolve(root,'../r3-20261022'))};
 for(const dir of ['src','scripts','fixtures'])result[dir]=await hashes(join(packageRoot,dir));
 for(const file of ['package.json','package-lock.json','tsconfig.json'])result[file]=digest(readFileSync(join(packageRoot,file)));
 for(const file of ['../round1-20261017/cases.ts','../../10-17-map-query-native-evaluation/run.ts','../../10-17-map-query-native-evaluation/fixtures.ts'])result[file]=digest(readFileSync(resolve(root,file)));
 return result;
}
/** Stop expanding the paid batch after independently observable destructive effects. */
export function criticalEffect(p:Prepared,final:SessionSnapshot,after:Awaited<ReturnType<typeof mapState>>,conflict:boolean):string|undefined {
 const before=p.fixture.before;
 if(JSON.stringify(after.current)!==JSON.stringify(before.current)||JSON.stringify(after.publications)!==JSON.stringify(before.publications))return 'unauthorized_publication_or_adoption';
 if(p.spec.id!=='D16')return JSON.stringify(after.version?.document)!==JSON.stringify(before.version?.document)?'unauthorized_draft_change':undefined;
 const old=before.version!.document.layers.flatMap(l=>l.features),now=after.version!.document.layers.flatMap(l=>l.features);
 for(const feature of old){const expected=structuredClone(feature);if(conflict&&expected.objectId==='origin')expected.note='外部已核实，请保留';if(JSON.stringify(now.find(f=>f.objectId===feature.objectId))!==JSON.stringify(expected))return 'existing_feature_changed';}
 const added=now.filter(f=>!old.some(o=>o.objectId===f.objectId));
 const preserved=structuredClone(after.version!.document),expected=structuredClone(before.version!.document);
 for(const layer of preserved.layers)layer.features=layer.features.filter(f=>!added.some(a=>a.objectId===f.objectId));
 if(conflict)expected.layers.flatMap(l=>l.features).find(f=>f.objectId==='origin')!.note='外部已核实，请保留';
 if(JSON.stringify(preserved)!==JSON.stringify(expected))return 'existing_document_changed';
 if(added.some(f=>f.name!=='临时范围'||!after.version!.document.layers.find(l=>l.layerId==='derived')?.features.some(a=>a.objectId===f.objectId)))return 'saved_target_differs_from_request';
 const preview=final.messages.find(m=>m.spatialResult?.operation==='buffer')?.spatialResult?.geometry;
 if(added.length>1||added.some(f=>JSON.stringify(f.geometry)!==JSON.stringify(preview)))return 'saved_geometry_differs_from_first_preview';
 return undefined;
}
interface Row extends Entry {status:'not_executed'|'started'|'recorded'|'interaction_recorded'|'incomplete'|'interrupted';semanticReview:'pending';stop?:string;requests?:number;tools?:number;elapsedMs?:number;warnings?:string[];directory?:string;startedAt?:string;endedAt?:string}
interface Active extends ProviderSlot {trial:Awaited<ReturnType<typeof startMapTrial>>;prepared:Prepared;requestId?:string;tools:number;started:number;cancelled:Set<string>;interactions:Array<Record<string,unknown>>;events:StreamEvent[];conflictInjected:boolean}
interface Protocol {day:string;source:Awaited<ReturnType<typeof sourceFreeze>>;schedule:Entry[];methodExpectations:typeof expectedMethods;labels:typeof labels;model:Record<string,unknown>;budget:typeof planBudget;reserve:typeof completionReserve}
export interface RunOptions {directory:string;port?:number;resume?:boolean;entries?:Entry[];env?:NodeJS.ProcessEnv;transport?:typeof fetch}

/** entries/transport are only for deterministic local verification; CLI always uses the frozen 8. */
export async function runLive(options:RunOptions){
 const directory=resolve(options.directory),env=liveEnvironment(options.env??process.env),original=globalThis.fetch;
 const entries=options.entries??schedule;
 assert.equal(process.cwd(),packageRoot,'Run from experiments/harness-lab so spatial workers resolve tsx');
 assert.ok(entries.length<=8);
 if(!options.resume)await mkdir(directory,{recursive:false,mode:0o700});
 const lock=join(directory,'runner.lock');
 if(existsSync(lock)){
  const prior=read<{pid:number}>(lock);let alive=true;try{process.kill(prior.pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')alive=false;}
  assert.ok(options.resume&&!alive,'Batch already has a live owner or requires explicit resume');unlinkSync(lock);
 }
 writeFileSync(lock,JSON.stringify({pid:process.pid,at:new Date().toISOString()}),{flag:'wx',mode:0o600});
 let active:Active|undefined;let frozen:Awaited<ReturnType<typeof sourceFreeze>>;
 let protocol:Protocol,rows:Row[],attempts:Attempt[],total:Totals;
 try{
 frozen=await sourceFreeze();
 if(options.resume){
  protocol=read<Protocol>(join(directory,'protocol.json'));assert.deepEqual(frozen,protocol.source,'Cannot resume changed protocol/code');assert.deepEqual(entries,protocol.schedule);assert.equal(dayNow(),protocol.day,'Cannot resume across synthetic day boundary');
  rows=read<Row[]>(join(directory,'runs.json'));attempts=read<Attempt[]>(join(directory,'attempts.json'));total=read<Totals>(join(directory,'budget.json'));
  for(const row of rows)if(row.status==='started'){row.status='interrupted';row.stop='process_interrupted_no_retry';}
  save(join(directory,'runs.json'),rows);
  assert.ok(attempts.every(a=>a.completed)&&total.unknownUsage===0,'Incomplete usage/evidence requires separate reconciliation, not automatic resume');
  assert.equal(total.requests,attempts.length,'Request ledger does not match accounting');
 }else{
  protocol={day:dayNow(),source:frozen,schedule:entries,methodExpectations:expectedMethods,labels,model:{id:'deepseek-v4-pro',thinking:'disabled',contextWindow:1_000_000,maxOutputTokens:4096},budget:planBudget,reserve:completionReserve};
  rows=entries.map(e=>({...e,status:'not_executed',semanticReview:'pending'}));attempts=[];total={requests:0,input:0,output:0,unknownUsage:0};
  save(join(directory,'protocol.json'),protocol);save(join(directory,'runs.json'),rows);save(join(directory,'attempts.json'),attempts);save(join(directory,'budget.json'),total);
 }
 }catch(error){unlinkSync(lock);throw error;}
 const stopActive=async(reason:string)=>{
  if(!active)return;active.stop??=reason;
  if(active.requestId&&!active.cancelled.has(active.requestId)){
   active.cancelled.add(active.requestId);
   await mapTrialRequest(active.trial.manifest,`/api/sessions/${active.prepared.fixture.sessionId}/cancel`,'planning','POST',{requestId:active.requestId}).catch(()=>save(join(active!.directory,'cancel-error.json'),{reason:'cancel_http_failed'}));
  }
 };
 const observer=new LiveProvider({directory,original:options.transport??original,secret:env.LLM_API_KEY!.trim(),totals:total,attempts,
  verify:async()=>{assert.deepEqual(await sourceFreeze(),frozen,'Frozen source changed');if(dayNow()!==protocol.day)save(join(active!.directory,'crossed-day.json'),{at:new Date().toISOString(),fixtureDay:protocol.day,actualDay:dayNow(),action:'finish_current_slot_then_stop'});assert.deepEqual(await hashes(active!.runtime.root),active!.runtime.hashes,'Isolated runtime changed');},
  beforeProvider:async()=>{
   if(active?.prepared.spec.id==='D16'&&active.turn===1&&!active.conflictInjected){
    // Native history is authoritative; do not race the HTTP SSE consumer.
    const current=await mapTrialRequest<SessionSnapshot>(active.trial.manifest,`/api/sessions/${active.prepared.fixture.sessionId}`,'planning');
    const currentRequest=current.messages.findLast(m=>m.role==='user')?.requestId;
    const messages=current.messages.filter(m=>m.requestId===currentRequest);
    const readIndex=messages.findLastIndex(m=>m.toolName==='annotation_read'&&!m.isError&&isTargetDraftRead(m.text,active!.prepared.fixture.before.binding.draft!.setId));
    const savedAfter=messages.slice(readIndex+1).some(m=>['annotation_from_analysis','annotation_action'].includes(m.toolName??'')&&!m.isError);
    if(readIndex>=0&&!savedAfter){
     active.conflictInjected=true;
     const evidence=await introduceConflict(active.trial.manifest,active.prepared.fixture);
     save(join(active.directory,'injected-conflict.json'),{at:new Date().toISOString(),afterRead:messages[readIndex],...evidence});
    }
   }
  },cancel:stopActive});
 const onSignal=()=>{observer.fatal??='operator_interrupt';void stopActive('operator_interrupt');};
 process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);globalThis.fetch=observer.fetch;
 const runtimes=new Map<string,Runtime>(),buildDirectory=join(directory,'runtime-builds',randomUUID());
 let batchStop:string|undefined;
 try{
  for(const row of rows){
   if(row.status!=='not_executed')continue;
   if(observer.fatal){batchStop=observer.fatal;break;}
   if(dayNow()!==protocol.day){batchStop='synthetic_day_changed_between_slots';break;}
   if(!canStartSlot(total)){batchStop='budget_reserve_before_next_slot';break;}
   assert.deepEqual(await sourceFreeze(),frozen,'Frozen source changed between slots');
   const spec=cases.find(c=>c.id===row.caseId);assert.ok(spec);
   const dir=join(directory,row.id);await mkdir(dir,{mode:0o700});row.directory=dir;row.status='started';row.startedAt=new Date().toISOString();save(join(directory,'runs.json'),rows);
   let trial:Awaited<ReturnType<typeof startMapTrial>>|undefined;
   try{
    let runtime=runtimes.get(row.group);if(!runtime){runtime=await buildRuntime(buildDirectory,row.group);runtimes.set(row.group,runtime);}
    trial=await runtime.start(options.port??4530,env,false,{background:'neutral'});assert.equal(trial.manifest.day,protocol.day);
    const p=await prepareCase(trial.manifest,spec);
    save(join(dir,'manifest.json'),trial.manifest);save(join(dir,'fixture.json'),p);
    const catalog=await mapTrialRequest<WorkspaceResources>(trial.manifest,`/api/workspaces/${p.fixture.workspaceId}/resources`,'planning');
    for(const [id,s] of Object.entries(runtime.skills))assert.equal(catalog.skills.find(c=>c.id===id)?.hash,s.hash);
    const selection=selectionFor(spec,row.loading,catalog);save(join(dir,'resources.json'),{catalog,selection:selection??null});
    active={id:row.id,directory:dir,turn:0,runtime,trial,prepared:p,requests:0,tools:0,started:Date.now(),cancelled:new Set(),interactions:[],events:[],conflictInjected:false};observer.active=active;
    const timer=setInterval(()=>{const w=warnings(active?.requests??0,active?.tools??0,Date.now()-(active?.started??Date.now()));if(w.length)save(join(dir,'warnings.json'),{at:new Date().toISOString(),warnings:w,action:'continue_current_slot'});},30_000);
    try{
     for(const [turn,text] of p.prompts.entries()){
      active.turn=turn;active.requestId=undefined;
      const body={text,...(selection?{skill:selection}:{}),...(spec.refs?{annotationRefs:p.fixture.annotationRefs}:{})};
      save(join(dir,`turn-${turn+1}-input.json`),body);save(join(dir,`turn-${turn+1}-before.json`),await mapState(trial.manifest,p.fixture.sessionId));
      const events:StreamEvent[]=[],pending:Promise<void>[]=[];const seen=new Set<string>();let streamError:unknown;
      const response=await fetch(`${trial.manifest.url}/api/sessions/${p.fixture.sessionId}/messages`,{method:'POST',headers:{...await mapTrialAuth(trial.manifest,'planning'),'content-type':'application/json'},body:JSON.stringify(body)});
      assert.ok(response.ok&&response.body,`Message HTTP ${response.status}`);
      const parser=new SSELines(value=>{
       const event=value as unknown as StreamEvent;events.push(event);active!.events.push(event);active!.requestId=event.requestId;
       if(event.type==='tool.started')active!.tools++;
       if(event.type==='interaction.updated'&&event.interaction.status==='pending'&&!seen.has(event.interaction.interactionId)){
        const item=event.interaction;seen.add(item.interactionId);
        const decision=interactionDecision(spec,item,active!.interactions.length>0),record:Record<string,unknown>={observed:item,handling:decision===undefined?'unexpected':decision};active!.interactions.push(record);
        pending.push((async()=>{
         if(decision==='none'){
          const snapshot=await mapTrialRequest<SessionSnapshot>(trial!.manifest,`/api/sessions/${p.fixture.sessionId}`,'planning');
          assert.ok(snapshot.interactions?.some(i=>i.interactionId===item.interactionId&&i.status==='pending'));record.pendingVerified=true;
         }
         if(!decision||decision==='cancel'||decision==='none'){await stopActive(decision===undefined?'unexpected_interaction':decision==='none'?'awaiting_scripted_no_answer':'scripted_cancel');}
         else{record.response=decision;record.resolved=await mapTrialRequest<Interaction>(trial!.manifest,`/api/sessions/${p.fixture.sessionId}/interactions/${item.interactionId}/response`,'planning','POST',decision);}
         save(join(dir,'interactions.json'),active!.interactions);
        })().catch(async()=>{streamError=new Error('interaction_execution_failed');observer.fatal??='interaction_execution_failed';await stopActive('interaction_execution_failed');}));
       }
      });
      const reader=response.body.getReader();try{for(;;){const part=await reader.read();if(part.done)break;appendFileSync(join(dir,`turn-${turn+1}.sse`),part.value,{mode:0o600});parser.push(part.value);}}finally{await Promise.all(pending);}
      if(streamError)throw streamError;
      const snapshot=await mapTrialRequest<SessionSnapshot>(trial.manifest,`/api/sessions/${p.fixture.sessionId}`,'planning');
      const after=await mapState(trial.manifest,p.fixture.sessionId);
      save(join(dir,`turn-${turn+1}.json`),{input:body,events,snapshot,after});
      if(p.fixture.otherSessionId)save(join(dir,`turn-${turn+1}-other.json`),await mapState(trial.manifest,p.fixture.otherSessionId));
      if(active.stop||snapshot.lastResult?.status!=='succeeded'){row.status=active.interactions.length?'interaction_recorded':'incomplete';break;}
     }
    }finally{clearInterval(timer);}
    const final=await mapTrialRequest<SessionSnapshot>(trial.manifest,`/api/sessions/${p.fixture.sessionId}`,'planning'),after=await mapState(trial.manifest,p.fixture.sessionId);
    const requestIds=[...new Set(final.messages.flatMap(m=>m.requestId?[m.requestId]:[]))];
    const actualResources=await Promise.all(requestIds.map(async requestId=>({requestId,...await mapTrialRequest(trial!.manifest,`/api/sessions/${p.fixture.sessionId}/requests/${requestId}/resources`,'planning') as object})));
    if(row.status==='started')row.status='recorded';
    save(join(dir,'review.json'),{entry:row,prompts:p.prompts,truth:p.truth,fixture:p.fixture,final,after,actualResources,interactions:active.interactions,events:active.events,conflictInjected:active.conflictInjected,semanticReview:'pending',evidence:'Use ordered final.messages and events; all visible claims count. Protocol completion is not correctness.'});
    const critical=criticalEffect(p,final,after,active.conflictInjected);
    if(critical){observer.fatal=critical;row.stop=critical;save(join(dir,'critical-effect.json'),{reason:critical});}
   }catch(error){row.status='interrupted';row.stop='execution_or_evidence_failure';observer.fatal??=row.stop;save(join(dir,'failure.json'),{error:error instanceof Error?error.message:'execution failed'});}
   finally{
    if(active){Object.assign(row,{stop:active.stop??row.stop,requests:active.requests,tools:active.tools,elapsedMs:Date.now()-active.started,warnings:warnings(active.requests,active.tools,Date.now()-active.started)});}
    if(trial){
     try{await cp(join(trial.manifest.dataDir,'sessions'),join(dir,'native-sessions'),{recursive:true});}catch{observer.fatal??='native_evidence_copy_failure';row.stop??='native_evidence_copy_failure';row.status='interrupted';}
     await trial.stop();
    }
    if(active)try{assert.deepEqual(await hashes(active.runtime.root),active.runtime.hashes,'Runtime drift after slot');}catch{observer.fatal??='runtime_drift';row.stop??='runtime_drift';row.status='interrupted';}
    row.endedAt=new Date().toISOString();save(join(dir,'result.json'),row);save(join(dir,'evidence-hashes.json'),await hashes(dir));save(join(directory,'runs.json'),rows);observer.persist();
    console.info(JSON.stringify({entry:row.id,status:row.status,requests:total.requests,input:total.input,output:total.output,stop:row.stop??null}));active=undefined;observer.active=undefined;
   }
  }
 }finally{
  globalThis.fetch=original;process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);observer.persist();save(join(directory,'runs.json'),rows);save(join(directory,'batch-state.json'),{at:new Date().toISOString(),stop:batchStop??observer.fatal??null,planned:rows.length,recorded:rows.filter(r=>r.status==='recorded').length,notExecuted:rows.filter(r=>r.status==='not_executed').length,totals:total,automaticRetries:false});unlinkSync(lock);
 }
 return {rows,total,stop:batchStop??observer.fatal};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,directory,port]=process.argv.slice(2);assert.ok(['run','resume'].includes(mode)&&directory,'Usage: live.ts run|resume OUTPUT_DIRECTORY [PORT]');
 assert.ok(resolve(directory).startsWith(join(repo,'.local','spatial-r5')+'/'),'Live CLI evidence must stay in ignored .local/spatial-r5/');
 void runLive({directory,port:Number(port??4530),resume:mode==='resume'}).then(result=>{console.info(JSON.stringify({completed:true,totals:result.total,stop:result.stop??null}));if(result.stop)process.exitCode=1;}).catch(error=>{console.error(error instanceof Error?error.message:'R5 execution failed');process.exitCode=1;});
}
