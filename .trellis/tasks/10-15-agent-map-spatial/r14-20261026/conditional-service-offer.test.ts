import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {plainClarificationKind,plainClarificationEvidence,type Prepared} from './cases.js';
import {repo} from './runtime.js';
import type {SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
const directory=join(repo,'.local/spatial-r14/closeout-fourth-20261027/D04-2-A');
const fixture=JSON.parse(readFileSync(join(directory,'fixture.json'),'utf8')) as Prepared;
const snapshot=(text:string)=>({messages:[{role:'assistant',text}]} as SessionSnapshot);
const offer='如果你需要，我可以：① 给出缺失数量的进一步说明（需要你提供车场乙的数量或允许查询来源）；② 标注车场乙的缺失字段（这是修改操作，需要你明确确认）。';
test('historical D04 completed answer keeps the entire conditional follow-up list optional',()=>{
 const review=JSON.parse(readFileSync(join(directory,'review.json'),'utf8')) as {final:SessionSnapshot;after:unknown},row=JSON.parse(readFileSync(join(directory,'result.json'),'utf8')) as {stop:string};
 assert.equal(row.stop,'waiting_user_unmapped_plain_question');assert.equal(review.final.lastResult?.status,'succeeded');assert.deepEqual(review.after,fixture.fixture.before);assert.equal(plainClarificationKind(fixture,review.final),'none');
 assert.ok(plainClarificationEvidence(fixture,review.final).some(e=>e.reason==='conditional_numbered_services_with_nested_prerequisites'&&e.text.includes('①')&&e.text.includes('②')));
});
test('conditional service prerequisites remain scoped across semicolons and numbered lines',()=>{
 for(const text of [offer,'已完成查询。\n如果你需要，我可以：\n① 给出额外区间说明（需要你提供数量）；\n② 标注缺失字段（需要你明确确认）。','已完成查询。\n若您需要，我可以：1. 补充说明（需要你提供另一个样例）；2. 标记缺失（需要你确认）。'])assert.equal(plainClarificationKind(fixture,snapshot(text)),'none',text);
});
test('current dependencies, mixed requests and authority never inherit the optional scope',()=>{
 for(const text of [
  offer+'\n但请提供起点坐标后我才能完成当前计算？',
  offer+' 同时请先提供当前任务的坐标？',
  '如果你需要，我可以：① 补充说明（为了完成当前任务，需要你先提供坐标）；② 标注缺失（需要确认）。',
  '如果你需要，我可以：① 补充说明（当前任务需要你提供坐标）；② 标注缺失（需要确认）。',
  '当前无法完成计算，坐标尚缺。\n'+offer,
  '如果你需要，我可以：① 补充说明（需要你提供数据）；但请授权发布当前草稿？',
  '如果你需要，我可以：\n① 补充说明（需要你提供数据）。\n请提供起点坐标后我才能继续？',
 ])assert.equal(plainClarificationKind(fixture,snapshot(text)),'unsupported',text);
});
test('a currently requested save cannot be deferred as an optional listed service',()=>{
 const p={...fixture,caseId:'D18',prompts:['预览','预览','保存第二次固定结果。']} as Prepared;
 assert.notEqual(plainClarificationKind(p,snapshot('如果你需要，我可以：① 保存该结果（需要你明确确认）。'),2),'none');
});
