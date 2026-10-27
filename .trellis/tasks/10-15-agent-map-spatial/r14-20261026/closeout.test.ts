import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {closeoutFreeze,verifyOriginal,remainingEntries,validateComparable,validateCloseoutAccount,runCloseout,originalDirectory,closeoutClaim,expectedOriginalTotals} from './closeout.js';
import {sourceFreeze,liveClaim,type Row} from './live.js';
import {schedule} from './cases.js';
import {Ledger,cumulativeAccount,modelConfiguration,validateSeed,type AccountPreflight,type Group} from './budget.js';
import {digest,loopbackOnly} from './runtime.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
const read=<T>(path:string)=>JSON.parse(readFileSync(path,'utf8')) as T;
const accountPath=new URL('./closeout-account-preflight.json',import.meta.url).pathname;

test('all 1076 original evidence files remain frozen; selection is exactly 136 never-started slots',async()=>{
 await assert.rejects(runCloseout({directory:join(originalDirectory,'nested-new-output'),accountPath}),/must_not_modify_original/);
 const old=await verifyOriginal(),remaining=remainingEntries(old.rows);assert.equal(remaining.length,136);assert.deepEqual(remaining,schedule.slice(8));assert.equal(remaining[0].id,'D03-1-B');assert.ok(!remaining.some(r=>['D03-1-A','D03-1-C'].includes(r.id)));
 const altered=structuredClone(old.rows);altered[8].id='D03-1-A';assert.throws(()=>remainingEntries(altered),/original_slot_changed/);
 altered[8]=old.rows[8];altered[8]={...altered[8],status:'started'};assert.throws(()=>remainingEntries(altered),/still_running/);
});
test('closeout rejects task/model/data/scoring drift while allowing only declared evaluator repair',async()=>{
 const old=await verifyOriginal(),current=await sourceFreeze();assert.doesNotThrow(()=>validateComparable(old.protocol.source,current));
 const data=structuredClone(current);data.driver['data.ts']='changed';assert.throws(()=>validateComparable(old.protocol.source,data),/unapproved_driver_change/);
 const scores=structuredClone(current);scores.driver['review-rules.md']='changed';assert.throws(()=>validateComparable(old.protocol.source,scores),/unapproved_driver_change/);
 const model=structuredClone(current);Object.assign(model.model.groups.C,{responseModel:'unexpected'});assert.throws(()=>validateComparable(old.protocol.source,model),/comparison_drift:model/);
 const changed=structuredClone(current);changed.schedule=changed.schedule.slice(1);assert.throws(()=>validateComparable(old.protocol.source,changed),/comparison_drift:schedule/);
});
test('inherited ledger starts new request at 35, keeps old charges once and never restores window allowance',async()=>{
 const old=await verifyOriginal(),dir=await mkdtemp(join(tmpdir(),'r14-offline-closeout-ledger-')),fresh=read<AccountPreflight>(accountPath),account=validateCloseoutAccount(fresh,old),ledger=new Ledger(join(dir,'ledger.json'),'new-freeze',account,old.ledgerSeed);
 for(const key of ['requests','input','output','unknown'] as const)assert.equal(ledger.totals()[key],expectedOriginalTotals[key]);assert.ok(Math.abs(ledger.totals().afp-expectedOriginalTotals.afp)<1e-8);assert.ok(ledger.canStartTriple());
 assert.deepEqual(ledger.read().requests,old.ledgerSeed.requests);assert.equal(ledger.read().halted,undefined);assert.equal(ledger.read().inherited?.halted,'waiting_user_unmapped_plain_question');
 assert.throws(()=>ledger.finish(34,{input:0,output:0}));const id=ledger.begin('D03-1-B','B',1000);assert.equal(id,35);ledger.finish(id,{input:100,output:10});assert.equal(ledger.totals().requests,35);assert.ok(Math.abs(ledger.totals().afp-old.totals.afp-.01375)<1e-8);
 assert.ok(ledger.accountRemaining()<=10000-1000-old.totals.afp-.01375+1e-8);assert.throws(()=>new Ledger(ledger.path,'another',account,old.ledgerSeed));
 const bad=structuredClone(old.ledgerSeed);delete bad.requests[0].usage;assert.throws(()=>validateSeed(bad),/unknown_usage/);
});
test('fresh observed balances lower the cumulative cap without double-charging old requests',async()=>{
 const old=await verifyOriginal(),fresh=read<AccountPreflight>(accountPath),lower={...fresh,remainingAfp:{...fresh.remainingAfp,fiveHour:9700}},cap=cumulativeAccount(old.protocol.account,lower,old.totals.afp);
 assert.ok(Math.abs(cap.remainingAfp.fiveHour-(9700+old.totals.afp))<1e-8);assert.equal(cap.externalUseReserveAfp,1000);assert.ok(Math.abs(cap.remainingAfp.fiveHour-old.totals.afp-cap.externalUseReserveAfp-8700)<1e-8);
 assert.throws(()=>validateCloseoutAccount({...fresh,checkedAt:old.protocol.account.checkedAt},old),/must_follow_original/);
 assert.throws(()=>validateCloseoutAccount(fresh,old,Date.parse(fresh.checkedAt)+5*60*60*1000+1),/five_hour_window/);
});
test('explicit closeout freeze records original stop, preserved usage and only the approved remaining schedule',async()=>{
 const f=await closeoutFreeze();assert.equal(f.explicitCloseout.remaining.length,136);assert.equal(f.explicitCloseout.originalEvidenceCount,1076);assert.deepEqual(f.explicitCloseout.originalTotals,expectedOriginalTotals);assert.ok(['budget.ts','cases.ts','live.ts'].every(n=>f.explicitCloseout.changedDriver.includes(n)));assert.ok(f.explicitCloseout.changedDriver.every(n=>['budget.ts','cases.test.ts','cases.ts','live.ts'].includes(n)));
});
test('native offline continuation executes only D03-B then D04 ABC, preserves old evidence and refuses duplicate claim',{timeout:180000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r14-offline-closeout-native-')),directory=join(parent,'batch'),claimPath=join(parent,'claim.json'),originalFetch=globalThis.fetch,originalClaimHash=digest(readFileSync(liveClaim)),originalLedgerHash=digest(readFileSync(join(originalDirectory,'ledger.json'))),hadRealClaim=existsSync(closeoutClaim);const called:string[]=[];
 const transport:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(originalFetch)(input,init);
  const row=read<Row[]>(join(directory,'runs.json')).find(r=>r.status==='started')!;called.push(row.id);const payload=JSON.parse(String(init?.body));assert.equal(payload.model,modelConfiguration[row.group].requestModel);assert.equal(payload.max_completion_tokens,32768);
  return fakeResponse(modelConfiguration[row.group as Group].responseModel,undefined,'离线续跑接线检查完成。');
 };
 const result=await runCloseout({directory,accountPath,port:4791,offline:{transport,claimPath,prefixSlots:4}});
 assert.equal(result.stop,undefined,JSON.stringify(result));assert.deepEqual(called,['D03-1-B','D04-1-A','D04-1-B','D04-1-C']);assert.ok(result.rows.every(r=>r.status==='recorded'));assert.equal(result.total.requests,38);assert.equal(result.total.input,expectedOriginalTotals.input+400);assert.equal(result.total.output,expectedOriginalTotals.output+40);
 const attempts=read<Array<{id:number;entry:string}>>(join(directory,'attempts.json'));assert.deepEqual(attempts.map(a=>a.id),[35,36,37,38]);assert.equal(attempts.length,4);
 const pair=read<{originalCanonicalHash?:string;canonicalHash:string}>(join(directory,'D03-r1-triple.json'));assert.ok(pair.originalCanonicalHash);assert.equal(pair.canonicalHash,pair.originalCanonicalHash);
 assert.equal(digest(readFileSync(liveClaim)),originalClaimHash);assert.equal(digest(readFileSync(join(originalDirectory,'ledger.json'))),originalLedgerHash);assert.equal(existsSync(closeoutClaim),hadRealClaim);await verifyOriginal();
 await assert.rejects(runCloseout({directory:join(parent,'another'),accountPath,port:4791,offline:{transport,claimPath,prefixSlots:4}}),/already claimed/);assert.equal(called.length,4);
});
