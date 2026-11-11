import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readdir} from 'node:fs/promises';
import {readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {schedule,caseIds,type Prepared,clarificationResponse,isPlainClarification} from './source-cases.js';
import {SourceLedger,budgets} from './source-budget.js';
import {preload} from './source-provider.js';
import {runLive} from './source-live.js';
import {loopbackOnly,type Runtime,treatmentPaths} from './source-runtime.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
import type {Payload} from '../r3-20261022/audit.js';
import {mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import type {SessionSnapshot,Interaction} from '../../../../experiments/harness-lab/src/contracts/index.js';
const read=<T>(path:string)=>JSON.parse(readFileSync(path,'utf8')) as T;
test('12 unique paired slots; neither group always runs first',()=>{
 assert.equal(schedule.length,12);assert.equal(new Set(schedule.map(e=>e.id)).size,12);
 for(const c of caseIds)assert.deepEqual(schedule.filter(e=>e.caseId===c).map(e=>e.group).sort(),['B0','B1']);
 assert.equal(schedule.filter((e,i)=>i%2===0&&e.group==='B0').length,3);
});
test('B ledger reserves each active request, never resumes or borrows C budget',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'r12-b-ledger-')),ledger=new SourceLedger(join(dir,'ledger.json'),'freeze');
 assert.ok(ledger.canStartTrial());ledger.assertRequest(100);ledger.beginRequest('one','B01');assert.equal(ledger.canStartTrial(),false);assert.throws(()=>ledger.assertRequest(100));
 ledger.finishRequest('one',{inputTokens:10,outputTokens:budgets.output-8192,responseModel:'deepseek-v4-1-flash-261017'});
 ledger.assertRequest(100);ledger.beginRequest('two','B01');ledger.finishRequest('two',{inputTokens:10,outputTokens:1,responseModel:'deepseek-v4-1-flash-261017'});
 assert.throws(()=>ledger.assertRequest(100));assert.equal(ledger.canStartTrial(),false);assert.throws(()=>new SourceLedger(ledger.path,'freeze'));
 const requests=new SourceLedger(join(dir,'requests.json'),'freeze');for(let i=0;i<96;i++){requests.assertRequest(1);requests.beginRequest(String(i),'B01');requests.finishRequest(String(i),{inputTokens:1,outputTokens:1,responseModel:'deepseek-v4-1-flash-261017'});}assert.throws(()=>requests.assertRequest(1));
 const failed=new SourceLedger(join(dir,'failed.json'),'freeze');failed.beginRequest('bad','B01');failed.failRequest('bad','unknown_usage');assert.throws(()=>failed.assertRequest(1));assert.equal(failed.read().requests[0].status,'failed');
});
test('preload preserves native messages and includes exact both bodies plus labelled real driver evidence',()=>{
 const runtime={skills:{'map-annotations':{content:'MAP_BODY',hash:'a',description:'map'},'spatial-analysis':{content:'SPATIAL_BODY',hash:'b',description:'spatial'}}} as unknown as Runtime;
 const original:Payload={messages:[{role:'system',content:'EXISTING'},{role:'user',content:'hello'}],tools:[],model:'deepseek-v4.1-flash'};
 const p=preload(original,runtime,[{method:'POST',path:'/actual',params:{},result:{actual:true}}]);assert.deepEqual(p.messages!.slice(1),original.messages!.slice(1));assert.ok(String(p.messages![0].content).includes('MAP_BODY'));assert.ok(String(p.messages![0].content).includes('SPATIAL_BODY'));assert.ok(String(p.messages![0].content).includes('driver_read_evidence'));assert.equal(original.messages![0].content,'EXISTING');assert.throws(()=>preload({messages:[]},runtime));
});
test('only predefined ambiguity answers; no arbitrary approvals or future-work offers',()=>{
 const p={caseId:'B03',clarificationReply:'predefined draft choice'} as Prepared;
 const q={kind:'question',requestId:'r',questions:[{id:'scope',prompt:'请选择草稿还是来源系统？'}]} as Interaction;
 assert.equal(clarificationResponse(p,q,false)?.kind,'question');assert.equal(clarificationResponse(p,q,true),undefined);assert.equal(clarificationResponse(p,{...q,kind:'confirmation'} as Interaction,false),undefined);
 const snapshot=(text:string)=>({messages:[{role:'assistant',text}]}) as SessionSnapshot;
 assert.ok(isPlainClarification(p,snapshot('请确认，是草稿还是来源系统？')));assert.equal(isPlainClarification(p,snapshot('草稿4个，来源1个。是否需要继续分析？')),false);
});
test('live refuses missing freeze before reading secret or network',async()=>{
 let reads=0;const env=new Proxy({},{get(){reads++;throw new Error('secret read');}}) as NodeJS.ProcessEnv;
 await assert.rejects(runLive({directory:'/tmp/r12-never-created',env}),/requires frozen source/);assert.equal(reads,0);assert.equal(existsSync('/tmp/r12-never-created'),false);
});
test('12 real HTTP/Pi sessions verify archive isolation, both preload bodies, source paths and cross-source math',{timeout:600000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r12-b-offline-')),directory=join(parent,'batch'),original=globalThis.fetch;const counts=new Map<string,number>();let scriptError:unknown,requests=0;
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);
  requests++;const payload=JSON.parse(String(init?.body)) as Payload;assert.equal(payload.thinking?.type,'disabled');
  const row=read<Array<{id:string;caseId:string;group:string;status:string}>>(join(directory,'runs.json')).find(r=>r.status==='started')!;
  const stem=join(directory,row.id),p=read<Prepared>(join(stem,'fixture.json')),m=read<Parameters<typeof mapTrialRequest>[0]>(join(stem,'manifest.json')),turn=read<Array<{turn:number}>>(join(directory,'attempts.json')).at(-1)!.turn;
  const key=row.id+':'+turn,n=(counts.get(key)??0)+1;counts.set(key,n);
  const call=(name:string,args:unknown)=>fakeResponse('deepseek-v4-1-flash-261017',{name,arguments:args});
  const ref=p.fixture.before.version!.ref,ann=(objectIds:string[])=>({kind:'annotation',ref,objectIds}),candidates={kind:'annotation',ref,layerIds:['resources']};
  const filter=()=>call('spatial_analyze',{operation:'filter',input:candidates,spatial:{relation:'contains',target:ann(['region'])}});
  try{
   if(row.caseId==='B01'&&n===1)return filter();
   if(row.caseId==='B02'&&n===1)return call('situation_query',{systemId:'situation',mode:'current',objectRefs:[m.objects.resource]});
   if(['B03','B04'].includes(row.caseId)){
    if(row.group==='B1'&&turn===0&&n===1)return fakeResponse('deepseek-v4-1-flash-261017',undefined,'请确认，您指的是草稿点，还是来源系统的资源点？');
    if(row.group==='B1'&&turn===1&&n===1)return filter();
    if(row.group==='B0'&&n===1)return call('ask_user',{questions:[{id:'source',prompt:'请确认使用本会话草稿还是来源系统的资源？'}]});
    if(row.group==='B0'&&n===2)return filter();
   }
   if(row.caseId==='B05'&&turn===1&&n===1)return filter();
   if(row.caseId==='B06'&&n===1)return call('spatial_analyze',{operation:'filter',input:candidates,spatial:{relation:'contains',target:{kind:'source',systemId:'situation',objectRefs:[p.truth.sourceRegion]}}});
   return fakeResponse('deepseek-v4-1-flash-261017',undefined,'离线工具接线检查，不计模型语义通过。');
  }catch(error){scriptError=error;throw error;}
 };
 const result=await runLive({directory,port:4627,offline:{transport}});assert.equal(scriptError,undefined);assert.equal(result.stop,undefined,JSON.stringify(result));assert.equal(result.rows.length,12);assert.ok(result.rows.every(r=>r.status==='recorded'));
 const sessions=new Set<string>(),toolGroups=new Map<string,unknown>();
 for(const row of result.rows){
  const stem=join(directory,row.id),review=read<{fixture:Prepared;final:SessionSnapshot;after:Prepared['fixture']['before'];clarification:{api:boolean;plain:boolean}}>(join(stem,'review.json'));sessions.add(review.fixture.fixture.sessionId);
  const results=review.final.messages.flatMap(m=>m.spatialResult?[m.spatialResult]:[]);
  if(row.caseId!=='B02')assert.deepEqual(results.at(-1)!.items.map(i=>i.annotation!.objectId).sort(),row.caseId==='B06'?['r1']:['edge','r1','r2','r3']);
  assert.deepEqual(review.fixture.fixture.before,review.after);
  if(['B03','B04'].includes(row.caseId))assert.ok(row.group==='B0'?review.clarification.api:review.clarification.plain);
  if(row.caseId==='B04'){assert.equal(review.fixture.providedQueries!.length,2);assert.ok(JSON.stringify(review.fixture.providedQueries).includes('availableCount'));}
  const files=await readdir(stem),wire=files.filter(f=>f.endsWith('-wire-input.json'));assert.ok(wire.length);
  for(const f of wire){const payload=read<Payload>(join(stem,f));toolGroups.set(row.group,payload.tools);const text=String(payload.messages!.find(m=>m.role==='system')!.content);for(const id of ['map-annotations','spatial-analysis'])assert.ok(text.includes(readFileSync(join(directory,'runtime-builds/runtimes',row.group,'fixtures/skills',id,'SKILL.md'),'utf8')));if(row.caseId==='B04')assert.ok(text.includes('driver_read_evidence'));}
 }
 const oldTools=toolGroups.get('B0') as Array<{function:{name:string;description:string}}>,newTools=toolGroups.get('B1') as typeof oldTools;const changed=oldTools.filter((t,i)=>JSON.stringify(t)!==JSON.stringify(newTools[i])).map(t=>t.function.name).sort();assert.deepEqual(changed,['source_list','source_read']);const normalize=(v:unknown)=>JSON.parse(JSON.stringify(v),(k,v)=>k==='description'?undefined:v);assert.deepEqual(normalize(oldTools),normalize(newTools));
 for(const group of ['B0','B1']){const integrity=read<{baselineRevision:string;allowedDiff:string[]}>(join(directory,'runtime-builds/runtimes',group,'runtime-integrity.json'));assert.equal(integrity.baselineRevision,'6a631a4');assert.deepEqual(integrity.allowedDiff,group==='B0'?[]:[...treatmentPaths].sort());}
 assert.equal(sessions.size,12);assert.equal(read<{requests:unknown[]}>(join(directory,'ledger.json')).requests.length,requests);await assert.rejects(runLive({directory,port:4627,offline:{transport}}),/EEXIST/);
});
for(const fault of ['http_error','response_model_drift','missing_usage'] as const)test(`real HTTP preserves ${fault}, stops next slot and never retries`,{timeout:120000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r12-b-failure-')),directory=join(parent,'batch'),original=globalThis.fetch;let calls=0;
 const transport:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);calls++;
  if(fault==='http_error')return new Response('quota blocked',{status:429});
  if(fault==='response_model_drift')return fakeResponse('deepseek-v4.1-flash',undefined,'wrong exact response version');
  const response=fakeResponse('deepseek-v4-1-flash-261017');return new Response((await response.text()).replace(/,"usage":\{[^}]+\}/g,''),{headers:response.headers});
 };
 const result=await runLive({directory,port:4627,offline:{entries:schedule.slice(0,2),transport}});assert.equal(calls,1);assert.ok(result.stop);assert.equal(result.rows[1].status,'not_executed');const ledger=read<{requests:Array<{status:string}>;halted?:string}>(join(directory,'ledger.json'));assert.ok(ledger.halted);assert.equal(ledger.requests.length,1);assert.equal(ledger.requests[0].status,'failed');
});
