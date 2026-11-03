import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readdir} from 'node:fs/promises';
import {readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runLive,liveClaim,availableBufferResults} from './live.js';
import {schedule,type Prepared} from './cases.js';
import {loopbackOnly} from './runtime.js';
import {responseModel} from './budget.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
import type {Payload} from '../r12-20261025/reasoning-prepare.js';
import {mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import type {SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
const read=<T>(p:string)=>JSON.parse(readFileSync(p,'utf8')) as T;
async function response(thinking:boolean,call?:{name:string;arguments:unknown},text?:string){const r=fakeResponse(responseModel,call,text),raw=await r.text();return new Response(raw.replace('"delta":{','"delta":{'+(thinking?'"reasoning_content":"PRIVATE_REASONING_TRACE",':'')),{headers:r.headers});}
test('live missing freeze refuses before secret access, mock claim cannot consume live entry',async()=>{
 let reads=0;const env=new Proxy({},{get(){reads++;throw new Error('secret read');}}) as NodeJS.ProcessEnv;
 await assert.rejects(runLive({directory:'/tmp/r13-no-entry',env}),/requires frozen source/);assert.equal(reads,0);assert.equal(existsSync('/tmp/r13-no-entry'),false);
});
test('ten real native SDK trials execute tools, replay private reasoning, correct parameters, and finish dependent turns',{timeout:600000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r13-offline-complete-')),directory=join(parent,'batch'),claimPath=join(parent,'claim.json'),original=globalThis.fetch,hadLiveClaim=existsSync(liveClaim);let calls=0,scriptError:unknown,sameTurnReplay=0,newTurnReplay=0;const counts=new Map<string,number>();
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);calls++;
  const payload=JSON.parse(String(init?.body)) as Payload,row=read<Array<{id:string;caseId:string;group:string;status:string}>>(join(directory,'runs.json')).find(r=>r.status==='started')!,dir=join(directory,row.id),p=read<Prepared>(join(dir,'fixture.json')),m=read<Parameters<typeof mapTrialRequest>[0]>(join(dir,'manifest.json')),turn=read<Array<{turn:number}>>(join(directory,'attempts.json')).at(-1)!.turn;
  const n=(counts.get(row.id+':'+turn)??0)+1;counts.set(row.id+':'+turn,n);
  try{
   assert.equal(payload.max_tokens,32768);assert.equal(payload.top_p,1);assert.equal('temperature'in payload,false);assert.deepEqual(payload.thinking,{type:row.group==='E0'?'disabled':'enabled'});assert.equal(payload.reasoning_effort,row.group==='E0'?undefined:'high');
   const currentUser=payload.messages.findLastIndex(x=>x.role==='user');
   for(const [i,msg] of payload.messages.entries())if(msg.role==='assistant'&&msg.reasoning_content){assert.equal(row.group,'E1');assert.equal(msg.reasoning_content,'PRIVATE_REASONING_TRACE');assert.ok(!String(msg.content).includes('PRIVATE_REASONING_TRACE'));if(i>currentUser)sameTurnReplay++;else newTurnReplay++;}
   if(turn===0&&n===1){for(const id of ['map-annotations','spatial-analysis'])assert.ok(!payload.messages.map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n').includes(readFileSync(join(directory,'runtime-builds/runtimes',row.group,'fixtures/skills',id,'SKILL.md'),'utf8')));assert.ok(existsSync(join(directory,row.caseId+'-pair.json')));}
   const call=(name:string,args:unknown)=>response(row.group==='E1',{name,arguments:args});
   const snapshot=await mapTrialRequest<SessionSnapshot>(m,`/api/sessions/${p.fixture.sessionId}`,'planning'),buffers=snapshot.messages.flatMap(x=>x.spatialResult?.operation==='buffer'?[x.spatialResult]:[]),ref=p.fixture.before.version!.ref;
   const ann=(objectIds:string[])=>({kind:'annotation',ref,objectIds}),candidates={kind:'annotation',ref,layerIds:['resources']},index=n-(turn===0?2:0);
   if(turn===0&&n<=2)return call('skill_read',{id:n===1?'map-annotations':'spatial-analysis'});
   if(row.caseId==='F01'&&index===1)return call('situation_query',{systemId:'situation',mode:'current',objectRefs:[m.objects.resource]});
   if(row.caseId==='F02'&&index===1){if(turn<2)return call('spatial_analyze',{operation:'buffer',input:ann(['origin']),distanceM:turn===0?500:1500});return call('spatial_analyze',{operation:'filter',input:candidates,spatial:{relation:'contains',target:{kind:'result',resultRef:buffers[0].resultRef,geometry:true}}});}
   if(row.caseId==='F03'&&index===1)return call('spatial_analyze',{operation:'nearest',input:candidates,target:ann(['origin']),count:'invalid-number'});
   if(row.caseId==='F03'&&index===2){assert.ok(snapshot.messages.some(x=>x.toolName==='spatial_analyze'&&x.isError));return call('spatial_analyze',{operation:'nearest',input:candidates,target:ann(['origin']),count:2});}
   if(row.caseId==='F04'){if(turn===0&&index===1)return call('spatial_analyze',{operation:'buffer',input:ann(['origin']),distanceM:500});if(turn===1&&index===1)return call('annotation_read',{mode:'draft'});if(turn===1&&index===2)return call('annotation_from_analysis',{resultRef:buffers[0].resultRef,layerId:'derived',objectId:'saved-range',name:'临时范围'});}
   if(row.caseId==='F05'&&index===1)return call('spatial_analyze',{operation:'filter',input:candidates,spatial:{relation:'contains',target:ann(['region'])}});
   return response(row.group==='E1',undefined,'离线真实工具接线检查；不计模型正确率。');
  }catch(e){scriptError=e;throw e;}
 };
 const result=await runLive({directory,port:4677,offline:{claimPath,transport}});assert.equal(scriptError,undefined);assert.equal(result.stop,undefined,JSON.stringify(result));assert.ok(result.rows.every(r=>r.status==='recorded'),JSON.stringify(result));assert.equal(result.total.requests,calls);assert.equal(existsSync(liveClaim),hadLiveClaim);assert.ok(sameTurnReplay>0);assert.ok(newTurnReplay>0);
 const sessions=new Set<string>();for(const row of result.rows){const dir=join(directory,row.id),review=read<{fixture:Prepared;final:SessionSnapshot;after:Prepared['fixture']['before']}>(join(dir,'review.json'));sessions.add(review.fixture.fixture.sessionId);assert.equal(row.completedUserTurns,row.plannedUserTurns);assert.ok(!JSON.stringify(read(join(dir,'judge-input.json'))).includes('PRIVATE_REASONING_TRACE'));assert.ok(!review.final.messages.some(x=>x.text?.includes('PRIVATE_REASONING_TRACE')));
  const results=review.final.messages.flatMap(m=>m.spatialResult?[m.spatialResult]:[]);
  if(row.caseId==='F02'){assert.equal(results.at(-1)!.items.length,0);assert.equal(results.filter(r=>r.operation==='buffer').length,2);}
  if(row.caseId==='F03')assert.deepEqual(results.at(-1)!.items.map(i=>i.annotation!.objectId),['r1','r2']);
  if(row.caseId==='F04')assert.deepEqual(review.after.version!.document.layers.find(l=>l.layerId==='derived')!.features[0].geometry,results[0].geometry);
  if(row.caseId==='F05')assert.equal(results.at(-1)!.items.length,4);
  const files=await readdir(dir);assert.ok(files.some(f=>f.endsWith('-loading.json')));assert.ok(files.includes('native-sessions'));const loading=files.filter(f=>f.endsWith('-loading.json')).sort().map(f=>read<{skills:Record<string,{catalogPresent:boolean;bodyPresent:boolean}>}>(join(dir,f)));for(const id of ['map-annotations','spatial-analysis']){assert.equal(loading[0].skills[id].catalogPresent,true);assert.equal(loading[0].skills[id].bodyPresent,false);assert.ok(loading.some(l=>l.skills[id].bodyPresent));}
 }
 assert.equal(sessions.size,10);await assert.rejects(runLive({directory:join(parent,'another'),port:4677,offline:{claimPath,transport}}),/already claimed/);assert.equal(result.total.unknown,0);
});
for(const fault of ['http_error','response_model_drift','missing_usage','truncated'] as const)test(`native failure ${fault} preserves one attempt and stops batch without retry`,{timeout:120000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r13-offline-failure-')),directory=join(parent,'batch'),original=globalThis.fetch;let calls=0;
 const transport:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);calls++;if(fault==='http_error')return new Response('quota blocked',{status:429});const r=fakeResponse(fault==='response_model_drift'?'other':responseModel),raw=await r.text();return new Response(fault==='missing_usage'?raw.replace(/,"usage":\{[^}]+\}/g,''):fault==='truncated'?raw.replace('"finish_reason":"stop"','"finish_reason":"length"'):raw,{headers:r.headers});};
 const result=await runLive({directory,port:4677,offline:{entries:schedule.slice(0,2),transport,claimPath:join(parent,'claim.json')}});assert.equal(calls,1);assert.ok(result.stop);assert.equal(result.rows[1].status,'not_executed');const ledger=read<{requests:Array<{status:string;reason?:string}>;halted:string}>(join(directory,'ledger.json'));assert.equal(ledger.requests.length,1);assert.equal(ledger.requests[0].status,'failed');assert.ok(ledger.halted);if(fault==='truncated')assert.equal(ledger.requests[0].reason,'output_truncated');
});
for(const scenario of ['missing_dependency','unknown_question','technical_error'] as const)test(`native task boundary ${scenario} does not fabricate the next user turn`,{timeout:120000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r13-offline-boundary-')),directory=join(parent,'batch'),original=globalThis.fetch;let calls=0;
 const transport:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com'){
   if(scenario==='technical_error'&&url.pathname.endsWith('/messages')&&init?.method==='POST')return new Response('local failure',{status:500});
   return loopbackOnly(original)(input,init);
  }calls++;return fakeResponse(responseModel,undefined,scenario==='unknown_question'?'请提供尚未提供的起点坐标？':'可以生成范围。');};
 const result=await runLive({directory,port:4677,offline:{entries:schedule.filter(e=>e.caseId==='F04'),transport,claimPath:join(parent,'claim.json')}});
 if(scenario==='technical_error'){assert.ok(result.stop);assert.equal(calls,0);assert.equal(result.rows[1].status,'not_executed');}else{assert.equal(result.stop,undefined);assert.equal(calls,2);assert.ok(result.rows.every(r=>r.status===(scenario==='unknown_question'?'waiting_user':'incomplete')));assert.ok(result.rows.every(r=>r.completedUserTurns<r.plannedUserTurns));}
});
test('ordinary and interaction API clarification repeat only original authorized prompt then continue tools',{timeout:120000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r13-offline-clarification-')),directory=join(parent,'batch'),original=globalThis.fetch,counts=new Map<string,number>();
 const transport:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);
  const row=read<Array<{id:string;group:string;status:string}>>(join(directory,'runs.json')).find(r=>r.status==='started')!,dir=join(directory,row.id),p=read<Prepared>(join(dir,'fixture.json')),m=read<Parameters<typeof mapTrialRequest>[0]>(join(dir,'manifest.json')),n=(counts.get(row.id)??0)+1;counts.set(row.id,n);
  if(n===1)return row.group==='E0'?response(false,{name:'ask_user',arguments:{questions:[{id:'source',prompt:'请确认使用来源系统的资源点统计车辆？'}]}}):response(true,undefined,'请确认使用来源系统的资源点统计车辆？');
  if(n===2)return response(row.group==='E1',{name:'situation_query',arguments:{systemId:'situation',mode:'current',objectRefs:[m.objects.resource]}});
  const payload=JSON.parse(String(init?.body)) as Payload;assert.ok(JSON.stringify(payload.messages).includes(p.prompts[0]));return response(row.group==='E1',undefined,'离线工具接线完成。');
 };
 const result=await runLive({directory,port:4677,offline:{entries:schedule.slice(0,2),transport,claimPath:join(parent,'claim.json')}});assert.equal(result.stop,undefined);assert.ok(result.rows.every(r=>r.status==='recorded'));assert.equal(result.total.requests,6);
 const api=read<{interactions:Array<{scriptedResponse?:unknown}>}>(join(directory,'F01-E0/review.json'));assert.ok(api.interactions[0].scriptedResponse);
 const plain=read<{response:string}>(join(directory,'F01-E1/scripted-plain-clarification.json')),p=read<Prepared>(join(directory,'F01-E1/fixture.json'));assert.equal(plain.response,p.prompts[0]);
});

test('dependent turns require distinct real results, reading an old buffer again does not invent a second range',()=>{
 const original={id:'a',role:'tool',toolName:'spatial_analyze',spatialResult:{operation:'buffer',resultRef:'first',geometry:{type:'Polygon'}}};
 assert.equal(availableBufferResults([original,{...original,id:'read-back'}]),1);
 assert.equal(availableBufferResults([original,{...original,id:'b',spatialResult:{...original.spatialResult,resultRef:'second'}}]),2);
 assert.equal(availableBufferResults([{...original,isError:true}]),0);
});
