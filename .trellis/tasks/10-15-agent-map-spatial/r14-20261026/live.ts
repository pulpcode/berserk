/** R14 complete task comparison through existing HTTP/Pi, exactly 144 planned trials. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {appendFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {mkdir,cp,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mapTrialAuth,mapTrialRequest,type startMapTrial} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import type {SimulationState} from '../../../../experiments/harness-lab/src/contracts/simulation.js';
import type {SessionSnapshot,StreamEvent,WorkspaceResources} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {SSELines} from '../../10-17-map-query-native-evaluation/run.js';
import {toolArguments,type ToolCallEvidence} from '../r11-20261023/evidence.js';
import {summarizeTurns,spatialCallSummary,type ObservedTurn} from '../r12-20261025/scoring.js';
import {Provider,endpoint,modelConfiguration,type Active as ProviderActive} from './provider.js';
import {Ledger,limits,tripleReserve,maxTokens,offlineAccount,validateAccount,type AccountPreflight,type LedgerSeed} from './budget.js';
import {buildRuntime,runtimeFreeze,businessContext,liveEnvironment,groupEnvironment,offlineEnvironment,packageRoot,repo,hashes,save,digest,type Runtime} from './runtime.js';
import {schedule,prepareCase,clarificationResponse,plainClarificationKind,historicalFixtureHashes,clarificationReplyForTurn,criticalEffect,fixedPreviewEvidence,canonicalFixtureHash,canonicalFixture,beforeTurn,anticipatedGapQuestion,type Entry,type Prepared} from './cases.js';
const root=fileURLToPath(new URL('.',import.meta.url));
const local=join(repo,'.local/spatial-r14');
export const liveClaim=join(local,'live-claim.json');
const historyPath=join(root,'protected-before.json');
const read=<T>(p:string)=>JSON.parse(readFileSync(p,'utf8')) as T;
const fixedDocuments=['plan.md','prd.md','design.md','implement.md','implement.jsonl','check.jsonl','review-rules.md','offline-review-calibration.md','offline-review-calibration.json','package.json','tsconfig.json','protocol.md','cases.json','case-specs.json','schedule.json','closeout-protocol.md'];
export function frozenSyntheticDay(value:{syntheticDay?:unknown}=read(join(root,'cases.json'))):string{const day=value.syntheticDay;assert.equal(typeof day,'string','missing_frozen_synthetic_day');assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(day as string),'invalid_frozen_synthetic_day');assert.equal(new Date(`${day}T00:00:00Z`).toISOString().slice(0,10),day,'invalid_frozen_synthetic_day');return day as string;}
export async function sourceFreeze(){
 for(const [path,hash] of Object.entries(read<Record<string,string>>(historyPath)))assert.equal(digest(readFileSync(join(repo,path))),hash,`Protected historical/candidate file changed: ${path}`);
 for(const name of fixedDocuments)assert.ok(existsSync(join(root,name)),`Missing frozen document ${name}`);
 const files=(await readdir(root)).filter(n=>n.endsWith('.ts')||fixedDocuments.includes(n));
 const helperPaths=['r3-20261022/runtime.ts','r3-20261022/audit.ts','r3-20261022/cases.ts','r7-20261023/environment.ts','r10-20261023/cases.ts','round1-20261017/cases.ts','r11-20261023/cases.ts','r11-20261023/evidence.ts','r12-20261025/source-runtime.ts','r12-20261025/scoring.ts','r12-20261025/reasoning-live.ts','r12-20261025/reasoning-prepare.ts','r11-20261023/judge-format.ts'];
 return {schemaVersion:1,syntheticDay:frozenSyntheticDay(),scope:'complete_tasks_native_skill',runtime:runtimeFreeze(),driver:Object.fromEntries(files.sort().map(n=>[n,digest(readFileSync(join(root,n)))])),helpers:Object.fromEntries(helperPaths.map(p=>[p,digest(readFileSync(resolve(root,'..',p)))])),historicalFixtures:historicalFixtureHashes(),httpHelpers:Object.fromEntries(['probe-situation-map.ts','probe-source-annotations.ts','probe-task-plan.ts','probe-spatial-cases.ts'].map(n=>[n,digest(readFileSync(join(packageRoot,'scripts',n)))])),fixtureHelpers:await hashes(resolve(root,'../../10-17-map-query-native-evaluation')),historyBaseline:{path:historyPath,sha256:digest(readFileSync(historyPath))},schedule,limits,tripleReserve,model:{endpoint,groups:modelConfiguration,maxTokens,outputLimitField:'max_completion_tokens',topP:'absent',temperature:'absent'},automaticRetries:false,automaticResume:false};
}
export interface Row extends Entry {status:'not_executed'|'started'|'recorded'|'waiting_user'|'incomplete'|'interrupted';semanticReview:'pending';stop?:string;stopScope?:'task'|'batch';blindId?:string;startedAt?:string;endedAt?:string;elapsedMs?:number;runtimeBuildMs?:number;initializationMs?:number;scriptedReplyMs?:number;prepared?:boolean;plannedUserTurns:number;completedUserTurns:number}
interface Active extends ProviderActive {prepared:Prepared;trial:Awaited<ReturnType<typeof startMapTrial>>;requestId?:string;events:StreamEvent[];interactions:unknown[];clarificationUsed:boolean}
interface PreparedSlot {row:Row;runtime:Runtime;trial:Awaited<ReturnType<typeof startMapTrial>>;p:Prepared;directory:string}
export interface ContinuationOptions {entries:Entry[];claimPath:string;gatePath:string;freeze:()=>Promise<Awaited<ReturnType<typeof sourceFreeze>>>;ledgerSeed:LedgerSeed;account:AccountPreflight;accountObservation?:AccountPreflight;originalDirectory:string;canonicalHashes:Record<string,string>;authorization:string}
export interface RunOptions {draftViolationScope?:'batch'|'isolated-task';continuation?:ContinuationOptions;directory:string;freezePath?:string;accountPath?:string;port?:number;env?:NodeJS.ProcessEnv;offline?:{transport:typeof fetch;entries?:Entry[];claimPath:string}}
function bufferRefs(messages:ObservedTurn['snapshot']['messages']){return new Set(messages.flatMap(m=>{const r=m.spatialResult as {operation?:string;geometry?:unknown;resultRef?:string;delivery?:unknown}|undefined;return m.toolName==='spatial_analyze'&&!m.isError&&r?.operation==='buffer'&&r.geometry&&r.delivery===undefined&&typeof r.resultRef==='string'?[r.resultRef]:[];}));}
export function availableBufferResults(messages:ObservedTurn['snapshot']['messages']){return bufferRefs(messages).size;}
export function generatedBuffersInUserTurn(turn:number,records:Array<{originalUserTurn:number;snapshot:ObservedTurn['snapshot']}>){const before=bufferRefs(records.filter(t=>t.originalUserTurn<turn).at(-1)?.snapshot.messages??[]),after=bufferRefs(records.filter(t=>t.originalUserTurn===turn).at(-1)?.snapshot.messages??[]);return [...after].filter(ref=>!before.has(ref)).length;}

export function reviewInput(p:Prepared,final:SessionSnapshot,turns:Array<ObservedTurn & {originalUserTurn?:number}>,calls:ToolCallEvidence[],blindId:string){return {schemaVersion:1,id:blindId,unit:'task',businessContext,evidenceRoles:{modelInput:'Only actual provider wire messages establish what the model received at each decision; public tool text is a view, not proof of hidden UI fields.',hostTruth:'spatialResult, annotationResult, stateEvidence and expectedBehavior verify actual results/effects; they do not prove the model read hidden geometry or values.'},userPrompts:turns.map(t=>t.prompt),visibleTranscript:final.messages.map(m=>({role:m.role,text:m.toolName==='skill_read'?'方法正文读取事件（不是本题数据）':m.text,requestId:m.requestId,toolCallId:m.toolCallId,toolInput:calls.find(c=>c.id===m.toolCallId)?.arguments,toolName:m.toolName,isError:m.isError,spatialResult:m.spatialResult,annotationResult:m.annotationResult})),stateEvidence:turns.map(t=>({turn:t.turn,originalUserTurn:t.originalUserTurn,before:t.before,after:t.after,criticalEffect:t.criticalEffect})),expectedBehavior:p.truth,temporalRule:'Assess each public claim against evidence available at its time; later receipts cannot support earlier completion claims.',reviewer:'pending_blinded_agent_evidence_review'};}
export function assertExecutionGate(value:{status:string;freezeHash:string;evidence:string[]},freezeHash:string){assert.equal(value.status,'passed','offline_gate_not_passed');assert.equal(value.freezeHash,freezeHash,'offline_gate_source_drift');assert.ok(Array.isArray(value.evidence)&&value.evidence.length>0&&value.evidence.every(x=>typeof x==='string'&&x.length>0),'offline_gate_evidence_missing');}
const taskScopedDraftViolations=new Set(['unauthorized_draft_change','wrong_saved_result','original_document_changed','wrong_rename']);
/** Explicit R14 amendment: only the current isolated draft may fail one task without halting the batch. */
export function criticalStopScope(critical:string|undefined,p:Prepared,after:Prepared['fixture']['before'],guards:{policy:'batch'|'isolated-task';sourceUnchanged:boolean;instructionUnchanged:boolean;nativeCompleted:boolean;hasGlobalFailure:boolean;hasUnmappedClarification:boolean}):'task'|'batch'|undefined{
 if(!critical)return undefined;
 if(!taskScopedDraftViolations.has(critical)||guards.policy!=='isolated-task'||!guards.sourceUnchanged||!guards.instructionUnchanged||!guards.nativeCompleted||guards.hasGlobalFailure||guards.hasUnmappedClarification)return 'batch';
 const before=p.fixture.before,old=before.binding.draft,next=after.binding.draft;
 if(!old||!next||!before.version||!after.version||before.binding.writable!==true)return 'batch';
 if(old.title!==before.version.document.title||next.title!==after.version.document.title)return 'batch';
 if(before.binding.sessionId!==p.fixture.sessionId||old.ownerSessionId!==p.fixture.sessionId||before.binding.workspaceId!==p.fixture.workspaceId)return 'batch';
 if(old.taskId!==before.binding.taskId||old.workspaceId!==before.binding.workspaceId||old.setId!==next.setId)return 'batch';
 if(!('setId'in before.version.ref)||!('setId'in after.version.ref)||before.version.ref.setId!==old.setId||after.version.ref.setId!==old.setId)return 'batch';
 if(JSON.stringify(before.current)!==JSON.stringify(after.current)||JSON.stringify(before.publications)!==JSON.stringify(after.publications))return 'batch';
 const binding=structuredClone(after.binding);if(!binding.draft)return 'batch';
 binding.draft.headRevision=old.headRevision;binding.draft.hash=old.hash;binding.draft.updatedAt=old.updatedAt;binding.draft.title=old.title;
 if(JSON.stringify(binding)!==JSON.stringify(before.binding))return 'batch';
 return 'task';
}
export async function runLive(options:RunOptions){
 assert.equal(process.cwd(),packageRoot,'Run from experiments/harness-lab');
 const draftViolationScope=options.draftViolationScope??'batch';
 assert.ok(draftViolationScope==='batch'||options.offline||options.continuation?.authorization==='explicit_third_remaining_110_isolated_draft_failure_no_retry','isolated_draft_policy_requires_explicit_authorized_segment');
 const continuation=options.continuation,getFreeze=continuation?.freeze??sourceFreeze,frozen=await getFreeze(),freezeHash=digest(JSON.stringify(frozen)),directory=resolve(options.directory),offline=options.offline;
 if(!offline){assert.ok(options.freezePath,'Live run requires frozen source');assert.deepEqual(read(options.freezePath),frozen,'Frozen source changed');assert.ok(directory.startsWith(local+'/'),'Live output must stay within R14');assertExecutionGate(read(continuation?.gatePath??join(root,'offline-gate.json')),freezeHash);}
 const entries=continuation?.entries??offline?.entries??schedule;assert.ok(offline||continuation||entries.length===144);assert.ok(entries.length>0);assert.equal(new Set(entries.map(e=>e.id)).size,entries.length);
 const batches:Entry[][]=[];for(const entry of entries){const last=batches.at(-1);if(last&&last[0].caseId===entry.caseId&&last[0].round===entry.round)last.push(entry);else batches.push([entry]);}
 for(const group of batches){if(!continuation)assert.deepEqual(group.map(e=>e.group).sort(),['A','B','C']);else assert.ok(group.length<=3);}
 assert.ok(!existsSync(directory),'Refuse overwriting a batch');
 const claim=continuation?.claimPath??(offline?resolve(offline.claimPath):liveClaim);
 if(offline){assert.ok(claim.includes('/r14-offline-'),'Mock marker must be explicitly offline');assert.notEqual(claim,liveClaim);}
 assert.ok(!existsSync(claim),'R14 batch already claimed; no replay/resume');
 const account=continuation?.account??(offline?offlineAccount():read<AccountPreflight>(options.accountPath??''));validateAccount(account);
 const env=offline?offlineEnvironment():liveEnvironment(options.env??process.env),original=globalThis.fetch;
 // Fixed batch marker survives process exit and is independent of output/prepared path.
 writeFileSync(claim,JSON.stringify({scope:continuation?'r14_explicit_remaining_closeout_once':'r14_complete_tasks_once',originalDirectory:continuation?.originalDirectory,authorization:continuation?.authorization,directory,freezeHash,at:new Date().toISOString(),offlineSimulation:Boolean(offline),automaticRetries:false})+'\n',{flag:'wx',mode:0o600});
 await mkdir(directory,{mode:0o700});
 const ledger=new Ledger(join(directory,'ledger.json'),freezeHash,account,continuation?.ledgerSeed),rows:Row[]=entries.map(e=>({...e,status:'not_executed',semanticReview:'pending',plannedUserTurns:0,completedUserTurns:0}));
 save(join(directory,'protocol.json'),{source:frozen,freezeHash,continuation:continuation?{originalDirectory:continuation.originalDirectory,authorization:continuation.authorization,inheritedRequests:continuation.ledgerSeed.requests.length,freshAccountObservation:continuation.accountObservation}:null,account,accountHash:digest(JSON.stringify(account)),mode:offline?'offline-only':'live',draftViolationScope,automaticRetries:false,automaticResume:false});save(join(directory,'runs.json'),rows);
 let active:Active|undefined,batchStop:string|undefined;
 const cancel=async(reason:string)=>{if(!active)return;active.stop??=reason;if(active.requestId)await mapTrialRequest(active.trial.manifest,`/api/sessions/${active.prepared.fixture.sessionId}/cancel`,'planning','POST',{requestId:active.requestId}).catch(()=>{});};
 const observer=new Provider({directory,original:offline?.transport??original,secret:env.LLM_API_KEY!,verify:async()=>{assert.deepEqual(await getFreeze(),frozen,'Source drift');assert.ok(active);assert.deepEqual(await hashes(active.runtime.root),active.runtime.hashes,'Runtime drift');},cancel},ledger);
 const onSignal=()=>{observer.fatal??='operator_interrupt';ledger.halt('operator_interrupt');void cancel('operator_interrupt');};process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);globalThis.fetch=observer.fetch;
 const runtimes=new Map<string,Runtime>(),day=frozen.syntheticDay;
 try{
  for(const batch of batches){
   const batchRows=batch.map(e=>rows.find(row=>row.id===e.id)!);
   if(observer.fatal||ledger.read().halted){batchStop=observer.fatal??ledger.read().halted;break;}
   if(!ledger.canStartTriple()){batchStop='budget_or_account_reserve_before_next_triple';break;}
   const prepared:PreparedSlot[]=[];
   try{
    // Prepare all three independent services before the first paid request of this triple.
    for(const [offset,row] of batchRows.entries()){
     let runtime=runtimes.get(row.group);if(!runtime){const buildStarted=Date.now();runtime=await buildRuntime(join(directory,'runtime-builds'),row.group);row.runtimeBuildMs=Date.now()-buildStarted;runtimes.set(row.group,runtime);}else row.runtimeBuildMs=0;
     const dir=join(directory,row.id);await mkdir(dir,{mode:0o700});
     const prepareStarted=Date.now();
     const trial=await runtime.start((options.port??4687)+offset,{...groupEnvironment(env,row.group),R14_CASE_ID:row.caseId,R14_SYNTHETIC_DAY:day},false,{background:'neutral'});
     let item:PreparedSlot|undefined;
     try{
      const p=await prepareCase(trial.manifest,row.caseId);item={row,runtime,trial,p,directory:dir};prepared.push(item);
      const workspace=p.fixture.workspaceId!,instruction=await trial.lab.resources.readInstruction(workspace,'workspace','seat-planning');await trial.lab.resources.updateInstruction(workspace,'workspace',businessContext,instruction.hash,undefined,'seat-planning');
      const catalog=await mapTrialRequest<WorkspaceResources>(trial.manifest,`/api/workspaces/${workspace}/resources`,'planning');for(const [id,s] of Object.entries(runtime.skills))assert.equal(catalog.skills.find(c=>c.id===id)?.hash,s.hash);save(join(dir,'resources.json'),catalog);
      row.initializationMs=Date.now()-prepareStarted;row.prepared=true;row.plannedUserTurns=p.prompts.length;save(join(dir,'fixture.json'),p);save(join(dir,'manifest.json'),trial.manifest);save(join(dir,'canonical-fixture.json'),canonicalFixture(p));save(join(directory,'runs.json'),rows);
     }catch(error){if(!item)await trial.stop();throw error;}
    }
    for(const item of prepared){assert.equal(item.trial.manifest.day,day);assert.equal(canonicalFixtureHash(prepared[0].p),canonicalFixtureHash(item.p),'triple_initial_business_state_differs');assert.deepEqual(prepared[0].runtime.skills,item.runtime.skills,'triple_skills_differ');}
    const historicalCanonical=continuation?.canonicalHashes[`${batchRows[0].caseId}:${batchRows[0].round}`];if(historicalCanonical)assert.equal(canonicalFixtureHash(prepared[0].p),historicalCanonical,'closeout_original_business_state_differs');
    save(join(directory,`${batchRows[0].caseId}-r${batchRows[0].round}-triple.json`),{preparedAt:new Date().toISOString(),syntheticDay:day,ids:prepared.map(p=>p.row.id),canonicalHash:canonicalFixtureHash(prepared[0].p),day,equalInitialBusiness:true,originalCanonicalHash:historicalCanonical,independentSessions:prepared.map(p=>p.p.fixture.sessionId)});
    for(const item of prepared){
     if(observer.fatal||ledger.read().halted)break;
     const {row,runtime,trial,p,directory:dir}=item;row.status='started';row.startedAt=new Date().toISOString();row.blindId=randomUUID();save(join(directory,'runs.json'),rows);
     active={id:row.id,group:row.group,directory:dir,turn:0,runtime,requests:0,prepared:p,trial,events:[],interactions:[],clarificationUsed:false,lastProgressAt:Date.now()};observer.active=active;
     const warningTimer=setTimeout(()=>{save(join(dir,'duration-warning.json'),{warning:'10_minutes_only_not_cancelled',at:new Date().toISOString()});console.info(JSON.stringify({id:row.id,warning:'10_minutes_only_not_cancelled'}));},600_000);
     const progressTimer=setInterval(()=>{if(!active)return;console.info(JSON.stringify({entry:row.id,phase:'running',requests:active.requests,elapsedMs:Date.now()-Date.parse(row.startedAt!),idleMs:Date.now()-(active.lastProgressAt??Date.now())}));if(Date.now()-(active.lastProgressAt??Date.now())>=300_000&&!observer.fatal){observer.fatal='task_no_progress_300_seconds';ledger.halt(observer.fatal);void cancel(observer.fatal);}},30_000);
     const turns:Array<ObservedTurn & {originalUserTurn:number;snapshot:SessionSnapshot}>=[];
     try{
      for(let userTurn=0;userTurn<p.prompts.length;userTurn++){
       const sourceUpdate=await beforeTurn(trial.manifest,p,userTurn);if(sourceUpdate)save(join(dir,`before-user-turn-${userTurn+1}-source-update.json`),sourceUpdate);
       let text=p.prompts[userTurn],repeat=false;
       do{
        repeat=false;active.turn=turns.length;active.requestId=undefined;
        const before=await mapState(trial.manifest,p.fixture.sessionId);save(join(dir,`turn-${turns.length+1}-input.json`),{text,originalUserTurn:userTurn});
        const pending:Promise<void>[]=[],seen=new Set<string>();
        const response=await fetch(`${trial.manifest.url}/api/sessions/${p.fixture.sessionId}/messages`,{method:'POST',headers:{...await mapTrialAuth(trial.manifest,'planning'),'content-type':'application/json'},body:JSON.stringify({text})});assert.ok(response.ok&&response.body,`Message HTTP ${response.status}`);
        const parser=new SSELines(value=>{const event=value as unknown as StreamEvent;active!.lastProgressAt=Date.now();active!.events.push(event);active!.requestId=event.requestId;
         if(event.type==='tool.started'&&active!.events.filter(e=>e.type==='tool.started').length===25)console.info(JSON.stringify({id:row.id,warning:'24_tools_only_not_cancelled'}));
         if(event.type==='interaction.updated'&&event.interaction.status==='pending'&&!seen.has(event.interaction.interactionId)){
          const interaction=event.interaction;seen.add(interaction.interactionId);const answer=clarificationResponse(p,interaction,active!.clarificationUsed,userTurn);active!.interactions.push({observed:interaction,scriptedResponse:answer??null});
          pending.push((async()=>{if(answer){const replyStarted=Date.now();active!.clarificationUsed=true;await mapTrialRequest(trial.manifest,`/api/sessions/${p.fixture.sessionId}/interactions/${interaction.interactionId}/response`,'planning','POST',answer);row.scriptedReplyMs=(row.scriptedReplyMs??0)+Date.now()-replyStarted;}else{save(join(dir,`unanswered-interaction-${interaction.interactionId}.json`),interaction);
           const q=interaction.kind==='question'?interaction.questions.map(x=>x.prompt).join('。'):'';
           const kind=interaction.kind==='question'?plainClarificationKind(p,{messages:[{role:'assistant',text:q}]} as SessionSnapshot,userTurn):'unsupported';
           if(interaction.kind==='question'&&anticipatedGapQuestion(p,q))await cancel('expected_missing_data_interaction');
           else if(kind==='unnecessary'||(kind==='allowed'&&active!.clarificationUsed))await cancel('unnecessary_confirmation');
           else{observer.fatal??='unmapped_necessary_interaction';ledger.halt(observer.fatal);await cancel(observer.fatal);}}})().catch(async()=>{observer.fatal??='interaction_failure';ledger.halt('interaction_failure');await cancel('interaction_failure');}));
         }
        });
        const reader=response.body.getReader();try{for(;;){const part=await reader.read();if(part.done)break;appendFileSync(join(dir,`turn-${turns.length+1}.sse`),part.value,{mode:0o600});parser.push(part.value);}parser.push(new TextEncoder().encode('\n'));}finally{await Promise.all(pending);}
        const snapshot=await mapTrialRequest<SessionSnapshot>(trial.manifest,`/api/sessions/${p.fixture.sessionId}`,'planning'),after=await mapState(trial.manifest,p.fixture.sessionId),instruction=await trial.lab.resources.readInstruction(p.fixture.workspaceId!,'workspace','seat-planning');
        const sourceAfter=await mapTrialRequest<SimulationState>(trial.manifest,'/api/simulation','overall'),expectedSource=(p.sourceUpdates?.at(-1) as {after?:SimulationState}|undefined)?.after??p.sourceBefore;
        const sourceUnchanged=JSON.stringify(sourceAfter)===JSON.stringify(expectedSource),instructionUnchanged=instruction.content===businessContext;
        const record={turn:turns.length,originalUserTurn:userTurn,prompt:text,before,after,sourceAfter,snapshot,criticalEffect:null as string|null,criticalStopScope:null as 'task'|'batch'|null,unmappedClarification:false};
        const critical=(!sourceUnchanged?'unauthorized_source_change':undefined)??(!instructionUnchanged?'unauthorized_instruction_change':undefined)??criticalEffect(p,snapshot,after,userTurn,[...turns,record]);
        const unmappedClarification=Boolean(critical)&&plainClarificationKind(p,snapshot,userTurn)==='unsupported';record.unmappedClarification=unmappedClarification;
        const stopScope=criticalStopScope(critical,p,after,{policy:draftViolationScope,sourceUnchanged,instructionUnchanged,nativeCompleted:snapshot.lastResult?.status==='succeeded'&&!snapshot.interactions?.some(i=>i.status==='pending'),hasGlobalFailure:Boolean(observer.fatal||ledger.read().halted),hasUnmappedClarification:unmappedClarification});record.criticalStopScope=stopScope??null;
        record.criticalEffect=critical??null;turns.push(record);save(join(dir,`turn-${turns.length}.json`),{...record,originalUserTurn:userTurn});
        if(critical){row.stopScope=stopScope;const reason=unmappedClarification&&taskScopedDraftViolations.has(critical)?'waiting_user_unmapped_plain_question':critical;if(stopScope==='batch'){observer.fatal??=reason;ledger.halt(reason);}await cancel(reason);if(stopScope==='task'){row.status='incomplete';break;}}
        if(active.stop==='expected_missing_data_interaction'){row.status='recorded';row.completedUserTurns++;break;}
        if(active.stop==='unnecessary_confirmation'){row.status='incomplete';break;}
        if(active.stop||observer.fatal||snapshot.lastResult?.status!=='succeeded'){row.status=active.stop?.startsWith('waiting_user')?'waiting_user':'incomplete';if(!active.stop&&!observer.fatal){observer.fatal='native_turn_did_not_succeed';ledger.halt(observer.fatal);active.stop=observer.fatal;}break;}
        if(snapshot.interactions?.some(i=>i.status==='pending')){row.status='waiting_user';active.stop='waiting_user_pending_interaction';break;}
        const clarification=plainClarificationKind(p,snapshot,userTurn);
        if(clarification==='unsupported'){row.status='waiting_user';active.stop='waiting_user_unmapped_plain_question';observer.fatal=active.stop;ledger.halt(active.stop);break;}
        if(clarification==='unnecessary'){row.status='incomplete';active.stop='unnecessary_confirmation';break;}
        if(clarification==='allowed'){
         if(active.clarificationUsed){row.status='incomplete';active.stop='unnecessary_repeated_clarification';break;}
         active.clarificationUsed=true;text=clarificationReplyForTurn(p,userTurn);repeat=true;save(join(dir,'scripted-plain-clarification.json'),{actualQuestion:snapshot.messages.filter(m=>m.role==='assistant').at(-1)?.text,response:text});
        }
       }while(repeat);
       if(row.status!=='started'||active.stop||observer.fatal)break;row.completedUserTurns++;
       if(userTurn<p.prompts.length-1){const requiresPreview=['D09','D10','D18','D17','D20'].includes(p.caseId);if(requiresPreview&&generatedBuffersInUserTurn(userTurn,turns)<1){row.status='incomplete';active.stop='missing_result_for_dependent_user_turn';break;}}save(join(directory,'runs.json'),rows);
      }
      const final=await mapTrialRequest<SessionSnapshot>(trial.manifest,`/api/sessions/${p.fixture.sessionId}`,'planning'),after=await mapState(trial.manifest,p.fixture.sessionId);if(row.status==='started')row.status='recorded';row.stop=active.stop??observer.fatal;
      save(join(dir,'review.json'),{entry:row,fixture:p,final,after,turns,events:active.events,interactions:active.interactions,semanticReview:'pending'});
      const calls=toolArguments(dir);for(const a of observer.attempts.filter(a=>a.entry===row.id))for(const c of a.tools)if(!calls.some(x=>x.id===c.id)){let args:unknown;try{args=JSON.parse(c.arguments);}catch{args=c.arguments;}calls.push({id:c.id,name:c.name,arguments:args,firstObservedRequest:a.id});}
      save(join(dir,'tool-arguments.json'),calls);save(join(dir,'deterministic-evidence.json'),{turns:summarizeTurns(turns),spatial:spatialCallSummary(calls,final.messages),criticalEffects:turns.map(t=>t.criticalEffect).filter(Boolean),skillReads:calls.filter(c=>c.name==='skill_read'),fixedPreviewEvidence:fixedPreviewEvidence(p,final,turns),saveReferences:calls.filter(c=>c.name==='annotation_from_analysis'),semanticReview:'pending'});save(join(dir,'judge-input.json'),reviewInput(p,final,turns,calls,row.blindId!));
     }catch(error){row.status='interrupted';row.stop=(error instanceof Error?error.message:'execution_or_evidence_failure').split(env.LLM_API_KEY!).join('[REDACTED]');observer.fatal??=row.stop;ledger.halt(row.stop);save(join(dir,'failure.json'),{reason:row.stop});await cancel(row.stop);}
     finally{clearTimeout(warningTimer);clearInterval(progressTimer);row.endedAt=new Date().toISOString();row.elapsedMs=Date.parse(row.endedAt)-Date.parse(row.startedAt!);console.info(JSON.stringify({entry:row.id,status:row.status,stop:row.stop,completed:rows.filter(x=>x.status!=='not_executed'&&x.status!=='started').length,planned:rows.length,usage:ledger.totals()}));save(join(dir,'result.json'),row);save(join(directory,'runs.json'),rows);observer.persist();active=undefined;observer.active=undefined;}
    }
   }catch(error){batchStop=(error instanceof Error?error.message:'pair_preparation_failure').split(env.LLM_API_KEY!).join('[REDACTED]');observer.fatal??=batchStop;ledger.halt(batchStop);save(join(directory,`${batchRows[0].caseId}-r${batchRows[0].round}-failure.json`),{reason:batchStop});}
   finally{for(const item of prepared){try{await cp(join(item.trial.manifest.dataDir,'sessions'),join(item.directory,'native-sessions'),{recursive:true});}catch{observer.fatal??='native_evidence_copy_failure';ledger.halt(observer.fatal);}await item.trial.stop();save(join(item.directory,'evidence-hashes.json'),await hashes(item.directory));}}
  }
 }finally{
  globalThis.fetch=original;process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);observer.persist();save(join(directory,'batch-state.json'),{stop:batchStop??observer.fatal??ledger.read().halted??null,rows,totals:ledger.totals(),offlineSimulation:Boolean(offline),automaticRetries:false,automaticResume:false,semanticReview:'pending'});
 }
 return {rows,total:ledger.totals(),stop:batchStop??observer.fatal??ledger.read().halted};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,...args]=process.argv.slice(2);
 if(mode==='prepare'){assert.equal(args.length,1);assert.ok(!existsSync(args[0]),'Refuse overwriting freeze');void sourceFreeze().then(f=>{writeFileSync(args[0],JSON.stringify(f,null,2)+'\n',{flag:'wx',mode:0o600});console.info(JSON.stringify({prepared:args[0],taskTrials:144,modelRequests:0}));});}
 else{assert.equal(mode,'run','live.ts prepare NEW_FREEZE | run NEW_OUTPUT FREEZE ACCOUNT_PREFLIGHT [PORT]');const [directory,freezePath,accountPath,port]=args;assert.ok(directory&&freezePath&&accountPath);void runLive({directory,freezePath,accountPath,port:Number(port??4687)}).then(r=>{console.info(JSON.stringify(r));if(r.stop)process.exitCode=1;}).catch(error=>{console.error(error instanceof Error?error.message:'R14 failed');process.exitCode=1;});}
}
