import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assessEnding,replyFor,clarificationResponse} from './interactions.js';
import {slotAccounting} from '../evaluation-v2/accounting.js';
import {Ledger} from '../evaluation-v2/budget.js';
import {summarize} from '../evaluation-v2/scoring.js';
import type {QuestionInteraction} from '../../../../experiments/harness-lab/src/contracts/interactions.js';
import type {Prepared} from '../evaluation-v2/cases.js';

test('historical endings are protocol evidence only; omitted explicit attributes remain a semantic failure',()=>{
 const examples=JSON.parse(readFileSync(new URL('../evaluation-v2/ending-cases.json',import.meta.url),'utf8')) as Array<{id:string;text:string;expectedProtocol:string}>;
 for(const row of examples)assert.equal(assessEnding(row.text).kind,row.expectedProtocol,row.id);
 const unchanged=summarize([{id:'C10-1',status:'recorded'}],[{id:'C10-1',reviewer:'offline-regression',evidence:['historical-C10-1'],completed:false,coreCorrect:false,processFacts:true,finalFacts:true,effectsCorrect:false,withinScope:true,criticalErrors:[]}],true);
 assert.equal(unchanged.rows.find(row=>row.id==='C10-1')!.strict,false);assert.equal(unchanged.recommendIntegration,false);
});

test('conditional wording cannot hide a dependency of the current task',()=>{
 for(const text of [
  '如果要完成这次保存，请提供目标图层。',
  '如果需要完成当前任务，请提供坐标。',
  '我仍需确认目标，才能继续。',
  '已保存。备注还未添加，请确认是否继续。',
  '已保存。如需补上您要求的备注，请确认。',
  '请选择具体类型。',
  '请先选择目标图层。',
  '为了保存范围，请先提供目标图层。',
  '请您先提供坐标。',
  '请告诉我目标对象。',
  '请提供图层名称。如果需要后续发布，请告诉我。',
 ])assert.equal(assessEnding(text).kind,'needs_reply',text);
});

test('optional invitations do not authorize extra work and uncertain scope remains unresolved',()=>{
 for(const text of ['已保存。如需进一步修改，请告诉我。','如需额外发布，请另行告知。','如果你想了解其他方案，可以告诉我。'])assert.equal(assessEnding(text).kind,'finished',text);
 for(const text of ['如果要保存，请提供目标图层。','如果需要后续保存，请先提供目标图层。','如需进一步操作，请你补充目标坐标。','如需保存，请提供图层。','坐标已记录，如该坐标需要转换，请告知。','如果是水罐车，请确认类型。','需要发布或供其他席位查看时，请明确告知。','如需进一步完成保存，请提供目标图层。','请检查后决定。','可以继续吗？','要不要修改？','当前不支持这项操作。可选做法：更换类型。请选择你需要的方案。',''])assert.equal(assessEnding(text).kind,'needs_review',text);
 const p={caseId:'C02',prompts:['原始要求']} as Prepared;
 assert.equal(replyFor(p,'请批准发布',0),undefined);
 assert.equal(replyFor(p,'请删除当前对象',0),undefined);
 assert.equal(summarize([{id:'C02-1',status:'needs_review'}],[],true).recommendIntegration,false);
});

test('one settled snapshot matches ledger and attempts, distinguishing zero requests from unknown usage',()=>{
 const ledger=new Ledger(join(mkdtempSync(join(tmpdir(),'plotting-accounting-')),'ledger.json'),'offline');
 assert.deepEqual(slotAccounting(ledger,[],'empty',0),{requests:0,tools:0,usage:{input:0,output:0,unknown:0},providerRequestIds:[],accountingIssues:[]});
 const id=ledger.begin('complete',1000),usage={input:300,output:20};ledger.finish(id,usage);
 const attempt={id,slot:'complete',completed:true,output:{usage}};
 const count=slotAccounting(ledger,[attempt],'complete',2);
 assert.deepEqual(count,{requests:1,tools:2,usage:{input:300,output:20,unknown:0},providerRequestIds:[id],accountingIssues:[]});
 assert.ok(slotAccounting(ledger,[{...attempt,output:{usage:{input:300,output:19}}}],'complete',2).accountingIssues.includes(`ledger_attempt_usage_mismatch:${id}`));
 assert.ok(slotAccounting(ledger,[],'complete',2).accountingIssues.includes('ledger_attempt_identity_mismatch'));
 const failed=ledger.begin('failed',1000);ledger.finish(failed,undefined,'synthetic_transport_failure');
 const unknown=slotAccounting(ledger,[attempt,{id:failed,slot:'failed',completed:true,output:{}}],'failed',0);
 assert.equal(unknown.requests,1);assert.equal(unknown.usage.unknown,1);assert.deepEqual(unknown.accountingIssues,[]);assert.equal(ledger.canStartPair(),false);
});

test('explanatory insufficiency never synthesizes a repeated user task',()=>{
 const p={caseId:'C09',prompts:['原始查询']} as Prepared;
 for(const text of [
  '4. 若需要认定“已到场”，还需要现场记录类信息（例如 observation 性质标注或来源系统中的到场确认），目前资料中没有。',
  '确定是否可用还需要来源信息，目前没有相应数据。',
  '判断通行状态还需现场数据，现有图层不能证明。',
 ]){assert.equal(assessEnding(text).kind,'needs_review');assert.equal(replyFor(p,text,0),undefined);}
 for(const text of ['请提供目标图层。','请选择草稿还是来源。','请说明引用范围。'])assert.equal(replyFor(p,text,0),undefined);
});

test('scripted clarification requires an actual narrow request, not a mention of its subject',()=>{
 const p={caseId:'C02',prompts:['原始要求']} as Prepared;
 for(const text of ['请确认消防车是否已到场？','请确认水罐车是否需要移动？','请确认车型和备注。','请明确具体图层。','请问哪种颜色？','请选择图层。水罐车是候选类型。','已保存水罐车，类型可修改。','水罐车和泡沫车是不同类型。','如果是水罐车，请确认类型。','已保存。如需换车型，请告诉我。'])assert.equal(replyFor(p,text,0),undefined);
 assert.equal(replyFor(p,'请选择具体车型。',0),'水罐消防车');
 assert.equal(replyFor(p,'请选择具体车型。',1),undefined);
 for(const text of ['请确认90°方向是否有障碍？','请确认90°方向的含义。','请确认最新备注。'])assert.equal(replyFor({...p,caseId:'C08'},text,0),undefined);
 assert.equal(replyFor({...p,caseId:'C08'},'请提供90°方向的目标坐标。',0),undefined);
 assert.equal(replyFor({...p,caseId:'C08'},'请确认方向是否仍改为90°？',0),'方向仍改90°，保留最新备注');
 assert.equal(replyFor({...p,caseId:'C08'},'方向已改成90°，备注保留。',0),undefined);
});

test('structured answer options cannot broaden the current question',()=>{
 const p={caseId:'C02',prompts:['原始要求']} as Prepared;
 const interaction:QuestionInteraction={schemaVersion:1,interactionId:'i',workspaceId:'w',sessionId:'s',requestId:'r',toolCallId:'t',toolName:'question',createdAt:'2026-10-28T00:00:00Z',kind:'question',status:'pending',questions:[{id:'q',prompt:'请确认是否发布？',options:[{id:'water',label:'水罐消防车',description:'请选择具体车型'}]}]};
 assert.equal(clarificationResponse(p,interaction,false,0),undefined);
 interaction.questions[0].prompt='请选择具体类型。';assert.equal(clarificationResponse(p,interaction,false,0),undefined);
 interaction.questions[0].prompt='请选择具体车型。';assert.ok(clarificationResponse(p,interaction,false,0));
 assert.equal(clarificationResponse(p,interaction,true,0),undefined);
});
