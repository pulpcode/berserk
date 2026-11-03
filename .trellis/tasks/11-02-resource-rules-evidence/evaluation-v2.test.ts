import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { criticalKeys, sha256, type EvidenceSnapshot, type ReviewPass } from '../11-02-task-resource-acceptance/scoring.js';
import { aggregateV2, clarificationRule, evaluationVersion, reviewedContinuation, scoreReviewV2, type ReviewPacketV2, type ReviewPassV2, type ScopeAssessment } from './evaluation-v2.js';
import type { QuestionInteraction } from '../../../experiments/harness-lab/src/contracts/interactions.js';
const evidence = (id: string, sequence: number, kind: EvidenceSnapshot['kind'], text: string): EvidenceSnapshot => ({ id, sequence, kind, text, path: `constructed/${id}`, sha256: sha256(text), modelVisible: true });
function packet(): ReviewPacketV2 {
 const snapshots = [evidence('u',1,'user','列出所引用区域的资源。'),evidence('t',2,'tool','区域甲有2辆。'),evidence('a',3,'assistant','区域甲有2辆。')];
 const pass: ReviewPassV2 = { reviewer:'offline-first',reviewerKind:'agent' as const,rawEvidenceReadFirst:true,reviewedStatementIds:['a'],mainTask:'pass' as const,mainRationale:'构造样例，检验评分契约，不是独立语义复核。',critical:Object.fromEntries(criticalKeys.map(key=>[key,{verdict:'pass',rationale:'构造授权和状态依据',evidenceIds:['t']}])) as ReviewPass['critical'],claims:[{id:'claim',statementId:'a',quote:'区域甲有2辆。',availableEvidenceIds:['t'],laterEvidenceIds:[],verdict:'supported' as const,rationale:'工具明确返回2辆。'}],omissions:[],answer:{finalStatementIds:['a'],outcome:'answered' as const,rationale:'最后一条回答用户所问。',evidenceIds:['a']},scope:{requirement:'resolved',behavior:'direct',rationale:'明确引用，无需再次选择。',evidenceIds:['u','t']} as ScopeAssessment };
 return { scoringVersion:evaluationVersion,entryId:'N01-1',caseId:'N01',cohort:'calibration',repeat:1,trajectoryComplete:true,evidenceVerified:true,snapshots,protocolFaults:[],programChecks:[],first:pass,second:{...structuredClone(pass),reviewer:'offline-second'} };
}
function setScope(p:ReviewPacketV2, requirement:ScopeAssessment['requirement'],behavior:ScopeAssessment['behavior']) {for(const pass of [p.first!,p.second!])pass.scope={requirement,behavior,rationale:'明确构造的意图与实际行为，非关键词分类。',evidenceIds:['u','t']};}
test('E07 calibrated resolved, ambiguous single and comparison policies agree with deployed Skill',async()=>{
 const skill=await readFile(new URL('../../../experiments/harness-lab/fixtures/skills/spatial-analysis/SKILL.md',import.meta.url),'utf8');assert.ok(skill.includes(clarificationRule));assert.ok(!skill.includes('确有独立解释'));
 for(const [requirement,behavior,expected] of [['resolved','direct',true],['resolved','unnecessary_choice',false],['ambiguous_single','clarified_before_answer',true],['ambiguous_single','separate',false],['ambiguous_single','merged',false],['comparison','separate',true],['comparison','unnecessary_choice',false]] as const){const p=packet();setScope(p,requirement,behavior);const score=scoreReviewV2(p);assert.equal(score.status,'reviewed');assert.equal(score.mainTask,expected,`${requirement}/${behavior}`);}
});
test('E08 product failure without a final answer is failed, with explanation N/A not empty-claims true',()=>{
 const p=packet();p.snapshots=p.snapshots.filter(s=>s.kind!=='assistant');p.snapshots.push(evidence('fault',3,'controller','产品结果自校验失败，没有最终答复。'));
 for(const pass of [p.first!,p.second!]){pass.reviewedStatementIds=[];pass.claims=[];pass.answer={outcome:'product_failure',finalStatementIds:[],rationale:'真实产品故障记录',evidenceIds:['fault']};}
 const s=scoreReviewV2(p);assert.equal(s.status,'reviewed');assert.equal(s.mainTask,false);assert.equal(s.strict,false);assert.equal(s.explanation,null);assert.equal(s.finalAnswerPresent,false);assert.equal(s.processExplanation,null);
});
test('E08 no final answer retains an earlier false process claim rather than laundering it',()=>{
 const p=packet();for(const pass of [p.first!,p.second!]){pass.claims[0]!.verdict='factual_error';pass.answer={outcome:'product_failure',finalStatementIds:[],rationale:'之后中断，只有此前过程说明。',evidenceIds:['t']};}
 const s=scoreReviewV2(p);assert.equal(s.explanation,null);assert.equal(s.processExplanation,false);assert.equal(s.review.first!.claims[0]!.verdict,'factual_error');assert.equal(s.strict,false);
});
test('E08 infrastructure fault remains separate, and inconsistent or disputed final classifications cannot pass',()=>{
 const p=packet();p.protocolFaults=[{stage:'recording',reason:'轨迹缺失'}];assert.equal(scoreReviewV2(p).status,'protocol_failure');assert.equal(scoreReviewV2(p).mainTask,null);
 const disputed=packet();disputed.second!.answer.outcome='unfinished';disputed.second!.answer.finalStatementIds=[];assert.equal(scoreReviewV2(disputed).status,'pending_review');
 const bad=packet();bad.first!.answer.finalStatementIds=['t'];assert.equal(scoreReviewV2(bad).status,'pending_review');
});
test('N-series denominator keeps product failures and reports explanation N/A separately',()=>{
 const p=packet();p.cohort='formal';const ok=scoreReviewV2(p);const failed=structuredClone(p);failed.caseId='N02';failed.entryId='N02-1';for(const pass of [failed.first!,failed.second!])pass.answer={outcome:'unfinished',finalStatementIds:[],rationale:'只有过程消息，未完成。',evidenceIds:['a']};
 const slots=[{caseId:'N01',repeat:1 as const},{caseId:'N02',repeat:1 as const}];const result=aggregateV2([ok,scoreReviewV2(failed)],slots);assert.equal(result.planned,2);assert.equal(result.main,1);assert.deepEqual(result.explanation,{passed:1,denominator:1,notApplicable:1});assert.throws(()=>aggregateV2([ok,ok],slots),/duplicate/);
});
const humanFacts=[{id:'region',topic:'region' as const,value:'我指港口侧。',objectId:'harbor',acceptableForms:['港口侧'],rule:'仅在实际询问区域时回答。'}];
const match={reviewer:'offline-human-review-input',rationale:'实际问题要求选择区域，冻结事实可回答。',evidenceId:'question',quote:'您指港口侧还是山麓侧？',factId:'region'};
test('E07 ordinary clarification → frozen reply → final answer; no keyword/question-mark classifier',()=>{
 const question=evidence('question',1,'assistant',match.quote);const action=reviewedContinuation({humanFacts},question,match);assert.equal(action.kind,'clarify');assert.equal(action.channel,'ordinary_text');assert.equal('text' in action?action.text:'','我指港口侧。');assert.ok(!('response' in action));
 const p=packet();p.snapshots.unshift({...question,sequence:0});for(const pass of [p.first!,p.second!]){pass.reviewedStatementIds.unshift('question');pass.nonFactualStatements=[{statementId:'question',noFactualClaimsRationale:'只询问选择，无事实断言。'}];}setScope(p,'ambiguous_single','clarified_before_answer');assert.equal(scoreReviewV2(p).mainTask,true);
 assert.throws(()=>reviewedContinuation({humanFacts},question,{...match,quote:'还要继续吗？'}),/quote/);
 assert.throws(()=>reviewedContinuation({humanFacts},question,{...match,factId:'unprepared'}),/no_frozen_fact/);
});
test('E07 structured clarification uses real API response mapping; wrong question/options/approval cannot be answered',()=>{
 const interaction:QuestionInteraction={schemaVersion:1,interactionId:'i',workspaceId:'w',sessionId:'s',requestId:'r',toolCallId:'c',toolName:'ask_user',createdAt:'2026-11-02T00:00:00Z',kind:'question',status:'pending',questions:[{id:'q',prompt:match.quote,options:[{id:'port',label:'港口侧'},{id:'hill',label:'山麓侧'}]}]};
 const observed=evidence('question',1,'controller',JSON.stringify(interaction));const action=reviewedContinuation({humanFacts},observed,{...match,questionId:'q',optionIds:['port']},interaction);assert.equal(action.channel,'interaction_api');assert.deepEqual('response'in action?action.response:null,{requestId:'r',kind:'question',action:'answer',answers:[{questionId:'q',optionIds:['port']}]});
 assert.throws(()=>reviewedContinuation({humanFacts},observed,{...match,questionId:'wrong'},interaction),/question_quote/);
 assert.throws(()=>reviewedContinuation({humanFacts},observed,{...match,questionId:'q',optionIds:['not-an-option']},interaction),/invalid_reviewed_options/);
});

test('E01–E06 seven historical quoted negatives keep original provenance; six positives are explicitly constructed',async()=>{
 const root=new URL('../../../',import.meta.url);
 const historical=JSON.parse(await readFile(new URL('./historical-explanation-cases.json',import.meta.url),'utf8')) as {cases:Array<{id:string;kind:string;trajectoryPath:string;trajectorySha256:string;reviewPath:string;reviewSha256:string;statementId:string;quote:string;availableEvidenceIds:string[];verdict:'factual_error'|'unsupported';rationale:string}>};
 assert.equal(historical.cases.length,7);
 for(const example of historical.cases){
  assert.equal(example.kind,'real_history');const bytes=await readFile(new URL(example.trajectoryPath,root));assert.equal(sha256(bytes),example.trajectorySha256);assert.equal(sha256(await readFile(new URL(example.reviewPath,root))),example.reviewSha256);
  const trace=(JSON.parse(bytes.toString()) as {trajectory:Array<EvidenceSnapshot & {messageId?:string}>}).trajectory;const statement={...trace.find(s=>s.id===example.statementId||s.messageId===example.statementId)!,id:example.statementId};assert.ok(statement.text.includes(example.quote));
  const prior=example.availableEvidenceIds.map(id=>({...trace.find(s=>s.id===id||s.messageId===id)!,id}));assert.ok(prior.every(s=>s&&s.sequence<statement.sequence));
  // Only this quote is calibrated: never rescore/save the original task or replace its reviews.
  const p=packet();p.entryId=`calibration-history-${example.id}`;p.caseId=p.entryId;p.snapshots=[...prior,{...statement,text:example.quote,sha256:sha256(example.quote)}];
  for(const pass of [p.first!,p.second!]){pass.reviewedStatementIds=[statement.id];pass.mainRationale='构造校准包装，不对原任务主任务重新评分。';pass.claims=[{id:example.id,statementId:statement.id,quote:example.quote,availableEvidenceIds:example.availableEvidenceIds,laterEvidenceIds:[],verdict:example.verdict,rationale:example.rationale}];pass.answer={outcome:'answered',finalStatementIds:[statement.id],rationale:'本校准对象是这条真实原句。',evidenceIds:[statement.id]};pass.scope={requirement:'not_applicable',behavior:'not_applicable',rationale:'本样例仅校准该解释原句。',evidenceIds:[statement.id]};for(const key of criticalKeys)pass.critical[key].evidenceIds=[prior[0]!.id];}
  const score=scoreReviewV2(p);assert.equal(score.status,'reviewed',score.issues.join(';'));assert.equal(score.explanation,false,example.id);
 }
 const positives=JSON.parse(await readFile(new URL('./calibration-positive.json',import.meta.url),'utf8')) as {cases:Array<{id:string;kind:string;evidence:string;quote:string;verdict:'supported'}>};assert.equal(positives.cases.length,6);
 for(const example of positives.cases){assert.equal(example.kind,'constructed');const p=packet();p.caseId=example.id;p.entryId=example.id;p.snapshots[1]=evidence('t',2,'tool',example.evidence);p.snapshots[2]=evidence('a',3,'assistant',example.quote);for(const pass of [p.first!,p.second!]){pass.claims[0]!.quote=example.quote;pass.claims[0]!.rationale='固定构造事实支持这条说明，检验显式审阅转换。';}assert.equal(scoreReviewV2(p).explanation,true,example.id);}
});

test('reviewer wording and evidence order do not create semantic disagreement',()=>{const p=packet();p.second!.answer.rationale='另一位审阅者采用自己的说明。';p.second!.scope.rationale='语义决定相同。';p.second!.scope.evidenceIds=['t','u'];assert.equal(scoreReviewV2(p).status,'reviewed');assert.equal(scoreReviewV2(p).processExplanation,null);});

test('untrusted JSON new assessment fields cannot pass or crash via malformed enums, arrays or text',()=>{
 const changes = [
  {scope:{requirement:'not_applicable',behavior:'invalid-behavior',rationale:'test',evidenceIds:['u']}},
  {scope:{requirement:'invented',behavior:'direct',rationale:'test',evidenceIds:['u']}},
  {answer:{outcome:'invented',finalStatementIds:['a'],rationale:'test',evidenceIds:['a']}},
  {answer:{outcome:'answered',finalStatementIds:'a',rationale:'test',evidenceIds:['a']}},
  {answer:{outcome:'answered',finalStatementIds:['a'],rationale:42,evidenceIds:['a']}},
  {scope:{requirement:'resolved',behavior:'direct',rationale:'test',evidenceIds:'u'}},
  {scope:[]}, {answer:null},
 ];
 for(const change of changes){const p=packet();Object.assign(p.first!,structuredClone(change));Object.assign(p.second!,structuredClone(change));const score=scoreReviewV2(p);assert.equal(score.status,'pending_review',JSON.stringify(change));assert.equal(score.strict,null);}
});
