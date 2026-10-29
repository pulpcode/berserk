import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {run} from './run.js';
import {Ledger,limits} from './budget.js';
import {actualPayload} from './provider.js';
import {schedule,specs,layers,repliesFor} from './cases.js';
import * as previous from '../live-20261029/cases.js';
const temporary=async()=>join(await mkdtemp(join(tmpdir(),'integrated-repeat-')),'batch');
test('30 independent slots reuse frozen cases; payload and aggregate budget are exact',async()=>{
 assert.equal(specs.length,5);assert.equal(schedule.length,30);assert.equal(new Set(schedule.map(r=>r.id)).size,30);
 assert.deepEqual(schedule.slice(0,4).map(r=>r.id),['P02-R1-A','P02-R1-B','S02-R1-B','S02-R1-A']);
 for(const s of specs){assert.deepEqual(s,previous.specs.find(o=>o.id===s.id));assert.equal(layers,previous.layers);assert.equal(repliesFor,previous.repliesFor);for(const g of ['A','B'])assert.equal(schedule.filter(r=>r.caseId===s.id&&r.group===g).length,3);}
 assert.deepEqual(limits,{requests:240,input:6000000,output:150000});
 const dir=await mkdtemp(join(tmpdir(),'repeat-budget-'));const ledger=new Ledger(join(dir,'ledger.json'),'fixed');
 for(let i=0;i<240;i++){const id=ledger.begin('one','A',1);ledger.finish(id,{input:1,output:1});}assert.equal(ledger.totals().requests,240);assert.throws(()=>ledger.begin('over','A',1));
 const output=new Ledger(join(dir,'output.json'),'fixed');output.finish(output.begin('one','A',1),{input:1,output:117233});assert.throws(()=>output.begin('over','B',1),/budget_exhausted/);
 const native={model:'deepseek-v4.1-flash',stream:true,messages:[{role:'user',content:'unchanged'}]};const a=actualPayload(native,'A');assert.deepEqual(a,actualPayload(native,'B'));assert.deepEqual(a.messages,native.messages);assert.equal(a.thinking?.type,'enabled');assert.equal(a.reasoning_effort,'high');
});
test('all30 fixtures are identical to original and use independent sessions without model calls',{timeout:240000},async()=>{
 const directory=await temporary(),result=await run({directory,mode:'prepare',port:5398});assert.equal(result.stop,undefined);assert.equal(result.totals.requests,0);assert.equal(result.rows.filter(r=>r.status==='recorded').length,30);
 const ids=new Set<string>();for(const row of schedule){const p=JSON.parse(await readFile(join(directory,row.id,'fixture.json'),'utf8'));assert.ok(!ids.has(p.sessionId));ids.add(p.sessionId);assert.deepEqual(p.before.version.document.layers,previous.layers(row.caseId));assert.deepEqual(p.prompts,previous.specs.find(s=>s.id===row.caseId)!.prompts);assert.deepEqual(p.replies,previous.repliesFor(row.caseId));assert.deepEqual(p.expected,previous.specs.find(s=>s.id===row.caseId)!.expected);}
 console.info(JSON.stringify({prepareEvidence:directory,slots:30,realRequests:0}));
});
const stream=(n:number,text:string,tool?:{name:string;arguments:unknown})=>new Response(`data: ${JSON.stringify({id:'offline-'+n,model:'deepseek-v4-1-flash-261017',choices:[{index:0,delta:tool?{role:'assistant',tool_calls:[{index:0,id:'call-'+n,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.arguments)}}]}:{role:'assistant',content:text},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:2000,completion_tokens:100}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
test('reused native loop handles clarification and P05 saved-object browser gate in both groups',{timeout:180000},async()=>{
 const directory=await temporary(),original=globalThis.fetch,counts=new Map<string,number>(),refs=new Map<string,string>();
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return original(input,init);
  const row=(JSON.parse(readFileSync(join(directory,'runs.json'),'utf8')) as Array<{id:string;status:string}>).find(r=>r.status==='started')!;const n=(counts.get(row.id)??0)+1;counts.set(row.id,n);assert.ok(n<=6);
  const payload=JSON.parse(String(init?.body)),last=payload.messages.filter((m:{role:string})=>m.role==='tool').at(-1),data=last?JSON.parse(last.content).data:undefined;const tool=(name:string,args:unknown)=>stream(n,'',{name,arguments:args});
  if(row.id.startsWith('P02')){if(n===1)return tool('ask_user',{questions:[{id:'vehicle',prompt:'请选择具体消防车类型。'}]});if(n===2)return tool('annotation_read',{mode:'draft'});if(n===3)return tool('annotation_action',{action:'apply',operations:[{op:'add_object',layerId:'deployment',feature:{objectId:'new-truck',name:'消防车甲',kind:'point',geometry:{type:'Point',coordinates:[114,22.5]},informationRole:'plan',style:{symbolId:'xf3013-2020.6.2.1'}}}]});return stream(n,'已按水罐消防车保存方案。');}
  if(n===1||n===4)return tool('annotation_read',{mode:'draft',objectIds:['origin'],fields:['geometry']});
  if(n===2)return tool('spatial_analyze',{operation:'buffer',input:{kind:'annotation',ref:data.ref,objectIds:['origin']},distanceM:700});
  if(n===3){refs.set(row.id,data.resultRef);return stream(n,'700米预览完成。还需要保存吗？');}
  if(n===5)return tool('annotation_from_analysis',{resultRef:refs.get(row.id),layerId:'derived',objectId:'saved',name:'临时范围'});
  return stream(n,'固定结果已保存。');
 };
 const chosen=['P02-R1-A','P02-R1-B','P05-R1-A','P05-R1-B'];let browser=0;
 const result=await run({directory,mode:'live',port:5398,offline:{transport,ids:chosen,decision:async n=>{if(n.kind==='browser')browser++;return {checkpointHash:n.checkpointHash,reviewer:'controlled-offline',reason:'Known mocked terminal, no semantic success claim',action:n.kind==='interaction'?'reply':'advance',...(n.kind==='interaction'?{replyId:'declared-choice'}:{}),...(n.kind==='browser'?{checked:true}:{})};}}});
 assert.equal(result.stop,undefined);assert.equal(result.totals.requests,20);assert.equal(browser,2);assert.equal(result.rows.filter(r=>r.status==='recorded').length,4);
 for(const id of chosen){const r=JSON.parse(await readFile(join(directory,id,'review.json'),'utf8'));assert.equal(r.snapshot.messages.filter((m:{role:string})=>m.role==='user').length,id.startsWith('P05')?2:1);if(id.startsWith('P02'))assert.equal(r.interactions.length,1);else{const saved=r.mapState.version.document.layers.find((l:{layerId:string})=>l.layerId==='derived').features.find((f:{objectId:string})=>f.objectId==='saved');assert.ok(saved);const preview=r.snapshot.messages.find((m:{spatialResult?:unknown})=>m.spatialResult).spatialResult;assert.deepEqual(saved.geometry,preview.geometry);}}
 console.info(JSON.stringify({nativeOfflineEvidence:directory,controlledRequests:20,realRequests:0}));
});
