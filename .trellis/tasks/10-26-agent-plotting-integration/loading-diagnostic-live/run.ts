/** Task-local HTTP/Pi runner. Default is prepare; live needs an independently reviewed frozen authorization. */
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {appendFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {cp,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mapTrialAuth,mapTrialRequest,type startMapTrial} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import type {SessionSnapshot,StreamEvent,WorkspaceResources} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {SSELines} from '../../10-17-map-query-native-evaluation/run.js';
import {prepareCase,type Prepared} from '../evaluation-v2/cases.js';
import {clarificationResponse,assessEnding,replyFor} from '../evaluation-v3/interactions.js';
import {slotAccounting} from '../evaluation-v2/accounting.js';
import {Provider,type Active as ProviderActive} from '../evaluation-v2/provider.js';
import {diagnosticEffect} from './effects.js';
import {Ledger,limits} from './budget.js';
import {cases,schedule} from '../loading-diagnostic/cases.js';
import {auditPayload} from '../../10-15-agent-map-spatial/r3-20261022/audit.js';
import {type Payload} from '../evaluation-v2/provider.js';
type Entry=typeof schedule[number];
import {sourceFreeze,buildRuntime,liveEnvironment,offlineEnvironment,loopbackOnly,packageRoot,repo,root,businessContext,hashes,save,digest,scope} from './runtime.js';
interface Row extends Entry {status:'not_executed'|'prepared'|'started'|'recorded'|'waiting_user'|'needs_review'|'incomplete'|'failed';semanticReview:'pending';stop?:string;requests:number;tools:number;completedTurns:number;messageSendAttempts:number;sentTurns:number;successfulResponseTurns:number;respondedUserTurns:number;usage?:{input:number;output:number;unknown:number};providerRequestIds?:number[];accountingIssues?:string[]}
interface Active extends ProviderActive {trial:Awaited<ReturnType<typeof startMapTrial>>;prepared:Prepared;requestId?:string;conflictInjected:boolean;group:'A'|'B';skillBody:string;events:StreamEvent[];interactionUsed:boolean;interactions:unknown[];userTurn:number;tools:number}
export interface Authorization {approvedByUser:true;freezeHash:string;limits:typeof limits;providerAllowanceVerified:boolean;providerAllowanceCheckWaivedByUser?:true;billingNote:string;scope:typeof scope}
export interface Options {directory:string;mode?:'prepare'|'live';port?:number;authorization?:Authorization;env?:NodeJS.ProcessEnv;offline?:{transport:typeof fetch;entries?:Entry[]}}
export async function createClaim(claims:string,freezeHash:string,directory:string){await mkdir(claims,{recursive:true,mode:0o700});writeFileSync(join(claims,freezeHash+'.json'),JSON.stringify({freezeHash,directory,at:new Date().toISOString(),automaticRetries:false})+'\n',{flag:'wx',mode:0o600});}
function read<T>(p:string):T{return JSON.parse(readFileSync(p,'utf8')) as T;}
export function validateAuthorization(value:Authorization|undefined,hash:string){assert.ok(value?.approvedByUser===true&&(value.providerAllowanceVerified===true||value.providerAllowanceCheckWaivedByUser===true)&&value.billingNote.trim(),'Live execution requires actual approval and verified allowance or explicit user waiver');assert.equal(value.freezeHash,hash,'Authorization is for another frozen version');assert.deepEqual(value.limits,limits,'Budget differs from reviewed plan');assert.deepEqual(value.scope,scope,'Scope differs from reviewed diagnostic');}
export async function run(options:Options){
 assert.equal(process.cwd(),packageRoot,'Run from experiments/harness-lab');const directory=resolve(options.directory),mode=options.mode??'prepare',original=globalThis.fetch;
 assert.ok(!directory.startsWith(root),'Evidence must stay outside evaluation source');assert.ok(!existsSync(directory),'Refuse overwriting evidence');const frozen=await sourceFreeze(),freezeHash=digest(JSON.stringify(frozen)),entries=options.offline?.entries??schedule;
 assert.deepEqual(entries,schedule,'All 24 diagnostic slots are required');
 if(mode==='live'&&!options.offline){assert.ok(directory.startsWith(join(repo,'.local','agent-plotting-integration')+'/'),'Live evidence must stay in task-local .local');assert.deepEqual(entries,schedule);validateAuthorization(options.authorization,freezeHash);const claims=join(repo,'.local','agent-plotting-integration','loading-diagnostic-claims');await createClaim(claims,freezeHash,directory);}
 const env=mode==='live'&&!options.offline?liveEnvironment(options.env??process.env):offlineEnvironment();
 await mkdir(directory,{mode:0o700});save(join(directory,'protocol.json'),{frozen,freezeHash,mode,offlineSimulation:Boolean(options.offline),automaticRetries:false,automaticResume:false});
 const ledger=new Ledger(join(directory,'ledger.json'),freezeHash),rows:Row[]=entries.map(e=>({...e,status:'not_executed',semanticReview:'pending',requests:0,tools:0,completedTurns:0,messageSendAttempts:0,sentTurns:0,successfulResponseTurns:0,respondedUserTurns:0}));save(join(directory,'runs.json'),rows);
 let active:Active|undefined,stop:string|undefined;const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const cancel=async(reason:string)=>{if(!active)return;active.stop??=reason;if(active.requestId)await mapTrialRequest(active.trial.manifest,`/api/sessions/${active.prepared.sessionId}/cancel`,'planning','POST',{requestId:active.requestId}).catch(()=>{});};
 const pairedDocuments=new Map<string,unknown>(),toolHashes=new Set<string>();
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(['127.0.0.1','localhost','[::1]'].includes(url.hostname))return (options.offline?.transport??original)(input,init);
  assert.ok(active);const wire=JSON.parse(String(init?.body)) as Payload,toolsHash=digest(JSON.stringify(wire.tools));toolHashes.add(toolsHash);assert.equal(toolHashes.size,1,'Tool schemas changed across A/B');
  const bodyPresent=auditPayload(wire,active.runtime.skills,active.requests,active.turn).skills['map-annotations'].bodyPresent;
  if(active.group==='B')assert.equal(bodyPresent,true,'Explicit Skill body missing');
  if(active.group==='A'&&active.requests===1)assert.equal(bodyPresent,false,'A initial context unexpectedly preloaded');
  save(join(active.directory,`loading-check-${active.requests}.json`),{bodyPresent,toolsHash,group:active.group});
  return (options.offline?.transport??original)(input,init);
 };
 const observer=new Provider({directory,original:transport,secret:env.LLM_API_KEY!,verify:async()=>{assert.equal(digest(JSON.stringify(await sourceFreeze())),freezeHash,'Frozen source changed');assert.ok(active);assert.deepEqual(await hashes(active.runtime.root),active.runtime.hashes,'Runtime changed');},beforeProvider:async()=>{},cancel},ledger);
 const signal=()=>{stop='operator_interrupt';ledger.halt(stop);void cancel(stop);};process.on('SIGINT',signal);process.on('SIGTERM',signal);
 globalThis.fetch=mode==='prepare'?loopbackOnly(original):observer.fetch;
 try{
  const runtime=await buildRuntime(join(directory,'runtime'));
  for(const [index,row] of rows.entries()){
   if(stop||observer.fatal||ledger.read().halted){stop??=observer.fatal??ledger.read().halted;break;}
   if(index%2===0&&!ledger.canStartPair()){stop='budget_reserve_before_pair';break;}
   assert.equal(digest(JSON.stringify(await sourceFreeze())),freezeHash,'Frozen source changed between slots');
   const dir=join(directory,row.id);await mkdir(dir,{mode:0o700});row.status='started';save(join(directory,'runs.json'),rows);
   let trial:Awaited<ReturnType<typeof startMapTrial>>|undefined,review:Record<string,unknown>|undefined;
   try{
    trial=await runtime.start(options.port??5285,env,false,{background:'neutral'});assert.equal(trial.manifest.day,day,'Synthetic day changed');
    const spec=cases.find(c=>c.id===row.caseId)!,p=await prepareCase(trial.manifest,spec.fixture);p.prompts=[spec.prompt];
    const normalizedDocument=JSON.parse(JSON.stringify(p.before.version!.document).split(trial.manifest.objects.resource.objectId).join('fixture-source-resource')),pairKey=`${row.caseId}-${row.round}`;
    if(pairedDocuments.has(pairKey))assert.deepEqual(normalizedDocument,pairedDocuments.get(pairKey),'Paired business documents differ');else pairedDocuments.set(pairKey,normalizedDocument);
    save(join(dir,'pairing.json'),{pairKey,normalizedDocument,normalization:{[trial.manifest.objects.resource.objectId]:'fixture-source-resource'}});
    const instruction=await trial.lab.resources.readInstruction(p.workspaceId,'workspace','seat-planning');await trial.lab.resources.updateInstruction(p.workspaceId,'workspace',businessContext,instruction.hash,undefined,'seat-planning');
    const catalog=await mapTrialRequest<WorkspaceResources>(trial.manifest,`/api/workspaces/${p.workspaceId}/resources`,'planning'),skill=catalog.skills.find(s=>s.id==='map-annotations');assert.ok(skill);assert.equal(skill.hash,runtime.skills['map-annotations'].hash);
    const clarificationCase=row.caseId==='T1'?p:{...p,caseId:row.caseId};
    const selection=row.group==='B'?{id:skill.id,hash:skill.hash}:undefined;save(join(dir,'resources.json'),{catalog,selection:selection??null});
    save(join(dir,'manifest.json'),trial.manifest);save(join(dir,'fixture.json'),p);
    if(mode==='prepare'){row.status='prepared';continue;}
    active={id:row.id,directory:dir,turn:0,runtime,requests:0,trial,prepared:p,conflictInjected:false,group:row.group,skillBody:runtime.skills['map-annotations'].content,events:[],interactionUsed:false,interactions:[],userTurn:0,tools:0};observer.active=active;
    const started=Date.now(),respondedUserTurns=new Set<number>();
    for(const [userTurn,prompt] of p.prompts.entries()){
     active.userTurn=userTurn;active.interactionUsed=false;let text=prompt,repeat=false;
     do{
      repeat=false;active.requestId=undefined;const input={text,...(selection?{skill:selection}:{}),...(p.annotationRefs?{annotationRefs:p.annotationRefs}:{})},stem=join(dir,`turn-${++active.turn}`);save(stem+'-input.json',input);save(stem+'-before.json',await mapState(trial.manifest,p.sessionId));
      const jobs:Promise<void>[]=[],seen=new Set<string>();let interactionFailure:unknown;
      const auth=await mapTrialAuth(trial.manifest,'planning');row.messageSendAttempts++;
      const response=await fetch(`${trial.manifest.url}/api/sessions/${p.sessionId}/messages`,{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify(input)});assert.ok(response.ok&&response.body,`Message HTTP ${response.status}`);row.sentTurns++;
      const parser=new SSELines(value=>{const event=value as unknown as StreamEvent;active!.events.push(event);active!.requestId=event.requestId;if(event.type==='tool.started')active!.tools++;
       if(event.type==='interaction.updated'&&event.interaction.status==='pending'&&!seen.has(event.interaction.interactionId)){
        const item=event.interaction;seen.add(item.interactionId);const answer=clarificationResponse(clarificationCase,item,active!.interactionUsed,userTurn);active!.interactions.push({item,answer:answer??null});if(answer)active!.interactionUsed=true;
        jobs.push((async()=>{if(answer)await mapTrialRequest(trial!.manifest,`/api/sessions/${p.sessionId}/interactions/${item.interactionId}/response`,'planning','POST',answer);else await cancel('waiting_user');})().catch(error=>{interactionFailure=error;void cancel('interaction_failed');}));
       }
      });
      const reader=response.body.getReader();try{for(;;){const chunk=await reader.read();if(chunk.done)break;appendFileSync(stem+'.sse',chunk.value,{mode:0o600});parser.push(chunk.value);}}finally{await Promise.all(jobs);}if(interactionFailure)throw interactionFailure;
      const snapshot=await mapTrialRequest<SessionSnapshot>(trial.manifest,`/api/sessions/${p.sessionId}`,'planning'),after=await mapState(trial.manifest,p.sessionId);
      const source=await mapTrialRequest(trial.manifest,'/api/simulation','overall'),critical=diagnosticEffect(row.caseId,p,snapshot,after,source);
      const other=p.otherSessionId?await mapState(trial.manifest,p.otherSessionId):undefined;
      save(stem+'-result.json',{snapshot,after,source,other,critical,interactions:active.interactions,conflictInjected:active.conflictInjected,semanticReview:'pending'});
      if(snapshot.lastResult?.status==='succeeded'){row.successfulResponseTurns++;respondedUserTurns.add(userTurn);row.respondedUserTurns=respondedUserTurns.size;}
      if(critical||other&&!isDeepStrictEqual(other,p.otherBefore)){stop=critical??'other_session_changed';ledger.halt(stop);row.stop=stop;row.status='failed';break;}
      if(active.stop||snapshot.lastResult?.status!=='succeeded'){row.status=active.stop==='waiting_user'?'waiting_user':'incomplete';row.stop=active.stop??'request_not_succeeded';if(row.status==='incomplete'){stop=row.stop;ledger.halt(stop);}break;}
      const ending=assessEnding(snapshot.messages.filter(m=>m.role==='assistant').at(-1)?.text??'');save(stem+'-ending.json',ending);
      if(ending.kind==='needs_review'){row.status='needs_review';row.stop=ending.reason;break;}
      if(ending.kind==='needs_reply'){const answer=active.interactionUsed?undefined:replyFor(clarificationCase,ending.question!,userTurn);if(!answer){row.status='waiting_user';row.stop='unrecognized_plain_question';break;}active.interactionUsed=true;text=answer;repeat=true;}
      if(active.requests>12||active.tools>24||Date.now()-started>600_000)save(join(dir,'warnings.json'),{requests:active.requests,tools:active.tools,elapsedMs:Date.now()-started,action:'warning_only_continue_within_batch_budget'});
     }while(repeat&&!stop);
     if(row.status!=='started'||stop)break;row.completedTurns++;
    }
    if(row.status==='started')row.status='recorded';
    review={fixture:p,final:await mapTrialRequest(trial.manifest,`/api/sessions/${p.sessionId}`,'planning'),after:await mapState(trial.manifest,p.sessionId),events:active.events,interactions:active.interactions,conflictInjected:active.conflictInjected,semanticReview:'pending',reviewer:'unassigned',note:'All visible claims require evidence review; successful transport is not a semantic pass.'};
   }catch(error){row.status='failed';row.stop='execution_or_evidence_failure';stop=row.stop;ledger.halt(stop);save(join(dir,'failure.json'),{error:String(error).split(env.LLM_API_KEY!).join('[REDACTED]')});}
   finally{
    if(trial){try{if(mode==='live')await cp(join(trial.manifest.dataDir,'sessions'),join(dir,'native-sessions'),{recursive:true});}catch{stop='native_evidence_copy_failed';ledger.halt(stop);row.stop=stop;row.status='failed';}await trial.stop();}
    const counts=slotAccounting(ledger,observer.attempts,row.id,active?.events.filter(event=>event.type==='tool.started').length??0);
    if(counts.requests!==(active?.requests??0)||counts.tools!==(active?.tools??0))counts.accountingIssues.push('runtime_counter_mismatch');
    Object.assign(row,counts);
    if(counts.accountingIssues.length){stop='accounting_mismatch';ledger.halt(stop);row.stop=stop;row.status='failed';}
    observer.persist();
    if(review)save(join(dir,'review.json'),{...review,entry:row});
    save(join(dir,'result.json'),row);save(join(dir,'evidence-hashes.json'),await hashes(dir));save(join(directory,'runs.json'),rows);active=undefined;observer.active=undefined;
   }
  }
 }catch(error){stop='batch_preparation_or_source_drift';ledger.halt(stop);save(join(directory,'failure.json'),{error:String(error).split(env.LLM_API_KEY!).join('[REDACTED]')});}finally{globalThis.fetch=original;process.off('SIGINT',signal);process.off('SIGTERM',signal);save(join(directory,'batch-state.json'),{mode,offlineSimulation:Boolean(options.offline),rows,stop:stop??observer.fatal??ledger.read().halted??null,totals:ledger.totals(),semanticReview:'pending'});}
 return {rows,stop:stop??observer.fatal??ledger.read().halted,totals:ledger.totals()};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode='prepare',directory,authorizationPath,port]=process.argv.slice(2);
 if(mode==='freeze'){assert.ok(directory&&!resolve(directory).startsWith(root),'Freeze output must stay outside evaluation source');void sourceFreeze().then(value=>{writeFileSync(directory,JSON.stringify({freezeHash:digest(JSON.stringify(value)),source:value},null,2)+'\n',{flag:'wx',mode:0o600});});}
 else{assert.ok((mode==='prepare'||mode==='live')&&directory,'Usage: run.ts prepare OUTPUT | freeze FILE | live OUTPUT AUTHORIZATION [PORT]');void run({mode,directory,port:Number(port??5285),authorization:mode==='live'?read<Authorization>(authorizationPath):undefined}).then(result=>{console.info(JSON.stringify(result));if(result.stop)process.exitCode=1;}).catch(error=>{console.error(error instanceof Error?error.message:'Evaluation failed');process.exitCode=1;});}
}
