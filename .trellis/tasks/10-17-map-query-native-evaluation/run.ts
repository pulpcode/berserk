/** Evaluation observer only. Uses the unchanged native Pi request path. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {appendFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {mkdir, readFile, readdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startMapTrial,mapTrialRequest} from '../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {ask,mapState} from '../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import {scopeObservations} from '../../../experiments/harness-lab/scripts/probe-map-result-projection.js';
import {prepareFixture,preparationState,prompts,schedule,type Fixture} from './fixtures.js';

const taskDir=fileURLToPath(new URL('.',import.meta.url));
const repo=resolve(taskDir,'../../..');
const packageRoot=join(repo,'experiments/harness-lab');
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const save=(path:string,value:unknown)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});
export function evaluationModel(value=process.env.NATIVE_EVAL_MODEL) {
  const model=value||'deepseek-flash';
  assert.ok(model==='deepseek-flash'||model==='deepseek-v4-pro','Unsupported evaluation model');
  return model;
}
export const limits={trialRequests:6,totalRequests:90,input:2_000_000,output:60_000,reserve:2048,trialMs:360_000};
export class Budget {
  total=0;trial=0;input=0;output=0;unknown=false;started=0;fatal:string|undefined;
  begin(now=Date.now()){this.trial=0;this.started=now;}
  reserve(now=Date.now()) {
    if(this.fatal)throw new Error(this.fatal);
    if(this.unknown||this.input>=limits.input||this.output+limits.reserve>limits.output||this.total>=limits.totalRequests) {
      this.fatal='batch_budget_or_missing_usage';throw new Error(this.fatal);
    }
    if(this.trial>=limits.trialRequests||now-this.started>=limits.trialMs)throw new Error('trial_budget');
    this.total++;this.trial++;
  }
  finish(usage:unknown) {
    const u=usage as {prompt_tokens?:number;completion_tokens?:number}|undefined;
    if(!Number.isInteger(u?.prompt_tokens)||!Number.isInteger(u?.completion_tokens)||u!.prompt_tokens!<0||u!.completion_tokens!<0){this.unknown=true;this.fatal??='missing_provider_usage';return;}
    // OpenAI-compatible prompt_tokens already includes cached tokens; never add cache-hit a second time.
    this.input+=u!.prompt_tokens!;this.output+=u!.completion_tokens!;
  }
}
export function allowedTool(name:string,args:unknown,phase:'prepare'|'readonly',basis?:{feature:Record<string,unknown>;layerId:string}):boolean {
  if(name==='annotation_action') {
    if(phase!=='prepare')return false;
    const p=args as {action?:string;operations?:Array<{op?:string;objectId?:string;changes?:Record<string,unknown>;layerId?:string}>};
    return p?.action==='apply'&&Array.isArray(p.operations)&&p.operations.length>0&&p.operations.every(op=>op.op==='update_object'&&op.objectId==='point-b'
      && Object.keys(op).every(key=>['op','objectId','changes','layerId'].includes(key))
      && (op.layerId===undefined||op.layerId===basis?.layerId)
      && op.changes?.note==='B 保障讨论'&&Object.entries(op.changes).every(([key,value])=>key==='note'||(basis!==undefined&&JSON.stringify(value)===JSON.stringify(basis.feature[key]))));
  }
  return ['annotation_read','annotation_list','situation_query','information_read','information_search','task_search','task_read','task_information_list','task_information_read','work_item_list','work_item_read','source_list','source_read','instructions_read','skill_read','source.list','source.read','instructions.read','skill.read','read','ls','find','grep','subagent','ask_user'].includes(name);
}
export class SSELines {
  buffer='';decoder=new TextDecoder();
  constructor(private consume:(value:Record<string,unknown>)=>void,private done?:()=>void){}
  push(chunk:Uint8Array){this.buffer+=this.decoder.decode(chunk,{stream:true});const lines=this.buffer.split('\n');this.buffer=lines.pop()!;for(const line of lines){if(!line.startsWith('data:'))continue;const raw=line.slice(5).trim();if(raw==='[DONE]'){this.done?.();continue;}if(!raw)continue;this.consume(JSON.parse(raw));}}
}
interface Attempt {id:number;trialId:string;phase:string;status?:number;usage?:unknown;error?:string;completed:boolean;tools:Array<{name:string;arguments:string}>}
interface Active {id:string;trial:Awaited<ReturnType<typeof startMapTrial>>;fixture:Fixture;directory:string;phase:'prepare'|'readonly';requestId?:string;cancelled?:string;cancelSent?:boolean;knownTools?:Set<string>}
export class Observer {
  budget=new Budget();active?:Active;mode:'prepare-only'|'run'='prepare-only';attempts:Attempt[]=[];pending=new Set<Promise<void>>();
  constructor(readonly original:typeof fetch,readonly directory:string,readonly providerOrigin:string,readonly model=evaluationModel('deepseek-flash')){}
  cancel(reason:string,fatal=false) {
    if(fatal)this.budget.fatal??=reason;
    const active=this.active;if(!active)return;
    active.cancelled??=reason;
    save(join(active.directory,'cancellation.json'),{reason,at:new Date().toISOString(),requestId:active.requestId??null,note:'Cancellation may follow a committed tool; inspect after-state.'});
    if(active.requestId&&!active.cancelSent){active.cancelSent=true;const promise=mapTrialRequest(active.trial.manifest,`/api/sessions/${active.fixture.sessionId}/cancel`,'planning','POST',{requestId:active.requestId}).then(()=>undefined).catch(error=>{save(join(active.directory,'cancel-error.json'),{error:String(error)});});this.pending.add(promise);void promise.finally(()=>this.pending.delete(promise));}
  }
  fetch:typeof fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    if(url.origin===this.providerOrigin) return this.provider(input,init);
    const response=await this.original(input,init);
    const active=this.active;
    if(active&&url.origin===active.trial.manifest.url&&url.pathname===`/api/sessions/${active.fixture.sessionId}/messages`&&response.body) {
      save(join(active.directory,`${active.phase}-http-body.json`),JSON.parse(String(init?.body)));
      const parser=new SSELines(event=>{
        if(typeof event.requestId==='string')active.requestId=event.requestId;
        if(event.type==='tool.started'&&typeof event.toolName==='string'&&active.knownTools?.has(event.toolName)&&event.toolName!=='annotation_action'&&!allowedTool(event.toolName,{},active.phase))this.cancel(`unauthorized_tool:${event.toolName}`,true);
        if(event.type==='tool.started'&&event.toolName==='annotation_action'&&active.phase==='readonly')this.cancel('unauthorized_tool:annotation_action',true);
        if(active.cancelled&&active.requestId&&!active.cancelSent)this.cancel(active.cancelled,Boolean(this.budget.fatal));
      });
      return this.observe(response,chunk=>parser.push(chunk));
    }
    return response;
  };
  observe(response:Response,consume:(chunk:Uint8Array)=>void,finish?:()=>void,failed?:(error:unknown)=>void) {
    assert.ok(response.body);
    const reader=response.body.getReader();
    const body=new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {const part=await reader.read();if(part.done){finish?.();controller.close();return;}consume(part.value);controller.enqueue(part.value);}
        catch(error){failed?.(error);finish?.();controller.error(error);}
      },
      async cancel(reason){failed?.(reason??'consumer_cancelled');finish?.();await reader.cancel(reason);},
    });
    return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  }
  async provider(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1]) {
    if(this.mode==='prepare-only'||!this.active)throw new Error('Provider forbidden before all fixtures are frozen');
    if(this.attempts.some(a=>!a.completed)){this.budget.unknown=true;this.budget.fatal??='previous_attempt_usage_unsettled';}
    try {this.budget.reserve();} catch(error){this.cancel(String(error),Boolean(this.budget.fatal));throw error;}
    const active=this.active,id=this.budget.total,stem=join(active.directory,`provider-${String(id).padStart(3,'0')}`);
    const body=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():null;
    assert.ok(body,'Actual provider JSON body missing');const payload=JSON.parse(body);
    assert.equal(payload.model,this.model);assert.equal(payload.max_tokens,2048);assert.equal(payload.thinking?.type,'disabled');
    save(`${stem}-input.json`,payload);
    const availableTools=new Set<string>((payload.tools??[]).map((tool:{function?:{name?:string}})=>tool.function?.name).filter(Boolean));
    active.knownTools??=new Set();for(const name of availableTools){active.knownTools.add(name);active.knownTools.add(name.replace('_','.'));}
    const attempt:Attempt={id,trialId:active.id,phase:active.phase,completed:false,tools:[]};this.attempts.push(attempt);
    const tools=new Map<number,{name:string;arguments:string}>();let finished=false;
    const finish=()=>{if(finished)return;finished=true;attempt.completed=true;this.budget.finish(attempt.usage);save(`${stem}-meta.json`,attempt);save(join(this.directory,'budget.json'),this.budget);};
    const inspectTools=()=>{for(const tool of tools.values()) {let args:unknown;try{args=JSON.parse(tool.arguments);}catch{continue;}
      // A hallucinated name cannot execute; leave its ordinary native error/recovery intact.
      if(!availableTools.has(tool.name))continue;
      const layer=active.fixture.before?.version?.document.layers.find(l=>l.features.some(f=>f.objectId==='point-b'));
      const feature=layer?.features.find(f=>f.objectId==='point-b');
      if(!allowedTool(tool.name,args,active.phase,feature&&layer?{feature:feature as unknown as Record<string,unknown>,layerId:layer.layerId}:undefined))this.cancel(`unauthorized_tool:${tool.name}`,true);
    }};
    const parser=new SSELines(event=>{
      if(event.usage)attempt.usage=event.usage;
      for(const choice of (event.choices??[]) as Array<{delta?:{tool_calls?:Array<{index:number;function?:{name?:string;arguments?:string}}>};finish_reason?:string}>) {
        for(const call of choice.delta?.tool_calls??[]){const tool=tools.get(call.index)??{name:'',arguments:''};tool.name+=call.function?.name??'';tool.arguments+=call.function?.arguments??'';tools.set(call.index,tool);}
        if(choice.finish_reason){attempt.tools=[...tools.values()];inspectTools();}
      }
    },finish);
    try {
      const response=await this.original(input,init);attempt.status=response.status;
      if([401,402,403,404].includes(response.status))this.cancel(`provider_http_${response.status}`,true);
      if(!response.body){finish();return response;}
      // No headers or credentials are recorded. The byte stream returned to Pi is unchanged.
      return this.observe(response,chunk=>{appendFileSync(`${stem}-response.sse`,chunk,{mode:0o600});parser.push(chunk);},finish,error=>{if(!finished)attempt.error=String(error);});
    } catch(error){attempt.error=String(error);finish();throw error;}
  }
  async settle(){await Promise.allSettled([...this.pending]);}
}
export async function exclusiveDirectory(path:string){await mkdir(path,{recursive:false,mode:0o700});}
async function hashes() {
  const paths=execFileSync('git',['ls-files','-z','experiments/harness-lab/src','experiments/harness-lab/fixtures','experiments/harness-lab/package-lock.json','experiments/harness-lab/package.json'],{cwd:repo,encoding:'utf8'}).split('\0').filter(Boolean);
  for(const name of await readdir(taskDir))if(/\.(md|ts|jsonl)$/.test(name))paths.push(join(taskDir,name));
  paths.push('experiments/harness-lab/scripts/probe-source-annotations.ts','experiments/harness-lab/scripts/probe-situation-map.ts','experiments/harness-lab/scripts/probe-map-query-cases.ts','experiments/harness-lab/scripts/probe-desktop-map.ts');
  const result:Record<string,string>={};for(const path of paths)result[path.startsWith(repo)?path.slice(repo.length+1):path]=digest(await readFile(resolve(repo,path)));return result;
}
export function parseArgs(args:string[]) {
  if(args.length===0||args[0]==='help'||args[0]==='--help')return {mode:'help' as const,batch:'',port:4450};
  const [mode,batch,...rest]=args;if(!['prepare-only','run'].includes(mode)||!batch||!/^[-a-zA-Z0-9_]+$/.test(batch)||rest.length>1)throw new Error('Usage: run.ts prepare-only|run <unique-batch-id> [base-port]');
  const port=rest.length?Number(rest[0]):4450;if(!Number.isInteger(port)||port<1024||port>65520)throw new Error('Invalid base port');return {mode:mode as 'prepare-only'|'run',batch,port};
}
export async function main(args=process.argv.slice(2)) {
  const options=parseArgs(args);if(options.mode==='help'){console.info('From experiments/harness-lab: node --import tsx --env-file-if-exists=.env.local ../../.trellis/tasks/10-17-map-query-native-evaluation/run.ts prepare-only|run UNIQUE_BATCH [BASE_PORT]\nEach run prepares and freezes 15 new isolated fixtures before any provider request. prepare-only never calls the provider and is not resumable. No product change, deployment or automatic grading.');return;}
  const parent=join(repo,'.local/map-query-native');mkdirSync(parent,{recursive:true,mode:0o700});const directory=join(parent,options.batch);await exclusiveDirectory(directory);
  const original=globalThis.fetch,origin=new URL(process.env.LLM_BASE_URL||'https://api.deepseek.com').origin;
  assert.equal(origin,'https://api.deepseek.com','This approved batch uses the existing DeepSeek endpoint only');
  const model=evaluationModel();
  const observer=new Observer(original,directory,origin,model);globalThis.fetch=observer.fetch;
  const prepared:Array<{entry:typeof schedule[number];trial:Awaited<ReturnType<typeof startMapTrial>>;fixture:Fixture;directory:string}>=[];
  const results=schedule.map(entry=>({...entry,status:'not_executed',semanticReview:'pending_review'})) as Array<Record<string,unknown>>;
  const env={...process.env,LLM_PROVIDER:'deepseek',LLM_MODEL:model,LLM_CONTEXT_WINDOW:'1000000',LLM_MAX_OUTPUT_TOKENS:'2048',LLM_REQUEST_TIMEOUT_MS:'60000',LAB_EXECUTION_ENABLED:'false',LAB_PUBLIC_ORIGIN:undefined};
  try {
    const productDiff=execFileSync('git',['diff','8cab905','--','experiments/harness-lab/src','experiments/harness-lab/fixtures','experiments/harness-lab/package-lock.json','experiments/harness-lab/package.json'],{cwd:repo,encoding:'utf8'});assert.equal(productDiff,'','Product differs from frozen baseline');
    assert.equal(execFileSync('git',['ls-files','--others','--exclude-standard','experiments/harness-lab/src','experiments/harness-lab/fixtures'],{cwd:repo,encoding:'utf8'}),'','Untracked product files found');
    save(join(directory,'protocol.json'),{schedule,prompts,limits,mode:options.mode,node:process.version,piVersion:JSON.parse(readFileSync(join(packageRoot,'node_modules/@earendil-works/pi-coding-agent/package.json'),'utf8')).version,model,contextWindow:1000000,thinking:'disabled',outputLimit:2048,requestTimeoutMs:60000,baseline:'8cab905',head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),hashes:await hashes(),grading:'review-rubric.md; no automatic semantic acceptance'});
    for(const [i,entry] of schedule.entries()) {
      const dir=join(directory,entry.id);await exclusiveDirectory(dir);
      const trial=await startMapTrial(options.port+i,env,false);
      // Retain even failed initialization and ensure cleanup.
      const holder={entry,trial,fixture:undefined as unknown as Fixture,directory:dir};prepared.push(holder);
      save(join(dir,'manifest.json'),trial.manifest);
      holder.fixture=await prepareFixture(trial.manifest,entry.kind);save(join(dir,'fixture.json'),holder.fixture);
      results[i].status='prepared';console.info(JSON.stringify({trial:entry.id,kind:entry.kind,status:'prepared'}));
    }
    const frozen=prepared.map(p=>({id:p.entry.id,hash:digest(readFileSync(join(p.directory,'fixture.json')))}));save(join(directory,'freeze.json'),{at:new Date().toISOString(),providerAttempts:observer.budget.total,fixtures:frozen});
    assert.equal(observer.budget.total,0);
    if(options.mode==='prepare-only')return;
    observer.mode='run';
    for(const [i,p] of prepared.entries()) {
      if(observer.budget.fatal)break;
      assert.equal(digest(readFileSync(join(p.directory,'fixture.json'))),frozen[i].hash);
      const active:Active={id:p.entry.id,trial:p.trial,fixture:p.fixture,directory:p.directory,phase:p.entry.kind==='F2'?'prepare':'readonly'};observer.active=active;observer.budget.begin();
      const timer=setTimeout(()=>observer.cancel('trial_timeout'),limits.trialMs);
      try {
        assert.deepEqual(await mapState(p.trial.manifest,p.fixture.sessionId),p.fixture.before,'Fixture changed before start');
        if(p.fixture.kind==='F2') {
          const prep=await ask(p.trial.manifest,p.directory,'preparation',p.fixture.sessionId,prompts.prep);await observer.settle();
          const other=await mapState(p.trial.manifest,p.fixture.otherSessionId!);save(join(p.directory,'preparation-other-after.json'),other);
          const state=preparationState(p.fixture.before,prep.after);results[i].preparationState=state;
          if(state==='unexpected'||JSON.stringify(other)!==JSON.stringify(p.fixture.otherBefore))observer.cancel('unexpected_preparation_state',true);
          if(state!=='correct'||prep.failure||prep.cancelledForInteraction||prep.snapshot.lastResult?.status!=='succeeded'||observer.budget.fatal||active.cancelled){results[i].status='dependency_failed';continue;}
          active.phase='readonly';active.requestId=undefined;
        }
        const before=await mapState(p.trial.manifest,p.fixture.sessionId),otherBefore=p.fixture.otherSessionId?await mapState(p.trial.manifest,p.fixture.otherSessionId):null;
        const record=await ask(p.trial.manifest,p.directory,'query',p.fixture.sessionId,prompts[p.fixture.kind],p.fixture.annotationRefs);await observer.settle();
        const otherAfter=p.fixture.otherSessionId?await mapState(p.trial.manifest,p.fixture.otherSessionId):null;
        const unchanged=JSON.stringify(before)===JSON.stringify(record.after)&&JSON.stringify(otherBefore)===JSON.stringify(otherAfter);
        const observations=scopeObservations(record.toolResults);save(join(p.directory,'checks.json'),{unchanged,otherBefore,otherAfter,observations});
        if(!unchanged||observations.writeToolAttempted)observer.cancel('readonly_state_or_write_violation',true);
        results[i].status=record.failure||record.cancelledForInteraction||record.snapshot.lastResult?.status!=='succeeded'||active.cancelled?'incomplete':'recorded';results[i].unchanged=unchanged;
      } catch(error) {results[i].status='technical_failure';results[i].error=String(error);observer.cancel('evidence_or_execution_failure',true);}
      finally {clearTimeout(timer);results[i].providerRequests=observer.budget.trial;results[i].cancelled=active.cancelled??null;save(join(directory,'runs.json'),results);save(join(directory,'attempts.json'),observer.attempts);save(join(directory,'budget.json'),observer.budget);await p.trial.stop();observer.active=undefined;}
    }
  } catch(error){observer.budget.fatal??=String(error);save(join(directory,'failure.json'),{error:String(error)});process.exitCode=1;}
  finally {await observer.settle();if(observer.attempts.some(a=>!a.completed)){observer.budget.unknown=true;observer.budget.fatal??='unfinished_provider_evidence';}globalThis.fetch=original;for(const p of prepared)await p.trial.stop();save(join(directory,'runs.json'),results);save(join(directory,'attempts.json'),observer.attempts);save(join(directory,'budget.json'),observer.budget);console.info(JSON.stringify({directory,mode:options.mode,recorded:results.filter(r=>r.status==='recorded').length,providerAttempts:observer.budget.total,stop:observer.budget.fatal??null}));if(options.mode==='run'&&results.some(r=>r.status!=='recorded'))process.exitCode=1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void main().catch(error=>{console.error(String(error));process.exitCode=1;});
