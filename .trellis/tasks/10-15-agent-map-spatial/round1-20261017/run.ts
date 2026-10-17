/** Opt-in evaluation observer. Product resources, prompts and Pi loop are unchanged. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {appendFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {cp,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {SessionSnapshot,StreamEvent,WorkspaceResources} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {startMapTrial,mapTrialRequest,mapTrialAuth} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import {uniqueSpatialResults,spatialSkillEvidence} from '../../../../experiments/harness-lab/scripts/probe-spatial-evaluation.js';
import {SSELines} from '../../10-17-map-query-native-evaluation/run.js';
import {schedule,prompts,kinds,prepareFixture,type Entry,type Fixture} from './cases.js';
const taskDir=fileURLToPath(new URL('.',import.meta.url)),repo=resolve(taskDir,'../../../..');
export const limits={trialRequests:24,requests:1152,tools:64,trialMs:600000,requestMs:60000,outputPerRequest:4096,input:4000000,output:150000};
export const modelConfig={contextWindow:1000000,thinking:'disabled',outputLimit:4096,requestTimeoutMs:60000};
export const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const save=(path:string,value:unknown)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});
const load=<T>(path:string):T=>JSON.parse(readFileSync(path,'utf8')) as T;
export class Budget {
 total=0;trial=0;input=0;output=0;started=0;fatal:string|undefined;
 begin(){this.trial=0;this.started=Date.now();}
 reserve(now=Date.now()){
  if(this.fatal)throw new Error(this.fatal);
  if(this.total>=limits.requests||this.input>=limits.input||this.output+limits.outputPerRequest>limits.output){this.fatal='batch_budget';throw new Error(this.fatal);}
  if(this.trial>=limits.trialRequests||now-this.started>=limits.trialMs)throw new Error('trial_budget');
  this.total++;this.trial++;
 }
 finish(usage:unknown){
  const u=usage as {prompt_tokens?:number;completion_tokens?:number;prompt_cache_hit_tokens?:number;prompt_cache_miss_tokens?:number}|undefined;
  const prompt=u?.prompt_tokens??(Number.isInteger(u?.prompt_cache_hit_tokens)&&Number.isInteger(u?.prompt_cache_miss_tokens)?u!.prompt_cache_hit_tokens!+u!.prompt_cache_miss_tokens!:undefined);
  if(!Number.isInteger(prompt)||!Number.isInteger(u?.completion_tokens)||prompt!<0||u!.completion_tokens!<0){this.fatal??='missing_provider_usage';return;}
  this.input+=prompt!;this.output+=u!.completion_tokens!;
 }
}
export function selectionFor(condition:Entry['condition'],catalog:WorkspaceResources){
 const skill=catalog.skills.find(s=>s.id==='spatial-analysis');assert.ok(skill,'Missing real Skill catalog');
 return condition==='B'?{id:skill.id,hash:skill.hash}:undefined;
}
export function allowedTool(name:string,args:Record<string,unknown>,entry:Entry,turn:number,fixture:Fixture,knownResultRefs:Set<string>):boolean {
 if(name==='annotation_from_analysis')return entry.kind==='J07'&&turn===1&&typeof args.resultRef==='string'&&knownResultRefs.has(args.resultRef)&&args.layerId==='derived'&&args.name==='临时范围';
 if(name==='annotation_action'){
  const expected=entry.kind==='J03'&&turn===0?{id:'point-b',key:'note',value:'B 保障讨论'}:entry.kind==='J06'&&turn===1?{id:'origin',key:'name',value:'出发点'}:null;
  if(!expected||args.action!=='apply'||!Array.isArray(args.operations)||args.operations.length!==1)return false;
  const op=args.operations[0] as {op?:string;objectId?:string;layerId?:string;changes?:Record<string,unknown>};
  const layer=fixture.before.version?.document.layers.find(l=>l.features.some(f=>f.objectId===expected.id));
  const feature=layer?.features.find(f=>f.objectId===expected.id) as unknown as Record<string,unknown>|undefined;
  return op.op==='update_object'&&op.objectId===expected.id&&(op.layerId===undefined||op.layerId===layer?.layerId)&&!!op.changes&&op.changes[expected.key]===expected.value&&Object.entries(op.changes).every(([key,value])=>key===expected.key||JSON.stringify(value)===JSON.stringify(feature?.[key]));
 }
 return ['annotation_read','annotation_list','spatial_analyze','spatial_read','situation_query','information_read','information_search','task_search','task_read','task_information_list','task_information_read','work_item_list','work_item_read','source_list','source_read','instructions_read','skill_read','source.list','source.read','instructions.read','skill.read','read','ls','find','grep','subagent','ask_user'].includes(name);
}
export async function hashes(){
 const files=execFileSync('git',['ls-files','-z','experiments/harness-lab/src','experiments/harness-lab/fixtures','experiments/harness-lab/scripts','experiments/harness-lab/package.json','experiments/harness-lab/package-lock.json'],{cwd:repo,encoding:'utf8'}).split('\0').filter(Boolean);
 for(const name of await readdir(taskDir))if(/\.ts$/.test(name)||['contract.json','review-rubric.md'].includes(name))files.push(join(taskDir,name));
 files.push(join(taskDir,'package.json'),join(taskDir,'../research/round1-review-rubric.md'));
 files.push(join(repo,'.trellis/tasks/10-17-map-query-native-evaluation/run.ts'),join(repo,'.trellis/tasks/10-17-map-query-native-evaluation/fixtures.ts'));
 const out:Record<string,string>={};for(const file of files)out[file.startsWith(repo)?file.slice(repo.length+1):file]=digest(readFileSync(resolve(repo,file)));return out;
}
interface Active {entry:Entry;fixture:Fixture;trial:Awaited<ReturnType<typeof startMapTrial>>;directory:string;turn:number;requestId?:string;stop?:string;interaction:boolean;toolCount:number;reservedToolCalls?:number;knownResultRefs:Set<string>;schemaHash?:string;cancelSent?:boolean}
interface Attempt {id:number;entry:string;turn:number;at:string;status?:number;usage?:unknown;error?:string;completed:boolean}
export class Observer {
 budget=new Budget();active?:Active;attempts:Attempt[]=[];live=false;pending=new Set<Promise<unknown>>();schemaHash?:string;
 constructor(readonly original:typeof fetch,readonly directory:string,readonly sourceHashes:Record<string,string>){}
 cancel(reason:string,fatal=false){
  if(fatal)this.budget.fatal??=reason;
  const a=this.active;if(!a)return;a.stop??=reason;
  if(a.requestId&&!a.cancelSent){a.cancelSent=true;const p=mapTrialRequest(a.trial.manifest,`/api/sessions/${a.fixture.sessionId}/cancel`,'planning','POST',{requestId:a.requestId}).catch(error=>save(join(a.directory,'cancel-error.json'),{error:String(error)}));this.pending.add(p);void p.finally(()=>this.pending.delete(p));}
 }
 fetch:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.origin==='https://api.deepseek.com')return this.provider(input,init);
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error(`Unapproved external origin: ${url.origin}`);
  return this.original(input,init);
 };
 async provider(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1]){
  assert.ok(this.live&&this.active,'No-network preflight forbids model calls');const a=this.active;
  if(a.stop)throw new Error(a.stop);
  try{assert.deepEqual(await hashes(),this.sourceHashes,'Frozen source drift');}catch(error){this.cancel('source_drift',true);throw error;}
  if(this.attempts.some(x=>!x.completed)){this.cancel('unsettled_provider_attempt',true);throw new Error('Unsettled attempt');}
  try{this.budget.reserve();}catch(error){this.cancel(String(error),!!this.budget.fatal);throw error;}
  const raw=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';
  assert.ok(raw,'Missing actual provider body');
  const secret=process.env.LLM_API_KEY;assert.ok(!secret||!raw.includes(secret),'Credential in provider body');
  const payload=JSON.parse(raw);assert.equal(payload.model,a.entry.model);assert.equal(payload.max_tokens,4096);assert.equal(payload.thinking?.type,'disabled');
  const schemaHash=digest(JSON.stringify(payload.tools));if(payload.tools?.some((t:{function:{name:string}})=>t.function.name==='spatial_analyze')){if(this.schemaHash)assert.equal(schemaHash,this.schemaHash,'Provider parent tool schema drift');else this.schemaHash=schemaHash;}
  const stem=join(a.directory,`provider-${String(this.budget.total).padStart(4,'0')}`);
  save(`${stem}-input.json`,payload);
  const attempt:Attempt={id:this.budget.total,entry:a.entry.id,turn:a.turn,at:new Date().toISOString(),completed:false};this.attempts.push(attempt);
  save(join(this.directory,'budget.json'),this.budget);save(join(this.directory,'attempts.json'),this.attempts);
  const available=new Set<string>((payload.tools??[]).map((t:{function:{name:string}})=>t.function.name));
  const calls=new Map<number,{name:string;arguments:string}>();let finished=false;
  const finish=()=>{if(finished)return;finished=true;attempt.completed=true;this.budget.finish(attempt.usage);save(`${stem}-meta.json`,attempt);save(join(this.directory,'budget.json'),this.budget);save(join(this.directory,'attempts.json'),this.attempts);};
  const parser=new SSELines(event=>{
   if(event.usage)attempt.usage=event.usage;
   for(const choice of (event.choices??[]) as Array<{delta?:{tool_calls?:Array<{index:number;function?:{name?:string;arguments?:string}}>};finish_reason?:string}>){
    for(const call of choice.delta?.tool_calls??[]){const tool=calls.get(call.index)??{name:'',arguments:''};tool.name+=call.function?.name??'';tool.arguments+=call.function?.arguments??'';calls.set(call.index,tool);}
    if(choice.finish_reason&&calls.size){if((a.reservedToolCalls??0)+calls.size>limits.tools){this.cancel('tool_budget');throw new Error('Tool budget before dispatch');}a.reservedToolCalls=(a.reservedToolCalls??0)+calls.size;}
    if(choice.finish_reason)for(const tool of calls.values()){
     let args:Record<string,unknown>;try{args=JSON.parse(tool.arguments);}catch{continue;}
     if(available.has(tool.name)&&!allowedTool(tool.name,args,a.entry,a.turn,a.fixture,a.knownResultRefs)){
      this.cancel(`unexpected_write_or_tool:${tool.name}`,true);throw new Error(`Blocked unauthorized tool: ${tool.name}`);
     }
    }
   }
  },finish);
  try{
   const signal=AbortSignal.any([...(init?.signal?[init.signal]:[]),AbortSignal.timeout(limits.requestMs)]);
   const response=await this.original(input,{...init,signal});attempt.status=response.status;
   if(!response.ok){const body=await response.text();writeFileSync(`${stem}-error.txt`,body,{mode:0o600});attempt.error=`provider_http_${response.status}`;this.cancel(attempt.error,true);finish();return new Response(body,{status:response.status,headers:response.headers});}
   assert.ok(response.body);const reader=response.body.getReader();
   const stream=new ReadableStream<Uint8Array>({pull:async controller=>{try{const part=await reader.read();if(part.done){finish();controller.close();return;}appendFileSync(`${stem}-response.sse`,part.value,{mode:0o600});parser.push(part.value);controller.enqueue(part.value);}catch(error){attempt.error=String(error);finish();controller.error(error);await reader.cancel().catch(()=>{});}},cancel:async reason=>{attempt.error=String(reason??'cancelled');finish();await reader.cancel(reason);}});
   return new Response(stream,{status:response.status,headers:response.headers});
  }catch(error){attempt.error=String(error);finish();throw error;}
 }
 async settle(){await Promise.allSettled([...this.pending]);}
}
export async function ask(observer:Observer,selection:{id:string;hash:string}|undefined,text:string,refs?:Fixture['annotationRefs']){
 const a=observer.active!,m=a.trial.manifest,stem=join(a.directory,`turn-${a.turn+1}`);a.requestId=undefined;a.cancelSent=false;
 const body={text,...(selection?{skill:selection}:{}),...(refs?{annotationRefs:refs}:{})};save(`${stem}-input.json`,body);
 const response=await fetch(`${m.url}/api/sessions/${a.fixture.sessionId}/messages`,{method:'POST',headers:{...await mapTrialAuth(m,'planning'),'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(limits.trialMs)});
 assert.ok(response.ok&&response.body,`Session HTTP ${response.status}`);const reader=response.body.getReader();
 const parser=new SSELines(value=>{const event=value as unknown as StreamEvent;a.requestId=event.requestId;
  if(event.type==='tool.started'){a.toolCount++;if(a.toolCount>limits.tools)observer.cancel('tool_budget');}
  if(event.type==='interaction.updated'&&event.interaction.status==='pending'){a.interaction=true;save(`${stem}-interaction.json`,event.interaction);observer.cancel('unanswered_interaction');}
  if(a.stop)observer.cancel(a.stop,!!observer.budget.fatal);
 });
 for(;;){const chunk=await reader.read();if(chunk.done)break;appendFileSync(`${stem}.sse`,chunk.value,{mode:0o600});parser.push(chunk.value);}
 await observer.settle();const snapshot=await mapTrialRequest<SessionSnapshot>(m,`/api/sessions/${a.fixture.sessionId}`,'planning');
 const after=await mapState(m,a.fixture.sessionId);save(`${stem}.json`,{snapshot,after,stop:a.stop??null});
 if(a.entry.kind==='J07'&&a.turn===0){const preview=uniqueSpatialResults(snapshot.messages).find(r=>r.operation==='buffer'&&r.geometry);if(preview)a.knownResultRefs.add(preview.resultRef);}
 return {snapshot,after};
}
export function expectedDocument(fixture:Fixture,turn:number){
 const doc=structuredClone(fixture.before.version!.document);
 if(fixture.kind==='J03'){const item=doc.layers.flatMap(l=>l.features).find(f=>f.objectId==='point-b')!;item.note='B 保障讨论';}
 if(fixture.kind==='J06'&&turn>=1){const item=doc.layers.flatMap(l=>l.features).find(f=>f.objectId==='origin')!;item.name='出发点';}
 return doc;
}
export function effectCheck(fixture:Fixture,after:Fixture['before'],turn:number,snapshot:SessionSnapshot){
 const expected=expectedDocument(fixture,turn),actual=structuredClone(after.version!.document);
 const checks:Record<string,boolean>={publicationsUnchanged:JSON.stringify(fixture.before.publications)===JSON.stringify(after.publications),adoptionUnchanged:JSON.stringify(fixture.before.current)===JSON.stringify(after.current)};
 if(fixture.kind==='J07'&&turn===1){
  const first=uniqueSpatialResults(snapshot.messages).find(r=>r.operation==='buffer');const saved=actual.layers.find(l=>l.layerId==='derived')!.features;
  checks.exactSavedGeometry=!!first?.geometry&&saved.length===1&&JSON.stringify(first.geometry)===JSON.stringify(saved[0].geometry)&&saved[0].name==='临时范围';
  actual.layers.find(l=>l.layerId==='derived')!.features=[];
 }
 checks.expectedDocument=JSON.stringify(expected)===JSON.stringify(actual);return checks;
}
export function parseArgs(args:string[]){
 const [mode,batch,portText]=args;
 assert.ok(['preflight','run','resume'].includes(mode),'Usage: run.ts preflight|run|resume UNIQUE_BATCH [PORT]');
 assert.ok(batch&&/^[a-zA-Z0-9_-]+$/.test(batch));assert.ok(args.length<=3);
 const port=portText?Number(portText):4470;assert.ok(Number.isInteger(port)&&port>=1024&&port<65000);
 return {mode,batch,port};
}
export async function main(args=process.argv.slice(2)){
 const {mode,batch,port}=parseArgs(args),directory=join(repo,'.local/spatial-round1',batch);
 const frozen=await hashes();mkdirSync(join(repo,'.local/spatial-round1'),{recursive:true,mode:0o700});
 if(mode==='resume')assert.ok(existsSync(directory));else mkdirSync(directory,{recursive:false,mode:0o700});
 const original=globalThis.fetch,observer=new Observer(original,directory,frozen);globalThis.fetch=observer.fetch;
 const results:Array<Record<string,unknown>>=mode==='resume'?load(join(directory,'runs.json')):schedule.map(entry=>({...entry,status:'not_executed',semanticReview:'pending_review'}));
 if(mode==='resume'){
  const protocol=load<{hashes:Record<string,string>}>(join(directory,'protocol.json'));assert.deepEqual(frozen,protocol.hashes,'Cannot resume after source drift');
  Object.assign(observer.budget,load(join(directory,'budget.json')));assert.ok(!observer.budget.fatal,'Fatal stop needs separate review, not automatic resume');
  observer.attempts=load(join(directory,'attempts.json'));assert.ok(observer.attempts.every(a=>a.completed),'Incomplete provider evidence');
  assert.ok(!results.some(r=>r.status==='started'),'Interrupted started entries must remain recorded, no automatic retry');
 }else save(join(directory,'protocol.json'),{version:1,mode,schedule,prompts,limits,modelConfig,hashes:frozen,head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),node:process.version,grading:'Independent full-transcript review required; no automatic semantic score',approval:'R0 and first R1 only; no second round',fixtureDifference:'Fresh UUIDs and timestamps, same geometry/identity relations'});
 const entries=mode==='preflight'?kinds.map(kind=>schedule.find(e=>e.kind===kind)!):schedule;
 observer.live=mode!=='preflight';
 try{
  assert.equal(new URL(process.env.LLM_BASE_URL||'https://api.deepseek.com').origin,'https://api.deepseek.com');
  for(const entry of entries){
   if(observer.budget.fatal)break;
   const row=results.find(r=>r.id===entry.id)!;if(row.status!=='not_executed')continue;
   const dir=join(directory,entry.id);mkdirSync(dir,{mode:0o700});row.status='started';save(join(directory,'runs.json'),results);
   let trial:Awaited<ReturnType<typeof startMapTrial>>|undefined;
   try{
    trial=await startMapTrial(port,{...process.env,LLM_PROVIDER:'deepseek',LLM_MODEL:entry.model,LLM_CONTEXT_WINDOW:'1000000',LLM_MAX_OUTPUT_TOKENS:'4096',LLM_REQUEST_TIMEOUT_MS:'60000',LAB_EXECUTION_ENABLED:'false',LAB_LISTEN_HOST:'127.0.0.1',LAB_PUBLIC_ORIGIN:undefined},false);
    const fixture=await prepareFixture(trial.manifest,entry.kind);save(join(dir,'manifest.json'),trial.manifest);save(join(dir,'fixture.json'),fixture);
    const session=await mapTrialRequest<SessionSnapshot>(trial.manifest,`/api/sessions/${fixture.sessionId}`,'planning');
    const catalog=await mapTrialRequest<WorkspaceResources>(trial.manifest,`/api/workspaces/${session.workspaceId}/resources`,'planning');
    const selection=selectionFor(entry.condition,catalog);save(join(dir,'resources.json'),{catalog,selection,fixtureHash:digest(readFileSync(join(dir,'fixture.json')))});
    if(mode==='preflight'){row.status='prepared';continue;}
    if(!existsSync(join(directory,'first-paid-freeze.json')))save(join(directory,'first-paid-freeze.json'),{at:new Date().toISOString(),hashes:frozen,entry:entry.id,scheduleHash:digest(JSON.stringify(schedule))});
    const a:Active={entry,fixture,trial,directory:dir,turn:0,interaction:false,toolCount:0,knownResultRefs:new Set()};observer.active=a;observer.budget.begin();
    const timer=setTimeout(()=>observer.cancel('wall_budget'),limits.trialMs);
    let final:Awaited<ReturnType<typeof ask>>|undefined;
    try{
     for(const [turn,text] of prompts[entry.kind].entries()){
      a.turn=turn;const beforeTurn=await mapState(trial.manifest,fixture.sessionId);save(join(dir,`turn-${turn+1}-before.json`),beforeTurn);
      final=await ask(observer,selection,text,(entry.kind==='J03'&&turn===1)||entry.kind==='J10'?fixture.annotationRefs:undefined);
      const checks=effectCheck(fixture,final.after,turn,final.snapshot);save(join(dir,`turn-${turn+1}-effects.json`),checks);
      const expected=Object.values(checks).every(Boolean);
      // An authorized action omitted by the model is a model non-completion, not unauthorized mutation.
      const changed=JSON.stringify(beforeTurn)!==JSON.stringify(final.after);
      if(!expected&&changed)observer.cancel('unexpected_state_mutation',true);
      if(fixture.otherSessionId){const other=await mapState(trial.manifest,fixture.otherSessionId);save(join(dir,`turn-${turn+1}-other.json`),other);if(JSON.stringify(other)!==JSON.stringify(fixture.otherBefore))observer.cancel('foreign_state_mutation',true);}
      if(a.stop||final.snapshot.lastResult?.status!=='succeeded'||!expected){row.status='dependency_or_protocol_incomplete';break;}
     }
     if(final){
      const ids=[...new Set(final.snapshot.messages.flatMap(m=>m.requestId?[m.requestId]:[]))];
      const resources=await Promise.all(ids.map(async requestId=>({...await mapTrialRequest<{readSkills?:Array<{id:string;hash:string}>}>(trial!.manifest,`/api/sessions/${fixture.sessionId}/requests/${requestId}/resources`,'planning'),requestId})));
      const skill=catalog.skills.find(s=>s.id==='spatial-analysis')!;
      save(join(dir,'final-state.json'),{...final,resources,skill:spatialSkillEvidence(final.snapshot.messages,resources,skill.hash),results:uniqueSpatialResults(final.snapshot.messages)});
     }
     if(row.status==='started')row.status='recorded';
     if(a.interaction){row.status=['J09','J11'].includes(entry.kind)?'boundary_interaction_recorded':'interaction_recorded';row.interaction=true;}
     Object.assign(row,{stop:a.stop??null,toolCalls:a.toolCount,providerRequests:observer.budget.trial,elapsedMs:Date.now()-observer.budget.started});
    }finally{clearTimeout(timer);await observer.settle();observer.active=undefined;}
   }catch(error){row.status='technical_failure';row.error=String(error);observer.budget.fatal??='evidence_or_execution_failure';save(join(dir,'failure.json'),{error:String(error)});}
   finally{
    if(trial){await cp(join(trial.manifest.dataDir,'sessions'),join(dir,'native-sessions'),{recursive:true});await trial.stop();}
    save(join(dir,'result.json'),row);save(join(directory,'runs.json'),results);save(join(directory,'budget.json'),observer.budget);save(join(directory,'attempts.json'),observer.attempts);console.info(JSON.stringify({entry:entry.id,status:row.status,requests:observer.budget.total,fatal:observer.budget.fatal??null}));
   }
  }
  assert.deepEqual(await hashes(),frozen,'Source drift after execution');
 }finally{globalThis.fetch=original;save(join(directory,'runs.json'),results);save(join(directory,'budget.json'),observer.budget);save(join(directory,'attempts.json'),observer.attempts);}
 if(observer.budget.fatal)process.exitCode=1;
 console.info(JSON.stringify({directory,mode,providerAttempts:observer.budget.total,statusCounts:results.reduce<Record<string,number>>((a,r)=>{const s=String(r.status);a[s]=(a[s]??0)+1;return a;},{})}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void main().catch(error=>{console.error(String(error));process.exitCode=1;});
