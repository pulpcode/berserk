import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {mkdir,cp,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {SessionSnapshot,StreamEvent,Interaction} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {mapTrialAuth,mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import {SSELines} from '../../10-17-map-query-native-evaluation/run.js';
import {runReviewedTurns,type Evidence,type Decision} from '../evaluation/review-gate.js';
import {specs,schedule,layers,repliesFor,prepare,runtimeCase,type Prepared} from './cases.js';
import {Provider,type Active} from './provider.js';
import {Ledger,limits,modelConfiguration} from './budget.js';
import {repo,packageRoot,hashes,save,digest,revisions,day,buildRuntime,liveEnvironment,offlineEnvironment,businessContext,candidateRoot} from './runtime.js';
export const root=fileURLToPath(new URL('.',import.meta.url));
const read=<T>(p:string)=>JSON.parse(readFileSync(p,'utf8')) as T;
async function codeHashes(dir:string):Promise<Record<string,string>>{const out:Record<string,string>={};for(const e of await readdir(dir,{withFileTypes:true})){if(e.isFile()&&/\.(ts|json)$/.test(e.name))out[e.name]=digest(readFileSync(join(dir,e.name)));}return out;}
export async function freeze(){const dependencies:Record<string,unknown>={};for(const dir of ['r3-20261022','r7-20261023','r10-20261023','r11-20261023','r12-20261025','r13-20261025','r14-20261026','r15-20261027','round1-20261017'])dependencies[dir]=await codeHashes(resolve(root,'../../10-15-agent-map-spatial',dir));dependencies.plotting=await codeHashes(resolve(root,'../../10-26-agent-plotting-integration/evaluation-v2'));dependencies.query=await codeHashes(resolve(root,'../../10-17-map-query-native-evaluation'));dependencies.sharedSource=await hashes(join(packageRoot,'src'));dependencies.sharedScripts=await hashes(join(packageRoot,'scripts'));dependencies.scoring=digest(readFileSync(join(root,'review-protocol.md')));dependencies.taskList=digest(readFileSync(join(root,'task-list.md')));dependencies.plan=digest(readFileSync(join(root,'plan.md')));dependencies.previousDriver=await codeHashes(resolve(root,'../live-20261029'));dependencies.candidates=await hashes(candidateRoot);dependencies.reviewGate=digest(readFileSync(resolve(root,'../evaluation/review-gate.ts')));return {schemaVersion:1,revisions:Object.fromEntries(Object.entries(revisions).map(([g,r])=>[g,execFileSync('git',['rev-parse',r],{cwd:repo,encoding:'utf8'}).trim()])),driver:await codeHashes(root),dependencies,skillLoading:'native_on_demand',model:modelConfiguration,limits,day,sourceRefs:['https://console.volcengine.com/ark/region%3Acn-beijing/docs/deepseek-v4-1-flash','https://docs.volcengine.com/docs/ark/deep-thinking?lang=en'],schedule,specs,replies:Object.fromEntries(specs.map(s=>[s.id,repliesFor(s.id)])),data:Object.fromEntries(specs.map(s=>[s.id,layers(s.id)])),automaticRetry:false};}
interface Row {id:string;caseId:string;group:'G0'|'G1'|'G2';status:'not_executed'|'started'|'recorded'|'needs_review'|'failed';semanticReview:'pending';requests?:number;accepted?:number;stop?:string}
interface DecisionFile {checkpointHash:string;reviewer:string;reason:string;action:'reply'|'hold';replyId?:string;answers?:Array<{questionId:string;replyId:string}>}
export function structuredAnswers(item:Interaction,decision:DecisionFile,available:Prepared['replies'],used:Set<string>){
 assert.ok(decision.action==='reply'&&item.kind==='question','Unapproved structured clarification');
 const selected=decision.answers??(item.questions.length===1&&decision.replyId?[{questionId:item.questions[0].id,replyId:decision.replyId}]:[]);
 assert.equal(selected.length,item.questions.length);assert.equal(new Set(selected.map(x=>x.questionId)).size,selected.length);
 const answers=selected.map(x=>{assert.ok(item.questions.some(q=>q.id===x.questionId));const reply=available.find(r=>r.id===x.replyId);assert.ok(reply&&!used.has(reply.id),'Unfrozen or repeated reply');return {questionId:x.questionId,text:reply.text};});
 for(const id of new Set(selected.map(x=>x.replyId)))used.add(id);return answers;
}
export function checkFirstSix(approval:{checkpointHash:string;reviewer:string;reason:string;pass:boolean},key:string){assert.equal(approval.checkpointHash,key);assert.ok(approval.reviewer&&approval.reason&&approval.pass,'First six flow gate not passed');}
export interface Options {directory:string;mode:'prepare'|'live';port?:number;authorization?:{approvedByUser:true;freezeHash:string;limits:typeof limits};offline?:{transport:typeof fetch;ids:string[];decision:(pending:Record<string,unknown>)=>Promise<unknown>}}
/** No timeout is interpreted as approval. Process remains alive with the native session. */
async function waitDecision<T>(path:string,notice:Record<string,unknown>,options:Options):Promise<T>{
 save(join(options.directory,'pending.json'),{...notice,decisionPath:path});console.info(JSON.stringify({waitingReview:notice.kind,id:notice.id,decisionPath:path}));
 if(options.offline){const answer=await options.offline.decision(notice);writeFileSync(path,JSON.stringify(answer,null,2)+'\n',{flag:'wx',mode:0o600});}
 while(!existsSync(path))await new Promise(resolve=>setTimeout(resolve,1000));const value=read<T>(path);if((value as {action?:string}).action==='hold'){console.info(JSON.stringify({heldForReview:notice.id,retainedSession:true}));return waitDecision<T>(path+'.next',notice,options);}return value;
}
export async function run(options:Options){
 assert.equal(process.cwd(),packageRoot);assert.ok(!existsSync(options.directory),'Refuse overwriting batch');
 const frozen=await freeze(),freezeHash=digest(JSON.stringify(frozen));
 if(options.mode==='live'&&!options.offline){assert.equal(options.authorization?.approvedByUser,true);assert.equal(options.authorization.freezeHash,freezeHash);assert.deepEqual(options.authorization.limits,limits);const claims=join(repo,'.local','agent-spatial-plotting-improvement-20261029','claims');await mkdir(claims,{recursive:true,mode:0o700});writeFileSync(join(claims,freezeHash+'.json'),JSON.stringify({freezeHash,directory:options.directory,limits,automaticRetry:false}),{flag:'wx',mode:0o600});}
 const env=options.offline||options.mode==='prepare'?offlineEnvironment():liveEnvironment(process.env);
 await mkdir(options.directory,{recursive:true,mode:0o700});save(join(options.directory,'protocol.json'),{frozen,freezeHash,authorized:options.authorization??null,offline:Boolean(options.offline),semanticReview:'pending'});
 const rows:Row[]=schedule.map(e=>({...e,status:'not_executed',semanticReview:'pending'}));save(join(options.directory,'runs.json'),rows);
 const ledger=new Ledger(join(options.directory,'ledger.json'),freezeHash),original=globalThis.fetch;
 let active:Active|undefined,trial:Awaited<ReturnType<Awaited<ReturnType<typeof buildRuntime>>['start']>>|undefined,p:Prepared|undefined,requestId:string|undefined;
 const observer=new Provider({directory:options.directory,original:options.offline?.transport??original,secret:env.LLM_API_KEY!,verify:async()=>{
  assert.equal(digest(JSON.stringify(await freeze())),freezeHash,'Source drift');assert.ok(active);assert.deepEqual(await hashes(active.runtime.root),active.runtime.hashes,'Runtime drift');

 },cancel:async reason=>{if(active)active.stop??=reason;if(trial&&p&&requestId)await mapTrialRequest(trial.manifest,`/api/sessions/${p.sessionId}/cancel`,'planning','POST',{requestId}).catch(()=>{});}},ledger);
 globalThis.fetch=options.mode==='prepare'?async(input,init)=>{const u=new URL(input instanceof Request?input.url:String(input));assert.ok(['localhost','127.0.0.1','[::1]'].includes(u.hostname));return original(input,init);}:observer.fetch;
 let stop:string|undefined;
 try {
  const runtimes={G0:await buildRuntime(join(options.directory,'runtimes'),'G0'),G1:await buildRuntime(join(options.directory,'runtimes'),'G1'),G2:await buildRuntime(join(options.directory,'runtimes'),'G2')};
  for(const group of ['G1','G2'] as const)for(const [id,skill] of Object.entries(runtimes.G0.skills)){assert.equal(runtimes[group].skills[id].name,skill.name);assert.equal(runtimes[group].skills[id].description,skill.description);}
  for(const [position,row] of rows.entries()){
   if(position===6&&options.mode==='live'&&(!options.offline||options.offline.ids.includes(row.id))){const key=digest(JSON.stringify(rows.slice(0,6))),approval=await waitDecision<{checkpointHash:string;reviewer:string;reason:string;pass:boolean}>(join(options.directory,'first6-review.json'),{kind:'first6',id:'first6',checkpointHash:key,rows:rows.slice(0,6)},options);checkFirstSix(approval,key);}

   if(options.offline&&!options.offline.ids.includes(row.id))continue;
   if(observer.fatal||ledger.read().halted){stop=observer.fatal??ledger.read().halted;break;}
   const dir=join(options.directory,row.id);await mkdir(dir,{mode:0o700});row.status='started';save(join(options.directory,'runs.json'),rows);
   try {
    const runtime=runtimes[row.group];trial=await runtime.start(options.port??5398,{...env,INTEGRATION_CASE:runtimeCase(row.caseId as Prepared['caseId'])},true,{background:'neutral'});p=await prepare(trial.manifest,row.caseId as Prepared['caseId']);
    const instruction=await trial.lab.resources.readInstruction(p.workspaceId,'workspace','seat-planning');await trial.lab.resources.updateInstruction(p.workspaceId,'workspace',businessContext,instruction.hash,undefined,'seat-planning');
    save(join(dir,'fixture.json'),p);save(join(dir,'manifest.json'),trial.manifest);
    if(options.mode==='prepare'){row.status='recorded';continue;}
    active={id:row.id,group:row.group,directory:dir,turn:0,runtime,requests:0};observer.active=active;const events:StreamEvent[]=[],interactions:unknown[]=[],usedReplies=new Set<string>();
    const inspect=async():Promise<Evidence>=>{const snapshot=await mapTrialRequest<SessionSnapshot>(trial!.manifest,`/api/sessions/${p!.sessionId}`,'planning');return {sessionId:p!.sessionId,requestId:snapshot.lastResult?.requestId??requestId??'',status:snapshot.lastResult?.status==='succeeded'?'succeeded':'failed',snapshot,mapState:await mapState(trial!.manifest,p!.sessionId),pendingInteraction:(snapshot.interactions??[]).some(i=>i.status==='pending')};};
    const result=await runReviewedTurns({directory:join(dir,'gate'),prompts:p.prompts,replies:p.replies,ports:{inspect,review:async checkpoint=>{
     const path=join(dir,`decision-${checkpoint.index}.json`);const decision=await waitDecision<Decision>(path,{kind:'ending',id:row.id,checkpointHash:checkpoint.hash,checkpointPath:join(dir,'gate',`${checkpoint.index}-checkpoint.json`),allowedReplies:p!.replies.filter(r=>r.userTurn===checkpoint.userTurn&&!usedReplies.has(r.id))},options);if(decision.action==='reply'){assert.ok(decision.replyId&&!usedReplies.has(decision.replyId),'Clarification already consumed');usedReplies.add(decision.replyId);}return decision;
    },send:async text=>{
     requestId=undefined;active!.turn++;const turn=active!.turn,stem=join(dir,`turn-${turn}`),auth=await mapTrialAuth(trial!.manifest,'planning');save(stem+'-input.json',{text});
     const response=await fetch(`${trial!.manifest.url}/api/sessions/${p!.sessionId}/messages`,{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({text})});assert.ok(response.ok&&response.body,`Message HTTP ${response.status}`);
     const jobs:Promise<void>[]=[],seen=new Set<string>();let interactionError:unknown;
     const parser=new SSELines(value=>{const event=value as unknown as StreamEvent;events.push(event);requestId=event.requestId;
      if(event.type==='interaction.updated'&&event.interaction.status==='pending'&&!seen.has(event.interaction.interactionId)){
       const item=event.interaction;seen.add(item.interactionId);jobs.push((async()=>{
        const userTurn=read<{userTurn:number}>(join(dir,'gate',`${turn}-dispatch.json`)).userTurn;const available=p!.replies.filter(r=>r.userTurn===userTurn&&!usedReplies.has(r.id));const evidence={item,sessionId:p!.sessionId,turn,userTurn,originalPrompts:p!.prompts,allowedReplies:available},key=digest(JSON.stringify(evidence));save(join(dir,`interaction-${item.interactionId}.json`),evidence);
        const decision=await waitDecision<DecisionFile>(join(dir,`interaction-${item.interactionId}-decision.json`),{kind:'interaction',id:row.id,checkpointHash:key,evidencePath:join(dir,`interaction-${item.interactionId}.json`),allowedReplies:available},options);
        assert.equal(decision.checkpointHash,key);assert.ok(decision.reviewer&&decision.reason);
        const answers=structuredAnswers(item,decision,available,usedReplies);const answer={requestId:item.requestId,kind:'question',action:'answer',answers};interactions.push({item,decision,answer});await mapTrialRequest(trial!.manifest,`/api/sessions/${p!.sessionId}/interactions/${item.interactionId}/response`,'planning','POST',answer);
       })().catch(error=>{interactionError=error;void observer.options.cancel('interaction_requires_review');}));
      }
     });
     const reader=response.body.getReader();for(;;){const chunk=await reader.read();if(chunk.done)break;appendFileSync(stem+'.sse',chunk.value,{mode:0o600});parser.push(chunk.value);}await Promise.all(jobs);if(interactionError)throw interactionError;
     const evidence=await inspect();save(stem+'-result.json',evidence);return evidence;
    }}});
    row.status=result.status;row.accepted=result.accepted;row.requests=active.requests;
    const evidence=await inspect();save(join(dir,'review.json'),{entry:row,fixture:p,...evidence,events,interactions,semanticReview:'pending'});
    if(row.caseId==='T07'&&row.status==='recorded'){
     const key=digest(JSON.stringify(evidence));const browser=await waitDecision<{checkpointHash:string;reviewer:string;reason:string;checked:boolean}>(join(dir,'browser-review.json'),{kind:'browser',id:row.id,checkpointHash:key,manifestPath:join(dir,'manifest.json'),reviewPath:join(dir,'review.json'),url:trial.manifest.url,sessionId:p.sessionId},options);assert.equal(browser.checkpointHash,key);assert.ok(browser.reviewer&&browser.reason&&browser.checked,'Browser check incomplete');
    }
    if(row.status==='needs_review'){stop='unresolved_review';break;}
   }catch(error){row.status='failed';row.stop=String(error).split(env.LLM_API_KEY!).join('[REDACTED]');stop=row.stop;save(join(dir,'failure.json'),{error:row.stop});}
   finally{if(trial){if(options.mode==='live')await cp(join(trial.manifest.dataDir,'sessions'),join(dir,'native-sessions'),{recursive:true});await trial.stop();}observer.persist();save(join(dir,'result.json'),row);save(join(options.directory,'runs.json'),rows);trial=undefined;p=undefined;active=undefined;observer.active=undefined;}
   if(stop)break;
  }
 }catch(error){stop=String(error).split(env.LLM_API_KEY!).join('[REDACTED]');save(join(options.directory,'failure.json'),{error:stop});}
 finally {globalThis.fetch=original;save(join(options.directory,'batch-state.json'),{rows,stop:stop??observer.fatal??ledger.read().halted??null,totals:ledger.totals(),semanticReview:'pending'});save(join(options.directory,'pending.json'),{kind:'stopped',stop:stop??null});}
 return {rows,stop,totals:ledger.totals()};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,dir,auth]=process.argv.slice(2);if(mode==='freeze'){void freeze().then(f=>{writeFileSync(dir,JSON.stringify({frozen:f,freezeHash:digest(JSON.stringify(f))},null,2)+'\n',{flag:'wx'});});}
 else {assert.ok(mode==='prepare'||mode==='live');void run({mode,directory:resolve(dir),authorization:auth?read(auth):undefined}).then(r=>{console.info(JSON.stringify(r));if(r.stop)process.exitCode=1;}).catch(e=>{console.error(String(e));process.exitCode=1;});}
}
