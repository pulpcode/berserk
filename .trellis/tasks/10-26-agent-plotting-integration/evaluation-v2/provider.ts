/** Observes the existing native Pi transport; never invents tools, history, or model replies. */
import assert from 'node:assert/strict';
import {appendFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {SSELines} from '../../10-17-map-query-native-evaluation/run.js';
import {auditPayload} from '../../10-15-agent-map-spatial/r3-20261022/audit.js';
import {digest,save,type Runtime} from './runtime.js';
import {Ledger,maxTokens,responseModel,type Usage} from './budget.js';
export const endpoint='https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions';
export interface Payload {model:string;stream?:boolean;messages:Array<{role:string;content:unknown}>;tools?:unknown[];max_tokens?:number;top_p?:number;temperature?:number;thinking?:{type:string};reasoning_effort?:string;[key:string]:unknown}
export function actualPayload(native:Payload):Payload {assert.equal(native.model,'deepseek-v4.1-flash');assert.equal(native.stream,true);assert.ok(Array.isArray(native.messages));const wire=structuredClone(native);wire.max_tokens=maxTokens;wire.top_p=1;wire.thinking={type:'disabled'};delete wire.temperature;delete wire.reasoning_effort;return wire;}
export function collectResponse(){
 const output:{models:string[];ids:string[];usage?:Usage;content:string;finishReason?:string;done:boolean;reasoningCharacters:number;reasoningTokens:number;tools:Array<{id:string;name:string;arguments:string}>}={models:[],ids:[],content:'',done:false,reasoningCharacters:0,reasoningTokens:0,tools:[]};
 const parser=new SSELines(event=>{
  if(typeof event.model==='string'&&!output.models.includes(event.model))output.models.push(event.model);if(typeof event.id==='string'&&!output.ids.includes(event.id))output.ids.push(event.id);
  const usage=event.usage as {prompt_tokens?:number;completion_tokens?:number;completion_tokens_details?:{reasoning_tokens?:number}}|undefined;
  if(usage){assert.ok(Number.isSafeInteger(usage.prompt_tokens)&&Number.isSafeInteger(usage.completion_tokens),'invalid_usage');output.usage={input:usage.prompt_tokens!,output:usage.completion_tokens!};output.reasoningTokens=usage.completion_tokens_details?.reasoning_tokens??0;}
  for(const choice of (event.choices??[]) as Array<{finish_reason?:string;delta?:{content?:string;reasoning_content?:string;tool_calls?:Array<{index:number;id?:string;function?:{name?:string;arguments?:string}}>}}>){
   if(choice.finish_reason)output.finishReason=choice.finish_reason;const d=choice.delta;if(!d)continue;output.content+=d.content??'';output.reasoningCharacters+=(d.reasoning_content??'').length;
   for(const t of d.tool_calls??[]){const current=output.tools[t.index]??={id:'',name:'',arguments:''};current.id+=t.id??'';current.name+=t.function?.name??'';current.arguments+=t.function?.arguments??'';}
  }
 },()=>{output.done=true;});return {output,parser};
}
export function validateResponse(o:ReturnType<typeof collectResponse>['output']){
 assert.deepEqual(o.models,[responseModel],'response_model_drift');assert.equal(o.ids.length,1,'response_identity_missing_or_changed');assert.ok(o.done&&o.finishReason,'incomplete_response');assert.ok(o.usage&&o.usage.input>0&&o.usage.output>0&&o.usage.output<=maxTokens,'unknown_or_invalid_usage');assert.equal(o.reasoningCharacters+o.reasoningTokens,0,'disabled_thinking_not_effective');assert.notEqual(o.finishReason,'length','output_truncated');
 if(o.tools.length){assert.equal(o.finishReason,'tool_calls');for(const t of o.tools){assert.ok(t.id&&t.name);JSON.parse(t.arguments);}}else{assert.equal(o.finishReason,'stop');assert.ok(o.content.trim(),'empty_answer');}
}
export interface Active {id:string;directory:string;turn:number;runtime:Runtime;requests:number;stop?:string}
interface Options {directory:string;original:typeof fetch;secret:string;verify:()=>Promise<void>;beforeProvider:()=>Promise<void>;cancel:(reason:string)=>Promise<void>}
export class Provider {
 active?:Active;fatal?:string;readonly attempts:Array<Record<string,unknown>>=[];
 constructor(readonly options:Options,readonly ledger:Ledger){}
 persist(){save(join(this.options.directory,'attempts.json'),this.attempts);save(join(this.options.directory,'budget.json'),this.ledger.totals());}
 private async halt(reason:string){this.fatal??=reason;this.ledger.halt(reason);if(this.active)this.active.stop??=reason;await this.options.cancel(reason);}
 fetch:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.href===endpoint)return this.provider(input,init);assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'External request blocked');return this.options.original(input,init);};
 private async provider(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1]){
  assert.ok(this.active&&!this.fatal&&!this.active.stop,'Provider halted; no automatic retry');const slot=this.active;
  let id:number|undefined,attempt:Record<string,unknown>|undefined,stem='',finished=false;
  const {output,parser}=collectResponse();
  const finish=async(reason?:string)=>{if(finished)return;finished=true;if(id!==undefined)this.ledger.finish(id,output.usage,reason);if(attempt)Object.assign(attempt,{completed:true,output,error:reason});this.persist();if(reason)await this.halt(reason);};
  try{
   await this.options.verify();await this.options.beforeProvider();
   const nativeRaw=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';assert.ok(nativeRaw&&!nativeRaw.includes(this.options.secret),'Missing body or secret contamination');
   const native=JSON.parse(nativeRaw) as Payload,wire=actualPayload(native),raw=JSON.stringify(wire);
   id=this.ledger.begin(slot.id,Buffer.byteLength(raw,'utf8')+4096);slot.requests++;stem=join(slot.directory,`provider-${String(id).padStart(4,'0')}`);
   save(stem+'-native.json',native);save(stem+'-wire.json',wire);save(stem+'-loading.json',auditPayload(wire,slot.runtime.skills,id,slot.turn));
   attempt={id,slot:slot.id,turn:slot.turn,completed:false,nativeHash:digest(nativeRaw),wireHash:digest(raw)};this.attempts.push(attempt);this.persist();
   const response=await this.options.original(input,{...init,body:raw,redirect:'error'});attempt.status=response.status;
   if(!response.ok){writeFileSync(stem+'-http-error.txt',(await response.text()).split(this.options.secret).join('[REDACTED]'),{mode:0o600});throw new Error(`provider_http_${response.status}`);}assert.ok(response.body,'missing_response_body');const reader=response.body.getReader();
   return new Response(new ReadableStream<Uint8Array>({pull:async controller=>{try{const chunk=await reader.read();if(chunk.done){parser.push(new TextEncoder().encode('\n'));validateResponse(output);await finish();controller.close();return;}appendFileSync(stem+'-response.sse',chunk.value,{mode:0o600});parser.push(chunk.value);controller.enqueue(chunk.value);}catch(error){const reason=String(error).split(this.options.secret).join('[REDACTED]');await finish(reason);await reader.cancel().catch(()=>{});controller.error(new Error(reason));}},cancel:async()=>{await finish('provider_stream_cancelled');await reader.cancel().catch(()=>{});}}),{status:response.status,statusText:response.statusText,headers:response.headers});
  }catch(error){const reason=String(error).split(this.options.secret).join('[REDACTED]');await finish(reason);throw new Error(reason);}
 }
}
