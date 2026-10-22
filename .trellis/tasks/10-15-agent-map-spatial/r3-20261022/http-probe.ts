/** Local fake-provider integration helper. Never supplies a default user answer. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mapTrialAuth,mapTrialRequest,type MapTrialManifest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import type {Interaction,InteractionResponse,SessionSnapshot,StreamEvent} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {SSELines} from '../../10-17-map-query-native-evaluation/run.js';
export interface InteractionRecord {observed:Interaction;response?:InteractionResponse;resolved?:Interaction;handling:'answered'|'skipped'|'cancelled'|'unanswered'|'unexpected'}
export async function request(manifest:MapTrialManifest,sessionId:string,input:Record<string,unknown>,respond?:(item:Interaction)=>InteractionResponse|'cancel'|'none'){
 const events:StreamEvent[]=[],interactions:InteractionRecord[]=[],seen=new Set<string>(),pending:Promise<void>[]=[];
 let failure:unknown;
 const response=await fetch(`${manifest.url}/api/sessions/${sessionId}/messages`,{method:'POST',headers:{...await mapTrialAuth(manifest,'planning'),'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(30_000)});
 assert.ok(response.ok&&response.body,`Message HTTP ${response.status}`);
 const parser=new SSELines(value=>{
  const event=value as unknown as StreamEvent;events.push(event);
  if(event.type!=='interaction.updated'||event.interaction.status!=='pending'||seen.has(event.interaction.interactionId))return;
  const item=event.interaction;seen.add(item.interactionId);
  pending.push((async()=>{
   const record:InteractionRecord={observed:item,handling:'unexpected'};interactions.push(record);
   try{
    const decision=respond?.(item);
    if(!decision||decision==='cancel'||decision==='none'){
     record.handling=decision==='cancel'?'cancelled':decision==='none'?'unanswered':'unexpected';
     if(decision==='none'){
      // Observe an actually unanswered pending question BEFORE cleanup cancellation.
      const live=await mapTrialRequest<SessionSnapshot>(manifest,`/api/sessions/${sessionId}`,'planning');
      assert.ok(live.interactions?.some(i=>i.interactionId===item.interactionId&&i.status==='pending'));
     }
     await mapTrialRequest(manifest,`/api/sessions/${sessionId}/cancel`,'planning','POST',{requestId:item.requestId});return;
    }
    record.response=decision;
    record.resolved=await mapTrialRequest<Interaction>(manifest,`/api/sessions/${sessionId}/interactions/${item.interactionId}/response`,'planning','POST',decision);
    record.handling=record.resolved.status==='answered'?'answered':'skipped';
   }catch(error){failure=error;await mapTrialRequest(manifest,`/api/sessions/${sessionId}/cancel`,'planning','POST',{requestId:item.requestId});}
  })());
 });
 const reader=response.body.getReader();for(;;){const part=await reader.read();if(part.done)break;parser.push(part.value);}
 await Promise.all(pending);if(failure)throw failure;
 return {events,interactions,snapshot:await mapTrialRequest<SessionSnapshot>(manifest,`/api/sessions/${sessionId}`,'planning')};
}
export function fakeResponse(model:string,call?:{name:string;arguments:unknown},text='确定性接线检查；不是模型语义结果。'){
 const common={id:'r3-fake',object:'chat.completion.chunk',created:1,model};
 const delta=call?{role:'assistant',tool_calls:[{index:0,id:randomUUID(),type:'function',function:{name:call.name,arguments:JSON.stringify(call.arguments)}}]}:{role:'assistant',content:text};
 return new Response([{...common,choices:[{index:0,delta,finish_reason:null}]},{...common,choices:[{index:0,delta:{},finish_reason:call?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}}].map(c=>`data: ${JSON.stringify(c)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
}
