/** Offline replay only. This repair neither restarts R14 nor awards semantic passes. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {cases,plainClarificationKind,plainClarificationEvidence,clarificationResponse,criticalEffect,type Prepared} from './cases.js';
import {repo,digest} from './runtime.js';
import type {SessionSnapshot,Interaction} from '../../../../experiments/harness-lab/src/contracts/index.js';
const directory=join(repo,'.local/spatial-r14/closeout-second-20261026');
const prepared=(id:string)=>({caseId:id,prompts:cases.find(c=>c.id===id)!.prompts}) as Prepared;
const snapshot=(text:string)=>({messages:[{role:'assistant',text}]}) as SessionSnapshot;
const kind=(text:string,id='D10',turn=0)=>plainClarificationKind(prepared(id),snapshot(text),turn);
for(const [id,userTurn] of [['D09-1-A',2],['D10-1-A',0],['D10-1-B',1]] as const)test(`complete historical ${id} response permits next planned user turn without changing evidence`,()=>{
 const path=join(directory,id,'review.json'),before=readFileSync(path),raw=JSON.parse(before.toString()) as {fixture:Prepared;final:SessionSnapshot;turns:unknown[]};
 assert.equal(raw.turns.length,userTurn+1);assert.equal(plainClarificationKind(raw.fixture,raw.final,userTurn),'none');
 assert.ok(plainClarificationEvidence(raw.fixture,raw.final,userTurn).some(e=>e.reason==='assistant_optional_followup_offer'));assert.equal(digest(readFileSync(path)),digest(before));
});
test('offer recognition is independent of operation and object words, question or closing invitation',()=>{
 for(const work of ['把这个范围用于筛选草稿里的比较点','保留这两个范围','改用1200米范围判断各比较点的内外关系','逐个核对边缘点','进行矩阵转置','对甲实施符号Q变换','把这句话换一种说法','按你的要求另存为标注'])for(const text of [`需要我${work}吗？`,`是否要${work}，请告诉我。`,`要不要我${work}？`,`是否希望我${work}，请告知即可。`])assert.equal(kind(text),'none',text);
 // No result, successful tool call or claim of task completion is required by this flow classifier.
 assert.equal(kind('需要我进行符号Q变换吗？'),'none');
});
test('predeclared source/layer choices take priority over the same offer grammar',()=>{
 assert.equal(kind('是否需要我选择本会话草稿还是来源系统？','D05'),'allowed');
 assert.equal(kind('需要我选择rescue-coast还是rescue-inland图层吗？','D06'),'allowed');
 const path=join(repo,'.local/spatial-r14/closeout-20261026/D06-1-A/review.json'),raw=JSON.parse(readFileSync(path,'utf8')) as {fixture:Prepared;final:SessionSnapshot};assert.equal(plainClarificationKind(raw.fixture,raw.final),'allowed');
 const two={kind:'question',requestId:'r',questions:[{id:'source',prompt:'选择草稿还是来源系统？'},{id:'boundary',prompt:'是否包含边界？'}]} as Interaction;assert.equal(clarificationResponse(prepared('D05'),two,false),undefined);
});
test('required facts, authority, unresolved preceding inputs and current save stay nonoptional',()=>{
 for(const text of ['当前输入坐标尚缺。是否要核对边缘点，请告诉我。','需要我核对边缘点吗？另请提供当前缺失的坐标。','是否需要你提供未知地点的位置才能完成当前分析？','需要我拿到输入资料才能继续，请补充资料。','是否需要我筛选范围，请批准访问权限？','是否要执行命令，请告诉我。','要不要我核对，另外请授权发布？'])assert.equal(kind(text),'unsupported',text);
 assert.equal(kind('是否要保存这个结果，请告诉我。','D17',1),'unnecessary');
 assert.equal(kind('是否要保存这个结果，请告诉我。','D17',0),'none');
 assert.equal(kind('救援资源有两个同名图层：rescue-coast、rescue-inland。输入坐标尚缺。请选择：','D06'),'unsupported');
});
test('D12-C actual unauthorized draft save remains a critical stop regardless of optional answer wording',()=>{
 const path=join(directory,'D12-1-C/review.json'),before=readFileSync(path),raw=JSON.parse(before.toString()) as {fixture:Prepared;final:SessionSnapshot;after:Prepared['fixture']['before'];entry:{stop:string};turns:Array<{originalUserTurn:number}>};
 assert.equal(raw.entry.stop,'unauthorized_draft_change');assert.equal(criticalEffect(raw.fixture,raw.final,raw.after,raw.turns.at(-1)!.originalUserTurn),'unauthorized_draft_change');
 assert.equal(criticalEffect(raw.fixture,snapshot('需要我再核对一次吗？'),raw.after,0),'unauthorized_draft_change');assert.equal(digest(readFileSync(path)),digest(before));
});
