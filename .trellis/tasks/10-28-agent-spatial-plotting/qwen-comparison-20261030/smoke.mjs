/** Task-only neutral Pi protocol smoke. No product session, Skill or business evaluation. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync, appendFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';
// This file is the installed implementation of the package's public ./api/openai-completions export.
import {stream} from '../../../../experiments/harness-lab/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const outputDirectory = join(root, '.local/qwen-comparison-20261030/smoke');
export const models = {
  flash: {provider:'volcengine-agent-plan', id:'deepseek-v4.1-flash', actual:'deepseek-v4-1-flash-261017', baseUrl:'https://ark.cn-beijing.volces.com/api/plan/v3', env:'/Users/lau/.codex/worktrees/agent-result-grounding/berserk/experiments/harness-lab/.env.local'},
  qwen: {provider:'aliyun-bailian', id:'qwen3.8-max-0902', actual:'qwen3.8-max-0902', baseUrl:'https://ws-9o7uja66sj6pvrf9.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', env:join(root,'experiments/harness-lab/.env.qwen-bailian.local')},
};
const maxTokens=32768;
const tool={name:'lookup',description:'Read a value from the neutral smoke-test table by its exact key.',parameters:{type:'object',properties:{key:{type:'string'}},required:['key'],additionalProperties:false}};
const prompt='请调用 lookup 查询键 smoke-7 的值，然后根据工具实际返回的值回答。不要猜测。';
export const digest=value=>createHash('sha256').update(value).digest('hex');
const save=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});
const clean=(value,key)=>String(value).split(key).join('[REDACTED]');
// Keep a key-length tail so a key split across SSE chunks is never archived in full.
export function redactedSink(key,write){let pending='';return (text,final=false)=>{pending+=text;let cut=final?pending.length:Math.max(0,pending.length-key.length+1);const crossing=pending.lastIndexOf(key,cut-1);if(!final&&crossing>=0&&crossing<cut&&crossing+key.length>cut)cut=crossing;if(cut)write(clean(pending.slice(0,cut),key));pending=pending.slice(cut);};}
export function claim(directory){mkdirSync(dirname(directory),{recursive:true,mode:0o700});mkdirSync(directory,{mode:0o700});save(join(directory,'started.json'),{at:new Date().toISOString(),maxRequests:4,noRetry:true,scriptHash:digest(readFileSync(fileURLToPath(import.meta.url)))});}
export function config(name){const expected=models[name];assert.ok(expected,'unknown_model');const env=parseEnv(readFileSync(expected.env,'utf8'));assert.equal(env.LLM_MODEL,expected.id);assert.equal(env.LLM_PROVIDER,expected.provider);assert.equal(env.LLM_BASE_URL?.replace(/\/$/,''),expected.baseUrl);assert.ok(env.LLM_API_KEY?.trim(),'missing_key');const idleTimeoutMs=Number(env.LLM_HTTP_IDLE_TIMEOUT_MS??300000);assert.ok(Number.isInteger(idleTimeoutMs)&&idleTimeoutMs>0,'invalid_idle_timeout');return {...expected,key:env.LLM_API_KEY.trim(),idleTimeoutMs};}
export function payloadFor(name,original){const p=structuredClone(original);delete p.max_tokens;p.max_completion_tokens=maxTokens;delete p.temperature;delete p.top_p;delete p.thinking_budget;delete p.enable_search;
  if(name==='qwen'){delete p.thinking;p.enable_thinking=true;p.reasoning_effort='xhigh';p.preserve_thinking=true;}else{delete p.enable_thinking;delete p.preserve_thinking;p.thinking={type:'enabled'};p.reasoning_effort='high';}
  return p;
}
export function parseResponse(text){const events=[];let done=false;for(const block of text.replaceAll('\r\n','\n').split('\n\n')){const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)continue;if(data==='[DONE]'){done=true;continue;}events.push(JSON.parse(data));}
  const ids=[...new Set(events.map(e=>e.id).filter(Boolean))];const actualModels=[...new Set(events.map(e=>e.model).filter(Boolean))];const choices=events.flatMap(e=>e.choices??[]);const reasoning=choices.map(c=>c.delta?.reasoning_content??'').join('');const usage=events.findLast(e=>e.usage)?.usage;const reasons=[...new Set(choices.map(c=>c.finish_reason).filter(Boolean))];return {ids,actualModels,reasoning,usage,reasons,done};
}
export function validateResponse(raw,expected){assert.deepEqual(raw.actualModels,[expected],'response_model_drift');assert.equal(raw.ids.length,1,'response_id_missing_or_changed');assert.ok(raw.done,'incomplete_sse');assert.equal(raw.reasons.length,1,'finish_reason_missing_or_changed');assert.ok(['stop','tool_calls'].includes(raw.reasons[0]),'truncated_or_unexpected_finish');assert.ok(Number.isInteger(raw.usage?.prompt_tokens)&&raw.usage.prompt_tokens>0&&Number.isInteger(raw.usage?.completion_tokens)&&raw.usage.completion_tokens>0,'unknown_or_empty_usage');assert.ok(raw.usage.completion_tokens<=maxTokens,'output_budget_exceeded');const rt=raw.usage.completion_tokens_details?.reasoning_tokens;if(rt!==undefined)assert.ok(Number.isInteger(rt)&&rt>=0&&rt<=raw.usage.completion_tokens,'invalid_reasoning_usage');}
export function lookup(call){assert.equal(call.name,'lookup','unexpected_tool');assert.deepEqual(call.arguments,{key:'smoke-7'},'unexpected_tool_arguments');return {key:'smoke-7',value:'violet-42'};}

export async function runModel(name,cfg,{directory,transport=globalThis.fetch}={}){
  const model={id:cfg.id,name:cfg.id,provider:cfg.provider,api:'openai-completions',baseUrl:cfg.baseUrl,reasoning:true,input:['text'],contextWindow:1000000,maxTokens,cost:{input:0,output:0,cacheRead:0,cacheWrite:0},compat:{supportsStore:false,supportsDeveloperRole:false,maxTokensField:'max_completion_tokens',requiresThinkingAsText:false}};
  const context={systemPrompt:'You are running a neutral tool protocol smoke test.',messages:[{role:'user',content:prompt,timestamp:Date.now()}],tools:[tool]};
  const summary={model:name,requestedModel:cfg.id,status:'started',attempts:[],toolExecuted:false,reasoningReplay:'not_attempted'};
  const persist=()=>{if(directory)save(join(directory,`${name}-summary.json`),summary);};persist();
  let previousReasoning='';
  try{for(let turn=1;turn<=2;turn++){
    let calls=0;let observed;let body='';let responseText='';let idleTimer;const idleController=new AbortController();const resetIdle=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>idleController.abort(new Error('http_idle_timeout')),cfg.idleTimeoutMs??300000);};const started=Date.now();const archive=redactedSink(cfg.key,text=>{if(directory)appendFileSync(join(directory,`${name}-${turn}-response.sse`),text,{mode:0o600});});const attempt={turn,status:'prepared',usage:null,elapsedMs:0};summary.attempts.push(attempt);persist();
    const observedFetch=async(input,init)=>{
      assert.equal(++calls,1,'automatic_retry_forbidden');assert.equal(String(input instanceof Request?input.url:input),`${cfg.baseUrl}/chat/completions`,'unexpected_endpoint');
      body=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';assert.ok(body&&!body.includes(cfg.key),'invalid_or_secret_payload');
      const wire=JSON.parse(body);assert.equal(wire.model,cfg.id);assert.equal(wire.stream,true);
      if(turn===2){const prior=wire.messages.findLast(m=>m.role==='assistant');assert.ok(prior?.tool_calls?.length===1,'tool_history_missing');if(previousReasoning){assert.equal(prior.reasoning_content,previousReasoning,'reasoning_history_changed');assert.ok(!JSON.stringify(prior.content).includes(previousReasoning),'reasoning_leaked_into_content');summary.reasoningReplay='exact_original_field';}else summary.reasoningReplay='no_nonempty_reasoning_returned';const result=wire.messages.at(-1);assert.equal(result.role,'tool');assert.equal(result.tool_call_id,prior.tool_calls[0].id);assert.deepEqual(JSON.parse(result.content),{key:'smoke-7',value:'violet-42'});}
      if(directory)save(join(directory,`${name}-${turn}-wire.json`),wire);attempt.status='dispatched';persist();
      resetIdle();const signal=init?.signal?AbortSignal.any([init.signal,idleController.signal]):idleController.signal;const response=await transport(input,{...init,signal,redirect:'error'});attempt.httpStatus=response.status;
      if(!response.ok){const errorBody=clean(await response.text(),cfg.key);if(directory)writeFileSync(join(directory,`${name}-${turn}-http-error.txt`),errorBody,{mode:0o600});throw new Error(`http_${response.status}`);}
      assert.ok(response.body,'missing_body');const decoder=new TextDecoder();
      return new Response(response.body.pipeThrough(new TransformStream({transform(chunk,controller){resetIdle();const text=decoder.decode(chunk,{stream:true});responseText+=text;archive(text);controller.enqueue(chunk);},flush(){const tail=decoder.decode();responseText+=tail;archive(tail,true);clearTimeout(idleTimer);observed=parseResponse(responseText);}})),{status:response.status,headers:response.headers});
    };
    let result;try{result=await stream(model,context,{apiKey:cfg.key,maxRetries:0,maxTokens,reasoningEffort:name==='qwen'?'xhigh':'high',fetch:observedFetch,onPayload:p=>payloadFor(name,p)}).result();}finally{clearTimeout(idleTimer);archive('',true);}
    attempt.elapsedMs=Date.now()-started;
    if(directory)writeFileSync(join(directory,`${name}-${turn}-native.json`),clean(JSON.stringify(result,null,2),cfg.key),{mode:0o600});
    // Native SDK may turn a transport exception into an error message; never treat default zero usage as known.
    if(observed){attempt.actualModels=observed.actualModels;attempt.usage=observed.usage??null;attempt.reasoningCharacters=observed.reasoning.length;attempt.reasoningTokens=observed.usage?.completion_tokens_details?.reasoning_tokens;attempt.finishReasons=observed.reasons;attempt.responseHash=digest(responseText);}
    assert.ok(!idleController.signal.aborted,'http_idle_timeout');assert.ok(observed,'transport_or_incomplete_response');validateResponse(observed,cfg.actual);assert.ok(!['error','aborted','length'].includes(result.stopReason),'native_request_incomplete');
    previousReasoning=observed.reasoning;attempt.status='settled';persist();
    const tools=result.content.filter(c=>c.type==='toolCall');
    if(turn===1){assert.equal(result.stopReason,'toolUse','first_turn_did_not_call_tool');assert.equal(tools.length,1,'expected_exactly_one_tool');const value=lookup(tools[0]);summary.toolExecuted=true;context.messages.push(result,{role:'toolResult',toolCallId:tools[0].id,toolName:'lookup',content:[{type:'text',text:JSON.stringify(value)}],isError:false,timestamp:Date.now()});if(directory)save(join(directory,`${name}-tool-result.json`),{toolCallId:tools[0].id,...value});}
    else{assert.equal(result.stopReason,'stop','second_turn_not_final');assert.equal(tools.length,0,'second_turn_requires_more_tools');const answer=result.content.filter(c=>c.type==='text').map(c=>c.text).join('');assert.ok(answer.includes('violet-42'),'answer_missing_tool_value');summary.answer=clean(answer,cfg.key);summary.status='passed';}
    persist();
  }}catch(error){summary.status='failed';summary.error=clean(error instanceof Error?error.message:'smoke_failed',cfg.key);persist();}
  return summary;
}
export async function main(args){assert.deepEqual(args,['--live','--authorize-max-four'],'Only the explicitly authorized one-use smoke command is accepted');const configs={flash:config('flash'),qwen:config('qwen')};claim(outputDirectory);const results=[];for(const name of ['flash','qwen']){const result=await runModel(name,configs[name],{directory:outputDirectory});results.push(result);save(join(outputDirectory,'summary.json'),{results,maxRequests:4,businessEvaluation:false,scope:'Pi public completion API with task-only tool execution; not full product AgentSession'});console.log(JSON.stringify(result));if(result.status!=='passed'){process.exitCode=1;break;}}}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main(process.argv.slice(2));
