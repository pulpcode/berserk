import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readdir} from 'node:fs/promises';
import {readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runLive,liveClaim,assertExecutionGate,generatedBuffersInUserTurn} from './live.js';
import {schedule,type Prepared} from './cases.js';
import {loopbackOnly,toolOverlay,candidateSkills,candidateTools,baselineFile} from './runtime.js';
import {modelConfiguration,type Group} from './budget.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
import type {Payload} from '../r12-20261025/reasoning-prepare.js';
import {mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import type {SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
const read=<T>(p:string)=>JSON.parse(readFileSync(p,'utf8')) as T;
async function response(group:Group,call?:{name:string;arguments:unknown},text?:string){const r=fakeResponse(modelConfiguration[group].responseModel,call,text),raw=await r.text();return new Response(raw.replace('"delta":{','"delta":{"reasoning_content":"PRIVATE_REASONING_TRACE",'),{headers:r.headers});}
test('missing freeze refuses before secrets and does not claim live slot',async()=>{
 let reads=0;const env=new Proxy({},{get(){reads++;throw new Error('secret read');}}) as NodeJS.ProcessEnv;
 await assert.rejects(runLive({directory:'/tmp/r15-no-entry',env}),/requires frozen source/);assert.equal(reads,0);assert.equal(existsSync('/tmp/r15-no-entry'),false);
});
test('four factors use actual native Skill/tool loop, original result save, optional invitations and more than ten requests',{timeout:600000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r15-offline-complete-')),directory=join(parent,'batch'),claimPath=join(parent,'claim.json'),original=globalThis.fetch,hadClaim=existsSync(liveClaim),counts=new Map<string,number>();let calls=0,error:unknown,replays=0;
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);calls++;
  const row=read<Array<{id:string;caseId:string;group:Group;status:string}>>(join(directory,'runs.json')).find(r=>r.status==='started')!,dir=join(directory,row.id),p=read<Prepared>(join(dir,'fixture.json')),m=read<Parameters<typeof mapTrialRequest>[0]>(join(dir,'manifest.json')),turn=read<Array<{turn:number}>>(join(directory,'attempts.json')).at(-1)!.turn,n=(counts.get(row.id+':'+turn)??0)+1;counts.set(row.id+':'+turn,n);
  try{
   const payload=JSON.parse(String(init?.body)) as Payload;assert.deepEqual(payload.thinking,{type:'enabled'});assert.equal(payload.reasoning_effort,'high');assert.equal(payload.max_completion_tokens,32768);assert.equal('temperature'in payload,false);assert.equal('top_p'in payload,false);
   for(const message of payload.messages)if(message.role==='assistant'&&message.reasoning_content){assert.equal(message.reasoning_content,'PRIVATE_REASONING_TRACE');replays++;}
   if(turn===0&&n===1){for(const id of ['map-annotations','spatial-analysis'])assert.ok(!JSON.stringify(payload.messages).includes(readFileSync(join(directory,'runtime-builds/runtimes',row.group,'fixtures/skills',id,'SKILL.md'),'utf8')));assert.ok(existsSync(join(directory,row.caseId+'-r1-quartet.json')));}
   const call=(name:string,args:unknown)=>response(row.group,{name,arguments:args});
   if(row.caseId==='P01'){
    if(n===1&&turn===0)return row.group==='G0'?response(row.group,undefined,'请确认是当前会话草稿中的港区和资源图层，还是来源系统的数据？'):call('ask_user',{questions:[{id:'source',prompt:'请选择当前会话草稿中的港区和资源图层，还是来源系统的数据？'}]});
    assert.ok(JSON.stringify(payload.messages).includes('按当前会话草稿中的港区和资源图层'));
    return response(row.group,undefined,'当前会话草稿内共有4个资源点。');
   }
   const snapshot=await mapTrialRequest<SessionSnapshot>(m,`/api/sessions/${p.fixture.sessionId}`,'planning'),buffers=snapshot.messages.flatMap(x=>x.spatialResult?.operation==='buffer'?[x.spatialResult]:[]),ref=p.fixture.before.version!.ref,ann={kind:'annotation',ref,objectIds:['origin']};
   if(turn===0&&n<=2)return call('skill_read',{id:n===1?'map-annotations':'spatial-analysis'});
   const index=n-(turn===0?2:0);
   if(row.caseId==='P07'&&turn===0&&index<=11)return call('annotation_read',{mode:'draft'});
   if(row.caseId==='P07'&&turn===0&&index===12)return call('spatial_analyze',{operation:'buffer',input:ann,distanceM:700});
   if(row.caseId==='P07'&&turn===1&&index===1)return call('spatial_analyze',{operation:'read',resultRef:buffers[0].resultRef});
   if(row.caseId==='P08'){
    if((turn===0||turn===2)&&index===1)return call('spatial_analyze',{operation:'buffer',input:ann,distanceM:turn===0?700:1200});
    if(turn===1&&index===1)return call('annotation_read',{mode:'draft'});
    if(turn===1&&index===2)return call('annotation_from_analysis',{resultRef:buffers[0].resultRef,layerId:'derived',objectId:'saved-inner',name:'内圈'});
   }
   if(row.caseId==='P12'){
    if(turn===0&&index===1)return call('annotation_read',{mode:'draft'});
    if(turn===0&&index===2)return call('annotation_action',{action:'apply',operations:[{op:'add_object',layerId:'reference',feature:{objectId:'exercise',name:'演练点',kind:'point',geometry:{type:'Point',coordinates:[114,22.51]}}}]});
   }
   return response(row.group,undefined,'离线原生接线检查完成。若需要其他分析，请告知。');
  }catch(e){error=e;throw e;}
 };
 const entries=schedule.filter(e=>['P01','P07','P08','P12'].includes(e.caseId));
 const result=await runLive({directory,port:4737,offline:{entries,claimPath,transport}});assert.equal(error,undefined);assert.equal(result.stop,undefined,JSON.stringify(result));assert.ok(result.rows.every(r=>r.status==='recorded'),JSON.stringify(result));assert.equal(result.total.requests,calls);assert.equal(result.total.unknown,0);assert.equal(existsSync(liveClaim),hadClaim);assert.ok(replays>0);
 for(const row of result.rows){const dir=join(directory,row.id),review=read<{fixture:Prepared;final:SessionSnapshot;after:Prepared['fixture']['before']}>(join(dir,'review.json'));assert.equal(row.completedUserTurns,row.plannedUserTurns);assert.ok(!JSON.stringify(read(join(dir,'judge-input.json'))).includes('PRIVATE_REASONING_TRACE'));assert.ok(!review.final.messages.some(x=>x.text?.includes('PRIVATE_REASONING_TRACE')));
  const runtime=join(directory,'runtime-builds/runtimes',row.group),integrity=read<{before:Record<string,string>;after:Record<string,string>}>(join(runtime,'runtime-integrity.json'));
  for(const path of toolOverlay)assert.equal(integrity.before[path]!==integrity.after[path],candidateTools(row.group));
  for(const id of ['map-annotations','spatial-analysis'])assert.equal(readFileSync(join(runtime,`fixtures/skills/${id}/SKILL.md`),'utf8')!==baselineFile(`fixtures/skills/${id}/SKILL.md`),candidateSkills(row.group));
  if(row.caseId==='P08'){const results=review.final.messages.flatMap(m=>m.spatialResult?[m.spatialResult]:[]),first=results.find(r=>r.parameters.operation==='buffer'&&r.parameters.distanceM===700)!;assert.deepEqual(review.after.version!.document.layers.find(l=>l.layerId==='derived')!.features.find(f=>f.name==='内圈')!.geometry,first.geometry);assert.equal(review.after.version!.document.layers.find(l=>l.layerId==='derived')!.features.length,2);}
  if(row.caseId!=='P01'){const files=await readdir(dir),loading=files.filter(f=>f.endsWith('-loading.json')).sort().map(f=>read<{skills:Record<string,{catalogPresent:boolean;bodyPresent:boolean}>}>(join(dir,f)));for(const id of ['map-annotations','spatial-analysis']){assert.equal(loading[0].skills[id].catalogPresent,true);assert.equal(loading[0].skills[id].bodyPresent,false);assert.ok(loading.some(l=>l.skills[id].bodyPresent));}}
 }
 await assert.rejects(runLive({directory:join(parent,'again'),offline:{entries,claimPath,transport}}),/already claimed/);
});
for(const fault of ['http_error','response_model_drift','missing_usage','truncated'] as const)test(`provider ${fault} preserves first failure and never retries`,{timeout:120000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r15-offline-failure-')),directory=join(parent,'batch'),original=globalThis.fetch;let calls=0;
 const transport:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);calls++;if(fault==='http_error')return new Response('quota blocked',{status:429});const r=fakeResponse(fault==='response_model_drift'?'other':modelConfiguration.G0.responseModel),raw=await r.text();return new Response(fault==='missing_usage'?raw.replace(/,"usage":\{[^}]+\}/g,''):fault==='truncated'?raw.replace('"finish_reason":"stop"','"finish_reason":"length"'):raw,{headers:r.headers});};
 const result=await runLive({directory,port:4737,offline:{entries:schedule.slice(0,4),transport,claimPath:join(parent,'claim.json')}});assert.equal(calls,1);assert.ok(result.stop);assert.ok(result.rows.slice(1).every(r=>r.status==='not_executed'));const ledger=read<{requests:Array<{status:string}>;halted:string}>(join(directory,'ledger.json'));assert.equal(ledger.requests.length,1);assert.equal(ledger.requests[0].status,'failed');assert.ok(ledger.halted);
});
for(const kind of ['plain','api'] as const)test(`unmapped ${kind} clarification remains pending and independent tasks continue`,{timeout:120000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r15-offline-pending-')),directory=join(parent,'batch'),original=globalThis.fetch;let calls=0;
 const transport:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);calls++;const row=read<Array<{group:Group;status:string}>>(join(directory,'runs.json')).find(r=>r.status==='started')!;return kind==='plain'?response(row.group,undefined,'请提供尚未给出的目标坐标才能完成分析。'):response(row.group,{name:'ask_user',arguments:{questions:[{id:'missing',prompt:'请提供尚未给出的目标坐标才能完成分析。'}]}});};
 const result=await runLive({directory,port:4737,offline:{entries:schedule.filter(e=>e.caseId==='P02'),transport,claimPath:join(parent,'claim.json')}});assert.equal(result.stop,undefined,JSON.stringify(result));assert.equal(calls,4);assert.ok(result.rows.every(r=>r.status==='waiting_user'),JSON.stringify(result));
});
test('offline gate requires approval evidence matching exact frozen code',()=>{
 assert.throws(()=>assertExecutionGate({status:'blocked',freezeHash:'f',evidence:['check.md']},'f'));assert.throws(()=>assertExecutionGate({status:'passed',freezeHash:'old',evidence:['check.md']},'new'));assert.throws(()=>assertExecutionGate({status:'passed',freezeHash:'f',evidence:[]},'f'));
});
test('reading an old buffer does not count as a new generation',()=>{
 const first={id:'one',role:'tool',toolName:'spatial_analyze',spatialResult:{operation:'buffer',resultRef:'one',geometry:{type:'Polygon'}}},record={originalUserTurn:0,snapshot:{messages:[first]}} as unknown as {originalUserTurn:number;snapshot:SessionSnapshot};
 const later={originalUserTurn:1,snapshot:{messages:[first,{...first,id:'read',spatialResult:{...first.spatialResult,delivery:{toolCallId:'read'}}}]}} as unknown as typeof record;assert.equal(generatedBuffersInUserTurn(1,[record,later]),0);
});

for(const afterWrite of ['answer','plain','api'] as const)test(`isolated unauthorized write followed by ${afterWrite} still fails only that task`,{timeout:120000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r15-offline-isolated-write-')),directory=join(parent,'batch'),original=globalThis.fetch,counts=new Map<string,number>();
 const transport:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);
  const row=read<Array<{id:string;group:Group;status:string}>>(join(directory,'runs.json')).find(r=>r.status==='started')!,n=(counts.get(row.id)??0)+1;counts.set(row.id,n);
  if(n===1)return response(row.group,{name:'annotation_read',arguments:{mode:'draft'}});
  if(n===2)return response(row.group,{name:'annotation_action',arguments:{action:'apply',operations:[{op:'add_object',layerId:'reference',feature:{objectId:'not-authorized',name:'不应保存',kind:'point',geometry:{type:'Point',coordinates:[114,22.51]}}}]}});
  return afterWrite==='api'?response(row.group,{name:'ask_user',arguments:{questions:[{id:'missing',prompt:'请提供尚未给出的目标坐标才能完成分析。'}]}}):response(row.group,undefined,afterWrite==='plain'?'请提供尚未给出的目标坐标才能完成分析。':'已保存。');
 };
 const result=await runLive({directory,port:4737,offline:{entries:schedule.filter(e=>e.caseId==='P05'),transport,claimPath:join(parent,'claim.json')}});assert.equal(result.stop,undefined,JSON.stringify(result));assert.equal(result.total.requests,12);assert.ok(result.rows.every(r=>r.status==='incomplete'&&r.stopScope==='task'&&r.stop==='unauthorized_draft_change'),JSON.stringify(result));
});
