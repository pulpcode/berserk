import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,cp} from 'node:fs/promises';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadQuotaRetry,scheduledBatches,combinedRows,combinedEvidenceIndex,checkpointFor,runLive,liveClaim,continuationClaim,quotaRetryClaim,type Row,type Checkpoint} from './live.js';
import {schedule,type Prepared} from './cases.js';
import {loopbackOnly,hashes} from './runtime.js';
import {modelConfiguration} from './budget.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
const root=fileURLToPath(new URL('.',import.meta.url));
const read=<T>(p:string)=>JSON.parse(readFileSync(p,'utf8')) as T;
const save=(p:string,v:unknown)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n');
async function copyQuotaSource(){
 const parent=await mkdtemp(join(tmpdir(),'r16-offline-quota-retry-')),prior=read<{directory:string}>(continuationClaim),directory=join(parent,'prior');await cp(prior.directory,directory,{recursive:true});
 const paths={claimPath:join(parent,'old-claim.json'),scorePath:join(parent,'scores.json'),authorizationPath:join(parent,'authorization.md')};save(paths.claimPath,{...prior,directory});await cp(join(root,'quota-retry-reused-scores.json'),paths.scorePath);await cp(join(root,'quota-retry-authorization.md'),paths.authorizationPath);return {parent,directory,paths};
}
test('quota retry binds exactly two completed slots, one 429 attempt and 285 unstarted slots without score selection',async()=>{
 const source=await copyQuotaSource(),c=await loadQuotaRetry(source.paths);assert.equal(c.kind,'r16_after_quota_once');assert.deepEqual(c.pending,schedule.slice(2));assert.equal(c.pending.length,286);assert.equal(c.totals.requests,11);assert.equal(c.totals.unknown,1);assert.equal(c.quotaRetry!.reused.id,'Q07-1-G0');assert.equal(c.quotaRetry!.interrupted.id,'Q07-1-GS');assert.equal(c.quotaRetry!.interrupted.stop,'provider_http_429');
 const batches=scheduledBatches(c.pending,c);assert.deepEqual(batches[0],schedule.slice(2,4));assert.equal(batches.length,72);assert.ok(batches.slice(1).every(b=>b.length===4));assert.throws(()=>scheduledBatches(schedule.slice(1),c));assert.throws(()=>scheduledBatches(c.pending.slice(1),c));assert.throws(()=>scheduledBatches(c.pending.slice(0,1),c));
 const rows=c.pending.map(e=>({...e,status:'recorded',semanticReview:'pending',blindId:'new-'+e.id,plannedUserTurns:2,completedUserTurns:2,sentOriginalUserTurns:2,additionalClarificationTurns:0,unissuedOriginalUserTurns:0})) as Row[];
 const combined=combinedRows(rows,c),index=combinedEvidenceIndex(rows,'/new','new-freeze',c);assert.deepEqual(combined.map(e=>e.id),schedule.map(e=>e.id));assert.equal(combined.length,288);assert.deepEqual(combined.slice(0,2),[c.reused,c.quotaRetry!.reused]);assert.equal(index[2].previousInterruptedAttempt?.blindId,c.quotaRetry!.interrupted.blindId);assert.equal(index[2].attemptNumber,2);assert.equal(index.filter(e=>e.reusedByIndependentReview).length,2);
 const point=checkpointFor('new-freeze',rows,{requests:10,input:100,output:50,afp:1,unknown:0},c);assert.deepEqual(point.reusedEntryIds,['Q07-1-GST','Q07-1-G0']);assert.equal(point.rows.length,12);assert.equal(point.combinedTotals.requests,21);assert.equal(point.combinedTotals.unknown,1);assert.equal(point.totals.unknown,0);
 const scores=read<{rows:Array<{blindId:string;strict:string;mainRequirement:string}>}>(source.paths.scorePath),g0=scores.rows.find(s=>s.blindId===c.quotaRetry!.reused.blindId)!;g0.strict='fail';g0.mainRequirement='fail';save(source.paths.scorePath,scores);assert.equal((await loadQuotaRetry(source.paths)).quotaRetry!.reused.id,'Q07-1-G0','completed failure must also be reused, not selected out');
 const errorPath=join(source.directory,'Q07-1-GS','provider-0007-error.txt'),oldError=readFileSync(errorPath);save(errorPath,{error:{code:'RateLimitExceeded'}});await assert.rejects(loadQuotaRetry(source.paths),/retry_requires_original_account_quota_error/);writeFileSync(errorPath,oldError);
 const old=read<Row[]>(join(source.directory,'runs.json'));save(join(source.directory,'runs.json'),old.map((r,i)=>i===2?{...r,status:'started'}:r));await assert.rejects(loadQuotaRetry(source.paths),/quota_retry_cannot_repeat/);save(join(source.directory,'runs.json'),old.map((r,i)=>i===1?{...r,stop:'provider_http_500'}:r));await assert.rejects(loadQuotaRetry(source.paths));
});

test('native quota retry reuses two originals, starts fresh GS once, retains unknown usage, and gates old2 plus new10',{timeout:240000},async()=>{
 const source=await copyQuotaSource(),c=await loadQuotaRetry(source.paths),oldHash=await hashes(source.directory),initialHash=await hashes(c.priorDirectory),claimBytes=[readFileSync(liveClaim),readFileSync(continuationClaim)],hadClaim=existsSync(quotaRetryClaim),directory=join(source.parent,'new'),claimPath=join(source.parent,'new-claim.json'),original=globalThis.fetch,counts=new Map<string,number>(),sent=new Set<string>();let checkpointSeen=false,calls=0;
 const entries=c.pending.slice(0,14);
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);
  const row=read<Row[]>(join(directory,'runs.json')).find(r=>r.status==='started')!;assert.ok(entries.some(e=>e.id===row.id));assert.ok(!['Q07-1-GST','Q07-1-G0'].includes(row.id));sent.add(row.id);calls++;
  if(c.pending.findIndex(e=>e.id===row.id)>=10)assert.equal(checkpointSeen,true);
  if(calls===1){const usage=read<{previous:{requests:number;unknown:number};continuation:{unknown:number}}>(join(directory,'combined-usage.json'));assert.equal(usage.previous.requests,11);assert.equal(usage.previous.unknown,1);assert.equal(usage.continuation.unknown,0);assert.equal(row.id,'Q07-1-GS');assert.notEqual(row.blindId,c.quotaRetry!.interrupted.blindId);}
  const turn=read<Array<{turn:number}>>(join(directory,'attempts.json')).at(-1)!.turn,n=(counts.get(row.id+':'+turn)??0)+1;counts.set(row.id+':'+turn,n);
  if(row.caseId==='Q07'){
   const quartet=read<{ids:string[];canonicalHash:string;reusedEntryIds:string[]}>(join(directory,'Q07-r1-quartet.json'));assert.deepEqual(quartet.ids,schedule.slice(2,4).map(e=>e.id));assert.equal(quartet.canonicalHash,c.canonicalHash);assert.deepEqual(quartet.reusedEntryIds,['Q07-1-GST','Q07-1-G0']);for(const e of schedule.slice(2,4))assert.ok(existsSync(join(directory,e.id,'fixture.json')));
   const p=read<Prepared>(join(directory,row.id,'fixture.json')),old=read<Prepared>(join(source.directory,row.id,'fixture.json'));assert.notEqual(p.fixture.sessionId,old.fixture.sessionId);
   if(turn===0&&n===1)return fakeResponse(modelConfiguration[row.group].responseModel,{name:'spatial_analyze',arguments:{operation:'buffer',input:{kind:'annotation',ref:p.fixture.before.version!.ref,objectIds:['origin']},distanceM:700}});
   return fakeResponse(modelConfiguration[row.group].responseModel,undefined,turn===1?'当前范围是此前的固定只读结果，没有保存、发布或采用。本轮没有再次计算。如果要把它变成草稿对象，需要你另行要求保存。':'700米范围已经生成，只预览，没有保存。');
  }
  return fakeResponse(modelConfiguration[row.group].responseModel,undefined,'当前要求已处理，结果以本轮记录为准。');
 };
 const onCheckpoint=async(point:Checkpoint,batch:string)=>{assert.equal(sent.size,10);assert.equal(checkpointSeen,false);assert.deepEqual(point.ids,schedule.slice(0,12).map(e=>e.id));assert.deepEqual(point.rows.slice(0,2),[c.reused,c.quotaRetry!.reused]);assert.equal(point.combinedTotals.requests,point.totals.requests+11);assert.equal(point.combinedTotals.unknown,1);assert.equal(point.totals.unknown,0);checkpointSeen=true;save(join(batch,'checkpoint-12-approval.json'),{freezeHash:point.freezeHash,ids:point.ids,decision:'continue_remaining_276'});};
 const result=await runLive({directory,port:4837,retryAfterQuota:true,offline:{entries,claimPath,quotaRetrySource:source.paths,transport,onCheckpoint}});assert.equal(result.stop,undefined,JSON.stringify(result));assert.equal(result.rows.length,286);assert.equal(sent.size,14);assert.equal(result.rows.filter(r=>r.status==='recorded').length,14);assert.ok(result.rows.slice(14).every(r=>r.status==='not_executed'));assert.equal(result.total.requests,calls);assert.equal(result.total.unknown,0);assert.equal(checkpointSeen,true);
 const combined=read<Row[]>(join(directory,'combined-runs.json'));assert.equal(combined.length,288);assert.deepEqual(combined.map(e=>e.id),schedule.map(e=>e.id));assert.deepEqual(combined.slice(0,2),[c.reused,c.quotaRetry!.reused]);assert.equal(combined[2].id,'Q07-1-GS');assert.notEqual(combined[2].blindId,c.quotaRetry!.interrupted.blindId);
 const attempts=read<Array<{row:Row}>>(join(directory,'prior-interrupted-attempts.json'));assert.equal(attempts.length,1);assert.deepEqual(attempts[0].row,c.quotaRetry!.interrupted);const usage=read<{total:{requests:number;unknown:number};knownUsageOnly:boolean}>(join(directory,'combined-usage.json'));assert.equal(usage.total.requests,calls+11);assert.equal(usage.total.unknown,1);assert.equal(usage.knownUsageOnly,true);
 assert.deepEqual(await hashes(source.directory),oldHash);assert.deepEqual(await hashes(c.priorDirectory),initialHash);assert.deepEqual(readFileSync(liveClaim),claimBytes[0]);assert.deepEqual(readFileSync(continuationClaim),claimBytes[1]);assert.equal(existsSync(quotaRetryClaim),hadClaim);
 await assert.rejects(runLive({directory:join(source.parent,'again'),retryAfterQuota:true,offline:{entries,claimPath,quotaRetrySource:source.paths,transport}}),/already claimed/);
});

test('a new quota failure halts this authorized retry without another retry or further tasks',{timeout:120000},async()=>{
 const source=await copyQuotaSource(),c=await loadQuotaRetry(source.paths),directory=join(source.parent,'failed'),claimPath=join(source.parent,'new-claim.json'),original=globalThis.fetch;let calls=0;
 const transport:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);calls++;return new Response('mock quota failure',{status:429});};
 const result=await runLive({directory,port:4837,retryAfterQuota:true,offline:{entries:c.pending.slice(0,2),claimPath,quotaRetrySource:source.paths,transport}});assert.equal(calls,1);assert.equal(result.stop,'provider_http_429');assert.equal(result.rows[0].id,'Q07-1-GS');assert.equal(result.rows[0].status,'incomplete');assert.ok(result.rows.slice(1).every(r=>r.status==='not_executed'));assert.equal(result.total.unknown,1);
 const usage=read<{previous:{requests:number;unknown:number};total:{requests:number;unknown:number}}>(join(directory,'combined-usage.json'));assert.equal(usage.previous.requests,11);assert.equal(usage.previous.unknown,1);assert.equal(usage.total.requests,12);assert.equal(usage.total.unknown,2);assert.equal(existsSync(join(directory,'checkpoint-12.json')),false);
 await assert.rejects(runLive({directory:join(source.parent,'again'),retryAfterQuota:true,offline:{entries:c.pending.slice(0,2),claimPath,quotaRetrySource:source.paths,transport}}),/already claimed/);assert.equal(calls,1);
});
