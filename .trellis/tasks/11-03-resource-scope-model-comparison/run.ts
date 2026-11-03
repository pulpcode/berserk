import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {cp} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Interaction} from '../../../experiments/harness-lab/src/contracts/interactions.js';
import type {SessionSnapshot} from '../../../experiments/harness-lab/src/contracts/index.js';
import {acceptanceCase,schedule} from './cases.js';
import {Ledger,profile,models,limits} from './budget.js';
import {Provider,digest} from './provider.js';
import {driveBrowserTurn} from './browser.js';
import {reviewedAction,type Decision} from './continuation.js';
export {schedule} from './cases.js';
export {reviewedAction,type Decision} from './continuation.js';
import type {EvidenceSnapshot} from '../11-02-task-resource-acceptance/scoring.js';
import {buildRuntime,dependencyHashesAsync,hashes,save,selection,startTrial,taskRoot,revision,type Runtime,type Trial} from './runtime.js';
export function observedEvidence(snapshot:SessionSnapshot,interaction?:Interaction):EvidenceSnapshot {
 const message=snapshot.messages.findLast(m=>m.role==='assistant');
 const text=interaction?JSON.stringify(interaction):message?.text??'';
 return {id:interaction?'interaction:'+interaction.interactionId:message?.id??'no-assistant-answer',sequence:snapshot.messages.length,kind:interaction?'controller':'assistant',path:'native-session',sha256:digest(text),text,modelVisible:true};
}
export function skillReadEvidence(snapshot:SessionSnapshot){
 return snapshot.messages.filter(m=>m.role==='tool'&&m.toolName==='skill.read').map(message=>{
  let skill:{id?:string;content?:string;hash?:string}={};try{skill=JSON.parse(message.text);}catch{/* Failed calls retain original message evidence. */}
  const bodyReceived=!message.isError&&!message.resultMissing&&typeof skill.content==='string'&&skill.content.length>0;
  return {messageId:message.id,requestId:message.requestId,toolCallId:message.toolCallId,bodyReceived,skillId:bodyReceived?skill.id:null,contentHash:bodyReceived?digest(skill.content!):null,declaredHash:bodyReceived?skill.hash:null};
 });
}
const pause=(ms:number)=>new Promise<void>(resolveWait=>setTimeout(resolveWait,ms));
export async function review(directory:string,name:string,evidence:unknown):Promise<Decision>{
 const requestPath=join(directory,name+'-review.json'),decisionPath=join(directory,name+'-decision.json');assert.ok(!existsSync(requestPath),'review_slot_reuse');
 const evidenceHash=digest(JSON.stringify(evidence));save(requestPath,{evidenceHash,evidence,decisionPath,instructions:'Read complete evidence. Match only actual questions to frozen facts. Supply reviewer, rationale, kind and evidenceHash. Clarify requires evidenceId plus matches[]: exact quote, factId, questionId/optionIds for each API question. All actual questions must map to frozen facts. No keyword classification.'});console.info(JSON.stringify({status:'review_required',requestPath,decisionPath}));
 while(!existsSync(decisionPath))await pause(1000);
 const decision=JSON.parse(readFileSync(decisionPath,'utf8')) as Decision & {evidenceHash:string};assert.equal(decision.evidenceHash,evidenceHash,'review_evidence_changed');return decision;
}
export async function send(trial:Trial,text:string,input:ReturnType<typeof selection>,turn:number,reviewer:(name:string,evidence:unknown)=>Promise<Decision>){
 save(join(trial.directory,`turn-${turn}-input.json`),{text,...input});
 const response=await fetch(`${trial.url}/api/sessions/${trial.sessionId}/messages`,{method:'POST',headers:{...trial.headers,'content-type':'application/json'},body:JSON.stringify({text,...input})});assert.ok(response.ok,`message_admission_${response.status}`);assert.ok(response.body);
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',interactionCount=0;
 for(;;){const part=await reader.read();if(part.done)break;const value=decoder.decode(part.value,{stream:true});writeFileSync(join(trial.directory,`turn-${turn}-events.sse`),value,{flag:'a',mode:0o600});buffer+=value;const lines=buffer.split('\n');buffer=lines.pop()!;
  for(const line of lines){if(!line.startsWith('data:'))continue;const event=JSON.parse(line.slice(5)) as {type:string;interaction?:Interaction};if(event.type==='interaction.updated'&&event.interaction?.status==='pending'){
    const interaction=event.interaction;const decision=await reviewer(`turn-${turn}-interaction-${++interactionCount}`,{snapshot:trial.lab.get(trial.sessionId,'acceptance'),interaction,observed:observedEvidence(trial.lab.get(trial.sessionId,'acceptance'),interaction),humanFacts:acceptanceCase(trial.caseId).humanFacts});const action=reviewedAction(acceptanceCase(trial.caseId),decision,observedEvidence(trial.lab.get(trial.sessionId,'acceptance'),interaction),interaction);
    if(action.kind==='clarify'&&action.response)await trial.request(`/api/sessions/${trial.sessionId}/interactions/${interaction.interactionId}/response`,'POST',action.response);
    else {await trial.request(`/api/sessions/${trial.sessionId}/cancel`,'POST',{requestId:interaction.requestId});throw new Error(action.kind==='fixture_gap'?'fixture_gap':'review_stopped_interaction');}
   }}
 }
 const snapshot=await trial.lab.readSavedSession(trial.sessionId,'acceptance');save(join(trial.directory,`turn-${turn}-snapshot.json`),snapshot);return snapshot;
}
export function freezeFiles(){
 const directories=['.','../11-03-resource-independent-acceptance','../11-02-task-resource-acceptance','../11-02-resource-rules-evidence'];
 const names=directories.flatMap(directory=>readdirSync(join(taskRoot,directory)).filter(name=>/\.(ts|json|md|jsonl)$/.test(name)&&!['task.json','implement.md','check.jsonl','implement.jsonl','report.md','execution-notes.md','offline-checks.md','run-instructions.md'].includes(name)).map(name=>join(directory,name)));
 return Object.fromEntries(names.sort().map(name=>[name,digest(readFileSync(join(taskRoot,name)))]));
}
export async function prepare(directory:string){
 assert.deepEqual(JSON.parse(readFileSync(join(taskRoot,'schedule.json'),'utf8')).slots,schedule,'reviewed_schedule_mismatch');assert.ok(!existsSync(join(directory,'protocol.json')),'Already prepared');mkdirSync(directory,{recursive:true,mode:0o700});const runtime=await buildRuntime(directory,true);
 const files=freezeFiles();const protocol={productRevision:revision,files,profile,models,limits,schedule,bodyRewriting:{A:false,B:"model/thinking wire adapter only; native and wire retained"},taskRetries:0,clock:'per-trial T0 from recorded local HTTP clock; business relative times; real platform and source snapshot timestamps',runtimeIntegrity:runtime.integrity,dependencies:runtime.dependencies};
 save(join(directory,'protocol.json'),protocol);save(join(directory,'schedule.json'),schedule);(['A','B'] as const).forEach(group=>new Ledger(join(directory,`ledger-${group}.json`),digest(JSON.stringify(protocol))));return runtime;
}
export async function execute(directory:string,entryId:string,envFile:string,browser=false,port=4335){
 const entry=schedule.find(s=>s.id===entryId);assert.ok(entry,'entry_not_in_approved_schedule');if(entry.caseId==='P01')assert.ok(browser,'P01_requires_browser');
 const protocol=JSON.parse(readFileSync(join(directory,'protocol.json'),'utf8')) as {files:Record<string,string>;runtimeIntegrity:Record<string,string>;dependencies:Record<string,Record<string,string>>};assert.deepEqual(freezeFiles(),protocol.files,'execution_material_drift');
 const readiness=JSON.parse(readFileSync(join(directory,'readiness.json'),'utf8')) as {reviewer:string;offlinePassed:boolean;materialsReviewed:boolean;platformBalanceObservedAt?:string;platformAvailable?:boolean};assert.ok(readiness.reviewer&&readiness.offlinePassed&&readiness.materialsReviewed,'readiness_review_required');
 if(entry.phase==='formal'){const gate=JSON.parse(readFileSync(join(directory,'public-gate.json'),'utf8')) as {approved:boolean;reviewer:string;trials:string[]};assert.ok(gate.approved&&gate.reviewer&&schedule.filter(s=>s.phase==='public').every(s=>gate.trials.includes(s.id)),'public_gate_required');}
 const index=schedule.indexOf(entry);for(const previous of schedule.slice(0,index)){const prior=JSON.parse(readFileSync(join(directory,previous.id,'result.json'),'utf8')) as {status:string;stateChanged?:boolean};assert.notEqual(prior.status,'batch_halted','previous_batch_fault');const gate=JSON.parse(readFileSync(join(directory,previous.id,'continuation-review.json'),'utf8')) as {reviewer:string;rationale:string;continuationAllowed:boolean;trajectoryAuditable:boolean;isolatedEffectsVerified?:boolean};assert.ok(gate.reviewer&&gate.rationale&&gate.continuationAllowed,'previous_trial_needs_review');if(prior.stateChanged)assert.ok(gate.isolatedEffectsVerified,'changed_state_requires_isolation_review');if(entry.phase==='formal'&&previous.phase==='public')assert.ok(gate.trajectoryAuditable,'public_trajectory_not_auditable');}
 const trialDirectory=join(directory,entry.id);assert.ok(!existsSync(trialDirectory),'task_retry_forbidden');
 const env=parseEnv(readFileSync(envFile,'utf8'));assert.equal(env.LLM_MODEL,models[entry.group].model);assert.equal(env.LLM_BASE_URL?.replace(/\/$/,''),models[entry.group].baseUrl);const secret=env.LLM_API_KEY;assert.ok(secret,'missing_api_key');
 const runtime:Runtime={root:join(directory,'product'),integrity:protocol.runtimeIntegrity,dependencies:protocol.dependencies,verify:async()=>{assert.deepEqual(hashes(join(directory,'product')),protocol.runtimeIntegrity,'runtime_drift');assert.deepEqual(await dependencyHashesAsync(),protocol.dependencies,'installed_dependency_drift');}};
 const ledger=new Ledger(join(directory,`ledger-${entry.group}.json`),digest(JSON.stringify(protocol)),true);assert.ok(!ledger.read().halted,'batch_halted');
 const original=globalThis.fetch;const provider=new Provider({group:entry.group,original,secret,verify:async()=>{await runtime.verify();assert.deepEqual(freezeFiles(),protocol.files,'execution_material_drift');},reviewProgress:async reason=>{const decision=await review(trialDirectory,`progress-${ledger.read().attempts.length}`,{reason,attempts:ledger.read().attempts,progress:trial?.lab.get(trial.sessionId,'acceptance')});assert.equal(decision.kind,'continue');}},ledger);globalThis.fetch=provider.fetch;
 const startedAt=new Date().toISOString();let trial:Trial|undefined;let status='pending_review';let error:string|undefined;let stateChanged=false;
 try{
  trial=await startTrial(runtime,trialDirectory,entry.id,entry.caseId,secret,port,true);provider.active={id:entry.id,directory:trialDirectory,startedAt:Date.now()};
  console.info(JSON.stringify({status:'ready',id:entry.id,url:trial.url,sessionId:trial.sessionId,taskId:trial.taskId,credentials:join(trialDirectory,'credentials.json')}));
  const reviewer=(name:string,evidence:unknown)=>review(trialDirectory,name,evidence);let turn=0;
  const finishTurn=async(snapshot:SessionSnapshot)=>{
   for(;;){const observed=observedEvidence(snapshot);const decision=await reviewer(`turn-${turn}-terminal`,{snapshot,observed,humanFacts:acceptanceCase(entry.caseId).humanFacts});const action=reviewedAction(acceptanceCase(entry.caseId),decision,observed);
    if(action.kind==='clarify'){snapshot=await send(trial!,action.text,{},++turn,reviewer);continue;}
    if(action.kind!=='final')throw new Error(action.kind);return snapshot;
   }
  };
  let previous:SessionSnapshot|undefined;
  for(const item of acceptanceCase(entry.caseId).turns){
   if(previous?.lastResult?.status!=='succeeded'&&previous)throw new Error('product_previous_turn_failed');
   if(Date.now()>Date.parse(trial.fixture.t0)+(turn===0?60:24*60)*60_000)throw new Error('fixture_time_window_expired');
   ++turn;
   if(item.annotationSelections?.length||item.contextRefs?.length){
    let browserError:unknown;let browserDone=false;const browserWork=driveBrowserTurn(trial,item,turn).then(()=>{browserDone=true;}).catch(error=>{browserError=error;});
    const reviewedInteractions=new Set<string>();
    for(;;){
     if(browserError)throw browserError;
     const snapshot=trial.lab.get(trial.sessionId,'acceptance');
     for(const interaction of snapshot.interactions??[])if(interaction.status==='pending'&&!reviewedInteractions.has(interaction.interactionId)){
      reviewedInteractions.add(interaction.interactionId);const observed=observedEvidence(snapshot,interaction);const decision=await reviewer('browser-interaction-'+interaction.interactionId,{snapshot,interaction,observed,humanFacts:acceptanceCase(entry.caseId).humanFacts});const action=reviewedAction(acceptanceCase(entry.caseId),decision,observed,interaction);
      if(action.kind==='clarify'&&action.response)await trial.request(`/api/sessions/${trial.sessionId}/interactions/${interaction.interactionId}/response`,'POST',action.response);
      else {await trial.request(`/api/sessions/${trial.sessionId}/cancel`,'POST',{requestId:interaction.requestId});throw new Error(action.kind);}
     }
     if(browserDone)break;await pause(250);
    }
    await browserWork;const snapshot=await trial.lab.readSavedSession(trial.sessionId,'acceptance');save(join(trialDirectory,`turn-${turn}-snapshot.json`),snapshot);previous=await finishTurn(snapshot);
   }else previous=await finishTurn(await send(trial,item.text,selection(trial,item),turn,reviewer));
   if(ledger.read().halted)throw new Error('batch_halted');
  }
  if(ledger.read().halted)throw new Error('batch_halted');
  await runtime.verify();assert.deepEqual(freezeFiles(),protocol.files,'execution_material_drift');
  status='trajectory_recorded';
 }catch(caught){if(caught instanceof assert.AssertionError)ledger.halt('integrity_or_protocol_assertion');error=String(caught).split(secret).join('[REDACTED]');status=error.includes('fixture_gap')?'fixture_gap':ledger.read().halted?'batch_halted':'incomplete';}
 finally{
  if(trial){const after=trial.state();stateChanged=digest(JSON.stringify(after))!==digest(JSON.stringify(JSON.parse(readFileSync(join(trialDirectory,'state-before.json'),'utf8'))));save(join(trialDirectory,'state-after.json'),after);save(join(trialDirectory,'final-snapshot.json'),trial.lab.get(trial.sessionId,'acceptance'));save(join(trialDirectory,'skill-read-evidence.json'),skillReadEvidence(trial.lab.get(trial.sessionId,'acceptance')));await trial.close();await cp(join(trialDirectory,'data','sessions'),join(trialDirectory,'native-history'),{recursive:true});}
  globalThis.fetch=original;mkdirSync(trialDirectory,{recursive:true,mode:0o700});save(join(trialDirectory,'result.json'),{entry,status,error,stateChanged,model:provider.responseModel,usage:ledger.totals(entry.id),groupUsage:ledger.totals(),semanticReview:'pending',startedAt,finishedAt:new Date().toISOString(),wallMs:Date.now()-Date.parse(startedAt),wallTimeIncludesHumanReview:true});
 }
 console.info(JSON.stringify({entry:entry.id,status,error,usage:ledger.totals(entry.id),groupUsage:ledger.totals()}));
}
async function main(){const [command,directory,entry,envFile,...flags]=process.argv.slice(2);assert.ok(directory,'Usage: prepare DIRECTORY | run DIRECTORY ENTRY ENV_FILE [--browser]');if(command==='prepare'){await prepare(resolve(directory));console.info('Prepared without model calls');}else if(command==='run'){assert.ok(entry&&envFile);await execute(resolve(directory),entry,resolve(envFile),flags.includes('--browser'));}else throw new Error('Unknown command');}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void main().catch(error=>{console.error((error as Error).message);process.exitCode=1;});
