import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {cases,plainClarificationKind,type Prepared} from './cases.js';
import {repo,digest} from './runtime.js';
import type {SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
const prepared={caseId:'F04',prompts:cases.find(c=>c.id==='F04')!.prompts} as Prepared;
const snapshot=(text:string)=>({messages:[{role:'assistant',text}]}) as SessionSnapshot;
const kind=(text:string)=>plainClarificationKind(prepared,snapshot(text));
test('original F04-E0 completed preview with conditional offer is not waiting; raw evidence stays unchanged',()=>{
 const path=join(repo,'.local/spatial-r13/batch-20261026/F04-E0/turn-1.json'),before=readFileSync(path),historical=JSON.parse(before.toString()) as {snapshot:SessionSnapshot};
 const last=historical.snapshot.messages.filter(m=>m.role==='assistant').at(-1)!.text;
 assert.ok(last.includes('已完成预览，未保存到草稿。'));assert.ok(last.includes('若需要，我可以把这个 500 米范围保存为草稿中的新标注'));assert.ok(last.includes('若保存或后续分析需要指定名称、图层或候选来源，请告知。'));
 assert.equal(plainClarificationKind(prepared,historical.snapshot),'none');assert.equal(digest(readFileSync(path)),digest(before));
});
test('nearby optional wording is ignored only within the conditional invitation',()=>{
 for(const text of [
  '已完成预览，未保存。若需要，我可以保存这个范围，请告知。',
  '已完成预览，未保存。如果需要后续分析，请告诉我。',
  '已完成预览，未保存。如需调整展示，请随时联系我。',
  '已完成预览。若保存时希望指定图层，请告知即可。',
  '已完成预览。是否需要继续分析？',
  '已完成预览。要不要进一步查看？',
  '必须读取全部对象才能确认总数；本次已经读取完整，共4个。',
 ])assert.equal(kind(text),'none',text);
});
test('necessary facts and authorization remain waiting, including conditional requirements',()=>{
 for(const text of [
  '请提供基点坐标。',
  '若需要继续，必须先提供基点坐标。',
  '如需完成本次任务，请告知。',
  '需要您提供坐标后才能继续。',
  '若需要保存，请批准发布权限。',
  '如果需要继续，请告知基点坐标。',
  '当前无法生成范围，请告知。',
  '基点坐标是什么？',
 ])assert.equal(kind(text),'unsupported',text);
 assert.equal(kind('请确认，基点使用当前草稿中的基点吗？'),'allowed');
});
test('optional suggestions never hide necessary questions elsewhere in the same answer',()=>{
 for(const text of [
  '已完成预览。若需要后续分析，请告知。另请提供本次基点坐标。',
  '请提供基点坐标。若需要后续分析，请告知。',
  '已完成预览。若需要后续分析，请告知，同时请提供基点坐标。',
  '若需要后续分析，请告知；当前必须先确认坐标。',
  '请确认，使用本会话草稿吗？另外请提供基点坐标。',
  '如需进一步分析，请告知。是否批准发布这个范围？',
 ])assert.equal(kind(text),'unsupported',text);
 assert.equal(kind('请确认，使用本会话草稿中的基点吗？若需要进一步分析，请告知。'),'allowed');
});
