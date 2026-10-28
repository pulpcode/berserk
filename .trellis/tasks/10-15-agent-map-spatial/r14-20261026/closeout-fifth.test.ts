import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {verifyFourthSegment,fifthFreeze,validateFifthComparable,runFifthCloseout,carriedAccount,carriedTotals,fifthClaim} from './closeout-fifth.js';
import {fourthDirectory} from './closeout-fourth.js';
import {sourceFreeze,type Row} from './live.js';
import {schedule,plainClarificationKind,type Prepared} from './cases.js';
import {Ledger,modelConfiguration,type AccountPreflight} from './budget.js';
import {loopbackOnly,digest} from './runtime.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
import type {SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
const read=<T>(path:string)=>JSON.parse(readFileSync(path,'utf8')) as T;
const accountPath=new URL('./third-closeout-account-preflight.json',import.meta.url).pathname;
test('fourth raw evidence and drivers remain intact; only original final 11 slots may execute',async()=>{
 const previous=await verifyFourthSegment();assert.deepEqual(previous.remaining,schedule.slice(133));assert.equal(previous.remaining.length,11);assert.equal(previous.remaining[0].id,'D04-2-B');assert.ok(!previous.remaining.some(r=>r.id==='D04-2-A'));
 await assert.rejects(runFifthCloseout({directory:join(fourthDirectory,'do-not-write'),accountPath}),/must_not_modify_prior_evidence/);
});
test('original D04-2-A has completed the allowed missing-field answer; optional conditional work is not blocking',()=>{
 const path=join(fourthDirectory,'D04-2-A/review.json'),bytes=readFileSync(path),raw=JSON.parse(bytes.toString()) as {fixture:Prepared;final:SessionSnapshot;entry:{stop:string};interactions:unknown[]};
 assert.match(String(raw.fixture.truth.scoring),/正确说明缺口就是本题完成/);
 const text=raw.final.messages.filter(m=>m.role==='assistant').at(-1)!.text;assert.ok(text.includes('资源点数量：3'));assert.ok(text.includes('合计 6 辆'));assert.ok(text.includes('没有 `availableCount` 字段'));assert.ok(text.includes('不能确定'));assert.equal(raw.interactions.length,0);
 assert.equal(plainClarificationKind(raw.fixture,raw.final),'none');assert.equal(raw.entry.stop,'waiting_user_unmapped_plain_question');assert.equal(digest(readFileSync(path)),digest(bytes));
});
test('609 inherited requests debit the same old window cap exactly once, and duplicate completion is rejected',async()=>{
 const previous=await verifyFourthSegment(),observation=read<AccountPreflight>(accountPath),account=carriedAccount(previous,observation),dir=await mkdtemp(join(tmpdir(),'r14-offline-fifth-ledger-')),ledger=new Ledger(join(dir,'ledger.json'),'offline-fifth',account,previous.ledgerSeed);
 assert.deepEqual(account,previous.protocol.account);assert.equal(ledger.totals().requests,609);assert.ok(Math.abs(ledger.accountRemaining()-(10000-1000-carriedTotals.afp))<1e-8);assert.equal(ledger.read().halted,undefined);assert.equal(ledger.read().inherited?.halted,'waiting_user_unmapped_plain_question');
 assert.throws(()=>ledger.finish(609,{input:0,output:0}));assert.equal(ledger.begin('D04-2-B','B',1000),610);
 assert.throws(()=>carriedAccount(previous,{...observation,checkedAt:new Date().toISOString()}),/observation_changed/);
 assert.throws(()=>carriedAccount(previous,observation,Date.parse(observation.checkedAt)+5*60*60*1000+1),/outside_five_hours/);
});
test('fifth freeze cannot legalize changes to existing driver, model, source data or scoring',async()=>{
 const previous=await verifyFourthSegment(),current=await sourceFreeze();validateFifthComparable(previous.protocol.source,current);
 for(const name of ['live.ts','budget.ts','closeout-fourth.ts','provider.ts','data.ts','case-specs.json','review-rules.md']){const changed=structuredClone(current);changed.driver[name]='changed';assert.throws(()=>validateFifthComparable(previous.protocol.source,changed));}
 const model=structuredClone(current);Object.assign(model.model.groups.B,{thinking:'disabled'});assert.throws(()=>validateFifthComparable(previous.protocol.source,model));
 const approved=structuredClone(current);approved.driver['cases.ts']='approved-conditional-offer-change';validateFifthComparable(previous.protocol.source,approved);
 const frozen=await fifthFreeze();assert.equal(frozen.explicitFifthCloseout.remaining.length,11);assert.deepEqual(frozen.explicitFifthCloseout.carriedTotals,carriedTotals);assert.equal(frozen.syntheticDay,'2026-10-26');assert.equal(frozen.explicitFifthCloseout.draftViolationScope,'isolated-task');
});
test('native fifth mock runs remaining D04 BC only, starts request 610 and keeps all original data and claims',{timeout:180000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r14-offline-fifth-native-')),directory=join(parent,'batch'),claimPath=join(parent,'claim.json'),originalFetch=globalThis.fetch,hadRealClaim=existsSync(fifthClaim),oldLedger=digest(readFileSync(join(fourthDirectory,'ledger.json'))),seen:string[]=[],counts=new Map<string,number>();
 const transport:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(originalFetch)(input,init);
  const row=read<Row[]>(join(directory,'runs.json')).find(r=>r.status==='started')!,n=(counts.get(row.id)??0)+1;counts.set(row.id,n);seen.push(row.id);const body=JSON.parse(String(init?.body));assert.equal(body.model,modelConfiguration[row.group].requestModel);assert.equal(body.max_completion_tokens,32768);
  return fakeResponse(modelConfiguration[row.group].responseModel,n===1?{name:'annotation_read',arguments:{mode:'draft'}}:undefined,'离线原生循环检查。');
 };
 const result=await runFifthCloseout({directory,accountPath,port:4791,offline:{transport,claimPath,prefixSlots:2}});
 assert.equal(result.stop,undefined,JSON.stringify(result));assert.deepEqual(seen,['D04-2-B','D04-2-B','D04-2-C','D04-2-C']);assert.ok(result.rows.every(r=>r.status==='recorded'));assert.equal(result.total.requests,613);assert.equal(result.total.input,carriedTotals.input+400);assert.equal(result.total.output,carriedTotals.output+40);
 assert.deepEqual(read<Array<{id:number}>>(join(directory,'attempts.json')).map(a=>a.id),[610,611,612,613]);const triple=read<{equalInitialBusiness:boolean;syntheticDay:string;ids:string[]}>(join(directory,'D04-r2-triple.json'));assert.equal(triple.equalInitialBusiness,true);assert.equal(triple.syntheticDay,'2026-10-26');assert.deepEqual(triple.ids,['D04-2-B','D04-2-C']);
 assert.equal(digest(readFileSync(join(fourthDirectory,'ledger.json'))),oldLedger);assert.equal(existsSync(fifthClaim),hadRealClaim);await verifyFourthSegment();
 await assert.rejects(runFifthCloseout({directory:join(parent,'again'),accountPath,port:4791,offline:{transport,claimPath,prefixSlots:2}}),/already claimed/);assert.equal(seen.length,4);
});
