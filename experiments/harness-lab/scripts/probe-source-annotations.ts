/** Opt-in, isolated map-only live probe. No automatic answers, approvals, adoption, or deployment. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {appendFile, mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {AnnotationBinding, AnnotationCurrent, AnnotationFeature, AnnotationListing, AnnotationSelection, AnnotationVersion} from '../src/contracts/annotations.js';
import type {SituationObject} from '../src/contracts/context.js';
import type {SessionSnapshot, StreamEvent} from '../src/contracts/index.js';
import type {SimulationState} from '../src/contracts/simulation.js';
import {loadConfig} from '../src/server/config.js';
import {mapTrialAuth, mapTrialRequest, startMapTrial, type MapTrialManifest} from './probe-situation-map.js';
import {control} from './probe-task-plan.js';

const packageRoot=fileURLToPath(new URL('../',import.meta.url));
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const save=(path:string,value:unknown)=>writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});
type Case='main'|'custom'|'missing-geometry'|'unavailable'|'ambiguous';
interface Options {runs:number; port:number; cases:'all'|'main'|'special'; prepareOnly:boolean}
export function parseOptions(args:string[]):Options {
  const options:Options={runs:3,port:4339,cases:'all',prepareOnly:false};
  for(let i=0;i<args.length;i++) {
    const key=args[i],value=args[i+1];
    if(key==='--prepare-only')options.prepareOnly=true;
    else if(key==='--runs'&&/^[1-3]$/.test(value??'')){options.runs=Number(value);i++;}
    else if(key==='--port'&&/^\d+$/.test(value??'')&&Number(value)>1023&&Number(value)<65536){options.port=Number(value);i++;}
    else if(key==='--cases'&&['all','main','special'].includes(value)){options.cases=value as Options['cases'];i++;}
    else throw new Error('用法：--runs 1|2|3 --port 4339 --cases all|main|special [--prepare-only]');
  }
  return options;
}
export function removeTargetGeometry(body:unknown, objectId:string):unknown {
  if(!body||typeof body!=='object'||!('items' in body)||!Array.isArray(body.items))return body;
  return {...body,items:body.items.map((item:SituationObject)=>{
    if(item.ref?.objectId!==objectId)return item;
    const copy={...item};delete copy.geometry;return copy;
  })};
}
function revision() {
  if(process.env.SOURCE_ANNOTATIONS_REVISION)return process.env.SOURCE_ANNOTATIONS_REVISION;
  try{return execFileSync('git',['rev-parse','HEAD'],{cwd:packageRoot,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}
  catch{return 'unknown: source archive without Git; set SOURCE_ANNOTATIONS_REVISION';}
}
export async function mapState(m:MapTrialManifest, sessionId:string) {
  const binding=await mapTrialRequest<AnnotationBinding>(m,`/api/sessions/${sessionId}/annotation`,'planning');
  const version=binding.draft?await mapTrialRequest<AnnotationVersion>(m,`/api/annotations/${binding.draft.setId}/revisions/${binding.draft.headRevision}`,'planning'):null;
  const listing=await mapTrialRequest<AnnotationListing>(m,`/api/tasks/${m.tasks.supply}/annotations`,'planning');
  const current=await mapTrialRequest<AnnotationCurrent>(m,`/api/tasks/${m.tasks.supply}/annotations/current`,'planning');
  const publications=[];
  for(const item of listing.publications.items)publications.push({metadata:item,version:await mapTrialRequest<AnnotationVersion>(m,`/api/annotation-publications/${item.publicationId}`,'planning')});
  return {binding,version,publications,current};
}
export function features(state:Awaited<ReturnType<typeof mapState>>) {return state.version?.document.layers.flatMap(layer=>layer.features)??[];}
export function sourceMatches(items:AnnotationFeature[],sources:SituationObject[]) {
  return sources.map(source=>({sourceRef:source.ref,sourceRevision:source.revision,
    matches:items.filter(item=>item.sourceRefs?.some(ref=>ref.systemId===source.ref.systemId&&ref.objectType===source.ref.objectType&&ref.objectId===source.ref.objectId))
      .map(item=>({objectId:item.objectId,geometryEqual:JSON.stringify(item.geometry)===JSON.stringify(source.geometry),
        sourceRefs:item.sourceRefs}))}));
}
export async function ask(m:MapTrialManifest, evidence:string,label:string,sessionId:string,prompt:string,annotationRefs?:AnnotationSelection[]) {
  const startedAt=Date.now(),before=await mapState(m,sessionId),streamPath=join(evidence,`${label}.sse`);
  await save(join(evidence,`${label}-input.json`),{sessionId,prompt,before,...(annotationRefs === undefined ? {} : {annotationRefs})});
  await writeFile(streamPath,'',{mode:0o600});
  let requestId:string|undefined,failure:string|undefined,cancelledForInteraction=false;
  const interactions:unknown[]=[];
  try {
    const response=await fetch(`${m.url}/api/sessions/${sessionId}/messages`,{method:'POST',
      headers:{...await mapTrialAuth(m,'planning'),'content-type':'application/json'},body:JSON.stringify({text:prompt,...(annotationRefs === undefined ? {} : {annotationRefs})}),signal:AbortSignal.timeout(600_000)});
    assert.ok(response.ok&&response.body,`Message HTTP ${response.status}`);
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
    for(;;) {
      const part=await reader.read();if(part.done)break;
      const chunk=decoder.decode(part.value,{stream:true});await appendFile(streamPath,chunk);buffer+=chunk;
      const lines=buffer.split('\n');buffer=lines.pop()!;
      for(const line of lines)if(line.startsWith('data: ')) {
        const event=JSON.parse(line.slice(6)) as StreamEvent;requestId=event.requestId;
        if(event.type==='interaction.updated'&&event.interaction.status==='pending'&&!cancelledForInteraction) {
          interactions.push(event.interaction);cancelledForInteraction=true;
          await save(join(evidence,`${label}-interaction.json`),event.interaction);
          await mapTrialRequest(m,`/api/sessions/${sessionId}/cancel`,'planning','POST',{requestId});
        }
      }
    }
  } catch(error) {
    failure=String(error);
    if(requestId)await mapTrialRequest(m,`/api/sessions/${sessionId}/cancel`,'planning','POST',{requestId}).catch(()=>undefined);
  }
  const snapshot=await mapTrialRequest<SessionSnapshot>(m,`/api/sessions/${sessionId}`,'planning');
  const after=await mapState(m,sessionId),actualId=requestId??snapshot.lastResult?.requestId;
  const messages=snapshot.messages.filter(message=>message.requestId===actualId);
  const toolResults=messages.filter(message=>message.role==='tool');
  const record={label,prompt,sessionId,requestId:actualId,startedAt:new Date(startedAt).toISOString(),elapsedMs:Date.now()-startedAt,
    failure,cancelledForInteraction,interactions,before,after,snapshot,toolResults,
    queries:toolResults.filter(message=>['situation_query','annotation_from_source','annotation_read','information_read','information_search','task_read'].includes(message.toolName??'')),
    usage:snapshot.lastResult?.usageSummary??null,semanticReview:'pending_review'};
  await save(join(evidence,`${label}.json`),record);
  console.info(JSON.stringify({label,status:snapshot.lastResult?.status,elapsedMs:record.elapsedMs,cancelledForInteraction,failure}));
  return record;
}
export async function setRoad(m:MapTrialManifest,open:boolean) {
  const before=await mapTrialRequest<SimulationState>(m,'/api/simulation');
  const road=before.objects.find(object=>object.ref.objectId===m.objects.road.objectId)!;
  const time=`${m.day}T${open?'09:35':'09:20'}:00+08:00`;
  const receipt=await mapTrialRequest(m,'/api/simulation/object-updates','overall','POST',{
    clientActionId:randomUUID(),ref:road.ref,expectedRevision:road.revision,
    properties:{passability:open?'open':'closed',restrictionNote:open?'09:35 观测确认恢复通行':'09:20 观测通道不可通行'},
    effectiveAt:time,validTime:{from:time,to:`${m.day}T11:00:00+08:00`},
  });
  return {before,receipt,after:await mapTrialRequest<SimulationState>(m,'/api/simulation')};
}
async function runCase(kind:Case, run:number, options:Options,collection:string) {
  const originalFetch=globalThis.fetch;
  let trial:Awaited<ReturnType<typeof startMapTrial>>|undefined,evidence:string|undefined,label='prepare';
  const result:{kind:Case;run:number;status:string;evidence?:string;failure?:string;semanticReview:string}={kind,run,status:'preparing',semanticReview:'pending_review'};
  try {
    trial=await startMapTrial(options.port,{...process.env,LAB_LISTEN_HOST:'127.0.0.1',LAB_PUBLIC_ORIGIN:undefined},false);
    const m=trial.manifest;evidence=join(m.dataDir,'source-annotations-evidence');await mkdir(evidence,{mode:0o700});result.evidence=evidence;
    console.info(JSON.stringify({kind,run,evidence,trialId:m.trialId}));
    const config=loadConfig({...process.env,LAB_AUTH_MODE:'test',LAB_TEST_SEATS:undefined});
    const mockUrl=(await control(m.socket,['status']) as {url:string}).url;
    const sourcePayloads:unknown[]=[];let inputIndex=0;
    globalThis.fetch=async(input,init)=>{
      const url=new URL(input instanceof Request?input.url:String(input));
      if(url.origin===new URL(config.baseUrl).origin) {
        const body=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';
        if(body) {
          assert.ok(!config.apiKey||!body.includes(config.apiKey),'模型正文含凭证，拒绝记录');
          await appendFile(join(evidence!,'model-inputs.jsonl'),JSON.stringify({label,index:++inputIndex,at:new Date().toISOString(),bytes:Buffer.byteLength(body),payload:JSON.parse(body)})+'\n',{mode:0o600});
        }
      }
      const response=await originalFetch(input,init);
      if(url.origin!==new URL(mockUrl).origin||!['/situation/objects','/situation/changes','/intel/reports'].some(path=>url.pathname.startsWith(path)))return response;
      const raw:unknown=await response.clone().json();
      const effective=kind==='missing-geometry'&&url.pathname==='/situation/objects'&&response.ok?removeTargetGeometry(raw,`${m.trialId}-zone-west`):raw;
      const entry={label,at:new Date().toISOString(),path:url.pathname+url.search,status:response.status,
        faultInjection:raw!==effective?'remove target geometry from isolated HTTP response':null,raw,effective};
      sourcePayloads.push(entry);await appendFile(join(evidence!,'source-responses.jsonl'),JSON.stringify(entry)+'\n',{mode:0o600});
      if(raw===effective)return response;
      const headers=new Headers(response.headers);headers.delete('content-length');headers.delete('content-encoding');
      return new Response(JSON.stringify(effective),{status:response.status,headers});
    };
    const initial=await setRoad(m,false);
    const workspace=await mapTrialRequest<{id:string}>(m,`/api/tasks/${m.tasks.supply}/workspace`,'planning','POST',{});
    const session=await mapTrialRequest<{id:string}>(m,'/api/sessions','planning','POST',{workspaceId:workspace.id});
    const points:AnnotationFeature[]=kind==='ambiguous'?[
      {objectId:'point-a',name:'集合点 A',kind:'point',geometry:{type:'Point',coordinates:[103.832,1.304]}},
      {objectId:'point-b',name:'集合点 B',kind:'point',geometry:{type:'Point',coordinates:[103.834,1.305]}},
    ]:[];
    const preparation=await mapTrialRequest(m,`/api/sessions/${session.id}/annotation/actions`,'planning','POST',{
      clientActionId:randomUUID(),action:'create_draft',baseRef:null,title:'来源标注验证',
      operations:[{op:'add_layer',layer:{layerId:'discussion',name:'本会话讨论',order:0,defaultVisible:true,features:points}}],
    });
    const before=await mapState(m,session.id);
    await save(join(evidence,'baseline.json'),{kind,run,manifest:m,sessionId:session.id,revision:revision(),
      scriptHash:hash(await readFile(fileURLToPath(import.meta.url))),
      fixtureHashes:Object.fromEntries(await Promise.all(['map-fixtures.ts','fixtures.ts','server.ts'].map(async name=>[name,hash(await readFile(join(packageRoot,'scripts/mock-context',name)))]))),
      model:config.model,provider:config.provider,node:process.version,initial,preparation,before,prepareOnly:options.prepareOnly,
      notes:['Fresh formal accounts and isolated source instance; no work handoff or source notification.',
        'Driver creates an empty draft/layer as explicit test preparation; model still must discover current draft revision.',
        'Geometry fault injection changes only the target isolated HTTP response. Original and delivered bodies are both preserved.',
        'Publication is explicitly requested but adoption is not. Every pending interaction is captured and cancelled; no automatic answers/approvals.']});
    if(options.prepareOnly){result.status='prepared';return result;}
    if(kind==='unavailable'){await control(m.socket,['unavailable','situation','on']);await control(m.socket,['unavailable','intel','on']);}
    const prompt=kind==='main'?'请查询本任务西区的现有区域、道路和车辆对象，将这三个来源对象标到本会话地图草稿的讨论图层中。西区要采用来源已有边界，不要另行估算；请说明依据的版本和时间，暂不发布。'
      :kind==='custom'?'请在本会话讨论图层新建名为“自定义集合区域”的面。按经度、纬度顺序连接 [103.832,1.303]、[103.833,1.303]、[103.833,1.304]、[103.832,1.304] 并闭合。这是我的规划草稿，不是来源中的现实区域，不要发布。'
      :kind==='ambiguous'?'把那个集合点往东挪一点。'
      :'请查询本任务西区的现有区域对象，把来源已有的区域边界标到本会话讨论图层上，不要另行估算，也不要发布。';
    label='S01';const first=await ask(m,evidence,label,session.id,prompt);
    if(kind!=='main') {
      await save(join(evidence,'checks.json'),{draftUnchanged:before.version?.hash===first.after.version?.hash,
        geometryFaultObserved:kind==='missing-geometry'?sourcePayloads.some(entry=>(entry as {faultInjection:unknown}).faultInjection):null,
        note:'Raw observations only: unchanged draft is expected for missing geometry/offline/ambiguity but not custom creation. Semantic review must inspect response and evidence.'});
      result.status=first.failure?'incomplete':first.cancelledForInteraction?'interaction_observed':first.snapshot.lastResult?.status==='succeeded'?'recorded':'incomplete';return result;
    }
    assert.equal(first.failure,undefined);assert.equal(first.cancelledForInteraction,false);assert.equal(first.snapshot.lastResult?.status,'succeeded');
    const desired=initial.after.objects.filter(object=>object.areaIds.includes(`${m.trialId}-zone-west`));
    await save(join(evidence,'initial-geometry-comparison.json'),sourceMatches(features(first.after),desired));
    label='S02';const published=await ask(m,evidence,label,session.id,'请将本会话当前地图草稿发布为“西区标注第一版”，作为固定参考版本。不要设为任务当前版本。');
    assert.equal(published.failure,undefined);assert.equal(published.cancelledForInteraction,false);assert.equal(published.snapshot.lastResult?.status,'succeeded');
    assert.equal(published.after.publications.length,1,'未得到唯一固定发布，停止本轮，不追加纠错提示');
    label='source-update';const update=await setRoad(m,true);await save(join(evidence,'source-update.json'),update);
    const beforeRefresh=await mapState(m,session.id);await save(join(evidence,'before-refresh.json'),beforeRefresh);
    label='S03';const refreshed=await ask(m,evidence,label,session.id,'道路来源有新变化，请重新查询核对，并更新本会话地图中已有的同一道路标注，保留标注对象编号。写清当前状态、来源版本及时间依据，保存为草稿新修订，不要改动或重新发布第一版。');
    const previousRoad=features(published.after).filter(item=>item.sourceRefs?.some(ref=>ref.objectId===m.objects.road.objectId));
    const currentRoad=features(refreshed.after).filter(item=>item.sourceRefs?.some(ref=>ref.objectId===m.objects.road.objectId));
    await save(join(evidence,'checks.json'),{
      sourceUpdateDidNotChangeDraft:beforeRefresh.version?.hash===published.after.version?.hash,
      fixedPublicationUnchanged:JSON.stringify(published.after.publications)===JSON.stringify(refreshed.after.publications),
      taskCurrentUnchanged:JSON.stringify(before.current)===JSON.stringify(refreshed.after.current),
      roadIdsPreserved:previousRoad.length===1&&currentRoad.length===1&&previousRoad[0].objectId===currentRoad[0].objectId,
      newDraftRevision:(refreshed.after.binding.draft?.headRevision??0)>(published.after.binding.draft?.headRevision??0),
      comparison:sourceMatches(features(refreshed.after),update.after.objects.filter(object=>object.areaIds.includes(`${m.trialId}-zone-west`))),
      semanticReview:'pending: inspect actual geometry, source revisions and timestamps, tool errors, final prose and IDs; protocol completion is not semantic acceptance',
    });
    result.status=refreshed.failure||refreshed.cancelledForInteraction||refreshed.snapshot.lastResult?.status!=='succeeded'?'incomplete':'protocol_completed';
  } catch(error) {result.status='incomplete';result.failure=String(error);}
  finally {
    if(trial&&evidence) {
      await save(join(evidence,'source-requests.json'),await control(trial.manifest.socket,['requests']).catch(error=>({error:String(error)})));
      await save(join(evidence,'result.json'),result);
    }
    globalThis.fetch=originalFetch;await trial?.stop();await save(join(collection,`${kind}-${run}.json`),result);
  }
  return result;
}
async function main() {
  const options=parseOptions(process.argv.slice(2));
  const collection=await mkdtemp(join(tmpdir(),'axon-source-annotations-'));await mkdir(collection,{recursive:true,mode:0o700});
  console.info(JSON.stringify({collection,options}));
  const results=[];
  if(options.cases!=='special')for(let run=1;run<=options.runs;run++)results.push(await runCase('main',run,options,collection));
  if(options.cases!=='main')for(const kind of ['custom','missing-geometry','unavailable','ambiguous'] as const)results.push(await runCase(kind,1,options,collection));
  await save(join(collection,'runs.json'),results);
  if(results.some(result=>result.status==='incomplete'))process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(String(error));process.exitCode=1;});
