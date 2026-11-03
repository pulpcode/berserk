import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assessEnding,replyFor} from './interactions.js';
import {slotAccounting} from './accounting.js';
import {Ledger} from './budget.js';
import {summarize} from './scoring.js';
import type {Prepared} from './cases.js';

test('historical endings are protocol evidence only; omitted explicit attributes remain a semantic failure',()=>{
 const examples=JSON.parse(readFileSync(new URL('./ending-cases.json',import.meta.url),'utf8')) as Array<{id:string;text:string;expectedProtocol:string}>;
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
