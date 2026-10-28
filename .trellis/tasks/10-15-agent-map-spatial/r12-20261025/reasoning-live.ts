/** Isolated answer-time C comparison: one request per frozen slot, no tools/retries. */
import assert from 'node:assert/strict';
import {appendFileSync,existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SSELines} from '../../10-17-map-query-native-evaluation/run.js';
import {liveEnvironment} from '../r7-20261023/environment.js';
import {digest,endpoint,limits,maxTokens,read,repo,responseModel,saveNew,verifyFrozen,type Freeze,type Payload,type Slot} from './reasoning-prepare.js';

interface ToolCall {index:number;id:string;name:string;arguments:string}
interface ResponseData {ids:string[];models:string[];content:string;reasoningCharacters:number;reasoningTokens?:number;tools:ToolCall[];finishReason:string;usage?:{input:number;output:number};done:boolean}
export interface Result {id:string;caseId:string;group:'C0'|'C1';status:'planned'|'started'|'answer'|'needs_evidence'|'truncated'|'failed';startedAt?:string;completedAt?:string;requestSha256?:string;responseSha256?:string;httpStatus?:number;reason?:string;output?:ResponseData}
export interface BatchState {schemaVersion:1;freezeSha256:string;planned:12;records:Result[];totals:{requests:number;input:number;output:number;unknown:number};halted?:string;automaticRetries:false;toolsExecuted:0;semanticReview:'pending_agent_review'}
function persist(directory:string,state:BatchState){const target=join(directory,'progress.json'),temp=target+'.tmp';writeFileSync(temp,JSON.stringify(state,null,2)+'\n',{mode:0o600});renameSync(temp,target);}
export function canStart(state:BatchState,slot:Slot){return !state.halted&&state.totals.unknown===0&&state.totals.requests+1<=limits.requests&&state.totals.input+slot.inputReservation<=limits.input&&state.totals.output+maxTokens<=limits.output;}
export function collectResponse(){
 const calls=new Map<number,ToolCall>();const output:ResponseData={ids:[],models:[],content:'',reasoningCharacters:0,tools:[],finishReason:'',done:false};
 const parser=new SSELines(event=>{
  assert.ok(!event.error,'provider_stream_error');
  if(typeof event.id==='string'&&!output.ids.includes(event.id))output.ids.push(event.id);
  if(typeof event.model==='string'&&!output.models.includes(event.model))output.models.push(event.model);
  if(event.usage){const u=event.usage as {prompt_tokens?:number;completion_tokens?:number;completion_tokens_details?:{reasoning_tokens?:number}};
   if(Number.isSafeInteger(u.prompt_tokens)&&u.prompt_tokens!>=0&&Number.isSafeInteger(u.completion_tokens)&&u.completion_tokens!>=0)output.usage={input:u.prompt_tokens!,output:u.completion_tokens!};
   const count=u.completion_tokens_details?.reasoning_tokens;if(count!==undefined){assert.ok(Number.isSafeInteger(count)&&count>=0,'invalid_reasoning_usage');output.reasoningTokens=count;}
  }
  const choices=event.choices as Array<{index?:number;delta?:{content?:unknown;reasoning_content?:unknown;refusal?:unknown;tool_calls?:Array<{index:number;id?:string;function?:{name?:string;arguments?:string}}>};finish_reason?:string|null}>|undefined;
  assert.ok(choices===undefined||Array.isArray(choices),'invalid_choices');
  for(const choice of choices??[]){
   assert.ok(choice.index===undefined||choice.index===0,'unexpected_choice_index');const delta=choice.delta??{};
   if(delta.content!==undefined&&delta.content!==null){assert.equal(typeof delta.content,'string');output.content+=delta.content;}
   if(delta.reasoning_content!==undefined&&delta.reasoning_content!==null){assert.equal(typeof delta.reasoning_content,'string');output.reasoningCharacters+=(delta.reasoning_content as string).length;}
   assert.ok(!delta.refusal,'provider_refusal');
   for(const part of delta.tool_calls??[]){assert.ok(Number.isSafeInteger(part.index)&&part.index>=0);const call=calls.get(part.index)??{index:part.index,id:'',name:'',arguments:''};call.id+=part.id??'';call.name+=part.function?.name??'';call.arguments+=part.function?.arguments??'';calls.set(part.index,call);}
   if(choice.finish_reason){assert.ok(!output.finishReason||output.finishReason===choice.finish_reason,'conflicting_finish_reason');output.finishReason=choice.finish_reason;}
  }
  output.tools=[...calls.values()];
 },()=>{output.done=true;});
 return {output,parser};
}
export function classify(output:ResponseData,group:'C0'|'C1'):Result['status']{
 assert.deepEqual(output.models,[responseModel],'response_model_drift');assert.equal(output.ids.length,1,'missing_or_changed_response_id');assert.ok(output.usage,'unknown_provider_usage');assert.ok(output.usage.input>0&&output.usage.output>0,'empty_provider_usage');
 assert.ok(output.usage.output<=maxTokens,'provider_exceeded_output_limit');assert.ok(output.reasoningTokens===undefined||output.reasoningTokens<=output.usage.output,'reasoning_usage_exceeds_total');
 assert.ok(output.done||output.finishReason,'incomplete_stream');
 const thinking=output.reasoningCharacters>0||(output.reasoningTokens??0)>0;
 if(group==='C1')assert.ok(thinking,'thinking_effect_unverified');else assert.ok(!thinking,'disabled_thinking_not_effective');
 if(output.finishReason==='length')return 'truncated';
 if(output.tools.length){assert.equal(output.finishReason,'tool_calls');for(const call of output.tools){assert.ok(call.id&&call.name,'invalid_tool_call');JSON.parse(call.arguments);}return 'needs_evidence';}
 assert.equal(output.finishReason,'stop','unexpected_finish_reason');assert.ok(output.content.trim(),'empty_answer');return 'answer';
}
export interface RunOptions {prepared:string;directory:string;env?:NodeJS.ProcessEnv;transport?:typeof fetch}
export async function runComparison(options:RunOptions){
 const prepared=resolve(options.prepared),directory=resolve(options.directory);
 assert.ok(prepared.startsWith(join(repo,'.local/spatial-r12')+'/'));assert.ok(directory.startsWith(join(repo,'.local/spatial-r12')+'/'));
 const freezePath=join(prepared,'freeze.json'),freezeSha256=digest(readFileSync(freezePath)),frozen=read<Freeze>(freezePath);verifyFrozen(prepared,frozen);
 assert.ok(!existsSync(directory),'Refuse overwriting output');assert.ok(!existsSync(join(prepared,'run-claim.json')),'Frozen C batch already claimed; no repeated run');
 const env=liveEnvironment(options.env??process.env),secret=env.LLM_API_KEY!;
 const state:BatchState={schemaVersion:1,freezeSha256,planned:12,records:frozen.schedule.map(s=>({id:s.id,caseId:s.caseId,group:s.group,status:'planned'})),totals:{requests:0,input:0,output:0,unknown:0},automaticRetries:false,toolsExecuted:0,semanticReview:'pending_agent_review'};
 mkdirSync(directory,{mode:0o700});saveNew(join(prepared,'run-claim.json'),{directory,at:new Date().toISOString(),freezeSha256,noRetry:true});saveNew(join(directory,'protocol.json'),frozen);persist(directory,state);
 try{
  for(const [index,slot] of frozen.schedule.entries()){
   if(!canStart(state,slot)){state.halted??='c_budget_or_unknown_usage';break;}
   assert.equal(digest(readFileSync(freezePath)),freezeSha256,'freeze_manifest_drift');verifyFrozen(prepared,frozen);
   const body=read<Payload>(join(prepared,slot.bodyPath));const raw=JSON.stringify(body);assert.ok(!raw.includes(secret),'credential_contamination');
   const row=state.records[index],child=join(directory,slot.id);mkdirSync(child,{mode:0o700});saveNew(join(child,'request.json'),body);
   row.requestSha256=digest(raw);row.startedAt=new Date().toISOString();row.status='started';state.totals.requests++;state.totals.unknown++;persist(directory,state);
   const responsePath=join(child,'response.sse'),{parser,output}=collectResponse();let counted=false;let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
   try{
    const response=await (options.transport??fetch)(endpoint+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+secret},body:raw,redirect:'error'});row.httpStatus=response.status;
    if(!response.ok){writeFileSync(join(child,'response-error.txt'),(await response.text()).split(secret).join('[REDACTED]'),{flag:'wx',mode:0o600});throw new Error('provider_http_'+response.status);}
    assert.ok(response.body,'missing_response_body');reader=response.body.getReader();
    for(;;){const chunk=await reader.read();if(chunk.done)break;appendFileSync(responsePath,chunk.value,{mode:0o600});parser.push(chunk.value);}
    // Flush a terminal data line even if the server omitted its final newline.
    parser.push(new TextEncoder().encode('\n'));
    row.output=output;
    if(output.usage){state.totals.input+=output.usage.input;state.totals.output+=output.usage.output;state.totals.unknown--;counted=true;}
    row.status=classify(output,slot.group);
    if(state.totals.input>limits.input||state.totals.output>limits.output)state.halted='actual_usage_exceeded_budget';
   }catch(error){
    await reader?.cancel().catch(()=>{});row.output=output;
    if(!counted&&output.usage){state.totals.input+=output.usage.input;state.totals.output+=output.usage.output;state.totals.unknown--;counted=true;}
    row.status='failed';row.reason=(error instanceof Error?error.message:'provider_request_failed').split(secret).join('[REDACTED]');state.halted=row.reason;saveNew(join(child,'failure.json'),{reason:row.reason,noAutomaticRetry:true,knownUsage:counted});
   }finally{
    row.completedAt=new Date().toISOString();if(existsSync(responsePath))row.responseSha256=digest(readFileSync(responsePath));saveNew(join(child,'record.json'),row);persist(directory,state);
   }
   if(state.halted)break;
  }
 }catch(error){state.halted=(error instanceof Error?error.message:'c_execution_failure').split(secret).join('[REDACTED]');}
 finally{persist(directory,state);saveNew(join(directory,'results.json'),state);}
 return state;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,prepared,directory]=process.argv.slice(2);assert.equal(mode,'run','reasoning-live.ts run PREPARED NEW_OUTPUT');assert.ok(prepared&&directory);
 void runComparison({prepared,directory}).then(s=>{console.info(JSON.stringify({planned:s.planned,completed:s.records.filter(r=>['answer','needs_evidence','truncated'].includes(r.status)).length,totals:s.totals,halted:s.halted??null}));if(s.halted)process.exitCode=1;}).catch(error=>{console.error(error instanceof Error?error.message:'C runner failed');process.exitCode=1;});
}
