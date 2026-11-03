/** R13 complete task comparison through existing HTTP/Pi, exactly ten trials. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {appendFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {mkdir,cp,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mapTrialAuth,mapTrialRequest,type startMapTrial} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import type {SessionSnapshot,StreamEvent,WorkspaceResources} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {SSELines} from '../../10-17-map-query-native-evaluation/run.js';
import {toolArguments,type ToolCallEvidence} from '../r11-20261023/evidence.js';
import {summarizeTurns,spatialCallSummary,type ObservedTurn} from '../r12-20261025/scoring.js';
import {Provider,endpoint,requestModel,type Active as ProviderActive} from './provider.js';
import {Ledger,limits,pairReserve,maxTokens,responseModel} from './budget.js';
import {buildRuntime,runtimeFreeze,businessContext,liveEnvironment,offlineEnvironment,packageRoot,repo,hashes,save,digest,type Runtime} from './runtime.js';
import {schedule,prepareCase,clarificationResponse,plainClarificationKind,historicalFixtureHashes,clarificationReplyForTurn,criticalEffect,canonicalFixtureHash,canonicalFixture,type Entry,type Prepared} from './cases.js';
const root=fileURLToPath(new URL('.',import.meta.url));
const local=join(repo,'.local/spatial-r13');
export const liveClaim=join(local,'live-claim.json');
const historyPath=join(local,'history-before-20261026.json');
const read=<T>(p:string)=>JSON.parse(readFileSync(p,'utf8')) as T;
const fixedDocuments=['plan.md','prd.md','design.md','implement.md','implement.jsonl','check.jsonl','review-rules.md','offline-review-calibration.md','offline-review-calibration.json','package.json','tsconfig.json','protocol.md'];
export async function sourceFreeze(){
 for(const name of fixedDocuments)assert.ok(existsSync(join(root,name)),`Missing frozen document ${name}`);
 const files=(await readdir(root)).filter(n=>n.endsWith('.ts')||fixedDocuments.includes(n));
 const helperPaths=['r3-20261022/runtime.ts','r3-20261022/audit.ts','r3-20261022/cases.ts','r7-20261023/environment.ts','r10-20261023/cases.ts','round1-20261017/cases.ts','r11-20261023/cases.ts','r11-20261023/evidence.ts','r12-20261025/source-runtime.ts','r12-20261025/scoring.ts','r12-20261025/reasoning-live.ts','r12-20261025/reasoning-prepare.ts','r11-20261023/judge-format.ts'];
 return {schemaVersion:1,scope:'complete_tasks_native_skill',runtime:runtimeFreeze(),driver:Object.fromEntries(files.sort().map(n=>[n,digest(readFileSync(join(root,n)))])),helpers:Object.fromEntries(helperPaths.map(p=>[p,digest(readFileSync(resolve(root,'..',p)))])),historicalFixtures:historicalFixtureHashes(),httpHelpers:Object.fromEntries(['probe-situation-map.ts','probe-source-annotations.ts','probe-task-plan.ts','probe-spatial-cases.ts'].map(n=>[n,digest(readFileSync(join(packageRoot,'scripts',n)))])),fixtureHelpers:await hashes(resolve(root,'../../10-17-map-query-native-evaluation')),historyBaseline:{path:historyPath,sha256:digest(readFileSync(historyPath))},schedule,limits,pairReserve,model:{endpoint,requestModel,responseModel,maxTokens,topP:1,temperature:'absent'},automaticRetries:false,automaticResume:false};
}
interface Row extends Entry {status:'not_executed'|'started'|'recorded'|'waiting_user'|'incomplete'|'interrupted';semanticReview:'pending';stop?:string;blindId?:string;startedAt?:string;endedAt?:string;elapsedMs?:number;prepared?:boolean;plannedUserTurns:number;completedUserTurns:number}
interface Active extends ProviderActive {prepared:Prepared;trial:Awaited<ReturnType<typeof startMapTrial>>;requestId?:string;events:StreamEvent[];interactions:unknown[];clarificationUsed:boolean}
interface PreparedSlot {row:Row;runtime:Runtime;trial:Awaited<ReturnType<typeof startMapTrial>>;p:Prepared;directory:string}
export interface RunOptions {directory:string;freezePath?:string;port?:number;env?:NodeJS.ProcessEnv;offline?:{transport:typeof fetch;entries?:Entry[];claimPath:string}}
export function availableBufferResults(messages:ObservedTurn['snapshot']['messages']){return new Set(messages.flatMap(m=>{const r=m.spatialResult as {operation?:string;geometry?:unknown;resultRef?:string}|undefined;return m.toolName==='spatial_analyze'&&!m.isError&&r?.operation==='buffer'&&r.geometry&&typeof r.resultRef==='string'?[r.resultRef]:[];})).size;}
export function reviewInput(p:Prepared,final:SessionSnapshot,turns:ObservedTurn[],calls:ToolCallEvidence[],blindId:string){return {schemaVersion:1,id:blindId,unit:'task',businessContext,evidenceRoles:{modelInput:'Only actual provider wire messages establish what the model received at each decision; public tool text is a view, not proof of hidden UI fields.',hostTruth:'spatialResult, annotationResult, stateEvidence and expectedBehavior verify actual results/effects; they do not prove the model read hidden geometry or values.'},userPrompts:turns.map(t=>t.prompt),visibleTranscript:final.messages.map(m=>({role:m.role,text:m.toolName==='skill_read'?'方法正文读取事件（不是本题数据）':m.text,requestId:m.requestId,toolCallId:m.toolCallId,toolInput:calls.find(c=>c.id===m.toolCallId)?.arguments,toolName:m.toolName,isError:m.isError,spatialResult:m.spatialResult,annotationResult:m.annotationResult})),stateEvidence:turns.map(t=>({turn:t.turn,before:t.before,after:t.after,criticalEffect:t.criticalEffect})),expectedBehavior:p.truth,temporalRule:'Assess each public claim against evidence available at its time; later receipts cannot support earlier completion claims.',reviewer:'pending_blinded_agent_evidence_review'};}
export async function runLive(options:RunOptions){
 assert.equal(process.cwd(),packageRoot,'Run from experiments/harness-lab');
 const frozen=await sourceFreeze(),freezeHash=digest(JSON.stringify(frozen)),directory=resolve(options.directory),offline=options.offline;
 if(!offline){assert.ok(options.freezePath,'Live run requires frozen source');assert.deepEqual(read(options.freezePath),frozen,'Frozen source changed');assert.ok(directory.startsWith(local+'/'),'Live output must stay within R13');}
 const entries=offline?.entries??schedule;assert.ok(offline||entries.length===10);assert.ok(entries.length>0&&entries.length%2===0);assert.equal(new Set(entries.map(e=>e.id)).size,entries.length);
 for(let i=0;i<entries.length;i+=2){assert.equal(entries[i].caseId,entries[i+1].caseId);assert.deepEqual([entries[i].group,entries[i+1].group].sort(),['E0','E1']);}
 assert.ok(!existsSync(directory),'Refuse overwriting a batch');
 const claim=offline?resolve(offline.claimPath):liveClaim;
 if(offline){assert.ok(claim.includes('/r13-offline-'),'Mock marker must be explicitly offline');assert.notEqual(claim,liveClaim);}
 assert.ok(!existsSync(claim),'R13 batch already claimed; no replay/resume');
 const env=offline?offlineEnvironment():liveEnvironment(options.env??process.env),original=globalThis.fetch;
 // Fixed batch marker survives process exit and is independent of output/prepared path.
 writeFileSync(claim,JSON.stringify({scope:'r13_complete_tasks_once',directory,freezeHash,at:new Date().toISOString(),offlineSimulation:Boolean(offline),automaticRetries:false})+'\n',{flag:'wx',mode:0o600});
 await mkdir(directory,{mode:0o700});
 const ledger=new Ledger(join(directory,'ledger.json'),freezeHash),rows:Row[]=entries.map(e=>({...e,status:'not_executed',semanticReview:'pending',plannedUserTurns:0,completedUserTurns:0}));
 save(join(directory,'protocol.json'),{source:frozen,freezeHash,mode:offline?'offline-only':'live',automaticRetries:false,automaticResume:false});save(join(directory,'runs.json'),rows);
 let active:Active|undefined,batchStop:string|undefined;
 const cancel=async(reason:string)=>{if(!active)return;active.stop??=reason;if(active.requestId)await mapTrialRequest(active.trial.manifest,`/api/sessions/${active.prepared.fixture.sessionId}/cancel`,'planning','POST',{requestId:active.requestId}).catch(()=>{});};
 const observer=new Provider({directory,original:offline?.transport??original,secret:env.LLM_API_KEY!,verify:async()=>{assert.deepEqual(await sourceFreeze(),frozen,'Source drift');assert.ok(active);assert.deepEqual(await hashes(active.runtime.root),active.runtime.hashes,'Runtime drift');},cancel},ledger);
 const onSignal=()=>{observer.fatal??='operator_interrupt';ledger.halt('operator_interrupt');void cancel('operator_interrupt');};process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);globalThis.fetch=observer.fetch;
 const runtimes=new Map<string,Runtime>(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 try{
  for(let pair=0;pair<rows.length;pair+=2){
   if(observer.fatal||ledger.read().halted){batchStop=observer.fatal??ledger.read().halted;break;}
   if(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())!==day){batchStop='synthetic_day_changed';break;}
   if(!ledger.canStartPair()){batchStop='budget_reserve_before_next_pair';break;}
   const prepared:PreparedSlot[]=[];
   try{
    // Prepare both independent services before the first paid request of this pair.
    for(const [offset,row] of rows.slice(pair,pair+2).entries()){
     let runtime=runtimes.get(row.group);if(!runtime){runtime=await buildRuntime(join(directory,'runtime-builds'),row.group);runtimes.set(row.group,runtime);}
     const dir=join(directory,row.id);await mkdir(dir,{mode:0o700});
     const trial=await runtime.start((options.port??4667)+offset,env,false,{background:'neutral'});
     let item:PreparedSlot|undefined;
     try{
      const p=await prepareCase(trial.manifest,row.caseId);item={row,runtime,trial,p,directory:dir};prepared.push(item);
      const workspace=p.fixture.workspaceId!,instruction=await trial.lab.resources.readInstruction(workspace,'workspace','seat-planning');await trial.lab.resources.updateInstruction(workspace,'workspace',businessContext,instruction.hash,undefined,'seat-planning');
      const catalog=await mapTrialRequest<WorkspaceResources>(trial.manifest,`/api/workspaces/${workspace}/resources`,'planning');for(const [id,s] of Object.entries(runtime.skills))assert.equal(catalog.skills.find(c=>c.id===id)?.hash,s.hash);save(join(dir,'resources.json'),catalog);
      row.prepared=true;row.plannedUserTurns=p.prompts.length;save(join(dir,'fixture.json'),p);save(join(dir,'manifest.json'),trial.manifest);save(join(dir,'canonical-fixture.json'),canonicalFixture(p));save(join(directory,'runs.json'),rows);
     }catch(error){if(!item)await trial.stop();throw error;}
    }
    assert.equal(prepared[0].trial.manifest.day,prepared[1].trial.manifest.day);assert.equal(prepared[0].trial.manifest.day,day);assert.equal(canonicalFixtureHash(prepared[0].p),canonicalFixtureHash(prepared[1].p),'pair_initial_business_state_differs');assert.deepEqual(prepared[0].runtime.skills,prepared[1].runtime.skills,'pair_skills_differ');
    save(join(directory,`${rows[pair].caseId}-pair.json`),{ids:prepared.map(p=>p.row.id),canonicalHash:canonicalFixtureHash(prepared[0].p),day,equalInitialBusiness:true,independentSessions:prepared.map(p=>p.p.fixture.sessionId)});
    for(const item of prepared){
     if(observer.fatal||ledger.read().halted)break;
     const {row,runtime,trial,p,directory:dir}=item;row.status='started';row.startedAt=new Date().toISOString();row.blindId=randomUUID();save(join(directory,'runs.json'),rows);
     active={id:row.id,group:row.group,directory:dir,turn:0,runtime,requests:0,prepared:p,trial,events:[],interactions:[],clarificationUsed:false};observer.active=active;
     const warningTimer=setTimeout(()=>{save(join(dir,'duration-warning.json'),{warning:'10_minutes_only_not_cancelled',at:new Date().toISOString()});console.info(JSON.stringify({id:row.id,warning:'10_minutes_only_not_cancelled'}));},600_000);
     const turns:ObservedTurn[]=[];
     try{
      for(let userTurn=0;userTurn<p.prompts.length;userTurn++){
       let text=p.prompts[userTurn],repeat=false;
       do{
        repeat=false;active.turn=turns.length;active.requestId=undefined;
        const before=await mapState(trial.manifest,p.fixture.sessionId);save(join(dir,`turn-${turns.length+1}-input.json`),{text,originalUserTurn:userTurn});
        const pending:Promise<void>[]=[],seen=new Set<string>();
        const response=await fetch(`${trial.manifest.url}/api/sessions/${p.fixture.sessionId}/messages`,{method:'POST',headers:{...await mapTrialAuth(trial.manifest,'planning'),'content-type':'application/json'},body:JSON.stringify({text})});assert.ok(response.ok&&response.body,`Message HTTP ${response.status}`);
        const parser=new SSELines(value=>{const event=value as unknown as StreamEvent;active!.events.push(event);active!.requestId=event.requestId;
         if(event.type==='tool.started'&&active!.events.filter(e=>e.type==='tool.started').length===25)console.info(JSON.stringify({id:row.id,warning:'24_tools_only_not_cancelled'}));
         if(event.type==='interaction.updated'&&event.interaction.status==='pending'&&!seen.has(event.interaction.interactionId)){
          const interaction=event.interaction;seen.add(interaction.interactionId);const answer=clarificationResponse(p,interaction,active!.clarificationUsed,userTurn);active!.interactions.push({observed:interaction,scriptedResponse:answer??null});
          pending.push((async()=>{if(answer){active!.clarificationUsed=true;await mapTrialRequest(trial.manifest,`/api/sessions/${p.fixture.sessionId}/interactions/${interaction.interactionId}/response`,'planning','POST',answer);}else{save(join(dir,`unanswered-interaction-${interaction.interactionId}.json`),interaction);await cancel('waiting_user_unmapped_interaction');}})().catch(async()=>{observer.fatal??='interaction_failure';ledger.halt('interaction_failure');await cancel('interaction_failure');}));
         }
        });
        const reader=response.body.getReader();try{for(;;){const part=await reader.read();if(part.done)break;appendFileSync(join(dir,`turn-${turns.length+1}.sse`),part.value,{mode:0o600});parser.push(part.value);}parser.push(new TextEncoder().encode('\n'));}finally{await Promise.all(pending);}
        const snapshot=await mapTrialRequest<SessionSnapshot>(trial.manifest,`/api/sessions/${p.fixture.sessionId}`,'planning'),after=await mapState(trial.manifest,p.fixture.sessionId),instruction=await trial.lab.resources.readInstruction(p.fixture.workspaceId!,'workspace','seat-planning');
        const critical=criticalEffect(p,snapshot,after,userTurn)??(instruction.content!==businessContext?'unauthorized_instruction_change':undefined);
        const record={turn:turns.length,prompt:text,before,after,snapshot,criticalEffect:critical??null};turns.push(record);save(join(dir,`turn-${turns.length}.json`),{...record,originalUserTurn:userTurn});
        if(critical){observer.fatal=critical;ledger.halt(critical);await cancel(critical);}
        if(active.stop||observer.fatal||snapshot.lastResult?.status!=='succeeded'){row.status=active.stop?.startsWith('waiting_user')?'waiting_user':'incomplete';if(!active.stop&&!observer.fatal){observer.fatal='native_turn_did_not_succeed';ledger.halt(observer.fatal);active.stop=observer.fatal;}break;}
        if(snapshot.interactions?.some(i=>i.status==='pending')){row.status='waiting_user';active.stop='waiting_user_pending_interaction';break;}
        const clarification=plainClarificationKind(p,snapshot,userTurn);
        if(clarification==='unsupported'){row.status='waiting_user';active.stop='waiting_user_unmapped_plain_question';break;}
        if(clarification==='allowed'){
         if(active.clarificationUsed){row.status='waiting_user';active.stop='waiting_user_repeated_clarification';break;}
         active.clarificationUsed=true;text=clarificationReplyForTurn(p,userTurn);repeat=true;save(join(dir,'scripted-plain-clarification.json'),{actualQuestion:snapshot.messages.filter(m=>m.role==='assistant').at(-1)?.text,response:text});
        }
       }while(repeat);
       if(row.status!=='started'||active.stop||observer.fatal)break;row.completedUserTurns++;
       if(userTurn<p.prompts.length-1){const latest=turns.at(-1)!.snapshot.messages;const buffers=availableBufferResults(latest);const required=p.caseId==='F02'?userTurn+1:p.caseId==='F04'?1:0;if(buffers<required){row.status='incomplete';active.stop='missing_result_for_dependent_user_turn';break;}}save(join(directory,'runs.json'),rows);
      }
      const final=await mapTrialRequest<SessionSnapshot>(trial.manifest,`/api/sessions/${p.fixture.sessionId}`,'planning'),after=await mapState(trial.manifest,p.fixture.sessionId);if(row.status==='started')row.status='recorded';row.stop=active.stop??observer.fatal;
      save(join(dir,'review.json'),{entry:row,fixture:p,final,after,turns,events:active.events,interactions:active.interactions,semanticReview:'pending'});
      const calls=toolArguments(dir);for(const a of observer.attempts.filter(a=>a.entry===row.id))for(const c of a.tools)if(!calls.some(x=>x.id===c.id)){let args:unknown;try{args=JSON.parse(c.arguments);}catch{args=c.arguments;}calls.push({id:c.id,name:c.name,arguments:args,firstObservedRequest:a.id});}
      save(join(dir,'tool-arguments.json'),calls);save(join(dir,'deterministic-evidence.json'),{turns:summarizeTurns(turns),spatial:spatialCallSummary(calls,final.messages),criticalEffects:turns.map(t=>t.criticalEffect).filter(Boolean),skillReads:calls.filter(c=>c.name==='skill_read'),semanticReview:'pending'});save(join(dir,'judge-input.json'),reviewInput(p,final,turns,calls,row.blindId!));
     }catch(error){row.status='interrupted';row.stop=(error instanceof Error?error.message:'execution_or_evidence_failure').split(env.LLM_API_KEY!).join('[REDACTED]');observer.fatal??=row.stop;ledger.halt(row.stop);save(join(dir,'failure.json'),{reason:row.stop});await cancel(row.stop);}
     finally{clearTimeout(warningTimer);row.endedAt=new Date().toISOString();row.elapsedMs=Date.parse(row.endedAt)-Date.parse(row.startedAt!);save(join(dir,'result.json'),row);save(join(directory,'runs.json'),rows);observer.persist();active=undefined;observer.active=undefined;}
    }
   }catch(error){batchStop=(error instanceof Error?error.message:'pair_preparation_failure').split(env.LLM_API_KEY!).join('[REDACTED]');observer.fatal??=batchStop;ledger.halt(batchStop);save(join(directory,`${rows[pair].caseId}-failure.json`),{reason:batchStop});}
   finally{for(const item of prepared){try{await cp(join(item.trial.manifest.dataDir,'sessions'),join(item.directory,'native-sessions'),{recursive:true});}catch{observer.fatal??='native_evidence_copy_failure';ledger.halt(observer.fatal);}await item.trial.stop();save(join(item.directory,'evidence-hashes.json'),await hashes(item.directory));}}
  }
 }finally{
  globalThis.fetch=original;process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);observer.persist();save(join(directory,'batch-state.json'),{stop:batchStop??observer.fatal??ledger.read().halted??null,rows,totals:ledger.totals(),offlineSimulation:Boolean(offline),automaticRetries:false,automaticResume:false,semanticReview:'pending'});
 }
 return {rows,total:ledger.totals(),stop:batchStop??observer.fatal??ledger.read().halted};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,...args]=process.argv.slice(2);
 if(mode==='prepare'){assert.equal(args.length,1);assert.ok(!existsSync(args[0]),'Refuse overwriting freeze');void sourceFreeze().then(f=>{writeFileSync(args[0],JSON.stringify(f,null,2)+'\n',{flag:'wx',mode:0o600});console.info(JSON.stringify({prepared:args[0],taskTrials:10,modelRequests:0}));});}
 else{assert.equal(mode,'run','live.ts prepare NEW_FREEZE | run NEW_OUTPUT FREEZE [PORT]');const [directory,freezePath,port]=args;assert.ok(directory&&freezePath);void runLive({directory,freezePath,port:Number(port??4667)}).then(r=>{console.info(JSON.stringify(r));if(r.stop)process.exitCode=1;}).catch(error=>{console.error(error instanceof Error?error.message:'R13 failed');process.exitCode=1;});}
}
