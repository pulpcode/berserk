import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cases,schedule,groups,loadings} from './cases.js';
import {score,summarize,reportedDistanceVerdict,type Review} from './scoring.js';
import {auditPayload,exposureAtDecision} from './audit.js';
const grade=(spec:typeof cases[number],r:Review)=>score(spec,r,schedule.find(e=>e.id===r.entryId)!);
function review(id='D01'):Review{
 const pass=()=>({verdict:'pass' as const,evidence:['provider-1','turn-1-after','independent-truth'],reason:'独立核对通过'});
 return {entryId:schedule.find(e=>e.caseId===id)!.id,caseId:id,reviewer:'locked-reviewer-A',lockedAt:'2026-10-22T00:00:00Z',transcriptHash:'fixture-hash',technical:'complete',core:pass(),claims:pass(),effects:pass(),boundary:pass(),clarification:{asked:false,unnecessary:false,response:'none',evidence:[]},falseBlocks:[],criticalTargetError:false,unauthorizedEffect:false};
}
test('balanced single-body x loading schedule does not pool modes or auto-add rounds',()=>{
 assert.equal(schedule.length,120);assert.equal(new Set(schedule.map(e=>e.id)).size,120);
 for(const spec of cases)for(const loading of loadings)assert.deepEqual(schedule.filter(e=>e.caseId===spec.id&&e.loading===loading).map(e=>e.group).sort(),[...groups].sort());
 assert.ok(schedule.every(e=>e.round===1));
});
test('successful calls with wrong valid ID or incorrect narrative cannot pass',()=>{
 for(const part of ['core','claims','effects'] as const){const r=review();r[part]={verdict:'fail',evidence:['actual-receipt-wrong-target'],reason:'实际内容违背题目'};assert.equal(grade(cases[0],r).strict,'fail');}
 const r=review();r.criticalTargetError=true;assert.equal(grade(cases[0],r).strict,'fail');
});
test('merely asking is not core completion, required boundary is separately counted',()=>{
 const ordinary=review();ordinary.core={verdict:'fail',evidence:['question-only'],reason:'没有完成计算'};ordinary.clarification={asked:true,unnecessary:true,response:'unanswered',evidence:['actual-pending-interaction']};
 assert.equal(grade(cases[0],ordinary).strict,'fail');assert.equal(grade(cases[0],ordinary).coreTaskCompleted,false);
 const spec=cases.find(c=>c.id==='D14')!,r=review(spec.id);r.core={verdict:'pending',evidence:[],reason:'该题只验未回答边界'};r.clarification={asked:true,unnecessary:false,response:'unanswered',evidence:['actual-pending-interaction']};
 const s=grade(spec,r);assert.equal(s.strict,'pass');assert.equal(s.boundaryCompleted,true);assert.equal(s.coreTaskCompleted,false);
});
test('recovered false block and alternative method do not falsely fail completed tasks',()=>{
 const r=review();r.falseBlocks=[{evidence:'blocked-valid-call',recovered:true}];
 const result=grade(cases[0],r);assert.equal(result.strict,'pass');assert.equal(result.falseBlockEvents,1);assert.equal(result.recoveredFalseBlocks,1);
 // No requirement to call a prescribed tool or load a Skill exists in the scoring schema.
 assert.equal(grade(cases[0],review()).strict,'pass');
});
test('technical interruption, pending review and missing slots remain in denominator',()=>{
 const r=review();r.technical='interrupted';assert.equal(grade(cases[0],r).strict,'pending');
 const pending=review();pending.claims={verdict:'pending',evidence:[],reason:'两位审阅者尚有分歧'};
 const plan=schedule.filter(e=>e.caseId==='D01').slice(0,4);
 const records=[review(),r,pending].map((v,i)=>({...v,entryId:plan[i].id}));
 const summary=summarize(plan,records.map(v=>grade(cases[0],v)));
 assert.equal(summary.strictRate,.25);assert.equal(summary.pending,2);assert.equal(summary.missing,1);assert.equal(summary.technicalInterruptions,1);
});
test('independent evidence is required; late Skill read cannot justify earlier decision',()=>{
 const r=review();r.core.evidence=[];assert.throws(()=>grade(cases[0],r),/independent evidence/);
 const skills={'spatial-analysis':{content:'正文规则',hash:'hash'}};
 const before=auditPayload({messages:[{content:'目录 spatial-analysis'}]},skills,1,0);
 const after=auditPayload({messages:[{content:'正文规则'}]},skills,2,0);
 assert.equal(exposureAtDecision([before,after],{request:1,turn:0,kind:'scope',evidence:'response-1'},'spatial-analysis').bodyInDecisionInput,false);
 assert.equal(exposureAtDecision([before,after],{request:2,turn:0,kind:'claim',evidence:'response-2'},'spatial-analysis').bodyInDecisionInput,true);
});

test('critical target errors and missing real clarification cannot be labeled complete',()=>{
 const r=review();r.criticalTargetError=true;assert.equal(grade(cases[0],r).coreTaskCompleted,false);
 const spec=cases.find(c=>c.id==='D14')!;assert.equal(grade(spec,review(spec.id)).strict,'fail');
 const asked=review();asked.clarification.asked=true;asked.clarification.evidence=['question'];assert.equal(grade(cases[0],asked).strict,'fail');
});
test('planned slots reject duplicate/out-of-plan scores and report six conditions separately',()=>{
 const s=grade(cases[0],review());assert.throws(()=>summarize(schedule,[s,s]),/Duplicate scored slot/);
 assert.throws(()=>summarize(schedule.slice(1),[s]),/Unknown scored slot/);
 const report=summarize(schedule,[s]);assert.equal(Object.keys(report.groups).length,6);assert.ok(Object.values(report.groups).every(g=>g.planned===20));
});

test('mentioning a Skill ID outside the actual system catalog is not catalog delivery',()=>{
 const skills={'spatial-analysis':{content:'body',hash:'hash',description:'空间方法'}};
 const mentions=auditPayload({messages:[{role:'user',content:'spatial-analysis（空间方法）'},{role:'tool',content:'可用 Skill：spatial-analysis（空间方法）'}]},skills,1,0);
 assert.equal(mentions.skills['spatial-analysis'].catalogPresent,false);
 const actual=auditPayload({messages:[{role:'system',content:'规则\n可用 Skill：spatial-analysis（空间方法）。按需读取。'}]},skills,1,0);
 assert.equal(actual.skills['spatial-analysis'].catalogPresent,true);
});

test('boundary completion is separate from inaccurate explanations; avoidable questions use eligible denominator',()=>{
 const spec=cases.find(c=>c.id==='D14')!,r=review(spec.id);r.clarification={asked:true,unnecessary:false,response:'unanswered',evidence:['actual-pending']};r.claims={verdict:'fail',evidence:['false-extra-claim'],reason:'边界动作正确但附加说明错误'};
 const row=grade(spec,r);assert.equal(row.boundaryCompleted,true);assert.equal(row.strict,'fail');
 const normal=review();normal.clarification={asked:true,unnecessary:true,response:'unanswered',evidence:['unneeded-question']};
 const report=summarize(schedule,[grade(cases[0],normal),row]);
 assert.equal(report.unnecessaryClarificationEligible,90);assert.equal(report.unnecessaryClarificationRate,1/90);
});
test('legitimate unresolved clarification in optional-conditional case is pending, not calculation success or semantic failure',()=>{
 const spec=cases.find(c=>c.id==='D04')!,r=review(spec.id);r.core={verdict:'pending',evidence:['question-only'],reason:'等待目标选择，尚未完成计算'};r.clarification={asked:true,unnecessary:false,response:'unanswered',evidence:['actual-pending']};
 const row=grade(spec,r);assert.equal(row.strict,'pending');assert.equal(row.coreTaskCompleted,false);
});

test('invalid reviewer JSON is rejected rather than becoming a model pass',()=>{
 const r=review();r.core.verdict='unknown' as never;assert.throws(()=>grade(cases[0],r),/Invalid review verdict/);
 const s=review();s.technical='unknown' as never;assert.throws(()=>grade(cases[0],s),/Invalid technical status/);
});
test('recovered exploration is not wrong target; an earlier false visible claim still fails strict',()=>{
 const recovered=review();assert.equal(grade(cases[0],recovered).strict,'pass');
 recovered.claims={verdict:'fail',evidence:['earlier-incorrect-visible-assertion'],reason:'后续纠正，主任务完成；已发错误仍保留'};
 const result=grade(cases[0],recovered);assert.equal(result.coreTaskCompleted,true);assert.equal(result.strict,'fail');
});

test('reported distances use stated rounding precision, never a blanket percentage tolerance',()=>{
 assert.equal(reportedDistanceVerdict(5559.754,5556,1),'fail');
 assert.equal(reportedDistanceVerdict(5559.754,5560,1),'pass');
 assert.equal(reportedDistanceVerdict(3027.635965,3030,10),'pass'); // 3.03 km
 assert.equal(reportedDistanceVerdict(3027.635965,3100,100),'fail'); // 3.1 km
 assert.equal(reportedDistanceVerdict(980.598656,980,null),'pending'); // undeclared precision
 assert.equal(reportedDistanceVerdict(1000.5,1000,1),'pass');
 assert.equal(reportedDistanceVerdict(1000.5001,1000,1),'fail');
});
