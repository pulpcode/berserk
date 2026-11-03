import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,cp} from 'node:fs/promises';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadQ07Continuation,scheduledBatches,combinedRows,checkpointFor,runLive,liveClaim,continuationClaim,type Row} from './live.js';
import {schedule,type Prepared} from './cases.js';
import {loopbackOnly,hashes} from './runtime.js';
import {modelConfiguration} from './budget.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
import type {Payload} from '../r12-20261025/reasoning-prepare.js';
const root=fileURLToPath(new URL('.',import.meta.url));
const read=<T>(path:string)=>JSON.parse(readFileSync(path,'utf8')) as T;
const save=(path:string,data:unknown)=>writeFileSync(path,JSON.stringify(data,null,2)+'\n');
async function copiedPrior(){
 const parent=await mkdtemp(join(tmpdir(),'r16-offline-continuation-')),prior=read<{directory:string}>(liveClaim),directory=join(parent,'prior');await cp(prior.directory,directory,{recursive:true});
 const paths={claimPath:join(parent,'prior-claim.json'),scorePath:join(parent,'score.json'),authorizationPath:join(parent,'authorization.md')};save(paths.claimPath,{...prior,directory});await cp(join(root,'continuation-reused-score.json'),paths.scorePath);await cp(join(root,'continuation-authorization.md'),paths.authorizationPath);return {parent,directory,paths};
}
test('only the approved Q07 first slot can be reused; schedules, usage, original states and scores remain bound',async()=>{
 const source=await copiedPrior(),c=await loadQ07Continuation(source.paths);assert.equal(c.reused.id,'Q07-1-GST');assert.equal(c.reused.status,'waiting_user');assert.equal(c.reused.completedUserTurns,1);assert.equal(c.pending.length,287);assert.deepEqual(c.pending,schedule.slice(1));assert.equal(c.totals.requests,4);
 const batches=scheduledBatches(c.pending,c);assert.equal(batches.length,72);assert.deepEqual(batches[0],schedule.slice(1,4));assert.ok(batches.slice(1).every(b=>b.length===4));assert.throws(()=>scheduledBatches(schedule,c));assert.throws(()=>scheduledBatches(c.pending.slice(1),c));assert.throws(()=>scheduledBatches(c.pending.slice(0,2),c));assert.throws(()=>scheduledBatches([c.pending[1],c.pending[0],...c.pending.slice(2)],c));
 const rows=c.pending.map(e=>({...e,status:'recorded',semanticReview:'pending',plannedUserTurns:2,completedUserTurns:2,sentOriginalUserTurns:2,additionalClarificationTurns:0,unissuedOriginalUserTurns:0})) as Row[],all=combinedRows(rows,c);assert.equal(all.length,288);assert.deepEqual(all.map(r=>r.id),schedule.map(e=>e.id));assert.equal(all[0].blindId,c.reused.blindId);assert.equal(all[0].status,'waiting_user');
 const point=checkpointFor('f',rows,{requests:30,input:100,output:50,afp:1,unknown:0},c);assert.equal(point.rows.length,12);assert.equal(point.reusedEntryId,c.reused.id);assert.equal(point.combinedTotals.requests,34);assert.equal(point.rows[0].completedUserTurns,1);assert.throws(()=>checkpointFor('f',rows.map((r,i)=>i===10?{...r,status:'not_executed'}:r),point.totals,c));
 const oldRows=read<Row[]>(join(source.directory,'runs.json'));save(join(source.directory,'runs.json'),oldRows.map((r,i)=>i===1?{...r,status:'started'}:r));await assert.rejects(loadQ07Continuation(source.paths),/only_unstarted_slots/);save(join(source.directory,'runs.json'),oldRows);
 const score=read<{rows:Array<{strict:string}>}>(source.paths.scorePath);score.rows[0].strict='fail';save(source.paths.scorePath,score);await assert.rejects(loadQ07Continuation(source.paths));
});

test('native continuation preserves old slot, completes history-only Q07, reviews old1+new11, then dispatches only remaining slots',{timeout:240000},async()=>{
 const source=await copiedPrior(),prior=await loadQ07Continuation(source.paths),before=await hashes(source.directory),oldClaimBytes=readFileSync(source.paths.claimPath),originalClaimBytes=readFileSync(liveClaim),hadContinuation=existsSync(continuationClaim),directory=join(source.parent,'new'),claimPath=join(source.parent,'continuation-claim.json'),original=globalThis.fetch,counts=new Map<string,number>();let checkpointSeen=false,calls=0;
 const entries=prior.pending.slice(0,15),sent=new Set<string>();
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);
  const row=read<Row[]>(join(directory,'runs.json')).find(r=>r.status==='started')!;assert.notEqual(row.id,prior.reused.id);assert.ok(entries.some(e=>e.id===row.id));sent.add(row.id);calls++;
  const turn=read<Array<{turn:number}>>(join(directory,'attempts.json')).at(-1)!.turn,n=(counts.get(row.id+':'+turn)??0)+1;counts.set(row.id+':'+turn,n);const payload=JSON.parse(String(init?.body)) as Payload;
  if(prior.pending.findIndex(e=>e.id===row.id)>=11)assert.equal(checkpointSeen,true);
  if(row.caseId==='Q07'){
   const quartet=read<{ids:string[];canonicalHash:string;fullQuartetIds:string[]}>(join(directory,'Q07-r1-quartet.json'));assert.deepEqual(quartet.ids,schedule.slice(1,4).map(e=>e.id));assert.equal(quartet.canonicalHash,prior.canonicalHash);assert.deepEqual(quartet.fullQuartetIds,schedule.slice(0,4).map(e=>e.id));
   for(const peer of schedule.slice(1,4))assert.ok(existsSync(join(directory,peer.id,'fixture.json')));
   const p=read<Prepared>(join(directory,row.id,'fixture.json'));
   if(turn===0&&n===1)return fakeResponse(modelConfiguration[row.group].responseModel,{name:'spatial_analyze',arguments:{operation:'buffer',input:{kind:'annotation',ref:p.fixture.before.version!.ref,objectIds:['origin']},distanceM:700}});
   if(turn===1){assert.equal(n,1);assert.ok(payload.messages.some(m=>m.role==='tool'));return fakeResponse(modelConfiguration[row.group].responseModel,undefined,'当前700米范围是此前生成的固定只读分析结果，没有保存、发布或采用。本轮没有再次计算，也没有调用工具。如果要把它变成草稿对象，需要你另行要求保存；保存不会自动发布或采用。');}
   return fakeResponse(modelConfiguration[row.group].responseModel,undefined,'700米范围已生成，仅预览，没有保存。');
  }
  // Deliberately incomplete business answers still advance; semantic grading is separate.
  return fakeResponse(modelConfiguration[row.group].responseModel,undefined,'当前要求已经处理，具体结果以本轮记录为准。');
 };
 const onCheckpoint=async(checkpoint:Parameters<NonNullable<NonNullable<Parameters<typeof runLive>[0]['offline']>['onCheckpoint']>>[0],batch:string)=>{assert.equal(checkpointSeen,false);assert.equal(sent.size,11);assert.equal(checkpoint.rows[0].id,prior.reused.id);assert.equal(checkpoint.rows[0].status,'waiting_user');assert.equal(checkpoint.rows[0].blindId,prior.reused.blindId);assert.deepEqual(checkpoint.ids,schedule.slice(0,12).map(e=>e.id));assert.equal(checkpoint.combinedTotals.requests,checkpoint.totals.requests+4);checkpointSeen=true;save(join(batch,'checkpoint-12-approval.json'),{freezeHash:checkpoint.freezeHash,ids:checkpoint.ids,decision:'continue_remaining_276'});};
 const result=await runLive({directory,port:4837,continueAfterQ07:true,offline:{entries,claimPath,continuationSource:source.paths,transport,onCheckpoint}});
 assert.equal(result.stop,undefined,JSON.stringify(result));assert.equal(result.rows.length,287);assert.equal(sent.size,15);assert.equal(result.rows.filter(r=>r.status==='recorded').length,15);assert.ok(result.rows.slice(15).every(r=>r.status==='not_executed'));assert.equal(result.total.requests,calls);assert.equal(checkpointSeen,true);
 for(const row of result.rows.filter(r=>r.caseId==='Q07'&&r.round===1)){assert.equal(row.completedUserTurns,2);assert.equal(row.sentOriginalUserTurns,2);assert.equal(row.additionalClarificationTurns,0);assert.equal(row.unissuedOriginalUserTurns,0);const ledger=read<Array<{status:string;completed:boolean}>>(join(directory,row.id,'turn-ledger.json'));assert.ok(ledger.every(t=>t.status==='completed'&&t.completed));const second=read<{snapshot:{lastResult:{status:string};messages:Array<{role:string;requestId:string}>}}>(join(directory,row.id,'turn-2.json'));assert.equal(second.snapshot.lastResult.status,'succeeded');}
 const combined=read<Row[]>(join(directory,'combined-runs.json'));assert.equal(combined.length,288);assert.deepEqual(combined[0],prior.reused);assert.deepEqual(combined.map(e=>e.id),schedule.map(e=>e.id));const index=read<Array<{evidenceDirectory:string;reusedByIndependentReview:boolean}>>(join(directory,'combined-evidence-index.json'));assert.equal(index[0].evidenceDirectory,join(source.directory,prior.reused.id));assert.equal(index.filter(e=>e.reusedByIndependentReview).length,1);assert.equal(existsSync(join(directory,prior.reused.id)),false);
 assert.deepEqual(await hashes(source.directory),before);assert.deepEqual(readFileSync(source.paths.claimPath),oldClaimBytes);assert.deepEqual(readFileSync(liveClaim),originalClaimBytes);assert.equal(existsSync(continuationClaim),hadContinuation);
 await assert.rejects(runLive({directory:join(source.parent,'again'),port:4837,continueAfterQ07:true,offline:{entries,claimPath,continuationSource:source.paths,transport}}),/already claimed/);
});
