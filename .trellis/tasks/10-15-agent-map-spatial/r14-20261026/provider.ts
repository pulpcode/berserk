/** Native Pi transport observation; no tool/history/prompt synthesis. */
import assert from 'node:assert/strict';
import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {SSELines} from '../../10-17-map-query-native-evaluation/run.js';
import {collectResponse} from '../r12-20261025/reasoning-live.js';
import {auditPayload,type Payload as AuditPayload} from '../r3-20261022/audit.js';
import type {Payload} from '../r12-20261025/reasoning-prepare.js';
import {digest,save,type Runtime} from './runtime.js';

import {Ledger,maxTokens,modelConfiguration,type Group,type Usage} from './budget.js';
export const endpoint='https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions';
export {modelConfiguration} from './budget.js';
export interface Active {id:string;group:Group;directory:string;turn:number;runtime:Runtime;stop?:string;requests:number;lastProgressAt?:number}
export interface Attempt {id:number;entry:string;group:Group;turn:number;at:string;completed:boolean;payloadHash:string;wirePayloadHash:string;status?:number;usage?:{prompt_tokens:number;completion_tokens:number};actualModels?:string[];tools:Array<{id:string;name:string;arguments:string}>;reasoningCharacters?:number;reasoningTokens?:number;observedThinking?:boolean;finishReason?:string;responseSha256?:string;error?:string;requestedThinking:'enabled'|'disabled';requestedEffort:'high'|'absent';elapsedMs?:number}
interface Options {directory:string;original:typeof fetch;secret:string;verify:()=>Promise<void>;cancel:(reason:string)=>Promise<void>}
export function actualPayload(native:Payload,group:Group):Payload {
 assert.equal(native.model,modelConfiguration[group].requestModel);assert.equal(native.stream,true);assert.ok(Array.isArray(native.messages));
 const wire=structuredClone(native);delete wire.max_tokens;wire.max_completion_tokens=maxTokens;delete wire.top_p;delete wire.temperature;wire.thinking={type:group==='A'?'disabled':'enabled'};delete wire.reasoning_effort;if(group!=='A')wire.reasoning_effort='high';
 const strip=(p:Payload)=>{const c=structuredClone(p);for(const k of ['max_tokens','max_completion_tokens','top_p','temperature','thinking','reasoning_effort'])delete c[k];return c;};assert.deepEqual(strip(native),strip(wire),'unexpected_payload_mutation');return wire;
}
export function validateResponse(output:ReturnType<typeof collectResponse>['output'],group:Group){
 assert.deepEqual(output.models,[modelConfiguration[group].responseModel],'response_model_drift');assert.equal(output.ids.length,1,'response_identity_missing_or_changed');assert.ok(output.usage&&output.usage.input>0&&output.usage.output>0,'unknown_or_empty_usage');assert.ok(output.usage.output<=maxTokens,'provider_output_limit_exceeded');assert.ok(output.reasoningTokens===undefined||output.reasoningTokens<=output.usage.output,'reasoning_usage_exceeds_output');assert.ok(output.done&&output.finishReason,'incomplete_response');
 const observed=output.reasoningCharacters>0||(output.reasoningTokens??0)>0;if(group==='A')assert.equal(observed,false,'disabled_thinking_not_effective');
 if(output.finishReason==='length')return 'truncated';
 if(output.tools.length){assert.equal(output.finishReason,'tool_calls');for(const t of output.tools){assert.ok(t.id&&t.name,'invalid_tool_call');JSON.parse(t.arguments);}return 'tools';}
 assert.equal(output.finishReason,'stop','unexpected_finish_reason');assert.ok(output.content.trim(),'empty_answer');return 'answer';
}
export class Provider {
 active?:Active;fatal?:string;readonly attempts:Attempt[]=[];
 private schemas=new Map<string,string>();private reasoning=new Map<string,string>();
 constructor(readonly options:Options,readonly ledger:Ledger){}
 persist(){save(join(this.options.directory,'attempts.json'),this.attempts);save(join(this.options.directory,'budget.json'),this.ledger.totals());}
 private async fail(reason:string){this.fatal??=reason;this.ledger.halt(reason);if(this.active)this.active.stop??=reason;await this.options.cancel(reason);}
 fetch:typeof fetch=async(input,init)=>{const u=new URL(input instanceof Request?input.url:String(input));if(u.href===endpoint)return this.provider(input,init);assert.ok(['127.0.0.1','localhost','[::1]'].includes(u.hostname),'Unapproved external origin');return this.options.original(input,init);};
 async provider(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1]){
  assert.ok(this.active,'No active slot');const slot=this.active;assert.ok(!this.fatal&&!slot.stop,'Provider halted; no automatic retry');
  let wire:Payload,raw:string,stem:string,attempt:Attempt;
  try{
   slot.lastProgressAt=Date.now();await this.options.verify();const nativeRaw=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';assert.ok(nativeRaw&&!nativeRaw.includes(this.options.secret),'missing_payload_or_secret_contamination');const native=JSON.parse(nativeRaw) as Payload;wire=actualPayload(native,slot.group);raw=JSON.stringify(wire);
   // Check only current-user-turn replay, respecting SDK treatment of previous user turns.
   for(const m of wire.messages){if(m.role!=='assistant'||!Array.isArray(m.tool_calls))continue;for(const c of m.tool_calls as Array<{id:string}>){const expected=this.reasoning.get(`${slot.id}:${slot.turn}:${c.id}`);if(expected)assert.equal(m.reasoning_content,expected,'native_reasoning_tool_history_lost');}}
   const parent=Array.isArray(wire.tools)&&wire.tools.some(t=>(t as {function?:{name?:string}}).function?.name==='spatial_analyze');const schemaHash=digest(JSON.stringify(wire.tools??[]));
   if(parent){const prior=this.schemas.get('parent');if(prior)assert.equal(schemaHash,prior,'parent_schema_drift');else this.schemas.set('parent',schemaHash);}
   const id=this.ledger.begin(slot.id,slot.group,Buffer.byteLength(raw)+4096);slot.requests++;if(slot.requests===13)console.info(JSON.stringify({id:slot.id,warning:'12_requests_only_not_cancelled'}));stem=join(slot.directory,`provider-${String(id).padStart(4,'0')}`);
   save(stem+'-native-pi-input.json',native);save(stem+'-input.json',native);save(stem+'-wire-input.json',wire);
   save(stem+'-loading.json',{...auditPayload(wire as AuditPayload,slot.runtime.skills,id,slot.turn),parent,schemaHash,mode:'native-on-demand',preloaded:false});
   attempt={id,entry:slot.id,group:slot.group,turn:slot.turn,at:new Date().toISOString(),completed:false,payloadHash:digest(nativeRaw),wirePayloadHash:digest(raw),tools:[],requestedThinking:slot.group==='A'?'disabled':'enabled',requestedEffort:slot.group==='A'?'absent':'high'};this.attempts.push(attempt);this.persist();
  }catch(error){const reason=(error instanceof Error?error.message:'provider_prepare_error').split(this.options.secret).join('[REDACTED]');await this.fail(reason);throw new Error(reason);}
  const responsePath=stem+'-response.sse',{output,parser}=collectResponse();let reasoningText='';
  const thinkingParser=new SSELines(event=>{for(const c of (event.choices??[]) as Array<{delta?:{reasoning_content?:string}}>)if(typeof c.delta?.reasoning_content==='string')reasoningText+=c.delta.reasoning_content;});
  let finished=false;let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  const finish=async(reason?:string)=>{
   if(finished)return;finished=true;attempt.completed=true;attempt.elapsedMs=Date.now()-Date.parse(attempt.at);attempt.actualModels=output.models;attempt.tools=output.tools.map(t=>({id:t.id,name:t.name,arguments:t.arguments}));attempt.reasoningCharacters=output.reasoningCharacters;attempt.reasoningTokens=output.reasoningTokens;attempt.observedThinking=output.reasoningCharacters>0||(output.reasoningTokens??0)>0;attempt.finishReason=output.finishReason;
   let usage:Usage|undefined;if(output.usage){usage=output.usage;attempt.usage={prompt_tokens:usage.input,completion_tokens:usage.output};}
   if(reason)attempt.error=reason;else for(const c of output.tools)if(reasoningText)this.reasoning.set(`${slot.id}:${slot.turn}:${c.id}`,reasoningText);
   try{attempt.responseSha256=digest(readFileSync(responsePath));}catch{/* A failed HTTP response has no SSE bytes. */}
   this.ledger.finish(attempt.id,usage,reason);save(stem+'-meta.json',attempt);this.persist();
   if(reason||this.ledger.read().halted)await this.fail(reason??this.ledger.read().halted!);
  };
  try{
   const response=await this.options.original(input,{...init,body:raw,redirect:'error'});attempt.status=response.status;
   if(!response.ok){const body=(await response.text()).split(this.options.secret).join('[REDACTED]');writeFileSync(stem+'-error.txt',body,{mode:0o600});await finish('provider_http_'+response.status);return new Response(body,{status:response.status,headers:response.headers});}
   assert.ok(response.body,'missing_response_body');reader=response.body.getReader();
   const stream=new ReadableStream<Uint8Array>({pull:async controller=>{try{
    const part=await reader!.read();if(part.done){parser.push(new TextEncoder().encode('\n'));thinkingParser.push(new TextEncoder().encode('\n'));const status=validateResponse(output,slot.group);await finish(status==='truncated'?'output_truncated':undefined);controller.close();return;}
    slot.lastProgressAt=Date.now();appendFileSync(responsePath,part.value,{mode:0o600});parser.push(part.value);thinkingParser.push(part.value);controller.enqueue(part.value);
   }catch(error){const reason=(error instanceof Error?error.message:'provider_stream_failure').split(this.options.secret).join('[REDACTED]');await finish(reason);await reader?.cancel().catch(()=>{});controller.error(new Error(reason));}},cancel:async()=>{await finish('provider_stream_cancelled');await reader?.cancel().catch(()=>{});}});
   return new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
  }catch(error){const reason=(error instanceof Error?error.message:'provider_request_failure').split(this.options.secret).join('[REDACTED]');await finish(reason);throw new Error(reason);}
 }
}
