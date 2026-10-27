import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {verifyFirstSegment,secondFreeze,runSecondCloseout,validateSecondComparable,firstDirectory,carriedTotals} from './closeout-second.js';
import {originalDirectory,closeoutClaim,validateCloseoutAccount} from './closeout.js';
import {schedule,plainClarificationKind,clarificationResponse,type Prepared} from './cases.js';
import {sourceFreeze,type Row} from './live.js';
import {Ledger,modelConfiguration,type AccountPreflight} from './budget.js';
import {digest,loopbackOnly} from './runtime.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
import type {SessionSnapshot,Interaction} from '../../../../experiments/harness-lab/src/contracts/index.js';
const read=<T>(p:string)=>JSON.parse(readFileSync(p,'utf8')) as T;
const accountPath=new URL('./second-closeout-account-preflight.json',import.meta.url).pathname;
test('second segment preserves both evidence trees, selects exactly original slots 20-144 and carries 75 requests once',async()=>{
 const first=await verifyFirstSegment();assert.deepEqual(first.remaining,schedule.slice(19));assert.equal(first.remaining.length,125);assert.equal(first.remaining[0].id,'D07-1-B');
 assert.deepEqual(first.ledgerSeed.requests.slice(0,34),first.original.ledgerSeed.requests);
 const dir=await mkdtemp(join(tmpdir(),'r14-second-ledger-')),fresh=read<AccountPreflight>(accountPath),account=validateCloseoutAccount(fresh,first),ledger=new Ledger(join(dir,'ledger.json'),'offline-second',account,first.ledgerSeed);
 assert.equal(ledger.totals().requests,75);assert.equal(ledger.totals().input,carriedTotals.input);assert.ok(Math.abs(ledger.totals().afp-carriedTotals.afp)<1e-8);assert.ok(ledger.accountRemaining()<=10000-carriedTotals.afp-1000+1e-8);
 assert.throws(()=>ledger.finish(75,{input:0,output:0}));assert.equal(ledger.begin('D07-1-B','B',1000),76);
 for(const directory of [originalDirectory,join(firstDirectory,'nested')])await assert.rejects(runSecondCloseout({directory,accountPath}),/must_not_modify_prior_evidence/);
});
test('second freeze binds prior segments and only permits clarification repair in previously frozen drivers',async()=>{
 const first=await verifyFirstSegment(),current=await sourceFreeze();validateSecondComparable(first.protocol.source,current);
 for(const name of ['closeout.ts','live.ts','budget.ts','data.ts','review-rules.md']){const changed=structuredClone(current);changed.driver[name]='changed';assert.throws(()=>validateSecondComparable(first.protocol.source,changed),/second_unapproved/);}
 const frozen=await secondFreeze();assert.equal(frozen.explicitSecondCloseout.remaining.length,125);assert.deepEqual(frozen.explicitSecondCloseout.carriedTotals,carriedTotals);assert.ok(frozen.explicitSecondCloseout.protocolHash);
});
test('all 19 actually returned responses replay without the two optional-offer false stops; original incomplete cases retain their kind',async()=>{
 const first=await verifyFirstSegment();let checked=0;
 for(const [directory,rows] of [[originalDirectory,first.original.rows],[firstDirectory,first.rows]] as const)for(const row of rows.filter(r=>r.status!=='not_executed')){
  const raw=read<{fixture:Prepared;final:SessionSnapshot;interactions:Array<{observed:Interaction}>}>(join(directory,row.id,'review.json')),kind=plainClarificationKind(raw.fixture,raw.final);
  const expected:Record<string,string>={'D05-1-B':'unnecessary','D05-1-C':'unsupported','D06-1-A':'allowed'};assert.equal(kind,expected[row.id]??'none',row.id);
  if(row.id==='D05-1-C'){const item=raw.interactions[0].observed;assert.equal(item.kind,'question');assert.equal(clarificationResponse(raw.fixture,item,false),undefined);if(item.kind==='question')assert.equal(plainClarificationKind(raw.fixture,{messages:[{role:'assistant',text:item.questions.map(q=>q.prompt).join('。')}]} as SessionSnapshot),'unnecessary','actual API prompt branch records incomplete without batch stop');}
  checked++;
 }
 assert.equal(checked,19);
});
test('native second continuation starts at D07 B/C with original A canonical, request 76, no repeated completed slot or charge',{timeout:180000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r14-offline-second-')),directory=join(parent,'batch'),claimPath=join(parent,'claim.json'),originalFetch=globalThis.fetch,oldClaim=digest(readFileSync(closeoutClaim)),called:string[]=[];
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(originalFetch)(input,init);
  const row=read<Row[]>(join(directory,'runs.json')).find(r=>r.status==='started')!;called.push(row.id);
  const body=JSON.parse(String(init?.body));assert.equal(body.model,modelConfiguration[row.group].requestModel);assert.equal(body.max_completion_tokens,32768);
  return fakeResponse(modelConfiguration[row.group].responseModel,undefined,'离线流程检查。需要我将结果另行汇总吗？');
 };
 const result=await runSecondCloseout({directory,accountPath,port:4791,offline:{transport,claimPath,prefixSlots:2}});
 assert.equal(result.stop,undefined,JSON.stringify(result));assert.deepEqual(called,['D07-1-B','D07-1-C']);assert.ok(result.rows.every(r=>r.status==='recorded'));assert.equal(result.total.requests,77);assert.equal(result.total.input,carriedTotals.input+200);assert.equal(result.total.output,carriedTotals.output+20);
 assert.deepEqual(read<Array<{id:number}>>(join(directory,'attempts.json')).map(r=>r.id),[76,77]);
 const triple=read<{canonicalHash:string;originalCanonicalHash:string}>(join(directory,'D07-r1-triple.json'));assert.equal(triple.canonicalHash,triple.originalCanonicalHash);assert.ok(triple.originalCanonicalHash);
 assert.equal(digest(readFileSync(closeoutClaim)),oldClaim);await verifyFirstSegment();
 await assert.rejects(runSecondCloseout({directory:join(parent,'another'),accountPath,port:4791,offline:{transport,claimPath,prefixSlots:2}}),/already claimed/);assert.equal(called.length,2);
});
