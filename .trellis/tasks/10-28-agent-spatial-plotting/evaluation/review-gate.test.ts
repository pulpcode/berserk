import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runReviewedTurns,type Evidence,type Decision,type Checkpoint} from './review-gate.js';
const directory=async()=>join(await mkdtemp(join(tmpdir(),'integrated-review-')),'gate');
const evidence=(text:string):Evidence=>({sessionId:'isolated-session',requestId:'settled-request',status:'succeeded',snapshot:{text},mapState:{revision:1},pendingInteraction:false});
const decision=(c:Checkpoint,action:Decision['action'],replyId?:string):Decision=>({checkpointHash:c.hash,reviewer:'offline-scripted-review',reason:'Fixed test decision; not human or model grading',action,...replyId?{replyId}:{}});
test('historical optional offer and evidence explanation advance without resending the original question',async()=>{
 const rows=JSON.parse(await readFile(new URL('./historical-endings.json',import.meta.url),'utf8')) as Array<{id:string;evidence:Evidence}>;
 for(const row of rows){
  const sent:string[]=[],dir=await directory();let current=row.evidence;
  const result=await runReviewedTurns({directory:dir,prompts:['历史第一轮','既定保存或后续轮'],replies:[],ports:{send:async text=>{sent.push(text);current=sent.length===1?row.evidence:evidence('后续已处理');return current;},inspect:async()=>current,review:async c=>decision(c,'advance')}});
  assert.deepEqual(sent,['历史第一轮','既定保存或后续轮']);assert.equal(result.accepted,2);
  assert.equal(result.semanticReview,'pending');
  await assert.rejects(runReviewedTurns({directory:dir,prompts:['历史第一轮'],replies:[],ports:{send:async()=>{throw new Error('must not send');},inspect:async()=>current,review:async c=>decision(c,'advance')}}),/EEXIST/);
 }
});
test('necessary clarification consumes only a frozen reply and does not repeat the task',async()=>{
 const sent:string[]=[];let current=evidence('');
 const result=await runReviewedTurns({directory:await directory(),prompts:['请生成范围','保存刚才固定结果'],replies:[{id:'origin',userTurn:0,text:'以origin为中心'}],ports:{send:async text=>{sent.push(text);current=evidence(sent.length===1?'请选择中心':'已完成');return current;},inspect:async()=>current,review:async c=>decision(c,c.index===1?'reply':'advance',c.index===1?'origin':undefined)}});
 assert.deepEqual(sent,['请生成范围','以origin为中心','保存刚才固定结果']);assert.equal(result.accepted,2);
});
test('unknown question remains unresolved; wrong but answered task can advance without semantic credit',async()=>{
 let sends=0;const current=evidence('需要未知的新业务数据');
 const held=await runReviewedTurns({directory:await directory(),prompts:['题一','题二'],replies:[],ports:{send:async()=>{sends++;return current;},inspect:async()=>current,review:async c=>decision(c,'hold')}});
 assert.equal(sends,1);assert.equal(held.status,'needs_review');
 const wrong=evidence('实际数量4但回答3');
 const result=await runReviewedTurns({directory:await directory(),prompts:['统计'],replies:[],ports:{send:async()=>wrong,inspect:async()=>wrong,review:async c=>decision(c,'advance')}});
 assert.equal(result.status,'recorded');assert.equal(result.semanticReview,'pending');
});
test('wait preserves service ownership; stale review, state drift and unfrozen replies cannot continue',async()=>{
 for(const kind of ['stale','drift','reply'] as const){
  let sends=0;const current=evidence('问题');
  await assert.rejects(runReviewedTurns({directory:await directory(),prompts:['题一','题二'],replies:[],ports:{send:async()=>{sends++;return current;},inspect:async()=>kind==='drift'?evidence('changed'):current,review:async c=>({...decision(c,kind==='reply'?'reply':'advance',kind==='reply'?'unknown':undefined),checkpointHash:kind==='stale'?'wrong':c.hash})}}));
  assert.equal(sends,1);
 }
 let release!:(d:Decision)=>void,pending!:Checkpoint,sends=0;const current=evidence('可选邀请');
 const running=runReviewedTurns({directory:await directory(),prompts:['题一'],replies:[],ports:{send:async()=>{sends++;return current;},inspect:async()=>current,review:async c=>{pending=c;return new Promise<Decision>(resolve=>{release=resolve;});}}});
 while(!release)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(sends,1);release(decision(pending,'advance'));assert.equal((await running).accepted,1);
});
test('pending AskUser or failed request never becomes a new chat answer; transport failure never retries',async()=>{
 for(const current of [{...evidence('ask'),pendingInteraction:true},{...evidence('failed'),status:'failed' as const}]){
  const result=await runReviewedTurns({directory:await directory(),prompts:['题一','题二'],replies:[],ports:{send:async()=>current,inspect:async()=>current,review:async()=>{throw new Error('must not review unsettled request');}}});
  assert.equal(result.status,'needs_review');assert.equal(result.dispatched,1);
 }
 let sends=0;await assert.rejects(runReviewedTurns({directory:await directory(),prompts:['题一'],replies:[],ports:{send:async()=>{sends++;throw new Error('transport unknown');},inspect:async()=>evidence(''),review:async c=>decision(c,'advance')}}),/transport unknown/);assert.equal(sends,1);
});
test('scripted reply that repeats original wording is still recorded as a reply',async()=>{
 const dir=await directory(),current=evidence('请重述');let calls=0;
 await runReviewedTurns({directory:dir,prompts:['同样的文字'],replies:[{id:'repeat',userTurn:0,text:'同样的文字'}],ports:{send:async()=>{calls++;return current;},inspect:async()=>current,review:async c=>decision(c,c.index===1?'reply':'advance',c.index===1?'repeat':undefined)}});
 assert.equal(calls,2);assert.equal(JSON.parse(await readFile(join(dir,'1-dispatch.json'),'utf8')).kind,'original');assert.equal(JSON.parse(await readFile(join(dir,'2-dispatch.json'),'utf8')).kind,'scripted_reply');
});
