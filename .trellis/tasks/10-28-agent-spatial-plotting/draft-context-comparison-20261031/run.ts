import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {mkdir,cp,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import type {SessionSnapshot,StreamEvent} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {mapTrialAuth,mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import {SSELines} from '../../10-17-map-query-native-evaluation/run.js';
import {Provider,type Active} from './provider.js';
import {Ledger,limits,modelConfiguration} from './budget.js';
import {repo,packageRoot,hashes,save,digest,buildRuntime,revision} from './runtime.js';
import {prepare,oracle,type Prepared} from '../source-generalization-20261030/data.js';
const root=fileURLToPath(new URL('.',import.meta.url));
const schedule=JSON.parse(readFileSync(join(root,'schedule.json'),'utf8')).slots.map((v:{slotId:string;caseId:string;group:'A'|'B';repeat:number;order:number})=>({...v,id:v.slotId})) as Array<{id:string;caseId:string;group:'A'|'B';repeat:number;order:number}>;
import {initialScope,reply,type ScopeState,type Selection} from '../source-generalization-20261030/clarification.js';
export {schedule};
const read=<T>(p:string)=>JSON.parse(readFileSync(p,'utf8')) as T;
async function codeHashes(){const out:Record<string,string>={};for(const e of await readdir(root,{withFileTypes:true}))if(e.isFile()&&/\.(ts|json|md)$/.test(e.name))out[e.name]=digest(readFileSync(join(root,e.name)));return out;}
async function sharedHashes(){const paths=['.trellis/tasks/10-28-agent-spatial-plotting/source-generalization-20261030/data.ts','.trellis/tasks/10-28-agent-spatial-plotting/source-generalization-20261030/clarification.ts','.trellis/tasks/10-28-agent-spatial-plotting/source-generalization-20261030/runtime.ts','.trellis/tasks/10-17-map-query-native-evaluation/run.ts','.trellis/tasks/10-17-map-query-native-evaluation/fixtures.ts','.trellis/tasks/10-15-agent-map-spatial/r7-20261023/environment.ts','.trellis/tasks/10-15-agent-map-spatial/r3-20261022/audit.ts','.trellis/tasks/10-28-agent-spatial-plotting/improvement-20261029/runtime.ts','.trellis/tasks/10-28-agent-spatial-plotting/improvement-20261029/budget.ts','.trellis/tasks/10-15-agent-map-spatial/r12-20261025/reasoning-live.ts','.trellis/tasks/10-15-agent-map-spatial/r12-20261025/reasoning-prepare.ts','.trellis/tasks/10-15-agent-map-spatial/r3-20261022/runtime.ts','.trellis/tasks/10-28-agent-spatial-plotting/improvement-20261029/provider.ts','.trellis/tasks/10-28-agent-spatial-plotting/qwen-comparison-20261030/smoke.mjs','experiments/harness-lab/scripts/probe-situation-map.ts','experiments/harness-lab/scripts/probe-source-annotations.ts'];return Object.fromEntries(paths.map(p=>[p,digest(readFileSync(join(repo,p)))]));}
export async function freeze(){return {schemaVersion:1,driver:await codeHashes(),input:await hashes(join(root,'../source-generalization-20261030/input/review-copy')),product:await hashes(join(packageRoot,'src')),fixtures:await hashes(join(packageRoot,'fixtures')),scripts:await hashes(join(packageRoot,'scripts')),dependencies:digest(readFileSync(join(packageRoot,'package-lock.json'))),revision,shared:await sharedHashes(),model:modelConfiguration.A,limits,schedule,automaticRetry:false};}
export function environment(offline:boolean):NodeJS.ProcessEnv{const path=process.env.SOURCE_EVAL_ENV_FILE??'/Users/lau/.codex/worktrees/agent-result-grounding/berserk/experiments/harness-lab/.env.local';const env=offline?{LLM_API_KEY:'offline-placeholder'}:parseEnv(readFileSync(path,'utf8'));const base='https://ark.cn-beijing.volces.com/api/plan/v3';if(!offline){assert.equal(env.LLM_MODEL,modelConfiguration.A.requestModel);assert.equal(env.LLM_BASE_URL,base);assert.ok(env.LLM_API_KEY);}return {...process.env,...env,LLM_PROVIDER:'volcengine-agent-plan',LLM_MODEL:modelConfiguration.A.requestModel,LLM_BASE_URL:base,LLM_CONTEXT_WINDOW:'1000000',LLM_MAX_OUTPUT_TOKENS:'32768',LLM_HTTP_IDLE_TIMEOUT_MS:'300000',AGENT_RUN_TIMEOUT_MS:'0'};}
interface Row {order:number;repeat:number;id:string;caseId:string;group:'A'|'B';status:'not_executed'|'started'|'recorded'|'failed';semanticReview:'pending';requests?:number;stop?:string;modelIncomplete?:boolean}
export interface Decision {checkpointHash:string;reviewer:string;reason:string;action:'finish'|'reply'|'fail_task'|'stop';selection?:Selection;answers?:Array<{questionId:string;selection:Selection}>}
export interface Options {directory:string;mode:'prepare'|'live';port?:number;authorization?:{approvedByUser:true;freezeHash:string;limits:typeof limits};offline?:{transport:typeof fetch;ids:string[];decision:(pending:Record<string,unknown>)=>Promise<Decision>}}
async function waitDecision(path:string,notice:Record<string,unknown>,options:Options){
 save(join(options.directory,'pending.json'),{...notice,decisionPath:path});console.info(JSON.stringify({waitingReview:notice.kind,id:notice.id,decisionPath:path}));
 if(options.offline)writeFileSync(path,JSON.stringify(await options.offline.decision(notice),null,2)+'\n',{flag:'wx',mode:0o600});
 while(!existsSync(path))await new Promise(r=>setTimeout(r,1000));const d=read<Decision>(path);assert.equal(d.checkpointHash,notice.checkpointHash);assert.ok(d.reviewer.trim()&&d.reason.trim());assert.ok(['finish','reply','fail_task','stop'].includes(d.action));return d;
}
export async function run(options:Options){
 assert.equal(process.cwd(),packageRoot);assert.ok(!existsSync(options.directory),'Refuse overwriting batch');const frozen=await freeze(),freezeHash=digest(JSON.stringify(frozen));
 if(options.mode==='live'&&!options.offline){assert.equal(options.authorization?.approvedByUser,true);assert.equal(options.authorization.freezeHash,freezeHash);assert.deepEqual(options.authorization.limits,limits);const claims=join(repo,'.local/draft-context-comparison-20261031/claims');await mkdir(claims,{recursive:true,mode:0o700});writeFileSync(join(claims,freezeHash+'.json'),JSON.stringify({freezeHash,directory:options.directory}),{flag:'wx',mode:0o600});}
 const env=environment(Boolean(options.offline)||options.mode==='prepare');await mkdir(options.directory,{recursive:true,mode:0o700});save(join(options.directory,'protocol.json'),{frozen,freezeHash,authorization:options.authorization,offline:Boolean(options.offline)});
 const rows:Row[]=schedule.map(e=>({...e,status:'not_executed',semanticReview:'pending'}));save(join(options.directory,'runs.json'),rows);
 const ledger=new Ledger(join(options.directory,'ledger.json'),freezeHash),original=globalThis.fetch;let active:Active|undefined,trial:Awaited<ReturnType<Awaited<ReturnType<typeof buildRuntime>>['start']>>|undefined,p:Prepared|undefined,requestId:string|undefined;
 const observer=new Provider({directory:options.directory,original:options.offline?.transport??original,secret:env.LLM_API_KEY!,endpoint:env.LLM_BASE_URL+'/chat/completions',verify:async()=>{assert.equal(digest(JSON.stringify(await freeze())),freezeHash,'Source drift');assert.ok(active);assert.deepEqual(await hashes(active.runtime.root),active.runtime.hashes,'Runtime drift');},cancel:async reason=>{if(active)active.stop??=reason;if(trial&&p&&requestId)await mapTrialRequest(trial.manifest,`/api/sessions/${p.sessionId}/cancel`,'planning','POST',{requestId}).catch(()=>{});}},ledger);
 globalThis.fetch=options.mode==='prepare'?async(input,init)=>{const u=new URL(input instanceof Request?input.url:String(input));assert.ok(['localhost','127.0.0.1','[::1]'].includes(u.hostname));return original(input,init);}:observer.fetch;
 let stop:string|undefined;
 try{for(const row of rows){
  if(options.offline&&!options.offline.ids.includes(row.id))continue;if(observer.fatal||ledger.read().halted){stop=observer.fatal??ledger.read().halted;break;}
  const dir=join(options.directory,row.id);await mkdir(dir,{mode:0o700});row.status='started';save(join(options.directory,'runs.json'),rows);
  try{
   const runtime=await buildRuntime(join(options.directory,'runtimes',row.id),row.caseId);trial=await runtime.start(options.port??5412,env,true,{background:'neutral'});p=await prepare(trial.manifest,row.caseId);save(join(dir,'fixture.json'),p);save(join(dir,'manifest.json'),trial.manifest);
   if(options.mode==='prepare'){row.status='recorded';continue;}
   active={id:row.id,group:row.group,dataDir:trial.manifest.dataDir,directory:dir,turn:0,runtime,requests:0};observer.active=active;
   const o=oracle(row.caseId);let scope:ScopeState=initialScope(o);const events:StreamEvent[]=[],interactions:unknown[]=[];let modelIncomplete=false;
   const inspect=async()=>({snapshot:await mapTrialRequest<SessionSnapshot>(trial!.manifest,`/api/sessions/${p!.sessionId}`,'planning'),mapState:await mapState(trial!.manifest,p!.sessionId),source:await mapTrialRequest(trial!.manifest,'/api/simulation','overall')});
   let text=p.prompt,kind='original';
   while(true){
    requestId=undefined;active.turn++;const turn=active.turn,stem=join(dir,`turn-${turn}`),auth=await mapTrialAuth(trial.manifest,'planning');save(stem+'-input.json',{text,kind,scope});
    const response=await fetch(`${trial.manifest.url}/api/sessions/${p.sessionId}/messages`,{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({text})});assert.ok(response.ok&&response.body,`Message HTTP ${response.status}`);
    const jobs:Promise<void>[]=[],seen=new Set<string>();let interactionError:unknown;
    const parser=new SSELines(value=>{const event=value as unknown as StreamEvent;events.push(event);requestId=event.requestId;
     if(event.type==='interaction.updated'&&event.interaction.status==='pending'&&!seen.has(event.interaction.interactionId)){
      const item=event.interaction;seen.add(item.interactionId);jobs.push((async()=>{
       const state=await inspect(),evidence={item,sessionId:p!.sessionId,turn,prompt:p!.prompt,scope,state},key=digest(JSON.stringify(evidence));const path=join(dir,`interaction-${item.interactionId}.json`);save(path,evidence);
       const decision=await waitDecision(join(dir,`interaction-${item.interactionId}-decision.json`),{kind:'interaction',id:row.id,checkpointHash:key,evidencePath:path,scope},options);
       assert.equal(digest(JSON.stringify(await inspect())),digest(JSON.stringify(state)),'State changed during review');
       if(decision.action==='stop')throw new Error('reviewer_infrastructure_stop');
       if(decision.action==='fail_task'){modelIncomplete=true;await observer.options.cancel('model_incomplete');return;}
       assert.ok(decision.action==='reply'&&item.kind==='question');
       const chosen=decision.answers??(item.questions.length===1&&decision.selection?[{questionId:item.questions[0].id,selection:decision.selection}]:[]);assert.equal(chosen.length,item.questions.length);assert.equal(new Set(chosen.map(v=>v.questionId)).size,chosen.length);
       let next=scope;const applied=chosen.map(a=>{assert.ok(item.questions.some(q=>q.id===a.questionId));const result=reply(o,next,a.selection);next=result.state;return {...result,questionId:a.questionId};});
       const answer={requestId:item.requestId,kind:'question',action:'answer',answers:applied.map(a=>({questionId:a.questionId,text:a.text}))};
       interactions.push({item,decision,answer,applied});save(join(dir,'interactions.json'),interactions);await mapTrialRequest(trial!.manifest,`/api/sessions/${p!.sessionId}/interactions/${item.interactionId}/response`,'planning','POST',answer);scope=next;
      })().catch(error=>{interactionError=error;void observer.options.cancel('interaction_review_failed');}));
     }
    });
    const reader=response.body.getReader();for(;;){const chunk=await reader.read();if(chunk.done)break;appendFileSync(stem+'.sse',chunk.value,{mode:0o600});parser.push(chunk.value);}await Promise.all(jobs);if(interactionError)throw interactionError;
    const evidence=await inspect();save(stem+'-result.json',evidence);if(modelIncomplete)break;
    assert.equal(evidence.snapshot.lastResult?.status,'succeeded','Native request incomplete');assert.ok(!(evidence.snapshot.interactions??[]).some(i=>i.status==='pending'));
    const checkpoint={turn,prompt:p.prompt,scope,evidence},key=digest(JSON.stringify(checkpoint));save(stem+'-checkpoint.json',{...checkpoint,hash:key});
    const d=await waitDecision(stem+'-decision.json',{kind:'ending',id:row.id,checkpointHash:key,evidencePath:stem+'-checkpoint.json',scope},options);assert.equal(digest(JSON.stringify(await inspect())),digest(JSON.stringify(evidence)),'State changed during review');
    if(d.action==='stop')throw new Error('reviewer_infrastructure_stop');if(d.action==='finish')break;if(d.action==='fail_task'){modelIncomplete=true;break;}
    assert.ok(d.selection);const applied=reply(o,scope,d.selection);scope=applied.state;text=applied.text;kind='scripted_reply';save(stem+'-clarification.json',{decision:d,applied});
   }
   row.status='recorded';row.requests=active.requests;row.modelIncomplete=modelIncomplete;const evidence=await inspect();save(join(dir,'review.json'),{entry:row,fixture:p,...evidence,events,interactions,scope,semanticReview:'pending'});
   if(observer.fatal)stop=observer.fatal;
  }catch(error){row.status='failed';row.stop=String(error).split(env.LLM_API_KEY!).join('[REDACTED]');stop=row.stop;save(join(dir,'failure.json'),{error:row.stop});}
  finally{if(trial){if(options.mode==='live')await cp(join(trial.manifest.dataDir,'sessions'),join(dir,'native-sessions'),{recursive:true});await trial.stop();}observer.persist();save(join(dir,'result.json'),row);save(join(options.directory,'runs.json'),rows);trial=undefined;p=undefined;active=undefined;observer.active=undefined;}
  if(stop)break;
  if(row.order===4&&options.mode==='live'){const notice={kind:'process_gate',id:'first-four',checkpointHash:digest(JSON.stringify(rows.slice(0,4))),evidencePath:join(options.directory,'runs.json')};const d=await waitDecision(join(options.directory,'process-gate-decision.json'),notice,options);assert.equal(d.action,'finish','Process gate not accepted');}
 }}catch(error){stop=String(error).split(env.LLM_API_KEY!).join('[REDACTED]');save(join(options.directory,'failure.json'),{error:stop});}
 finally{globalThis.fetch=original;save(join(options.directory,'batch-state.json'),{rows,stop:stop??observer.fatal??ledger.read().halted??null,totals:ledger.totals(),semanticReview:'pending'});save(join(options.directory,'pending.json'),{kind:'stopped',stop:stop??null});}
 return {rows,stop,totals:ledger.totals()};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,dir,auth]=process.argv.slice(2);if(mode==='freeze')void freeze().then(f=>writeFileSync(dir,JSON.stringify({frozen:f,freezeHash:digest(JSON.stringify(f))},null,2)+'\n',{flag:'wx'}));
 else{assert.ok(mode==='prepare'||mode==='live');void run({mode,directory:resolve(dir),authorization:auth?read(auth):undefined}).then(r=>{console.info(JSON.stringify(r));if(r.stop)process.exitCode=1;}).catch(e=>{console.error(String(e));process.exitCode=1;});}
}
