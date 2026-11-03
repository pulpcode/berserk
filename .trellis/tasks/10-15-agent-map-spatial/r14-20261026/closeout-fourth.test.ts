import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {verifyThirdSegment,fourthFreeze,validateFourthComparable,runFourthCloseout,carriedAccount,carriedTotals,thirdDirectory,fourthClaim} from './closeout-fourth.js';
import {sourceFreeze,type Row} from './live.js';
import {schedule,plainClarificationKind,type Prepared} from './cases.js';
import {Ledger,modelConfiguration,type AccountPreflight} from './budget.js';
import {loopbackOnly,digest} from './runtime.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
import type {SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
const read=<T>(path:string)=>JSON.parse(readFileSync(path,'utf8')) as T;
const accountPath=new URL('./third-closeout-account-preflight.json',import.meta.url).pathname;
test('third raw evidence and drivers remain intact; only original final 21 slots may execute',async()=>{
 const previous=await verifyThirdSegment();assert.deepEqual(previous.remaining,schedule.slice(123));assert.equal(previous.remaining.length,21);assert.equal(previous.remaining[0].id,'D07-2-A');assert.ok(previous.remaining.every(r=>r.caseId!=='D08'));
 await assert.rejects(runFourthCloseout({directory:join(thirdDirectory,'do-not-write'),accountPath}),/must_not_modify_prior_evidence/);
});
test('original D08-2-B final answer already reports the explicitly allowed missing geometry outcome, without changing old halt',()=>{
 const path=join(thirdDirectory,'D08-2-B/review.json'),bytes=readFileSync(path),raw=JSON.parse(bytes.toString()) as {fixture:Prepared;final:SessionSnapshot;entry:{stop:string};interactions:unknown[]};
 assert.ok(raw.fixture.prompts[0].includes('如果现有数据不足'));assert.match(String(raw.fixture.truth.scoring),/准确说明缺口视为业务完成/);
 const text=raw.final.messages.filter(m=>m.role==='assistant').at(-1)!.text;assert.ok(text.includes('222.39'));assert.ok(text.includes('救援乙缺少几何'));assert.ok(text.includes('无法完成两项排序'));assert.equal(raw.interactions.length,0);
 // Record the existing evaluator's misclassification; do not edit it, replay the task or provide an answer.
 assert.equal(plainClarificationKind(raw.fixture,raw.final),'unsupported');assert.equal(raw.entry.stop,'waiting_user_unmapped_plain_question');assert.equal(digest(readFileSync(path)),digest(bytes));
});
test('573 inherited requests debit the same old window cap exactly once, and duplicate completion is rejected',async()=>{
 const previous=await verifyThirdSegment(),observation=read<AccountPreflight>(accountPath),account=carriedAccount(previous,observation),dir=await mkdtemp(join(tmpdir(),'r14-offline-fourth-ledger-')),ledger=new Ledger(join(dir,'ledger.json'),'offline-fourth',account,previous.ledgerSeed);
 assert.deepEqual(account,previous.protocol.account);assert.equal(ledger.totals().requests,573);assert.ok(Math.abs(ledger.accountRemaining()-(10000-1000-carriedTotals.afp))<1e-8);assert.equal(ledger.read().halted,undefined);assert.equal(ledger.read().inherited?.halted,'waiting_user_unmapped_plain_question');
 assert.throws(()=>ledger.finish(573,{input:0,output:0}));assert.equal(ledger.begin('D07-2-A','A',1000),574);
 assert.throws(()=>carriedAccount(previous,{...observation,checkedAt:new Date().toISOString()}),/observation_changed/);
 assert.throws(()=>carriedAccount(previous,observation,Date.parse(observation.checkedAt)+5*60*60*1000+1),/outside_five_hours/);
});
test('fourth freeze cannot legalize changes to existing driver, model, source data or scoring',async()=>{
 const previous=await verifyThirdSegment(),current=await sourceFreeze();validateFourthComparable(previous.protocol.source,current);
 for(const name of ['live.ts','cases.ts','closeout-third.ts','provider.ts','data.ts','review-rules.md']){const changed=structuredClone(current);changed.driver[name]='changed';assert.throws(()=>validateFourthComparable(previous.protocol.source,changed));}
 const model=structuredClone(current);Object.assign(model.model.groups.B,{thinking:'disabled'});assert.throws(()=>validateFourthComparable(previous.protocol.source,model));
 const frozen=await fourthFreeze();assert.equal(frozen.explicitFourthCloseout.remaining.length,21);assert.deepEqual(frozen.explicitFourthCloseout.carriedTotals,carriedTotals);assert.equal(frozen.syntheticDay,'2026-10-26');assert.equal(frozen.explicitFourthCloseout.draftViolationScope,'isolated-task');
});
test('native fourth mock runs D07 ABC only, starts request 574 and keeps all original data and claims',{timeout:180000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r14-offline-fourth-native-')),directory=join(parent,'batch'),claimPath=join(parent,'claim.json'),originalFetch=globalThis.fetch,hadRealClaim=existsSync(fourthClaim),oldLedger=digest(readFileSync(join(thirdDirectory,'ledger.json'))),seen:string[]=[],counts=new Map<string,number>();
 const transport:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(originalFetch)(input,init);
  const row=read<Row[]>(join(directory,'runs.json')).find(r=>r.status==='started')!,n=(counts.get(row.id)??0)+1;counts.set(row.id,n);seen.push(row.id);const body=JSON.parse(String(init?.body));assert.equal(body.model,modelConfiguration[row.group].requestModel);assert.equal(body.max_completion_tokens,32768);
  return fakeResponse(modelConfiguration[row.group].responseModel,n===1?{name:'annotation_read',arguments:{mode:'draft'}}:undefined,'离线原生循环检查。');
 };
 const result=await runFourthCloseout({directory,accountPath,port:4791,offline:{transport,claimPath,prefixSlots:3}});
 assert.equal(result.stop,undefined,JSON.stringify(result));assert.deepEqual(seen,['D07-2-A','D07-2-A','D07-2-B','D07-2-B','D07-2-C','D07-2-C']);assert.ok(result.rows.every(r=>r.status==='recorded'));assert.equal(result.total.requests,579);assert.equal(result.total.input,carriedTotals.input+600);assert.equal(result.total.output,carriedTotals.output+60);
 assert.deepEqual(read<Array<{id:number}>>(join(directory,'attempts.json')).map(a=>a.id),[574,575,576,577,578,579]);const triple=read<{equalInitialBusiness:boolean;syntheticDay:string;ids:string[]}>(join(directory,'D07-r2-triple.json'));assert.equal(triple.equalInitialBusiness,true);assert.equal(triple.syntheticDay,'2026-10-26');assert.deepEqual(triple.ids,['D07-2-A','D07-2-B','D07-2-C']);
 assert.equal(digest(readFileSync(join(thirdDirectory,'ledger.json'))),oldLedger);assert.equal(existsSync(fourthClaim),hadRealClaim);await verifyThirdSegment();
 await assert.rejects(runFourthCloseout({directory:join(parent,'again'),accountPath,port:4791,offline:{transport,claimPath,prefixSlots:3}}),/already claimed/);assert.equal(seen.length,6);
});
