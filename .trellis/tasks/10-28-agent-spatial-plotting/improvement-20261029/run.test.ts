import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {run,checkFirstSix} from './run.js';
import {Ledger,limits,type Group} from './budget.js';
import {actualPayload,normalizedToolSchema,repeatedToolEvidence} from './provider.js';
import {schedule,specs,layers,repliesFor,inheritance} from './cases.js';
import {repo,candidateRoot,candidateFiles,candidateFile,digest} from './runtime.js';
import * as previous from '../live-20261029/cases.js';
const temporary=async()=>join(await mkdtemp(join(tmpdir(),'integrated-improvement-')),'batch');
const groups:Group[]=['G0','G1','G2'];
test('48 slots, exact inherited tasks/candidate edits and approved budget',async()=>{
 assert.equal(specs.length,8);assert.equal(schedule.length,48);assert.equal(new Set(schedule.map(r=>r.id)).size,48);
 assert.deepEqual(schedule.slice(0,6).map(r=>r.id),['T01-R1-G0','T01-R1-G1','T01-R1-G2','T07-R1-G1','T07-R1-G2','T07-R1-G0']);
 for(const s of specs){for(const g of groups)assert.equal(schedule.filter(r=>r.caseId===s.id&&r.group===g).length,2);if(s.origin==='inherited'){const original=previous.specs.find(o=>o.id===inheritance[s.id])!;assert.deepEqual(s.prompts,original.prompts);assert.deepEqual(s.expected,original.expected);assert.deepEqual(repliesFor(s.id),previous.repliesFor(original.id));assert.deepEqual(layers(s.id),previous.layers(original.id));}}
 execFileSync('git',['diff','--exit-code','74986e0','ecff604','--','experiments/harness-lab/src','experiments/harness-lab/scripts','experiments/harness-lab/fixtures','experiments/harness-lab/package.json','experiments/harness-lab/package-lock.json','experiments/harness-lab/tsconfig.json'],{cwd:repo});
 const manifest=JSON.parse(readFileSync(join(candidateRoot,'../candidate-manifest.json'),'utf8'));
 for(const p of candidateFiles){let expected=candidateFile('G0',p);for(const phase of ['decision','explanation']){for(const change of manifest.changes.filter((c:{phase:string;file:string})=>c.phase===phase&&c.file===p)){assert.equal(expected.split(change.old).length,2);expected=expected.replace(change.old,change.new);}assert.equal(expected,candidateFile(phase==='decision'?'G1':'G2',p));}}
 for(const g of groups)for(const p of candidateFiles)assert.equal(digest(candidateFile(g,p)),manifest.groups[g][p]);
 for(const p of candidateFiles.filter(p=>p.endsWith('SKILL.md')))for(const g of groups)assert.equal(candidateFile(g,p).split('---')[1],candidateFile('G0',p).split('---')[1]);
 for(const p of candidateFiles.filter(p=>p.endsWith('.ts')))assert.equal(candidateFile('G1',p),candidateFile('G2',p));
 assert.deepEqual(limits,{requests:360,input:8000000,output:200000});const dir=await mkdtemp(join(tmpdir(),'improvement-budget-')),ledger=new Ledger(join(dir,'ledger.json'),'fixed');
 for(let i=0;i<360;i++){const id=ledger.begin('one','G0',1);ledger.finish(id,{input:1,output:1});}assert.throws(()=>ledger.begin('over','G2',1),/halted/);
 const output=new Ledger(join(dir,'output.json'),'fixed');output.finish(output.begin('one','G0',1),{input:1,output:167233});assert.throws(()=>output.begin('over','G1',1),/budget_exhausted/);
 const unknown=new Ledger(join(dir,'unknown.json'),'fixed');unknown.finish(unknown.begin('one','G1',1),undefined,'provider_http_429');assert.throws(()=>unknown.begin('retry','G1',1));
 const native={model:'deepseek-v4.1-flash',stream:true,messages:[{role:'user',content:'unchanged'}]};for(const g of groups){const wire=actualPayload(native,g);assert.deepEqual(wire,actualPayload(native,'G0'));assert.deepEqual(wire.messages,native.messages);assert.equal(wire.thinking?.type,'enabled');assert.equal(wire.reasoning_effort,'high');}
});
test('all48 isolated fixtures prepare without provider requests',{timeout:300000},async()=>{
 const directory=await temporary(),result=await run({directory,mode:'prepare',port:5398});assert.equal(result.stop,undefined);assert.equal(result.totals.requests,0);assert.equal(result.rows.filter(r=>r.status==='recorded').length,48);
 const ids=new Set<string>();for(const row of schedule){const p=JSON.parse(await readFile(join(directory,row.id,'fixture.json'),'utf8'));assert.ok(!ids.has(p.sessionId));ids.add(p.sessionId);assert.deepEqual(p.before.version.document.layers,layers(row.caseId));assert.deepEqual(p.prompts,specs.find(s=>s.id===row.caseId)!.prompts);assert.deepEqual(p.replies,repliesFor(row.caseId));if(row.caseId==='T03'||row.caseId==='T04'){assert.ok(p.sourceBefore.objects.some((o:{name:string})=>o.name==='港区'));assert.ok(p.sourceBefore.objects.some((o:{name:string})=>o.name==='来源港车甲'));}}
 console.info(JSON.stringify({prepareEvidence:directory,slots:48,realRequests:0}));
});
const stream=(n:number,text:string,tool?:{name:string;arguments:unknown})=>new Response(`data: ${JSON.stringify({id:'offline-'+n,model:'deepseek-v4-1-flash-261017',choices:[{index:0,delta:tool?{role:'assistant',tool_calls:[{index:0,id:'call-'+n,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.arguments)}}]}:{role:'assistant',content:text},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:2000,completion_tokens:100}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
test('native three-group Skill delivery, six-slot gate, clarification, fixed save and ordinary circle',{timeout:240000},async()=>{
 const directory=await temporary(),original=globalThis.fetch,counts=new Map<string,number>(),refs=new Map<string,string>();
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return original(input,init);
  const row=(JSON.parse(readFileSync(join(directory,'runs.json'),'utf8')) as Array<{id:string;caseId:string;group:Group;status:string}>).find(r=>r.status==='started')!;const n=(counts.get(row.id)??0)+1;counts.set(row.id,n);assert.ok(n<=8);
  if(row.id===schedule[6].id)return stream(n,'受控终态，用于门禁检查，不代表任务正确。');
  const payload=JSON.parse(String(init?.body)),last=payload.messages.filter((m:{role:string})=>m.role==='tool').at(-1),data=last?JSON.parse(last.content).data:undefined;const tool=(name:string,args:unknown)=>stream(n,'',{name,arguments:args});
  const skill=row.caseId==='T07'||row.caseId==='T04'?'spatial-analysis':'map-annotations';
  if(n===1)return tool('skill_read',{id:skill});
  if(n===2){const content=candidateFile(row.group,`fixtures/skills/${skill}/SKILL.md`);assert.ok(last.content.includes(content)||last.content.includes(JSON.stringify(content).slice(1,-1)),'actual Skill body missing');}
  if(row.caseId==='T01'){if(n===2)return tool('ask_user',{questions:[{id:'vehicle',prompt:'请选择具体消防车类型。'}]});if(n===3)return tool('annotation_read',{mode:'draft'});if(n===4)return tool('annotation_action',{action:'apply',operations:[{op:'add_object',layerId:'deployment',feature:{objectId:'new-truck',name:'消防车甲',kind:'point',geometry:{type:'Point',coordinates:[114,22.5]},informationRole:'plan',style:{symbolId:'xf3013-2020.6.2.1'}}}]});return stream(n,'水罐消防车方案已保存。');}
  if(row.caseId==='T05'){if(n===2)return tool('annotation_read',{mode:'draft'});if(n===3)return tool('annotation_action',{action:'apply',operations:[{op:'add_object',layerId:'deployment',feature:{objectId:'ordinary',name:'消防车甲',kind:'point',geometry:{type:'Point',coordinates:[114,22.5]},informationRole:'plan',style:{symbol:'circle'}}}]});return stream(n,'普通圆点方案已保存。');}
  if(row.caseId==='T04'){if(n===2)return tool('annotation_read',{mode:'draft',fields:['geometry']});if(n===3)return tool('spatial_analyze',{operation:'filter',input:{kind:'annotation',ref:data.ref,layerIds:['resources']},spatial:{target:{kind:'annotation',ref:data.ref,objectIds:['harbor']},relation:'contains'}});return stream(n,'草稿港区内4点：岸边甲、栈桥乙、码头丙、港池丁。');}
  if(n===2||n===5)return tool('annotation_read',{mode:'draft',objectIds:['origin'],fields:['geometry']});
  if(n===3)return tool('spatial_analyze',{operation:'buffer',input:{kind:'annotation',ref:data.ref,objectIds:['origin']},distanceM:700});
  if(n===4){refs.set(row.id,data.resultRef);return stream(n,'700米预览完成。还需要保存吗？');}
  if(n===6)return tool('annotation_from_analysis',{resultRef:refs.get(row.id),layerId:'derived',objectId:'saved',name:'临时范围'});
  if(n===7)return tool('annotation_action',{action:'apply',operations:[{op:'update_object',objectId:'saved',changes:{informationRole:'plan',note:'待核实'}}]});
  return stream(n,'固定700米范围已保存为方案，备注待核实。');
 };
 const chosen=[...schedule.slice(0,7).map(r=>r.id),'T04-R1-G2','T05-R1-G2'];let browser=0,gate=0;
 const result=await run({directory,mode:'live',port:5398,offline:{transport,ids:chosen,decision:async n=>{if(n.kind==='browser')browser++;if(n.kind==='first6')gate++;return {checkpointHash:n.checkpointHash,reviewer:'controlled-offline',reason:'Known mock flow; not model scoring',action:n.kind==='interaction'?'reply':'advance',...(n.kind==='interaction'?{replyId:'declared-choice'}:{}),...(n.kind==='browser'?{checked:true}:{}),...(n.kind==='first6'?{pass:true}:{})};}}});
 assert.equal(result.stop,undefined);assert.equal(browser,3);assert.equal(gate,1);assert.equal(result.rows.filter(r=>r.status==='recorded').length,9);
 for(const id of chosen.filter(id=>id.startsWith('T01')||id.startsWith('T07'))){const r=JSON.parse(await readFile(join(directory,id,'review.json'),'utf8'));assert.equal(r.snapshot.messages.filter((m:{role:string})=>m.role==='user').length,id.startsWith('T07')?2:1);assert.ok(!r.snapshot.messages.some((m:{isError?:boolean})=>m.isError));if(id.startsWith('T01'))assert.equal(r.interactions.length,1);else{const saved=r.mapState.version.document.layers.find((l:{layerId:string})=>l.layerId==='derived').features.find((f:{objectId:string})=>f.objectId==='saved');assert.equal(saved.note,'待核实');assert.equal(saved.informationRole,'plan');const preview=r.snapshot.messages.find((m:{spatialResult?:unknown})=>m.spatialResult).spatialResult;assert.deepEqual(saved.geometry,preview.geometry);}}
 const circle=JSON.parse(await readFile(join(directory,'T05-R1-G2','review.json'),'utf8')).mapState.version.document.layers[0].features.find((f:{objectId:string})=>f.objectId==='ordinary');assert.equal(circle.style.symbol,'circle');assert.equal(circle.style.symbolId,undefined);assert.equal(circle.informationRole,'plan');
 const filterReview=JSON.parse(await readFile(join(directory,'T04-R1-G2','review.json'),'utf8'));assert.ok(!filterReview.snapshot.messages.some((m:{isError?:boolean})=>m.isError));const filtered=filterReview.snapshot.messages.find((m:{spatialResult?:{operation?:string}})=>m.spatialResult?.operation==='filter').spatialResult;assert.equal(filtered.items.length,4);assert.deepEqual(filtered.items.map((i:{name:string})=>i.name).sort(),['岸边甲','栈桥乙','码头丙','港池丁'].sort());
 const schemas=await Promise.all(groups.map(g=>readFile(join(directory,`T01-R1-${g}`,'parent-schema-turn-1.json'),'utf8').then(s=>JSON.parse(s))));assert.equal(schemas[0].normalizedSchemaHash,schemas[1].normalizedSchemaHash);assert.equal(schemas[1].rawSchemaHash,schemas[2].rawSchemaHash);assert.notEqual(schemas[0].rawSchemaHash,schemas[1].rawSchemaHash);assert.throws(()=>normalizedToolSchema(schemas[1].tools,{},'G0'),/unapproved/);
 console.info(JSON.stringify({nativeOfflineEvidence:directory,controlledRequests:result.totals.requests,realRequests:0}));
});

test('flow gate rejects absent/false/stale approval and repeated unchanged tool evidence stops',()=>{
 const valid={checkpointHash:'fixed',reviewer:'offline-reviewer',reason:'Verified mechanics, business scores separate',pass:true};checkFirstSix(valid,'fixed');assert.throws(()=>checkFirstSix({...valid,pass:false},'fixed'));assert.throws(()=>checkFirstSix({...valid,checkpointHash:'stale'},'fixed'));assert.throws(()=>checkFirstSix({...valid,reviewer:''},'fixed'));
 const exchanges=[1,2,3].flatMap(n=>[{role:'assistant',tool_calls:[{id:'c'+n,function:{name:'annotation_read',arguments:JSON.stringify({mode:'draft'})}}]},{role:'tool',tool_call_id:'c'+n,content:JSON.stringify({data:{count:0},requestId:'r'+n,toolCallId:'c'+n})}]);assert.equal(repeatedToolEvidence(exchanges),true);assert.equal(repeatedToolEvidence(exchanges.slice(0,4)),false);assert.equal(repeatedToolEvidence([...exchanges,{role:'user',content:'New task'}]),false);
});
