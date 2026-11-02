import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {cp} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Interaction,InteractionResponse} from '../../../experiments/harness-lab/src/contracts/interactions.js';
import type {SessionSnapshot} from '../../../experiments/harness-lab/src/contracts/index.js';
import {acceptanceCase,acceptanceCases,type AcceptanceCase} from './cases.js';
import {Ledger,profile,limits} from './budget.js';
import {Provider,digest} from './provider.js';
import {driveP01Browser} from './browser.js';
import {buildRuntime,dependencyHashes,hashes,save,selection,startTrial,taskRoot,type Runtime,type Trial} from './runtime.js';
export const schedule=[...acceptanceCases.filter(c=>c.phase==='public').map(c=>({id:c.id+'-1',caseId:c.id,repeat:1,phase:c.phase})),...acceptanceCases.filter(c=>c.phase==='formal').map(c=>({id:c.id+'-1',caseId:c.id,repeat:1,phase:c.phase})),...acceptanceCases.filter(c=>c.phase==='formal').reverse().map(c=>({id:c.id+'-2',caseId:c.id,repeat:2,phase:c.phase}))];
export interface Decision {kind:'final'|'clarify'|'incomplete'|'fixture_gap'|'continue';rationale:string;reviewer:string;factId?:string;questionId?:string;optionIds?:string[]}
/** All terminal assistant text is reviewed, including normal final answers containing '?'. */
export function reviewedAction(scenario:AcceptanceCase,decision:Decision,interaction?:Interaction):{kind:'final'|'incomplete'|'fixture_gap'|'continue'}|{kind:'clarify';text:string;response?:InteractionResponse}{
 assert.ok(decision.rationale.trim()&&decision.reviewer.trim(),'review_reason_and_identity_required');
 if(decision.kind!=='clarify'){assert.ok(!interaction||decision.kind==='fixture_gap'||decision.kind==='incomplete','pending_interaction_requires_review');return {kind:decision.kind};}
 const fact=scenario.humanFacts.find(f=>f.id===decision.factId);assert.ok(fact,'no_frozen_fact_for_question');
 if(!interaction)return {kind:'clarify',text:fact.value};
 assert.equal(interaction.kind,'question','unauthorized_confirmation');assert.equal(interaction.status,'pending');
 if(interaction.kind!=='question')throw new Error('unexpected_confirmation');
 const question=interaction.questions.find(q=>q.id===decision.questionId);assert.ok(question&&interaction.questions.length===1,'question_mapping_missing_or_extra_questions');
 if(decision.optionIds){assert.ok(decision.optionIds.length>0&&decision.optionIds.every(id=>question.options?.some(o=>o.id===id)),'invalid_reviewed_options');}
 return {kind:'clarify',text:fact.value,response:{requestId:interaction.requestId,kind:'question',action:'answer',answers:[decision.optionIds?{questionId:question.id,optionIds:decision.optionIds}:{questionId:question.id,text:fact.value}]}};
}
const pause=(ms:number)=>new Promise<void>(resolveWait=>setTimeout(resolveWait,ms));
async function review(directory:string,name:string,evidence:unknown):Promise<Decision>{
 const requestPath=join(directory,name+'-review.json'),decisionPath=join(directory,name+'-decision.json');assert.ok(!existsSync(requestPath),'review_slot_reuse');
 const evidenceHash=digest(JSON.stringify(evidence));save(requestPath,{evidenceHash,evidence,decisionPath,instructions:'Read complete evidence. Classify semantic state and match only frozen human facts. Supply reviewer, rationale, kind and evidenceHash. No question-mark or keyword rules.'});console.info(JSON.stringify({status:'review_required',requestPath,decisionPath}));
 while(!existsSync(decisionPath))await pause(1000);
 const decision=JSON.parse(readFileSync(decisionPath,'utf8')) as Decision & {evidenceHash:string};assert.equal(decision.evidenceHash,evidenceHash,'review_evidence_changed');return decision;
}
export async function send(trial:Trial,text:string,input:ReturnType<typeof selection>,turn:number,reviewer:(name:string,evidence:unknown)=>Promise<Decision>){
 save(join(trial.directory,`turn-${turn}-input.json`),{text,...input});
 const response=await fetch(`${trial.url}/api/sessions/${trial.sessionId}/messages`,{method:'POST',headers:{...trial.headers,'content-type':'application/json'},body:JSON.stringify({text,...input})});assert.ok(response.ok,`message_admission_${response.status}`);assert.ok(response.body);
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',interactionCount=0;
 for(;;){const part=await reader.read();if(part.done)break;const value=decoder.decode(part.value,{stream:true});writeFileSync(join(trial.directory,`turn-${turn}-events.sse`),value,{flag:'a',mode:0o600});buffer+=value;const lines=buffer.split('\n');buffer=lines.pop()!;
  for(const line of lines){if(!line.startsWith('data:'))continue;const event=JSON.parse(line.slice(5)) as {type:string;interaction?:Interaction};if(event.type==='interaction.updated'&&event.interaction?.status==='pending'){
    const interaction=event.interaction;const decision=await reviewer(`turn-${turn}-interaction-${++interactionCount}`,{snapshot:trial.lab.get(trial.sessionId,'acceptance'),interaction,humanFacts:acceptanceCase(trial.caseId).humanFacts});const action=reviewedAction(acceptanceCase(trial.caseId),decision,interaction);
    if(action.kind==='clarify'&&action.response)await trial.request(`/api/sessions/${trial.sessionId}/interactions/${interaction.interactionId}/response`,'POST',action.response);
    else {await trial.request(`/api/sessions/${trial.sessionId}/cancel`,'POST',{requestId:interaction.requestId});throw new Error(action.kind==='fixture_gap'?'fixture_gap':'review_stopped_interaction');}
   }}
 }
 const snapshot=await trial.lab.readSavedSession(trial.sessionId,'acceptance');save(join(trial.directory,`turn-${turn}-snapshot.json`),snapshot);return snapshot;
}
function freezeFiles(){return Object.fromEntries(['budget.ts','provider.ts','runtime.ts','run.ts','cases.ts','fixtures.ts','product-freeze.json','scoring.ts','calibration.json','oracle.json','cases.md','review-template.md','browser.ts','browser-offline-notes.md','../10-28-agent-spatial-plotting/task-resources-20261102/04-acceptance.md'].map(name=>[name,digest(readFileSync(join(taskRoot,name)))]));}
export async function prepare(directory:string){
 assert.ok(!existsSync(join(directory,'protocol.json')),'Already prepared');mkdirSync(directory,{recursive:true,mode:0o700});const runtime=await buildRuntime(directory,true);
 const files=freezeFiles();const protocol={productRevision:'12e1cc9',files,profile,limits,schedule,bodyRewriting:false,taskRetries:0,clock:'identical fixture business/evidence timestamps; real product query clock, invariant validity intervals',runtimeIntegrity:runtime.integrity,dependencies:runtime.dependencies};
 save(join(directory,'protocol.json'),protocol);save(join(directory,'schedule.json'),schedule);new Ledger(join(directory,'ledger.json'),digest(JSON.stringify(protocol)));return runtime;
}
export async function execute(directory:string,entryId:string,envFile:string,browser=false,port=4335){
 const entry=schedule.find(s=>s.id===entryId);assert.ok(entry,'entry_not_in_approved_schedule');assert.equal(browser,entry.caseId==='P01','P01_requires_browser_only');
 const protocol=JSON.parse(readFileSync(join(directory,'protocol.json'),'utf8')) as {files:Record<string,string>;runtimeIntegrity:Record<string,string>;dependencies:Record<string,Record<string,string>>};assert.deepEqual(freezeFiles(),protocol.files,'execution_material_drift');
 const readiness=JSON.parse(readFileSync(join(directory,'readiness.json'),'utf8')) as {reviewer:string;offlinePassed:boolean;materialsReviewed:boolean;platformBalanceObservedAt?:string;platformAvailable?:boolean};assert.ok(readiness.reviewer&&readiness.offlinePassed&&readiness.materialsReviewed,'readiness_review_required');
 if(entry.phase==='formal'){const gate=JSON.parse(readFileSync(join(directory,'public-gate.json'),'utf8')) as {approved:boolean;reviewer:string;trials:string[]};assert.ok(gate.approved&&gate.reviewer&&['P01-1','P02-1','P03-1','P04-1'].every(id=>gate.trials.includes(id)),'public_gate_required');}
 const index=schedule.indexOf(entry);for(const previous of schedule.slice(0,index)){const prior=JSON.parse(readFileSync(join(directory,previous.id,'result.json'),'utf8')) as {status:string;stateChanged?:boolean};assert.notEqual(prior.status,'batch_halted','previous_batch_fault');const gate=JSON.parse(readFileSync(join(directory,previous.id,'continuation-review.json'),'utf8')) as {reviewer:string;rationale:string;continuationAllowed:boolean;trajectoryAuditable:boolean;isolatedEffectsVerified?:boolean};assert.ok(gate.reviewer&&gate.rationale&&gate.continuationAllowed,'previous_trial_needs_review');if(prior.stateChanged)assert.ok(gate.isolatedEffectsVerified,'changed_state_requires_isolation_review');if(entry.phase==='formal'&&previous.phase==='public')assert.ok(gate.trajectoryAuditable,'public_trajectory_not_auditable');}
 const trialDirectory=join(directory,entry.id);assert.ok(!existsSync(trialDirectory),'task_retry_forbidden');
 const env=parseEnv(readFileSync(envFile,'utf8'));assert.equal(env.LLM_MODEL,profile.model);assert.equal(env.LLM_BASE_URL?.replace(/\/$/,''),profile.baseUrl);const secret=env.LLM_API_KEY;assert.ok(secret,'missing_api_key');
 const runtime:Runtime={root:join(directory,'product'),integrity:protocol.runtimeIntegrity,dependencies:protocol.dependencies,verify:async()=>{assert.deepEqual(hashes(join(directory,'product')),protocol.runtimeIntegrity,'runtime_drift');assert.deepEqual(dependencyHashes(),protocol.dependencies,'installed_sdk_drift');}};
 const ledger=new Ledger(join(directory,'ledger.json'),digest(JSON.stringify(protocol)),true);assert.ok(!ledger.read().halted,'batch_halted');
 const original=globalThis.fetch;const provider=new Provider({original,secret,verify:async()=>{await runtime.verify();assert.deepEqual(freezeFiles(),protocol.files,'execution_material_drift');},reviewProgress:async reason=>{const decision=await review(trialDirectory,`progress-${ledger.read().attempts.length}`,{reason,attempts:ledger.read().attempts,progress:trial?.lab.get(trial.sessionId,'acceptance')});assert.equal(decision.kind,'continue');}},ledger);globalThis.fetch=provider.fetch;
 let trial:Trial|undefined;let status='pending_review';let error:string|undefined;let stateChanged=false;
 try{
  trial=await startTrial(runtime,trialDirectory,entry.id,entry.caseId,secret,port,browser);provider.active={id:entry.id,directory:trialDirectory,startedAt:Date.now()};
  console.info(JSON.stringify({status:'ready',id:entry.id,url:trial.url,sessionId:trial.sessionId,taskId:trial.taskId,credentials:join(trialDirectory,'credentials.json')}));
  const reviewer=(name:string,evidence:unknown)=>review(trialDirectory,name,evidence);let turn=0;
  const finishTurn=async(snapshot:SessionSnapshot)=>{
   for(;;){const decision=await reviewer(`turn-${turn}-terminal`,{snapshot,humanFacts:acceptanceCase(entry.caseId).humanFacts});const action=reviewedAction(acceptanceCase(entry.caseId),decision);
    if(action.kind==='clarify'){snapshot=await send(trial!,action.text,{},++turn,reviewer);continue;}
    if(action.kind!=='final')throw new Error(action.kind);return;
   }
  };
  if(browser){
   let browserError:unknown;const browserWork=driveP01Browser(trial).catch(error=>{browserError=error;});
   // Only the desktop browser sends P01. Polling reads existing product evidence and costs no model calls.
   for(;;){if(browserError)throw browserError;const snapshot=trial.lab.get(trial.sessionId,'acceptance');if(snapshot.lastResult&&!snapshot.active){save(join(trialDirectory,'turn-0-snapshot.json'),snapshot);await finishTurn(snapshot);break;}
    for(const interaction of snapshot.interactions??[])if(interaction.status==='pending'){const decision=await reviewer('browser-interaction-'+interaction.interactionId,{snapshot,interaction,humanFacts:acceptanceCase(entry.caseId).humanFacts});const action=reviewedAction(acceptanceCase(entry.caseId),decision,interaction);if(action.kind==='clarify'&&action.response)await trial.request(`/api/sessions/${trial.sessionId}/interactions/${interaction.interactionId}/response`,'POST',action.response);else throw new Error('browser_interaction_stopped');}await pause(1000);}
   await browserWork;if(browserError)throw browserError;
  }else{
   if(trial.fixture.priorUserReport){const report=trial.fixture.priorUserReport;await finishTurn(await send(trial,report.text,{contextRefs:report.sourceRefs},++turn,reviewer));}
   for(const item of acceptanceCase(entry.caseId).turns){if(item.after==='source-update'){assert.ok(trial.fixture.sourceUpdate);trial.source.update(trial.fixture.sourceUpdate);}await finishTurn(await send(trial,item.text,selection(trial,item),++turn,reviewer));if(ledger.read().halted)throw new Error('batch_halted');}
  }
  if(ledger.read().halted)throw new Error('batch_halted');
  status='trajectory_recorded';
 }catch(caught){if(caught instanceof assert.AssertionError)ledger.halt('integrity_or_protocol_assertion');error=String(caught).split(secret).join('[REDACTED]');status=error.includes('fixture_gap')?'fixture_gap':ledger.read().halted?'batch_halted':'incomplete';}
 finally{
  if(trial){const after=trial.state();stateChanged=digest(JSON.stringify(after))!==digest(JSON.stringify(JSON.parse(readFileSync(join(trialDirectory,'state-before.json'),'utf8'))));save(join(trialDirectory,'state-after.json'),after);save(join(trialDirectory,'final-snapshot.json'),trial.lab.get(trial.sessionId,'acceptance'));await trial.close();await cp(join(trialDirectory,'data','sessions'),join(trialDirectory,'native-history'),{recursive:true});}
  globalThis.fetch=original;mkdirSync(trialDirectory,{recursive:true,mode:0o700});save(join(trialDirectory,'result.json'),{entry,status,error,stateChanged,model:provider.responseModel,usage:ledger.totals(),semanticReview:'pending',finishedAt:new Date().toISOString()});
 }
 console.info(JSON.stringify({entry:entry.id,status,error,usage:ledger.totals()}));
}
async function main(){const [command,directory,entry,envFile,...flags]=process.argv.slice(2);assert.ok(directory,'Usage: prepare DIRECTORY | run DIRECTORY ENTRY ENV_FILE [--browser]');if(command==='prepare'){await prepare(resolve(directory));console.info('Prepared without model calls');}else if(command==='run'){assert.ok(entry&&envFile);await execute(resolve(directory),entry,resolve(envFile),flags.includes('--browser'));}else throw new Error('Unknown command');}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void main().catch(error=>{console.error((error as Error).message);process.exitCode=1;});
