import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {appendFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Ledger,profile,type Usage} from './budget.js';
export interface ProviderActive {id:string;directory:string;startedAt:number;reviewedThrough?:number}
export interface ProviderOptions {original:typeof fetch;secret:string;verify:()=>Promise<void>;reviewProgress?:(reason:string)=>Promise<void>}
export const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
/** An observer only: input/init and each response byte are forwarded unchanged. */
export class Provider {
 active?:ProviderActive;
 responseModel?:string;
 constructor(readonly options:ProviderOptions,readonly ledger:Ledger){}
 fetch:typeof fetch=async(input,init)=>{try{return await this.observeFetch(input,init);}catch(error){this.ledger.halt(error instanceof assert.AssertionError?'provider_preflight_failed':'provider_transport_failed');throw error;}};
 private observeFetch:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.href!==profile.baseUrl+'/chat/completions'){
   assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'unapproved_external_origin');return this.options.original(input,init);
  }
  const active=this.active;assert.ok(active,'no_active_trial');await this.options.verify();
  const count=this.ledger.read().attempts.filter(a=>a.trialId===active.id).length;
  if((count>=20||Date.now()-active.startedAt>=30*60_000)&&(active.reviewedThrough??-1)<count){
   assert.ok(this.options.reviewProgress,'progress_review_required');await this.options.reviewProgress('20 requests or 30 minutes reached; review evidence before admitting next request');active.reviewedThrough=count;
  }
  const raw=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';
  assert.ok(raw&&!raw.includes(this.options.secret),'empty_or_secret_payload');
  const payload=JSON.parse(raw) as {model?:string;thinking?:{type?:string};reasoning_effort?:string;max_tokens?:number;max_completion_tokens?:number};
  assert.equal(payload.model,profile.model);assert.equal(payload.thinking?.type,'enabled');assert.equal(payload.reasoning_effort,'high');
  const output=payload.max_tokens??payload.max_completion_tokens;assert.ok(output&&output<=profile.maxOutputTokens);
  // UTF-8 bytes + framing allowance is deliberately conservative, verified against returned usage.
  const id=this.ledger.begin(active.id,Buffer.byteLength(raw)+4096,output);
  const stem=join(active.directory,`provider-${String(id).padStart(4,'0')}`);
  writeFileSync(stem+'-request.json',raw,{mode:0o600});
  writeFileSync(stem+'-request-audit.json',JSON.stringify({sha256:digest(raw),forwardedSha256:digest(raw),bodyUnchanged:true,outputCap:output,at:new Date().toISOString()}),{mode:0o600});
  let usage:Usage|undefined,done=false,finishReason:string|undefined,settled=false,buffer='';const models=new Set<string>();
  const decoder=new TextDecoder();
  const consume=(text:string)=>{buffer+=text;const lines=buffer.split('\n');buffer=lines.pop()!;for(const line of lines){if(!line.startsWith('data:'))continue;const value=line.slice(5).trim();if(value==='[DONE]'){done=true;continue;}if(!value)continue;const event=JSON.parse(value) as {model?:string;usage?:{prompt_tokens:number;completion_tokens:number};choices?:Array<{finish_reason?:string}>};if(event.model)models.add(event.model);if(event.usage)usage={input:event.usage.prompt_tokens,output:event.usage.completion_tokens};for(const choice of event.choices??[])if(choice.finish_reason)finishReason=choice.finish_reason;}};
  // Keep a suffix so credentials split across transport chunks cannot leak into artifacts.
  let archivePending='';
  const archive=(text:string,final=false)=>{archivePending+=text;archivePending=archivePending.split(this.options.secret).join('[REDACTED]');const cut=final?archivePending.length:Math.max(0,archivePending.length-this.options.secret.length+1);appendFileSync(stem+'-response.sse',archivePending.slice(0,cut),{mode:0o600});archivePending=archivePending.slice(cut);};
  const settle=(reason?:string)=>{if(settled)return;settled=true;this.ledger.finish(id,usage,reason);writeFileSync(stem+'-response-meta.json',JSON.stringify({id,usage,done,finishReason,models:[...models],reason,at:new Date().toISOString()},null,2),{mode:0o600});};
  try{
   // Do not rewrite body, headers, retry options, signal or reasoning replay.
   const response=await this.options.original(input,init);
   if(!response.ok){const text=await response.text();archive(text,true);try{const error=JSON.parse(text) as {usage?:{prompt_tokens:number;completion_tokens:number}};if(error.usage)usage={input:error.usage.prompt_tokens,output:error.usage.completion_tokens};}catch{/* Preserve non-JSON response as evidence. */}
    settle('provider_http_'+response.status);if([401,402,403,429].includes(response.status))this.ledger.halt('provider_http_'+response.status);
    return new Response(text,{status:response.status,statusText:response.statusText,headers:response.headers});
   }
   assert.ok(response.body);const reader=response.body.getReader();
   return new Response(new ReadableStream<Uint8Array>({pull:async controller=>{try{const part=await reader.read();if(part.done){const tail=decoder.decode();archive(tail,true);consume(tail+'\n');
      let problem:string|undefined;if(!done||!usage)problem='incomplete_or_unknown_usage';else if(!['stop','tool_calls'].includes(finishReason??''))problem='truncated_or_bad_finish';else if(models.size!==1)problem='response_model_missing_or_mixed';else if(!this.ledger.observeModel([...models][0]))problem='response_model_drift';
      this.responseModel??=[...models][0];if(problem)this.ledger.halt(problem);settle(problem);controller.close();return;}
     const text=decoder.decode(part.value,{stream:true});archive(text);consume(text);controller.enqueue(part.value);
    }catch(error){archive(decoder.decode(),true);settle('stream_error');this.ledger.halt('stream_error');await reader.cancel().catch(()=>{});controller.error(error);}},cancel:async()=>{archive(decoder.decode(),true);settle('cancelled');this.ledger.halt('cancelled');await reader.cancel().catch(()=>{});}}),{status:response.status,statusText:response.statusText,headers:response.headers});
  }catch(error){settle('transport_error');throw error;}
 };
}
