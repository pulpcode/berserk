import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {run,structuredAnswers} from './run.js';
import {Ledger,limits} from './budget.js';
import {actualPayload,repeatedToolEvidence} from './provider.js';
import {schedule,specs} from './cases.js';
const temporary=async()=>join(await mkdtemp(join(tmpdir(),'integrated-live-')),'batch');
const stream=(n:number,text:string,tool?:{name:string;arguments:unknown})=>new Response(`data: ${JSON.stringify({id:'offline-'+n,model:'deepseek-v4-1-flash-261017',choices:[{index:0,delta:tool?{role:'assistant',tool_calls:[{index:0,id:'call-'+n,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.arguments)}}]}:{role:'assistant',content:text},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:2000,completion_tokens:100}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
test('exact task schedule and bounded request ledger',async()=>{
 assert.equal(specs.length,12);assert.equal(schedule.length,24);assert.deepEqual(schedule.slice(0,4).map(e=>e.id),['S04-A','S04-B','P02-B','P02-A']);
 const dir=await mkdtemp(join(tmpdir(),'integrated-budget-')),ledger=new Ledger(join(dir,'ledger.json'),'fixed');
 const id=ledger.begin('one','A',1000);assert.throws(()=>ledger.begin('two','B',1000),/unknown/);ledger.finish(id,{input:limits.input-1,output:100});assert.throws(()=>ledger.begin('two','B',1000),/budget_exhausted/);
 const native={model:'deepseek-v4.1-flash',stream:true,messages:[{role:'user',content:'冻结原题'}]};const a=actualPayload(native,'A'),b=actualPayload(native,'B');assert.deepEqual(a,b);assert.deepEqual(a.messages,native.messages);assert.equal(a.thinking?.type,'enabled');assert.equal(a.reasoning_effort,'high');assert.equal(repeatedToolEvidence(native.messages),false);
});
test('all 24 exact fixtures prepare offline and A/B documents match',{timeout:240000},async()=>{
 const directory=await temporary(),result=await run({directory,mode:'prepare',port:5398});assert.equal(result.stop,undefined);assert.equal(result.totals.requests,0);assert.equal(result.rows.filter(r=>r.status==='recorded').length,24);
 for(const c of specs){const a=JSON.parse(await readFile(join(directory,c.id+'-A','fixture.json'),'utf8')),b=JSON.parse(await readFile(join(directory,c.id+'-B','fixture.json'),'utf8'));assert.deepEqual(a.before.version.document,b.before.version.document);assert.deepEqual(a.prompts,b.prompts);assert.deepEqual(a.expected,b.expected);}
 console.info(JSON.stringify({prepareEvidence:directory,slots:24,providerRequests:0}));
});
test('first four native HTTP/Pi cases complete all frozen turns with review and real AskUser',{timeout:240000},async()=>{
 const directory=await temporary(),original=globalThis.fetch,counts=new Map<string,number>(),resultRefs=new Map<string,string>();
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return original(input,init);
  const rows=JSON.parse(readFileSync(join(directory,'runs.json'),'utf8')) as Array<{id:string;status:string}>;const row=rows.find(r=>r.status==='started')!;
  const n=(counts.get(row.id)??0)+1;counts.set(row.id,n);assert.ok(n<=9,'No uncontrolled mock loop');
  const payload=JSON.parse(String(init?.body)),last=payload.messages.filter((m:{role:string})=>m.role==='tool').at(-1),data=last?JSON.parse(last.content).data:undefined;
  const tool=(name:string,args:unknown)=>stream(n,'',{name,arguments:args});
  if(row.id.startsWith('P02')){
   if(n===1)return tool('ask_user',{questions:[{id:'vehicle',prompt:'请选择具体消防车类型。'}]});
   if(n===2)return tool('annotation_read',{mode:'draft'});
   if(n===3)return tool('annotation_action',{action:'apply',operations:[{op:'add_object',layerId:'deployment',feature:{objectId:'new-truck',name:'消防车甲',kind:'point',geometry:{type:'Point',coordinates:[114,22.5]},informationRole:'plan',style:{symbolId:'xf3013-2020.6.2.1'}}}]});
   return stream(n,'已按确认的水罐消防车保存方案，未发布、未采用。');
  }
  if([1,4,7].includes(n))return tool('annotation_read',{mode:'draft',objectIds:['origin'],fields:['geometry']});
  if(n===2||n===5)return tool('spatial_analyze',{operation:'buffer',input:{kind:'annotation',ref:data.ref,objectIds:['origin']},distanceM:n===2?700:1200});
  if(n===3){resultRefs.set(row.id,data.resultRef);return stream(n,'已生成700米预览。是否需要继续筛选？如果需要，我会沿用本次结果。');}
  if(n===6)return stream(n,'1200米范围只预览。');
  if(n===8)return tool('annotation_from_analysis',{resultRef:resultRefs.get(row.id),layerId:'derived',objectId:'guard',name:'值守圈'});
  return stream(n,'已保存最初700米固定范围，未发布、未采用。');
 };
 const result=await run({directory,mode:'live',port:5398,offline:{transport,ids:schedule.slice(0,4).map(e=>e.id),decision:async notice=>({checkpointHash:notice.checkpointHash,reviewer:'controlled-offline-review',reason:'Constructed known response; not model scoring',action:notice.kind==='interaction'?'reply':'advance',...(notice.kind==='interaction'?{replyId:'declared-choice'}:{})})}});
 assert.equal(result.stop,undefined);assert.equal(result.rows.filter(r=>r.status==='recorded').length,4);assert.equal(result.totals.requests,26);
 for(const row of schedule.slice(0,4)){const review=JSON.parse(await readFile(join(directory,row.id,'review.json'),'utf8'));assert.equal(review.snapshot.messages.filter((m:{role:string})=>m.role==='user').length,row.caseId==='S04'?3:1);if(row.caseId==='S04'){const saved=review.mapState.version.document.layers.find((l:{layerId:string})=>l.layerId==='derived').features.find((f:{name:string})=>f.name==='值守圈');const result=review.snapshot.messages.find((m:{spatialResult?:{operation:string}})=>m.spatialResult?.operation==='buffer').spatialResult;assert.deepEqual(saved.geometry,result.geometry);}}
 console.info(JSON.stringify({first4OfflineEvidence:directory,controlledRequests:26,realModelRequests:0}));
});
test('P04 injects real version conflict after read, rereads and preserves external note in both groups',{timeout:180000},async()=>{
 const directory=await temporary(),original=globalThis.fetch,counts=new Map<string,number>();
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return original(input,init);
  const rows=JSON.parse(readFileSync(join(directory,'runs.json'),'utf8')) as Array<{id:string;status:string}>;const row=rows.find(r=>r.status==='started')!;const n=(counts.get(row.id)??0)+1;counts.set(row.id,n);assert.ok(n<=5);
  const payload=JSON.parse(String(init?.body)),last=payload.messages.filter((m:{role:string})=>m.role==='tool').at(-1);const tool=(name:string,args:unknown)=>stream(n,'',{name,arguments:args});
  if(n===1||n===3){if(n===3)assert.match(last.content,/ANNOTATION_CONFLICT/);return tool('annotation_read',{mode:'draft',objectIds:['target'],fields:['style','note','geometry','informationRole','attributes']});}
  if(n===2||n===4){const data=JSON.parse(last.content).data;return tool('annotation_action',{action:'apply',operations:[{op:'update_object',objectId:'target',changes:{style:{...data.objects.items[0].style,heading:90}}}]});}
  return stream(n,'方向改为朝东，保留人工最新备注，未发布。');
 };
 const result=await run({directory,mode:'live',port:5398,offline:{transport,ids:['P04-A','P04-B'],decision:async n=>({checkpointHash:n.checkpointHash,reviewer:'controlled-offline-review',reason:'Constructed successful conflict recovery',action:'advance'})}});
 assert.equal(result.stop,undefined);assert.equal(result.totals.requests,10);
 for(const id of ['P04-A','P04-B']){const r=JSON.parse(await readFile(join(directory,id,'review.json'),'utf8'));assert.equal(r.conflictInjected,true);assert.ok(r.snapshot.messages.some((m:{text:string})=>m.text.includes('ANNOTATION_CONFLICT')));const f=r.mapState.version.document.layers.flatMap((l:{features:unknown[]})=>l.features).find((f:{objectId:string})=>f.objectId==='target');assert.equal(f.style.heading,90);assert.equal(f.note,'人工补充：入口已核实，请保留');}
 console.info(JSON.stringify({conflictOfflineEvidence:directory,controlledRequests:10,realModelRequests:0}));
});
test('S06 source and draft fixtures expose different explicit port counts',{timeout:120000},async()=>{
 const directory=await temporary(),result=await run({directory,mode:'prepare',port:5398,offline:{ids:['S06-A','S06-B'],transport:async()=>{throw new Error('No provider allowed');},decision:async()=>{throw new Error('No decision needed');}}});assert.equal(result.stop,undefined);assert.equal(result.totals.requests,0);
 for(const id of ['S06-A','S06-B']){const p=JSON.parse(await readFile(join(directory,id,'fixture.json'),'utf8'));const resources=p.sourceBefore.objects.filter((o:{ref:{objectType:string};geometry?:{type:string;coordinates:number[]}})=>o.ref.objectType==='resource'&&o.geometry?.type==='Point'&&o.geometry.coordinates[0]>=114&&o.geometry.coordinates[0]<=114.02&&o.geometry.coordinates[1]>=22.5&&o.geometry.coordinates[1]<=22.52);assert.deepEqual(resources.map((r:{name:string})=>r.name),['来源港车甲']);assert.ok(p.sourceBefore.objects.some((r:{name:string})=>r.name==='港区'));assert.equal(p.before.version.document.layers.find((l:{layerId:string})=>l.layerId==='resources').features.length,5);}
 console.info(JSON.stringify({sourceOfflineEvidence:directory,realModelRequests:0}));
});

test('structured replies validate atomically and may reuse one frozen answer within the same interaction',()=>{
 const item={kind:'question',questions:[{id:'coordinate',prompt:'坐标？'},{id:'layer',prompt:'图层？'}]} as Parameters<typeof structuredAnswers>[0],reply=[{id:'details',userTurn:0,text:'[114,22.5]；deployment层',topic:'坐标和图层'}],used=new Set<string>();
 const decision={checkpointHash:'f',reviewer:'offline',reason:'both parameters already explicit',action:'reply' as const,answers:[{questionId:'coordinate',replyId:'details'},{questionId:'layer',replyId:'details'}]};
 const answers=structuredAnswers(item,decision,reply,used);assert.equal(answers.length,2);assert.equal(used.size,1);assert.throws(()=>structuredAnswers(item,decision,reply,used));
 const empty=new Set<string>();assert.throws(()=>structuredAnswers(item,{...decision,answers:[decision.answers[0],{questionId:'layer',replyId:'unknown'}]},reply,empty));assert.equal(empty.size,0);
});
