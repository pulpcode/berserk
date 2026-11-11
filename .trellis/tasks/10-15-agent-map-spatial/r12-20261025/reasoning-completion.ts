/** R12 closeout only: first attempts of the five frozen, unattempted C slots. */
import assert from 'node:assert/strict';
import {appendFileSync,existsSync,mkdirSync,readFileSync,readdirSync,renameSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {liveEnvironment,offlineEnvironment} from '../r7-20261023/environment.js';
import {collectResponse,type BatchState,type Result} from './reasoning-live.js';
import {digest,endpoint,limits,maxTokens,read,repo,responseModel,root,saveNew,verifyFrozen,type Freeze,type Group,type Payload,type Slot} from './reasoning-prepare.js';

const local=join(repo,'.local/spatial-r12');
const originalPrepared=join(local,'reasoning-prepared-20261025');
const originalBatch=join(local,'reasoning-batch-20261025');
const baselinePath=join(local,'closeout-before-20261025.json');
const baselineSha256='d302fb1a829db67711c449ad87c368fa86f0b11bc86648f6053a9605bfbb8419';
const originalFreezeSha256='2cce95f5b245a86c454429ac1bce28b9e6397f711e85a4c2cc7496fcc47e3450';
const originalResultsSha256='f7228e5db5085838900996e3d11d92b901536f780b9b26addb274bf4ac693ff6';
export const completionIds=['C04-C0','C05-C0','C05-C1','C06-C1','C06-C0'] as const;
export const originalTotals={requests:7,input:146903,output:2588,unknown:0} as const;
export const liveClaimPath=originalBatch+'-completion-claim.json';
type ResponseData=ReturnType<typeof collectResponse>['output'];
type Totals=BatchState['totals'];
interface Baseline {files:Record<string,string>;product:Record<string,string>}
interface CompletionFreeze {
 schemaVersion:1;scope:'r12_remaining_five_first_attempts';baselineSha256:string;originalFreezeSha256:string;originalResultsSha256:string;
 originalPrepared:string;originalBatch:string;originalTotals:Totals;sourceCode:Record<string,string>;schedule:Slot[];
 requestFileHashes:Record<string,string>;limits:typeof limits;plannedRequests:5;automaticRetries:false;executeTools:false;
}
export interface CompletionResult extends Result {
 requestedThinking:'disabled'|'enabled';requestedEffort:'absent'|'high';
 observedThinking?:{signal:'observed'|'not_observed';characters:number;tokens?:number};
}
export interface CompletionState {
 schemaVersion:1;scope:'r12_remaining_five_first_attempts';freezeSha256:string;originalResultsSha256:string;originalTotals:Totals;
 planned:5;records:CompletionResult[];totals:Totals;cumulativeTotals:Totals;halted?:string;
 automaticRetries:false;toolsExecuted:0;semanticReview:'pending_agent_review';offlineSimulation:boolean;
}
function hashFile(path:string){return digest(readFileSync(path));}
function isolated(path:string){assert.ok(resolve(path).startsWith(local+'/'),'Use isolated R12 .local output');}
function sourceHashes(){return Object.fromEntries(['reasoning-completion.ts','reasoning-completion.test.ts'].map(name=>{const path=join(root,name);return [relative(repo,path),hashFile(path)];}));}
function verifyBaseline(){
 assert.equal(hashFile(baselinePath),baselineSha256,'closeout_baseline_drift');
 const baseline=read<Baseline>(baselinePath);assert.equal(Object.keys(baseline.files).length,488);assert.equal(Object.keys(baseline.product).length,3);
 for(const [path,hash] of Object.entries({...baseline.files,...baseline.product}))assert.equal(hashFile(join(repo,path)),hash,'original_evidence_or_product_drift: '+path);
 return baseline;
}
export function observeThinking(output:ResponseData){
 return {signal:output.reasoningCharacters>0||(output.reasoningTokens??0)>0?'observed' as const:'not_observed' as const,characters:output.reasoningCharacters,...(output.reasoningTokens===undefined?{}:{tokens:output.reasoningTokens})};
}
/** Old classifier is frozen. Keep its protocol checks, removing ONLY C1's required positive signal. */
export function classifyCompletion(output:ResponseData,group:Group):Result['status']{
 assert.deepEqual(output.models,[responseModel],'response_model_drift');
 assert.equal(output.ids.length,1,'missing_or_changed_response_id');
 assert.ok(output.usage,'unknown_provider_usage');
 assert.ok(output.usage.input>0&&output.usage.output>0,'empty_provider_usage');
 assert.ok(output.usage.output<=maxTokens,'provider_exceeded_output_limit');
 assert.ok(output.reasoningTokens===undefined||output.reasoningTokens<=output.usage.output,'reasoning_usage_exceeds_total');
 assert.ok(output.done||output.finishReason,'incomplete_stream');
 if(group==='C0')assert.equal(observeThinking(output).signal,'not_observed','disabled_thinking_not_effective');
 if(output.finishReason==='length')return 'truncated';
 if(output.tools.length){assert.equal(output.finishReason,'tool_calls');for(const call of output.tools){assert.ok(call.id&&call.name,'invalid_tool_call');JSON.parse(call.arguments);}return 'needs_evidence';}
 assert.equal(output.finishReason,'stop','unexpected_finish_reason');assert.ok(output.content.trim(),'empty_answer');return 'answer';
}
/** Independently reconstruct actual attempts and usage from the seven original raw responses. */
export function inspectOriginal(){
 const baseline=verifyBaseline(),freezePath=join(originalPrepared,'freeze.json');
 assert.equal(hashFile(freezePath),originalFreezeSha256,'original_freeze_drift');
 const frozen=read<Freeze>(freezePath);verifyFrozen(originalPrepared,frozen);
 assert.equal(hashFile(join(originalBatch,'results.json')),originalResultsSha256,'original_results_drift');
 const state=read<BatchState>(join(originalBatch,'results.json'));
 assert.deepEqual(read(join(originalBatch,'progress.json')),state,'original_progress_disagrees');
 assert.deepEqual(read(join(originalBatch,'protocol.json')),frozen,'original_protocol_disagrees');
 const claim=read<{directory:string;freezeSha256:string;noRetry:boolean}>(join(originalPrepared,'run-claim.json'));
 assert.equal(claim.directory,originalBatch);assert.equal(claim.freezeSha256,originalFreezeSha256);assert.equal(claim.noRetry,true);
 assert.equal(state.freezeSha256,originalFreezeSha256);assert.equal(state.planned,12);assert.equal(state.automaticRetries,false);assert.equal(state.toolsExecuted,0);assert.equal(state.halted,'thinking_effect_unverified');
 assert.deepEqual(state.records.map(row=>row.id),frozen.schedule.map(slot=>slot.id));
 assert.deepEqual(frozen.schedule.slice(7).map(slot=>slot.id),completionIds,'Only approved five may be selected');
 const attempted=frozen.schedule.slice(0,7),totals:Totals={requests:0,input:0,output:0,unknown:0};
 assert.deepEqual(readdirSync(originalBatch,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort(),attempted.map(slot=>slot.id).sort(),'unexpected_original_attempt_directory');
 for(const [index,slot] of frozen.schedule.entries()){
  const row=state.records[index];assert.equal(row.caseId,slot.caseId);assert.equal(row.group,slot.group);
  if(index>=7){assert.deepEqual(row,{id:slot.id,caseId:slot.caseId,group:slot.group,status:'planned'},'slot_already_attempted');continue;}
  const child=join(originalBatch,slot.id),request=read<Payload>(join(child,'request.json'));
  assert.deepEqual(read(join(child,'record.json')),row,'original_record_disagrees');
  assert.equal(hashFile(join(child,'request.json')),hashFile(join(originalPrepared,slot.bodyPath)),'original_request_bytes_changed');
  assert.equal(digest(JSON.stringify(request)),slot.bodySha256);assert.equal(row.requestSha256,slot.bodySha256);
  assert.ok(row.startedAt&&row.completedAt);assert.equal(row.httpStatus,200);
  const response=readFileSync(join(child,'response.sse'));assert.equal(digest(response),row.responseSha256,'original_response_hash_disagrees');
  const {output,parser}=collectResponse();parser.push(response);parser.push(new TextEncoder().encode('\n'));assert.deepEqual(output,row.output,'original_raw_response_disagrees');
  const status=classifyCompletion(output,slot.group);
  if(slot.id==='C04-C1'){assert.equal(row.status,'failed');assert.equal(row.reason,'thinking_effect_unverified');assert.equal(status,'answer');assert.equal(observeThinking(output).signal,'not_observed');}
  else assert.equal(status,row.status);
  assert.ok(output.usage);totals.requests++;totals.input+=output.usage.input;totals.output+=output.usage.output;
 }
 assert.deepEqual(totals,state.totals,'original_usage_disagrees');assert.deepEqual(totals,originalTotals,'approved_original_usage_changed');
 for(const directory of [originalPrepared,originalBatch]){
  const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(dir,entry.name)):[relative(repo,join(dir,entry.name))]);
  for(const path of walk(directory))assert.ok(baseline.files[path],'unfrozen_original_file: '+path);
 }
 return {frozen,totals,schedule:frozen.schedule.slice(7)};
}
export function prepareCompletion(directory:string):CompletionFreeze{
 directory=resolve(directory);isolated(directory);assert.ok(!existsSync(directory),'Refuse overwriting prepared completion');
 assert.ok(!existsSync(liveClaimPath),'Original batch completion already claimed');
 const {schedule,totals}=inspectOriginal();
 assert.equal(schedule.reduce((sum,slot)=>sum+slot.inputReservation,0),127938);
 assert.ok(totals.input+127938<=limits.input);assert.ok(totals.output+5*maxTokens<=limits.output);
 const frozen:CompletionFreeze={schemaVersion:1,scope:'r12_remaining_five_first_attempts',baselineSha256,originalFreezeSha256,originalResultsSha256,originalPrepared,originalBatch,originalTotals:totals,sourceCode:sourceHashes(),schedule,requestFileHashes:Object.fromEntries(schedule.map(slot=>[slot.bodyPath,hashFile(join(originalPrepared,slot.bodyPath))])),limits,plannedRequests:5,automaticRetries:false,executeTools:false};
 mkdirSync(dirname(directory),{recursive:true,mode:0o700});mkdirSync(directory,{mode:0o700});
 for(const slot of schedule)writeFileSync(join(directory,slot.bodyPath),readFileSync(join(originalPrepared,slot.bodyPath)),{flag:'wx',mode:0o600});
 saveNew(join(directory,'freeze.json'),frozen);return frozen;
}
function verifyCompletion(prepared:string,frozen:CompletionFreeze){
 assert.equal(frozen.scope,'r12_remaining_five_first_attempts');assert.equal(frozen.schemaVersion,1);assert.equal(frozen.plannedRequests,5);assert.equal(frozen.automaticRetries,false);assert.equal(frozen.executeTools,false);
 assert.equal(frozen.baselineSha256,baselineSha256);assert.equal(frozen.originalFreezeSha256,originalFreezeSha256);assert.equal(frozen.originalResultsSha256,originalResultsSha256);
 assert.equal(frozen.originalPrepared,originalPrepared);assert.equal(frozen.originalBatch,originalBatch);assert.deepEqual(frozen.originalTotals,originalTotals);assert.deepEqual(frozen.limits,limits);
 assert.deepEqual(frozen.sourceCode,sourceHashes(),'completion_source_drift');
 const original=inspectOriginal();assert.deepEqual(frozen.schedule,original.schedule,'completion_schedule_changed');
 assert.deepEqual(Object.keys(frozen.requestFileHashes).sort(),original.schedule.map(slot=>slot.bodyPath).sort());
 for(const slot of frozen.schedule){
  const bytes=readFileSync(join(prepared,slot.bodyPath));assert.equal(digest(bytes),frozen.requestFileHashes[slot.bodyPath],'completion_request_file_drift');
  assert.deepEqual(bytes,readFileSync(join(originalPrepared,slot.bodyPath)),'completion_request_bytes_changed');
  assert.equal(digest(JSON.stringify(JSON.parse(bytes.toString('utf8')))),slot.bodySha256,'completion_wire_drift');
 }
}
function combined(totals:Totals):Totals{return {requests:originalTotals.requests+totals.requests,input:originalTotals.input+totals.input,output:originalTotals.output+totals.output,unknown:totals.unknown};}
export function canStartCompletion(state:Pick<CompletionState,'totals'|'halted'>,slot:Slot){
 const total=combined(state.totals);
 return !state.halted&&total.unknown===0&&total.requests+1<=limits.requests&&total.input+slot.inputReservation<=limits.input&&total.output+maxTokens<=limits.output;
}
function persist(directory:string,state:CompletionState){state.cumulativeTotals=combined(state.totals);const path=join(directory,'progress.json');writeFileSync(path+'.tmp',JSON.stringify(state,null,2)+'\n',{mode:0o600});renameSync(path+'.tmp',path);}
interface RunOptions {prepared:string;directory:string;env?:NodeJS.ProcessEnv}
/** Explicit test seam; the CLI cannot select this branch or override the live marker. */
interface OfflineRunOptions extends RunOptions {transport:typeof fetch;offlineClaimDirectory:string}
export async function runCompletion(options:RunOptions|OfflineRunOptions){
 const prepared=resolve(options.prepared),directory=resolve(options.directory);isolated(prepared);isolated(directory);
 const simulation='transport' in options;
 const freezePath=join(prepared,'freeze.json'),freezeSha256=hashFile(freezePath),frozen=read<CompletionFreeze>(freezePath);verifyCompletion(prepared,frozen);
 assert.ok(!existsSync(directory),'Refuse overwriting completion output');
 let claimPath=liveClaimPath;
 if(simulation){isolated(options.offlineClaimDirectory);assert.ok(resolve(options.offlineClaimDirectory).includes('/offline-completion-'),'Offline claim must be in an explicit test directory');claimPath=join(resolve(options.offlineClaimDirectory),'completion-claim.json');}
 assert.ok(!existsSync(claimPath),'Original batch completion already claimed; no replay or automatic retry');
 const env=simulation?offlineEnvironment():liveEnvironment(options.env??process.env),secret=env.LLM_API_KEY!;
 const state:CompletionState={schemaVersion:1,scope:'r12_remaining_five_first_attempts',freezeSha256,originalResultsSha256,originalTotals,planned:5,records:frozen.schedule.map(slot=>({id:slot.id,caseId:slot.caseId,group:slot.group,status:'planned',requestedThinking:slot.group==='C0'?'disabled':'enabled',requestedEffort:slot.group==='C0'?'absent':'high'})),totals:{requests:0,input:0,output:0,unknown:0},cumulativeTotals:{...originalTotals},automaticRetries:false,toolsExecuted:0,semanticReview:'pending_agent_review',offlineSimulation:simulation};
 // Exclusive marker belongs to the original batch, not to the replaceable output directory.
 saveNew(claimPath,{originalBatch,originalFreezeSha256,originalResultsSha256,prepared,directory,freezeSha256,at:new Date().toISOString(),automaticRetries:false,offlineSimulation:simulation});
 mkdirSync(directory,{mode:0o700});saveNew(join(directory,'protocol.json'),frozen);persist(directory,state);
 try{
  for(const [index,slot] of frozen.schedule.entries()){
   if(!canStartCompletion(state,slot)){state.halted??='c_budget_or_unknown_usage';break;}
   assert.equal(hashFile(freezePath),freezeSha256,'completion_manifest_drift');verifyCompletion(prepared,frozen);
   const bytes=readFileSync(join(prepared,slot.bodyPath)),raw=JSON.stringify(JSON.parse(bytes.toString('utf8')));assert.equal(digest(raw),slot.bodySha256);assert.ok(!raw.includes(secret),'credential_contamination');
   const row=state.records[index],child=join(directory,slot.id);mkdirSync(child,{mode:0o700});writeFileSync(join(child,'request.json'),bytes,{flag:'wx',mode:0o600});
   row.requestSha256=digest(raw);row.startedAt=new Date().toISOString();row.status='started';state.totals.requests++;state.totals.unknown++;
   saveNew(join(child,'attempt.json'),{id:slot.id,startedAt:row.startedAt,requestSha256:row.requestSha256,usage:'unknown',automaticRetries:false});persist(directory,state);
   const responsePath=join(child,'response.sse'),{output,parser}=collectResponse();let counted=false;let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
   const account=()=>{if(!counted&&output.usage){state.totals.input+=output.usage.input;state.totals.output+=output.usage.output;state.totals.unknown--;counted=true;}};
   try{
    const transport=simulation?options.transport:fetch;
    const response=await transport(endpoint+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+secret},body:raw,redirect:'error'});row.httpStatus=response.status;
    if(!response.ok){writeFileSync(join(child,'response-error.txt'),(await response.text()).split(secret).join('[REDACTED]'),{flag:'wx',mode:0o600});throw new Error('provider_http_'+response.status);}
    assert.ok(response.body,'missing_response_body');reader=response.body.getReader();
    for(;;){const chunk=await reader.read();if(chunk.done)break;appendFileSync(responsePath,chunk.value,{mode:0o600});parser.push(chunk.value);}
    parser.push(new TextEncoder().encode('\n'));account();row.status=classifyCompletion(output,slot.group);
    const total=combined(state.totals);if(total.input>limits.input||total.output>limits.output)state.halted='actual_usage_exceeded_budget';
   }catch(error){
    await reader?.cancel().catch(()=>{});account();row.status='failed';row.reason=(error instanceof Error?error.message:'provider_request_failed').split(secret).join('[REDACTED]');state.halted=row.reason;
    saveNew(join(child,'failure.json'),{reason:row.reason,noAutomaticRetry:true,knownUsage:counted});
   }finally{
    row.output=output;row.observedThinking=observeThinking(output);row.completedAt=new Date().toISOString();
    if(existsSync(responsePath))row.responseSha256=hashFile(responsePath);saveNew(join(child,'record.json'),row);persist(directory,state);
   }
   if(state.halted)break;
  }
 }catch(error){state.halted=(error instanceof Error?error.message:'completion_execution_failure').split(secret).join('[REDACTED]');}
 finally{persist(directory,state);saveNew(join(directory,'results.json'),state);}
 return state;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,prepared,directory]=process.argv.slice(2);
 if(mode==='prepare'){assert.ok(prepared&&!directory,'reasoning-completion.ts prepare NEW_PREPARED');const frozen=prepareCompletion(prepared);console.info(JSON.stringify({prepared,planned:frozen.plannedRequests,ids:frozen.schedule.map(slot=>slot.id),originalTotals:frozen.originalTotals,inputReservation:127938,providerRequests:0}));}
 else {assert.ok(mode==='run'&&prepared&&directory,'reasoning-completion.ts run PREPARED NEW_OUTPUT');void runCompletion({prepared,directory}).then(state=>{console.info(JSON.stringify({planned:state.planned,completed:state.records.filter(row=>['answer','needs_evidence','truncated'].includes(row.status)).length,totals:state.totals,cumulativeTotals:state.cumulativeTotals,halted:state.halted??null}));if(state.halted)process.exitCode=1;}).catch(error=>{console.error(error instanceof Error?error.message:'Completion runner failed');process.exitCode=1;});}
}
