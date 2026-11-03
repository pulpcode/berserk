import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {validateSourceMetadata,validateCarryoverLedger,carriedLedger,assertFreshResumeDirectory,inspectResumeSource,reusedIds,remainingIds} from './resume.js';
import {Ledger,type LedgerData} from './budget.js';
const source=resolve('.local/resource-independent-acceptance/20261103-live-01');
const protocolBytes=readFileSync(join(source,'protocol.json')),ledgerBytes=readFileSync(join(source,'ledger.json'));
const original=JSON.parse(ledgerBytes.toString()) as LedgerData;
test('pinned old batch and archived evidence validate without modifying originals',()=>{
 const before=readFileSync(join(source,'ledger.json'));const inspected=inspectResumeSource(source);assert.equal(Object.keys(inspected.bytes).length,10);assert.deepEqual(readFileSync(join(source,'ledger.json')),before);assert.deepEqual(reusedIds,['P01-1','P02-1','P03-1','P04-1','N01-1','N02-1','N03-1','N04-1','N05-1','N06-1']);assert.equal(remainingIds.length,10);assert.equal(remainingIds[0],'N07-1');
});
test('new ledger carries all metered attempts and budget, preserves original halted ledger',()=>{
 const copied=structuredClone(original),next=carriedLedger(copied,'a'.repeat(64));assert.deepEqual(copied,original);assert.equal(next.halted,undefined);assert.deepEqual(next.attempts,original.attempts);
 const dir=mkdtempSync(join(tmpdir(),'acceptance-resume-budget-')),path=join(dir,'ledger.json');writeFileSync(path,JSON.stringify(next));const ledger=new Ledger(path,next.freezeHash,true);assert.equal(ledger.totals().requests,48);assert.equal(ledger.totals().input,1_624_623);assert.equal(ledger.totals().output,35_216);assert.equal(ledger.begin('N07-1',100,100),49);assert.equal(ledger.totals().requests,49);
});
for(const [name,alter] of Object.entries({unknown:(x:LedgerData)=>{delete x.attempts[0].usage;},pending:(x:LedgerData)=>{x.attempts[0].status='pending';},halt:(x:LedgerData)=>{x.halted='unknown_provider_usage';},n07:(x:LedgerData)=>{x.attempts[0].trialId='N07-1';},model:(x:LedgerData)=>{x.responseModel='changed';},usage:(x:LedgerData)=>{x.attempts[0].usage!.input++;}}))test('reject invalid carryover '+name,()=>{const x=structuredClone(original);alter(x);assert.throws(()=>validateCarryoverLedger(x));});
test('reject changed pinned protocol and ledger even if JSON parses',()=>{assert.throws(()=>validateSourceMetadata(Buffer.concat([protocolBytes,Buffer.from(' ')]),ledgerBytes));assert.throws(()=>validateSourceMetadata(protocolBytes,Buffer.concat([ledgerBytes,Buffer.from(' ')])));});
test('existing destination is not a retry target',()=>assert.throws(()=>assertFreshResumeDirectory(source)));
