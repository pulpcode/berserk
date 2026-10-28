/** Evaluation-only continuation gate. Never interpret free prose using keywords. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface Evidence {
 sessionId:string; requestId:string; status:'succeeded'|'failed'|'pending';
 snapshot:unknown; mapState:unknown;
 /** Pending AskUser must use its existing interaction endpoint, never a new chat turn. */
 pendingInteraction:boolean;
}
export interface Checkpoint {index:number;userTurn:number;prompt:string;evidence:Evidence;hash:string}
export interface Decision {
 checkpointHash:string; reviewer:string; reason:string;
 action:'advance'|'reply'|'hold'; replyId?:string;
}
export interface FrozenReply {id:string;userTurn:number;text:string}
export interface Ports {
 send:(text:string)=>Promise<Evidence>;
 /** Wait without destroying the native session. The caller supplies actual review, not a model prompt. */
 review:(checkpoint:Readonly<Checkpoint>)=>Promise<Decision>;
 /** Recheck state after review: external mutations invalidate the decision. */
 inspect:()=>Promise<Evidence>;
}
export interface Options {directory:string;prompts:readonly string[];replies:readonly FrozenReply[];ports:Ports}
const save=(directory:string,name:string,value:unknown)=>writeFile(join(directory,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
/** The caller owns server lifetime and provider authorization/budget. This adapter never retries. */
export async function runReviewedTurns({directory,prompts,replies,ports}:Options) {
 assert.ok(prompts.length&&prompts.every(p=>p.trim()));
 assert.equal(new Set(replies.map(r=>r.id)).size,replies.length,'Duplicate frozen reply');
 for(const r of replies)assert.ok(r.id&&r.text.trim()&&Number.isInteger(r.userTurn)&&r.userTurn>=0&&r.userTurn<prompts.length);
 await mkdir(directory,{mode:0o700}); // Existing evidence refuses automatic restart/replay.
 await save(directory,'protocol.json',{prompts,replies,semanticReview:'pending',automaticRetry:false});
 let index=0,accepted=0;const used=new Set<string>();
 for(const [userTurn,prompt] of prompts.entries()) {
  let text=prompt,kind:'original'|'scripted_reply'='original';
  for(;;) {
   const n=++index;
   await save(directory,`${n}-dispatch.json`,{userTurn,text,kind});
   let evidence:Evidence;
   try {evidence=await ports.send(text);}
   catch(error){await save(directory,`${n}-transport-failure.json`,{error:String(error),outcome:'unknown',retry:false});throw error;}
   await save(directory,`${n}-response.json`,evidence);
   if(evidence.status!=='succeeded'||evidence.pendingInteraction) {
    await save(directory,`${n}-hold.json`,{reason:'native_request_not_settled',semanticReview:'pending'});
    return {status:'needs_review' as const,accepted,dispatched:index,semanticReview:'pending' as const};
   }
   const payload={index:n,userTurn,prompt,evidence},checkpoint:Checkpoint={...payload,hash:digest(payload)};
   await save(directory,`${n}-checkpoint.json`,checkpoint);
   const decision=await ports.review(structuredClone(checkpoint));
   assert.equal(decision.checkpointHash,checkpoint.hash,'Stale or foreign decision');
   assert.ok(decision.reviewer.trim()&&decision.reason.trim(),'Attributed rationale required');
   assert.ok(['advance','reply','hold'].includes(decision.action),'Invalid review action');
   assert.equal(digest(await ports.inspect()),digest(evidence),'Native session/state changed during review');
   if(decision.action==='reply') {
    const reply=replies.find(r=>r.id===decision.replyId&&r.userTurn===userTurn);
    assert.ok(reply&&!used.has(reply.id),'Reply is not frozen for this turn or already consumed');
    await save(directory,`${n}-decision.json`,decision);used.add(reply.id);text=reply.text;kind='scripted_reply';continue;
   }
   assert.equal(decision.replyId,undefined,'Only reply decisions may name a reply');
   await save(directory,`${n}-decision.json`,decision);
   if(decision.action==='hold')return {status:'needs_review' as const,accepted,dispatched:index,semanticReview:'pending' as const};
   accepted++;break;
  }
 }
 const result={status:'recorded' as const,accepted,dispatched:index,semanticReview:'pending' as const};
 await save(directory,'result.json',result);return result;
}
