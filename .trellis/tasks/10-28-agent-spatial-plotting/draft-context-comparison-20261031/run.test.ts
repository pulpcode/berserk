import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {run,schedule,type Decision} from './run.js';
import {oracle,sourceScene} from '../source-generalization-20261030/data.js';
import {initialScope,reply} from '../source-generalization-20261030/clarification.js';
import {Ledger,limits,modelConfiguration} from './budget.js';
const temporary=async()=>join(await mkdtemp(join(tmpdir(),'source-generalization-')),'batch');
const stream=(n:number,text:string,tool?:{name:string;arguments:unknown})=>new Response(`data: ${JSON.stringify({id:'offline-'+n,model:modelConfiguration.A.responseModel,choices:[{index:0,delta:{role:'assistant',reasoning_content:'private synthetic thought',...(tool?{tool_calls:[{index:0,id:'call-'+n,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.arguments)}}]}:{content:text})},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:2000,completion_tokens:100,completion_tokens_details:{reasoning_tokens:5}}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
test('independent axes, redundant cap, exact final budget and no retries',async()=>{
 const o=oracle('G07');const first=reply(o,initialScope(o),{axes:['candidate']});assert.deepEqual(first.state.known,{candidate:'draft'});assert.ok(!first.text.includes('边界'));const second=reply(o,first.state,{axes:['reference']});assert.deepEqual(second.state.known,{candidate:'draft',reference:'source'});assert.equal(reply(o,initialScope(o),{axes:[],generic:true}).coupledSourceQuestion,true);const restated=reply(o,second.state,{axes:['candidate']});assert.throws(()=>reply(o,restated.state,{axes:['reference']}));
 assert.equal(schedule.length,32);assert.equal(new Set(schedule.map(x=>x.id)).size,32);assert.deepEqual(limits,{requests:192,input:6000000,output:400000});
 const d=await mkdtemp(join(tmpdir(),'source-budget-')),l=new Ledger(join(d,'ledger.json'),'fixed');assert.deepEqual(l.totals(),{requests:0,input:0,output:0,unknown:0});assert.throws(()=>l.begin('x','A',6000001));for(let i=0;i<192;i++)l.finish(l.begin('one','A',1),{input:1,output:1});assert.equal(l.read().halted,undefined);assert.throws(()=>l.begin('193','A',1));const bad=new Ledger(join(d,'bad.json'),'fixed');bad.finish(bad.begin('one','A',100),undefined,'provider_http_429');assert.equal(bad.totals().unknown,1);assert.throws(()=>bad.begin('retry','A',1));
});
test('16 A/B real HTTP/Pi executions, 64 combination checks, ordinary and structured replies',{timeout:300000},async()=>{
 const directory=await temporary(),original=globalThis.fetch,counts=new Map<string,number>(),checked:string[]=[];
 const transport:typeof fetch=async(input,init)=>{const u=new URL(input instanceof Request?input.url:String(input));if(!u.hostname.endsWith('volces.com'))return original(input,init);
  const row=(JSON.parse(readFileSync(join(directory,'runs.json'),'utf8')) as Array<{id:string;caseId:string;status:string}>).find(r=>r.status==='started')!;let n=(counts.get(row.id)??0)+1;counts.set(row.id,n);const seq=n;const payload=JSON.parse(String(init?.body));const p=JSON.parse(readFileSync(join(directory,row.id,'fixture.json'),'utf8'));const o=oracle(row.caseId),combos=Object.values(o.combinations);const tool=(name:string,args:unknown)=>stream(seq,'',{name,arguments:args});
  assert.equal(JSON.stringify(payload.messages.filter((m:{role:string})=>m.role==='user')).includes('自动会话草稿上下文（'),row.id.endsWith('-A'));assert.equal(payload.thinking.type,'enabled');assert.equal(payload.reasoning_effort,'high');assert.equal(payload.max_completion_tokens,32768);
  if(n===1){assert.equal(payload.messages.filter((m:{role:string})=>m.role==='assistant'||m.role==='tool').length,0);assert.ok(!JSON.stringify(payload).includes('preferred_scope_if_asked'));assert.ok(!JSON.stringify(payload).includes('g01-d-p03'));}
  if(row.caseId==='G07'){if(n===1)return tool('ask_user',{questions:[{id:'candidate',prompt:'资源点用草稿还是来源？'},{id:'reference',prompt:'区域边界用草稿还是来源？'}]});n--;}
  if(row.caseId==='G08'){if(n===1)return stream(seq,'请明确资源点来源与区域边界分别使用哪一套？');n--;}
  const last=payload.messages.filter((m:{role:string})=>m.role==='tool').at(-1);const lastData=last?JSON.parse(last.content).data:undefined;
  if(n===1)return tool('annotation_read',{mode:'draft',fields:['geometry']});
  if(n===2)return tool('situation_query',{systemId:'situation',mode:'current',limit:100});
  if(n===3)assert.deepEqual(lastData.items,sourceScene(row.caseId).objects);
  if(n>=4){const e=combos[n-4];assert.equal(lastData.values.interior,e.count);assert.equal(lastData.values.boundary,0);checked.push(row.id+':'+(n-4));}
  if(n>=7)return stream(seq,'受控离线流程完成。');
  const e=combos[n-3],ref={setId:p.before.binding.draft.setId,revision:p.before.binding.draft.headRevision};const draft=e.candidate_ids[0].includes('-d-'),targetDraft=e.target_id.includes('-d-');
  return tool('spatial_analyze',{operation:'classify_points',input:draft?{kind:'annotation',ref,objectIds:e.candidate_ids}:{kind:'source',systemId:'situation',objectRefs:e.candidate_ids.map(id=>({systemId:'situation',objectType:'resource',objectId:id}))},target:targetDraft?{kind:'annotation',ref,objectIds:[e.target_id]}:{kind:'source',systemId:'situation',objectRefs:[{systemId:'situation',objectType:'area',objectId:e.target_id}]}});
 };
 const result=await run({directory,mode:'live',port:5408,offline:{transport,ids:schedule.filter(x=>x.repeat===1).map(x=>x.id),decision:async n=>({checkpointHash:String(n.checkpointHash),reviewer:'offline constructed control',reason:'Synthetic protocol branch, not model scoring',action:n.kind==='interaction'||(String(n.id).startsWith('G08-')&&counts.get(String(n.id))===1)?'reply':'finish',...(n.kind==='interaction'?{answers:[{questionId:'candidate',selection:{axes:['candidate']}},{questionId:'reference',selection:{axes:['reference']}}]}:String(n.id).startsWith('G08-')&&counts.get(String(n.id))===1?{selection:{axes:['candidate','reference']}}:{})}) as Decision}});
 assert.equal(result.stop,undefined);assert.equal(result.rows.filter(x=>x.status==='recorded').length,16);assert.equal(checked.length,64);
 for(const row of schedule.filter(x=>x.repeat===1)){const review=JSON.parse(await readFile(join(directory,row.id,'review.json'),'utf8'));assert.deepEqual(review.mapState,review.fixture.before);assert.deepEqual(review.source,review.fixture.sourceBefore);assert.ok(!review.snapshot.messages.some((m:{isError?:boolean})=>m.isError));}
 console.info(JSON.stringify({offlineEvidence:directory,simulatedRequests:result.totals.requests,paidRequests:0,geometryCombinations:checked.length}));
});
test('unknown AskUser and ordinary incomplete answers do not stop following isolated case',{timeout:120000},async()=>{
 const directory=await temporary(),original=globalThis.fetch;
 const transport:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(!url.hostname.endsWith('volces.com'))return original(input,init);const row=(JSON.parse(readFileSync(join(directory,'runs.json'),'utf8')) as Array<{id:string;caseId:string;status:string}>).find(r=>r.status==='started')!;
  return row.caseId==='G01'?stream(1,'',{name:'ask_user',arguments:{questions:[{id:'unrelated',prompt:'请提供另一套未定义业务规则？'}]}}):stream(1,row.caseId==='G07'?'未能完成，需要另一个未定义数据集。':'受控下一题已完成。');};
 const result=await run({directory,mode:'live',port:5408,offline:{transport,ids:['G01-R1-A','G07-R1-B','G04-R1-A'],decision:async n=>({checkpointHash:String(n.checkpointHash),reviewer:'offline constructed control',reason:'Unknown model request is incomplete, not infrastructure failure',action:n.id==='G04-R1-A'?'finish':'fail_task'})}});
 assert.equal(result.stop,undefined);assert.equal(result.rows.filter(r=>r.status==='recorded').length,3);assert.equal(result.rows.find(r=>r.id==='G01-R1-A')?.modelIncomplete,true);assert.equal(result.rows.find(r=>r.id==='G07-R1-B')?.modelIncomplete,true);assert.equal(result.rows.find(r=>r.id==='G04-R1-A')?.modelIncomplete,false);assert.equal(result.totals.requests,3);
 console.info(JSON.stringify({offlineIncompleteEvidence:directory,paidRequests:0}));
});
test('native on-demand Skill body is absent initially and delivered after skill_read',{timeout:60000},async()=>{
 const directory=await temporary(),original=globalThis.fetch;let requests=0;
 const transport:typeof fetch=async(input,init)=>{const u=new URL(input instanceof Request?input.url:String(input));if(!u.hostname.endsWith('volces.com'))return original(input,init);requests++;const payload=JSON.parse(String(init?.body));const body=readFileSync(join(directory,'runtimes/G01-R1-B/G01/fixtures/skills/spatial-analysis/SKILL.md'),'utf8');
  if(requests===1){assert.ok(!JSON.stringify(payload.messages).includes(JSON.stringify(body).slice(1,-1)));return stream(1,'',{name:'skill_read',arguments:{id:'spatial-analysis'}});}
  const message=payload.messages.filter((m:{role:string})=>m.role==='tool').at(-1),result=JSON.parse(message.content);assert.equal(result.content,body);assert.ok(result.hash);return stream(2,'受控Skill读取完成。');};
 const result=await run({directory,mode:'live',port:5408,offline:{transport,ids:['G01-R1-B'],decision:async n=>({checkpointHash:String(n.checkpointHash),reviewer:'offline constructed control',reason:'Skill delivery verified in actual provider input',action:'finish'})}});
 assert.equal(result.stop,undefined);assert.equal(requests,2);console.info(JSON.stringify({offlineSkillEvidence:directory,paidRequests:0}));
});
