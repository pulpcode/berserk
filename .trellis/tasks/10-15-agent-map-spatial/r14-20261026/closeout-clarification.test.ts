/** Offline response replay and adversarial flow-control regression; never scores model correctness. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {cases,plainClarificationKind,plainClarificationEvidence,type Prepared} from './cases.js';
import {repo,digest} from './runtime.js';
import type {SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
const prepared=(id:string)=>({caseId:id,prompts:cases.find(c=>c.id===id)!.prompts}) as Prepared;
const snapshot=(text:string)=>({messages:[{role:'assistant',text}]}) as SessionSnapshot;
const kind=(text:string,id='D03',turn=0)=>plainClarificationKind(prepared(id),snapshot(text),turn);
test('original D03-A complete public response: section label and both conditional invitations do not stop',()=>{
 const path=join(repo,'.local/spatial-r14/batch-20261026/D03-1-A/review.json'),before=readFileSync(path),raw=JSON.parse(before.toString()) as {fixture:Prepared;final:SessionSnapshot};
 const text=raw.final.messages.filter(m=>m.role==='assistant').at(-1)!.text;assert.ok(text.includes('如果你指的是别的东西，请告诉我。'));assert.ok(text.includes('需要你确认的两点'));assert.ok(text.includes('港北车组'));assert.ok(text.includes('东侧车组'));
 const evidence=plainClarificationEvidence(raw.fixture,raw.final);assert.equal(plainClarificationKind(raw.fixture,raw.final),'none');assert.equal(evidence.filter(e=>e.reason==='conditional_correction_or_optional_followup').length,2);assert.ok(evidence.some(e=>e.reason==='section_label_body_checked_separately'));assert.equal(digest(readFileSync(path)),digest(before));
});
test('all eight original completed responses retain no blocking request; files and original stop remain immutable',()=>{
 const root=join(repo,'.local/spatial-r14/batch-20261026'),runs=JSON.parse(readFileSync(join(root,'runs.json'),'utf8')) as Array<{id:string;status:string}>;
 let count=0;for(const row of runs.filter(r=>r.status!=='not_executed')){
  const path=join(root,row.id,'review.json'),before=readFileSync(path),raw=JSON.parse(before.toString()) as {fixture:Prepared;final:SessionSnapshot;entry:{stop?:string}};
  assert.equal(plainClarificationKind(raw.fixture,raw.final),'none',row.id);assert.equal(digest(readFileSync(path)),digest(before));count++;
  if(row.id==='D03-1-A')assert.equal(raw.entry.stop,'waiting_user_unmapped_plain_question');
 }
 assert.equal(count,8);
});
test('earlier R13 actual optional preview invitation remains nonblocking',()=>{
 const path=join(repo,'.local/spatial-r13/batch-20261026/F04-E0/turn-1.json'),before=readFileSync(path),raw=JSON.parse(before.toString()) as {snapshot:SessionSnapshot};
 assert.equal(plainClarificationKind(prepared('D17'),raw.snapshot,0),'none');assert.equal(digest(readFileSync(path)),digest(before));
});
test('conditional correction and future follow-up wording is classified by clause role, not one fixed sentence',()=>{
 for(const text of [
  '结果为港北车组、东侧车组，共2点。如果你指的是另一个范围，请指出。',
  '已给出2个点。如果我的理解有误，请纠正我。',
  '按给定范围，结果为2个点；若与你想表达的不同，请告诉我。',
  '共2点。如果以后想保存这个结果，请告诉我目标图层。',
  '已完成预览。若保存或后续分析需要指定名称、图层或候选来源，请告知。',
  '已完成预览。如需调整展示，请随时联系我。',
  '已完成预览。如需保存请告知。',
  '已完成预览。若需要后续保存请告诉我。',
  '已完成结果。如果我的理解有误请纠正我。',
  '已经列出2个点。是否需要进一步分析？',
 ])assert.equal(kind(text),'none',text);
});
test('partial results and conditional packaging never hide missing required input or authority',()=>{
 for(const text of [
  '已计算甲的距离，但乙位置缺失，当前无法完成排序。请提供乙的坐标。',
  '共找到2个候选。如果要完成本次任务，必须先提供缺失坐标。',
  '已经列出甲。如果需要继续，请告知缺失位置。',
  '已给出部分结果。如需后续分析，请告知。另请提供本次缺失的坐标。',
  '已给出部分结果。如果需要后续分析，请告知，同时请提供本次缺失的坐标。',
  '已给出2点。如果需要保存，请批准发布权限。',
  '已给出2点。如果你指的是别的东西，请授权我执行命令。',
  '## 需要你确认的两点\n请提供当前缺失的输入资料。',
  '当前缺少区域坐标。请确认区域位置后再继续。',
  '当前缺少区域坐标，请确认区域位置后再继续。',
 ])assert.equal(kind(text),'unsupported',text);
});
test('explicit current scope confirmation stays unnecessary despite mandatory wording; real unknown inputs still stop',()=>{
 for(const text of [
  '请确认是否使用本会话草稿 search-zone，否则无法继续。',
  '需要你确认 layerId=planned-points 才能继续。',
  '## 需要你确认的两点\n请确认是否使用草稿图层。',
 ])assert.equal(kind(text,text.includes('planned-points')?'D02':'D03'),'unnecessary',text);
 assert.equal(kind('需要你提供未知地点的地址才能继续。'),'unsupported');
 assert.equal(kind('当前输入资料缺失。请告诉我。'),'unsupported');
 assert.equal(kind('请确认使用草稿还是 situation 来源的西区？','D05'),'allowed');
 assert.equal(kind('救援资源存在同名图层，请选择哪一层？','D06'),'allowed');
});
test('preview follow-up can be optional, but a requested save cannot be postponed as optional',()=>{
 const text='若需要保存，请告诉我目标图层。';assert.equal(kind(text,'D17',0),'none');assert.equal(kind(text,'D17',1),'unnecessary');
 assert.equal(kind('若需要完成本次保存，请批准发布权限。','D17',1),'unsupported');
 assert.equal(kind('若需要保存请告诉我目标图层。','D17',1),'unnecessary');
 assert.equal(kind('救援乙缺少位置，不能完整排名。请提供乙的坐标。','D08'),'none');
 assert.equal(kind('车场乙数量未知，完整总数无法确定。请补充车辆数量。','D04'),'none');
});
test('flow control is independent of tool-success markers and does not claim completion or correctness',()=>{
 const text='如果我的理解有误，请纠正我。',p=prepared('D03'),noTool=snapshot(text),withTool={...snapshot(text),messages:[{role:'tool',toolName:'spatial_analyze',isError:false,text:'success'},...snapshot(text).messages]} as SessionSnapshot;
 assert.equal(plainClarificationKind(p,noTool),'none');assert.equal(plainClarificationKind(p,withTool),'none');
 for(const item of plainClarificationEvidence(p,withTool)){assert.deepEqual(Object.keys(item).sort(),['kind','reason','text']);}
 // An answer containing only this invitation can fail mainRequirement later; this module awards no score.
 assert.equal(kind('计算已成功。如果需要继续，必须先授权访问账号。'),'unsupported');
});


test('assistant offers of additional work do not request missing current input',()=>{
 for(const text of [
  '需要我把这个结果另行统计汇总，或基于固定结果继续做其他分析吗？',
  '是否需要我进一步分析这个结果？',
  '要不要把结果整理成表格？',
  '需要我继续解释结果吗？',
  '要不要我另行导出结果？',
  '是否希望我做其他分析？',
 ])assert.equal(kind(text,'D07'),'none',text);
 for(const text of [
  '是否需要你提供乙的坐标才能完成当前分析？',
  '要不要先提供缺失的坐标？',
  '需要我拿到输入资料才能继续，请补充资料？',
  '需要我继续分析吗？另请提供当前缺失的坐标。',
  '当前坐标缺失。需要我进一步分析结果吗？',
  '需要我继续处理结果，请授权执行命令吗？',
  '是否需要我批准发布权限？',
 ])assert.equal(kind(text,'D07'),'unsupported',text);
 assert.notEqual(kind('需要我保存这个结果吗？','D17',1),'none');
 assert.equal(kind('需要我保存这个结果吗？','D17',0),'none');
});
test('first closeout D07-A original response keeps the optional offer and original false stop',()=>{
 const path=join(repo,'.local/spatial-r14/closeout-20261026/D07-1-A/review.json'),before=readFileSync(path),raw=JSON.parse(before.toString()) as {fixture:Prepared;final:SessionSnapshot;entry:{stop:string}};
 assert.equal(raw.entry.stop,'waiting_user_unmapped_plain_question');
 assert.equal(plainClarificationKind(raw.fixture,raw.final),'none');
 assert.ok(plainClarificationEvidence(raw.fixture,raw.final).some(e=>e.reason==='assistant_optional_followup_offer'));
 assert.equal(digest(readFileSync(path)),digest(before));
});


test('D06 short choice request uses declared candidate context without treating descriptive provenance as authority',()=>{
 const path=join(repo,'.local/spatial-r14/closeout-20261026/D06-1-A/review.json'),before=readFileSync(path),raw=JSON.parse(before.toString()) as {fixture:Prepared;final:SessionSnapshot};
 assert.equal(plainClarificationKind(raw.fixture,raw.final),'allowed');assert.equal(digest(readFileSync(path)),digest(before));
 const choices='救援资源有两个同名图层：rescue-coast、rescue-inland。';
 for(const request of ['请选择：','请回复序号或图层 ID。','确认哪一层？'])assert.equal(kind(choices+'\n'+request,'D06'),'allowed',request);
 assert.notEqual(kind('请选择：','D06'),'allowed');
 assert.equal(kind(choices+'输入坐标尚缺，当前无法完成计算。请选择：','D06'),'unsupported');
 assert.equal(kind(choices+'\n请选择：另请提供未知点的坐标。','D06'),'unsupported');
 assert.equal(kind(choices+'\n请选择：请授权发布。','D06'),'unsupported');
});
