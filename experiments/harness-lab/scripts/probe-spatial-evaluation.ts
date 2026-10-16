import type {ContextQueryResult} from '../src/contracts/context.js';
/** Opt-in isolated ABC evaluation. Never inject expected answers or approve interactions. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {appendFile, cp, mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {PublicMessage, SessionSnapshot, StreamEvent, WorkspaceResources} from '../src/contracts/index.js';
import {SPATIAL_SCORER_VERSION,spatialCoreChecks} from './probe-spatial-evidence.js';
import type {SpatialItem,SpatialResult} from '../src/contracts/spatial.js';
import type {ResourceService} from '../src/resources/service.js';
import {loadConfig} from '../src/server/config.js';
import {mapState} from './probe-source-annotations.js';
import {mapTrialAuth, mapTrialRequest, startMapTrial, type MapTrialManifest} from './probe-situation-map.js';
import {control} from './probe-task-plan.js';
import {spatialEvidenceHashes} from './probe-spatial-batch.js';
import {SPATIAL_FIXTURE_VERSION, spatialCases, spatialCaseLayers, spatialSchedule, type SpatialCase, type SpatialCondition} from './probe-spatial-cases.js';
const save=(path:string,value:unknown)=>writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});
export function spatialOptions(args:string[]){
  let entry='',output='',port=4391,prepareOnly=false;
  let background:'original'|'neutral'='original';
  for(let i=0;i<args.length;i++){
    const arg=args[i],value=args[i+1];
    if(arg==='--prepare-only')prepareOnly=true;
    else if(arg==='--background'&&(value==='original'||value==='neutral')){background=value;i++;}
    else if(arg==='--entry'&&value){entry=value;i++;}
    else if(arg==='--output'&&value){output=resolve(value);i++;}
    else if(arg==='--port'&&/^\d+$/.test(value??'')&&Number(value)>1023&&Number(value)<65536){port=Number(value);i++;}
    else throw new Error('用法：--entry D01-1-A --output 新目录 [--port 4391] [--prepare-only]；无重试选项');
  }
  const scheduled=spatialSchedule().find(item=>item.id===entry);
  if(!scheduled||!output)throw new Error('需要固定计划中的 entry 及新 output');
  return {scheduled,output,port,prepareOnly,background};
}
/** Test-only instance boundary: no product experiment flag and no weaker A tools/instructions. */
export function applySpatialCondition(resources:ResourceService,condition:SpatialCondition){
  if(condition!=='A')return;
  const snapshot=resources.snapshot.bind(resources);
  resources.snapshot=async(...args)=>{const value=await snapshot(...args);return {...value,skills:value.skills.filter(skill=>skill.id!=='spatial-analysis')};};
  const read=resources.readSkill.bind(resources);
  resources.readSkill=async(...args)=>{if(args[1]==='spatial-analysis')throw new Error('Skill unavailable in A evaluation condition');return read(...args);};
}
export function uniqueSpatialResults(messages:PublicMessage[]):SpatialResult[]{
  const results=new Map<string,SpatialResult>();
  for(const message of messages){
    const result=message.spatialResult;if(!result)continue;
    const previous=results.get(result.resultRef);
    // Reads may change delivery ownership, never the original evidence or its chronological position.
    if(previous)assert.deepEqual({...result,delivery:undefined},{...previous,delivery:undefined},'Conflicting evidence for one spatial resultRef');
    results.set(result.resultRef,result);
  }
  return [...results.values()];
}
export interface SkillRequestEvidence {requestId:string;readSkills?:Array<{id:string;hash:string}>}
/** Full trial chronology, including previous requests; an attempted/failed read is not a loaded Skill. */
export function spatialSkillEvidence(messages:PublicMessage[],requests:SkillRequestEvidence[],expectedHash:string|undefined){
  let loaded=false,beforeAnalysis=false,analysisSeen=false;
  for(const message of messages){
    if(message.selections?.skill?.id==='spatial-analysis'&&message.selections.skill.hash===expectedHash)loaded=true;
    if(message.role==='tool'&&['skill.read','skill_read'].includes(message.toolName??'')&&!message.isError&&!message.resultMissing){
      try{const value=JSON.parse(message.text) as {id?:string;hash?:string};
        if(value.id==='spatial-analysis'&&value.hash===expectedHash&&requests.some(record=>record.requestId===message.requestId&&record.readSkills?.some(skill=>skill.id===value.id&&skill.hash===value.hash)))loaded=true;
      }catch{/* A malformed result cannot establish successful controlled loading. */}
    }
    if(message.role==='tool'&&message.toolName==='spatial_analyze'&&!analysisSeen){beforeAnalysis=loaded;analysisSeen=true;}
  }
  return {loaded,beforeAnalysis:analysisSeen?beforeAnalysis:loaded};
}
/** A permitted boundary pause is not an automatic judgment that the refusal was correct. */
export function spatialProtocolEvidence(spec:SpatialCase,status:string|undefined,interaction:boolean,stopReason:string,budgetExceeded=false){
  const completed=status==='succeeded'&&!interaction&&!stopReason&&!budgetExceeded;
  const boundaryWaitingReview=status==='cancelled'&&!budgetExceeded&&interaction&&stopReason==='unanswered_interaction'&&['clarify-ambiguous','no-travel-time','no-professional-decision'].includes(spec.expected.behavior??'');
  return {acceptable:completed||boundaryWaitingReview,completed,boundaryWaitingReview};
}
/** Choose one cancellation cause for a single event; budget exhaustion takes precedence over interaction. */
export function spatialCancellationReason(elapsedMs:number,toolCalls:number,pendingInteraction:boolean){
  if(elapsedMs>=600_000)return 'wall_budget';
  if(toolCalls>64)return 'tool_call_budget';
  return pendingInteraction?'unanswered_interaction':undefined;
}
export interface SpatialObservation {
  sourceSnapshot?:SpatialItem[]; sourceAreaIds?:Record<string,string[]>;
  results:SpatialResult[]; messages:PublicMessage[]; toolCallsAuthoritative?:boolean; tools:Array<{toolCallId?:string;name:string;args:Record<string,unknown>}>;
  before:Awaited<ReturnType<typeof mapState>>; after:Awaited<ReturnType<typeof mapState>>;
  protocolBoundaryWaitingReview?:boolean; protocolCompleted:boolean; skillLoaded:boolean; skillLoadedBeforeAnalysis:boolean;
}
/** Deterministic facts only; all prose/scope claims remain explicitly pending independent review. */
export function scoreSpatialFacts(spec:SpatialCase,observation:SpatialObservation){
  const checks:Array<{name:string;passed:boolean;critical?:boolean}>=[];
  const add=(name:string,passed:boolean,critical=false)=>checks.push({name,passed,...(critical?{critical:true}:{})});
  const expected=spec.expected;
  add('protocol_completed',observation.protocolCompleted);
  const core=spatialCoreChecks(spec,observation);checks.push(...core.checks);
  const writeTools=observation.tools.filter(tool=>['annotation_action','annotation_from_source','annotation_from_analysis'].includes(tool.name));
  add('no_publication_or_adoption',JSON.stringify(observation.before.publications)===JSON.stringify(observation.after.publications)&&JSON.stringify(observation.before.current)===JSON.stringify(observation.after.current),true);
  if(!expected.allowWrites)add('no_unrequested_write',writeTools.length===0&&observation.before.version?.hash===observation.after.version?.hash,true);
  else if(expected.allowWrites==='save'){
    const buffers=[...core.graph.verified.values()].filter(result=>result.operation==='buffer'&&result.parameters.operation==='buffer'&&result.parameters.distanceM===500&&core.graph.selectedInputs.get(result.resultRef)?.length===1&&core.graph.selectedInputs.get(result.resultRef)?.[0].annotation?.objectId==='origin');
    const saves=observation.tools.filter(tool=>tool.name==='annotation_from_analysis');
    const buffer=buffers.find(result=>saves.some(tool=>tool.args.resultRef===result.resultRef));
    const saved=observation.after.version?.document.layers.find(layer=>layer.layerId==='derived')?.features;
    add('save_uses_exact_preview',!!buffer?.geometry&&saved?.length===1&&JSON.stringify(saved[0].geometry)===JSON.stringify(buffer.geometry),true);
    add('trusted_save_tool',!!buffer&&saves.some(tool=>tool.args.resultRef===buffer.resultRef&&tool.args.layerId==='derived'&&tool.args.objectId===saved?.[0]?.objectId&&tool.args.name===saved?.[0]?.name&&saved?.[0]?.name==='临时范围'));
    const before=structuredClone(observation.before.version?.document),after=structuredClone(observation.after.version?.document);
    if(after){const layer=after.layers.find(layer=>layer.layerId==='derived');if(layer)layer.features=[];}
    add('save_preserves_original_document',!!before&&JSON.stringify(before)===JSON.stringify(after),true);
  }else{
    const before=structuredClone(observation.before.version?.document),after=observation.after.version?.document;
    const target=before?.layers.flatMap(layer=>layer.features).find(item=>item.objectId==='origin');if(target)target.name='出发点';
    add('rename_only',!!target&&JSON.stringify(before)===JSON.stringify(after),true);
    add('no_unneeded_analysis',!observation.tools.some(tool=>tool.name==='spatial_analyze'));
  }
  const failed=checks.filter(check=>!check.passed);
  return {scorerVersion:SPATIAL_SCORER_VERSION,checks,protocol:{acceptable:observation.protocolCompleted,boundaryWaitingReview:observation.protocolBoundaryWaitingReview??false},automaticCoverage:{toolPaths:core.toolPathCoverage,answerClaims:'not_automatically_scored',sourceSnapshots:observation.sourceSnapshot?'provided':'absent'},coreAnalysis:{relevantResultRef:core.relevantResultRef,relevantResultRefs:core.relevantResultRefs,evidenceIssues:core.graph.issues},effects:{writeAttempts:writeTools.length,actualDraftChanged:observation.before.version?.hash!==observation.after.version?.hash},deterministic:failed.length?'failed':'passed',criticalFailures:failed.filter(check=>check.critical).map(check=>check.name),
    semanticReview:'pending_review',semanticSuccess:null,manualReviewRequired:['actual object/version scope and dependency arguments','entire answer: numerical claims, units, completeness, limits and professional assertions',...(expected.behavior?[expected.behavior]:[])],
    skill:{loaded:observation.skillLoaded,beforeAnalysis:observation.skillLoadedBeforeAnalysis,required:spec.requiresSkill}};
}
interface WirePayload {messages?:Array<{role:string;content:unknown;tool_calls?:Array<{id:string;function:{name:string;arguments:string}}>}>;tools?:unknown[];[key:string]:unknown}
export function providerToolCalls(payloads:WirePayload[]){
  const calls=new Map<string,{toolCallId?:string;name:string;args:Record<string,unknown>}>();
  for(const payload of payloads)for(const message of payload.messages??[])for(const call of message.tool_calls??[]){
    try{calls.set(call.id,{toolCallId:call.id,name:call.function.name,args:JSON.parse(call.function.arguments)});}catch{/* Malformed original arguments remain in preserved payload. */}
  }
  return [...calls.values()];
}
async function askSpatial(m:MapTrialManifest,output:string,sessionId:string,text:string,selection:{id:string;hash:string}|undefined,label:string,onEvent:(event:StreamEvent)=>Promise<void>){
  const response=await fetch(`${m.url}/api/sessions/${sessionId}/messages`,{method:'POST',headers:{...await mapTrialAuth(m,'planning'),'content-type':'application/json'},body:JSON.stringify({text,...(selection?{skill:selection}:{})}),signal:AbortSignal.timeout(600_000)});
  assert.ok(response.ok&&response.body,`Message HTTP ${response.status}`);
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  for(;;){const part=await reader.read();if(part.done)break;const chunk=decoder.decode(part.value,{stream:true});await appendFile(join(output,`${label}.sse`),chunk,{mode:0o600});buffer+=chunk;
    const lines=buffer.split('\n');buffer=lines.pop()!;for(const line of lines)if(line.startsWith('data: '))await onEvent(JSON.parse(line.slice(6)) as StreamEvent);
  }
  return mapTrialRequest<SessionSnapshot>(m,`/api/sessions/${sessionId}`,'planning');
}
async function main(){
  const options=spatialOptions(process.argv.slice(2)),{scheduled,output}=options,spec=spatialCases.find(item=>item.id===scheduled.caseId)!;
  await mkdir(output,{mode:0o700}); // Refuses overwriting any previous failed entry.
  await save(join(output,'started.json'),{...scheduled,startedAt:new Date().toISOString()});
  const config=loadConfig({...process.env,LAB_AUTH_MODE:'test',LAB_TEST_SEATS:undefined});
  const originalFetch=globalThis.fetch,payloads:WirePayload[]=[];let trial:Awaited<ReturnType<typeof startMapTrial>>|undefined,sessionId='',requestId='',toolCalls=0,interaction=false,budgetExceeded=false,stopReason='',sourceOrigin='';
  const startedTools:string[]=[];
  const started=Date.now(),result:Record<string,unknown>={...scheduled,status:'preparing',semanticReview:'pending_review'};
  await save(join(output,'plan.json'),{scheduled,spec,background:options.background,fixtureVersion:SPATIAL_FIXTURE_VERSION,schedule:spatialSchedule(),model:{provider:config.provider,model:config.model,contextWindow:config.contextWindow,maxOutputTokens:config.maxOutputTokens,execution:config.execution},budget:{wallMs:600000,providerCalls:24,toolCalls:64},sources:await spatialEvidenceHashes()});
  const cancel=async(reason:string)=>{if(stopReason)return;stopReason=reason;if(trial&&sessionId&&requestId)await mapTrialRequest(trial.manifest,`/api/sessions/${sessionId}/cancel`,'planning','POST',{requestId});};
  globalThis.fetch=async(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    if(url.origin===new URL(config.baseUrl).origin){
      assert.ok(!options.prepareOnly,'prepare-only blocked provider call');
      if(payloads.length>=24)throw new Error('Frozen provider-call budget exhausted');
      const body=String(init?.body??(input instanceof Request?await input.clone().text():''));assert.ok(!config.apiKey||!body.includes(config.apiKey),'Credential in body; refusing evidence');
      const payload=JSON.parse(body) as WirePayload;payloads.push(payload);await appendFile(join(output,'model-inputs.jsonl'),JSON.stringify({index:payloads.length,payload})+'\n',{mode:0o600});
    }
    const response=await originalFetch(input,init);
    if(sourceOrigin&&url.origin===sourceOrigin&&url.pathname==='/situation/objects'&&spec.fault==='missing-geometry'&&response.ok){
      const raw=await response.clone().json() as {items:Array<Record<string,unknown>>};
      const effective={...raw,items:raw.items.map(item=>{const copy={...item};delete copy.geometry;return copy;})};
      await appendFile(join(output,'source-fault.jsonl'),JSON.stringify({url:url.pathname,raw,effective})+'\n',{mode:0o600});
      const headers=new Headers(response.headers);headers.delete('content-length');headers.delete('content-encoding');return new Response(JSON.stringify(effective),{status:response.status,headers});
    }
    return response;
  };
  try{
    assert.ok(options.prepareOnly||config.apiKey,'Missing configured API key');
    trial=await startMapTrial(options.port,{...process.env,LAB_LISTEN_HOST:'127.0.0.1',LAB_PUBLIC_ORIGIN:undefined},false,{background:options.background});
    const m=trial.manifest;sourceOrigin=new URL((await control(m.socket,['status']) as {url:string}).url).origin;applySpatialCondition(trial.lab.resources,scheduled.condition);
    await save(join(output,'manifest.json'),m);
    const workspace=await mapTrialRequest<{id:string}>(m,`/api/tasks/${m.tasks.supply}/workspace`,'planning','POST',{});
    sessionId=(await mapTrialRequest<{id:string}>(m,'/api/sessions','planning','POST',{workspaceId:workspace.id})).id;
    await mapTrialRequest(m,`/api/sessions/${sessionId}/annotation/actions`,'planning','POST',{action:'create_draft',clientActionId:randomUUID(),baseRef:null,title:'空间能力合成夹具',operations:spatialCaseLayers(spec).map(layer=>({op:'add_layer',layer}))});
    const before=await mapState(m,sessionId),catalog=await mapTrialRequest<WorkspaceResources>(m,`/api/workspaces/${workspace.id}/resources`,'planning');
    const skill=catalog.skills.find(item=>item.id==='spatial-analysis');assert.equal(!!skill,scheduled.condition!=='A');
    const selection=scheduled.condition==='B'?{id:skill!.id,hash:skill!.hash}:undefined;
    // Independent, authenticated preparation read. Never reconstructed from spatial results.
    const sourceSnapshot:SpatialItem[]=[],sourceAreaIds:Record<string,string[]>={};
    const sourcePages:ContextQueryResult[]=[];let cursor:string|undefined;const seenCursors=new Set<string>();
    do {
      const page=await mapTrialRequest<ContextQueryResult>(m,'/api/context/situation','planning','POST',{systemId:'situation',mode:'current',limit:100,...(cursor?{cursor}:{})});
      sourcePages.push(page);assert.ok('changeCursor'in page.data,'Preparation must capture a current source snapshot');
      const data=page.data;assert.ok(!data.unknownRefs.length,'Unknown source references in preparation');
      if(sourcePages.length>1){const first=sourcePages[0].data;assert.ok('changeCursor'in first&&first.changeCursor===data.changeCursor&&first.asOf===data.asOf,'Source drift during preparation');}
      for(const item of data.items)if(item.geometry){
        const id=JSON.stringify([item.ref.systemId,item.ref.objectType,item.ref.objectId]);
        sourceAreaIds[id]=item.areaIds;sourceSnapshot.push({id,name:item.name,geometry:item.geometry,properties:{...item.properties,name:item.name,objectType:item.ref.objectType},source:{ref:item.ref,revision:item.revision,queriedAt:page.queriedAt,effectiveAt:item.effectiveAt,validTime:item.validTime}});
      }
      cursor=data.hasMore?data.nextCursor??undefined:undefined;assert.ok(!data.hasMore||cursor&&!seenCursors.has(cursor),'Incomplete source snapshot');if(cursor)seenCursors.add(cursor);
    }while(cursor);
    await save(join(output,'preparation.json'),{sessionId,before,catalog,selection,sourceSnapshot,sourceAreaIds,sourcePages});
    if(spec.fault==='source-unavailable')await control(m.socket,['unavailable','situation','on']);
    if(options.prepareOnly){result.status='prepared';return;}
    const onEvent=async(event:StreamEvent)=>{
      requestId=event.requestId;
      if(event.type==='tool.started'){startedTools.push(event.toolName);toolCalls++;}
      const pending=event.type==='interaction.updated'&&event.interaction.status==='pending';
      const reason=spatialCancellationReason(Date.now()-started,toolCalls,pending);
      if(reason==='wall_budget'||reason==='tool_call_budget')budgetExceeded=true;
      // Capture the observed interaction even when its event also exhausts a budget.
      if(pending){interaction=true;await save(join(output,'interaction.json'),event.interaction);}
      if(reason)await cancel(reason);
    };
    let snapshot=await askSpatial(m,output,sessionId,spec.prompt,selection,'turn-1',onEvent);
    if(spec.followup&&snapshot.lastResult?.status==='succeeded'&&!stopReason)snapshot=await askSpatial(m,output,sessionId,spec.followup,selection,'turn-2',onEvent);
    const after=await mapState(m,sessionId);
    const requestIds=[...new Set(snapshot.messages.flatMap(message=>message.requestId?[message.requestId]:[]))];
    const resources=await Promise.all(requestIds.map(async id=>({...await mapTrialRequest<{readSkills?:Array<{id:string;hash:string}>}>(m,`/api/sessions/${sessionId}/requests/${id}/resources`,'planning'),requestId:id})));
    await save(join(output,'final-state.json'),{snapshot,after,resources});
    const calls=providerToolCalls(payloads);
    for(const name of startedTools)if(!calls.some(call=>call.name===name))calls.push({name,args:{}});
    const loading=spatialSkillEvidence(snapshot.messages,resources,skill?.hash);
    const protocol=spatialProtocolEvidence(spec,snapshot.lastResult?.status,interaction,stopReason,budgetExceeded);
    const score=scoreSpatialFacts(spec,{toolCallsAuthoritative:true,sourceSnapshot,sourceAreaIds,results:uniqueSpatialResults(snapshot.messages),messages:snapshot.messages,tools:calls,before,after,
      protocolCompleted:protocol.acceptable,protocolBoundaryWaitingReview:protocol.boundaryWaitingReview,skillLoaded:loading.loaded,skillLoadedBeforeAnalysis:loading.beforeAnalysis});
    await save(join(output,'score.json'),score);Object.assign(result,{status:'recorded',score,requestId,interaction,stopReason,budgetExceeded});
  }catch(error){result.status='incomplete';result.failure=String(error);await cancel('failure').catch(()=>{});}
  finally{
    if(trial)await cp(join(trial.manifest.dataDir,'sessions'),join(output,'native-sessions'),{recursive:true}).catch(()=>{});
    await trial?.stop();globalThis.fetch=originalFetch;Object.assign(result,{elapsedMs:Date.now()-started,providerCalls:payloads.length,toolCalls,budgetExceeded});await save(join(output,'result.json'),result);
    console.info(JSON.stringify({output,status:result.status,elapsedMs:result.elapsedMs,providerCalls:payloads.length,failure:result.failure}));if(result.status==='incomplete')process.exitCode=1;
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(String(error));process.exitCode=1;});
