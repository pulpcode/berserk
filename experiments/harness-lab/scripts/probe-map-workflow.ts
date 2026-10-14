/** Fixed diagnostic batch: 3 source flows + 4 paired layer intents. Never auto-answer or retry cases. */
import {createHash,randomUUID} from 'node:crypto';
import {appendFile,cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {AnnotationLayer} from '../src/contracts/annotations.js';
import type {TaskSpace} from '../src/contracts/access.js';
import {loadConfig} from '../src/server/config.js';
import {mapTrialRequest,startMapTrial} from './probe-situation-map.js';
import {ask,features,mapState,setRoad,sourceMatches} from './probe-source-annotations.js';
import {control} from './probe-task-plan.js';

const packageRoot=fileURLToPath(new URL('../',import.meta.url));
const save=(path:string,data:unknown)=>writeFile(path,JSON.stringify(data,null,2)+'\n',{mode:0o600});
const hash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
const polygon={type:'Polygon' as const,coordinates:[[[103.832,1.303],[103.833,1.303],[103.833,1.304],[103.832,1.304],[103.832,1.303]] as [number,number][]]};
export const layerCases=['existing','new','duplicate','unspecified'] as const;
type LayerCase=typeof layerCases[number];
export function layerScenario(kind:LayerCase) {
  const names=kind==='duplicate'?['观察记录','观察记录']:['路线讨论','资源讨论'];
  const layers:AnnotationLayer[]=names.map((name,i)=>({layerId:`layer-${i+1}`,name,order:i,defaultVisible:true,features:[]}));
  const description='按经度、纬度顺序连接 [103.832,1.303]、[103.833,1.303]、[103.833,1.304]、[103.832,1.304] 并闭合，作为我规划的集合区域。';
  const prompt=kind==='existing'?`请在已有的“资源讨论”图层添加名为“临时集合区”的面。${description}保留现有图层结构，暂不发布。`
    :kind==='new'?`请另建一个“现场观察”图层，在新图层添加名为“临时集合区”的面。${description}原有两个图层保持不变，暂不发布。`
    :kind==='duplicate'?`请在“观察记录”图层添加名为“临时集合区”的面。${description}暂不发布。`
    :`请在地图上添加名为“临时集合区”的面。${description}暂不发布。`;
  return {layers,prompt,expectClarification:kind==='duplicate'||kind==='unspecified',targetName:kind==='new'?'现场观察':'资源讨论'};
}
export function workflowCases() {
  return [...[1,2,3].map(run=>({kind:'main' as const,run,skill:true})),
    ...layerCases.flatMap(kind=>[true,false].map(skill=>({kind,run:1,skill})))];
}
export function workflowOptions(args:string[]) {
  let port=4343,prepareOnly=false;
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--prepare-only')prepareOnly=true;
    else if(args[i]==='--port'&&/^\d+$/.test(args[i+1]??'')&&Number(args[i+1])>1023&&Number(args[i+1])<65536)port=Number(args[++i]);
    else throw new Error('用法：--port 4343 [--prepare-only]；固定 11 案，无重试选项');
  }
  return {port,prepareOnly};
}
async function runCase(spec:ReturnType<typeof workflowCases>[number],options:ReturnType<typeof workflowOptions>,collection:string) {
  const id=`${spec.kind}-${spec.run}-${spec.skill?'skill':'no-skill'}`,evidence=join(collection,id);
  await mkdir(evidence,{recursive:true,mode:0o700});
  const originalFetch=globalThis.fetch;let trial:Awaited<ReturnType<typeof startMapTrial>>|undefined,label='prepare';
  const result:{id:string;status:string;failure?:string;checks?:unknown;evidence:string}={id,status:'preparing',evidence};
  try {
    trial=await startMapTrial(options.port,{...process.env,LAB_EXECUTION_ENABLED:'false',LAB_LISTEN_HOST:'127.0.0.1',LAB_PUBLIC_ORIGIN:undefined},false);
    const {manifest:m,lab}=trial;
    if(!spec.skill) {
      const originalSnapshot=lab.resources.snapshot.bind(lab.resources);
      lab.resources.snapshot=async(...args)=>{const snapshot=await originalSnapshot(...args);return {...snapshot,skills:snapshot.skills.filter(s=>s.id!=='map-annotations')};};
    }
    const config=loadConfig({...process.env,LAB_AUTH_MODE:'test',LAB_TEST_SEATS:undefined});
    const mockUrl=(await control(m.socket,['status']) as {url:string}).url;let modelCalls=0;
    globalThis.fetch=async(input,init)=>{
      const url=new URL(input instanceof Request?input.url:String(input));
      if(url.origin===new URL(config.baseUrl).origin) {
        const body=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';
        if(body) {
          if(config.apiKey&&body.includes(config.apiKey))throw new Error('Refusing to record credential-bearing model body');
          await appendFile(join(evidence,'model-inputs.jsonl'),JSON.stringify({label,index:++modelCalls,at:new Date().toISOString(),bytes:Buffer.byteLength(body),payload:JSON.parse(body)})+'\n',{mode:0o600});
        }
      }
      const response=await originalFetch(input,init);
      if(url.origin===new URL(mockUrl).origin&&['/situation/objects','/situation/changes','/intel/reports'].some(p=>url.pathname.startsWith(p))) {
        await appendFile(join(evidence,'source-responses.jsonl'),JSON.stringify({label,at:new Date().toISOString(),path:url.pathname+url.search,status:response.status,body:await response.clone().json()})+'\n',{mode:0o600});
      }
      return response;
    };
    const task=await mapTrialRequest<TaskSpace>(m,`/api/tasks/${m.tasks.supply}`,'planning');
    await mapTrialRequest(m,`/api/tasks/${task.id}`,'overall','PUT',{title:spec.kind==='main'?['通道核对','资源集结','区域研判'][spec.run-1]:'图层归属诊断',goal:task.goal,revision:task.revision,context:task.context});
    const initial=await setRoad(m,false);
    const workspace=await mapTrialRequest<{id:string}>(m,`/api/tasks/${m.tasks.supply}/workspace`,'planning','POST',{});
    const session=await mapTrialRequest<{id:string}>(m,'/api/sessions','planning','POST',{workspaceId:workspace.id});
    const layerName=['通道核对记录','资源核实','现场讨论'][spec.run-1];
    const scenario=spec.kind==='main'?null:layerScenario(spec.kind);
    let preparation:unknown=null;
    if(spec.kind!=='main'||spec.run!==3)preparation=await mapTrialRequest(m,`/api/sessions/${session.id}/annotation/actions`,'planning','POST',{
      clientActionId:randomUUID(),action:'create_draft',baseRef:null,title:'合成标绘诊断',operations:(scenario?.layers??[{layerId:`target-${spec.run}`,name:layerName,order:0,defaultVisible:true,features:[]}]).map(layer=>({op:'add_layer',layer})),
    });
    const before=await mapState(m,session.id);
    const skill=await lab.resources.readSkill(workspace.id,'map-annotations','seat-planning');
    await save(join(evidence,'baseline.json'),{spec,sessionId:session.id,trialId:m.trialId,taskId:task.id,dataDir:m.dataDir,initial,preparation,before,model:config.model,provider:config.provider,
      skillHash:skill.hash,skillAvailable:spec.skill,scriptHash:hash(await readFile(fileURLToPath(import.meta.url))),prepareOnly:options.prepareOnly,
      notes:['Synthetic fresh formal accounts/task/session; no notifications or work handoff.','Skill-off only filters request resource snapshot; tool definitions and model settings remain the same.','Each pending question is recorded and cancelled; no automatic answers, correction prompts, or repeated cases.','Main 3 begins without a draft; main 1/2 and layer pairs have explicitly prepared empty layers.']});
    console.info(JSON.stringify({id,evidence,status:'prepared'}));
    if(options.prepareOnly){result.status='prepared';return result;}
    label='S01';
    const prompt=scenario?.prompt??`请查询本任务西区现有的区域、道路和车辆对象，将三个来源对象一起放到本会话地图的“${layerName}”图层中${spec.run===3?'，当前还没有草稿，请创建空白草稿和这个图层':''}。区域采用来源已有边界，不另行估算。说明实际依据的版本和时间，暂不发布。`;
    const first=await ask(m,evidence,label,session.id,prompt);
    const readSkill=(record:typeof first)=>record.toolResults.some(t=>t.toolName==='skill.read'&&!t.isError&&t.text.includes('map-annotations'));
    if(scenario) {
      const afterLayers=first.after.version?.document.layers??[],objects=features(first.after);
      const newLayers=afterLayers.filter(l=>!scenario.layers.some(old=>old.layerId===l.layerId));
      const clarification=first.cancelledForInteraction||first.snapshot.messages.some(t=>t.requestId===first.requestId&&t.role==='assistant'&&/哪个|哪一|选择|指定|确认/.test(t.text));
      const checks={skillRead:readSkill(first),clarificationObserved:clarification,draftUnchanged:before.version?.hash===first.after.version?.hash,
        expectClarification:scenario.expectClarification,objectCount:objects.length,layerCount:afterLayers.length,newLayerCount:newLayers.length,
        geometryMatches:objects.length===1&&JSON.stringify(objects[0].geometry)===JSON.stringify(polygon),
        targetMatches:afterLayers.some(l=>l.name===scenario.targetName&&l.features.length===1),
        originalLayerStructurePreserved:scenario.layers.every(l=>afterLayers.some(a=>a.layerId===l.layerId&&a.name===l.name)),
        currentUnchanged:JSON.stringify(before.current)===JSON.stringify(first.after.current),noPublication:first.after.publications.length===0,
        semanticReview:'pending: verify real clarification text and target/layer intent; protocol completion alone is not acceptance'};
      result.checks=checks; await save(join(evidence,'checks.json'),checks);
      result.status=first.failure?'incomplete':first.cancelledForInteraction?'interaction_observed':first.snapshot.lastResult?.status==='succeeded'?'recorded':'incomplete';return result;
    }
    const desired=initial.after.objects.filter(o=>o.areaIds.includes(`${m.trialId}-zone-west`));
    const comparisons=sourceMatches(features(first.after),desired);
    if(first.failure||first.cancelledForInteraction||first.snapshot.lastResult?.status!=='succeeded')throw new Error('Main initial step did not complete; no corrective retry');
    label='S02';const published=await ask(m,evidence,label,session.id,`请将本会话当前地图草稿发布为“${layerName}第一版”，作为固定参考。不要设为任务当前版本。`);
    if(published.failure||published.cancelledForInteraction||published.after.publications.length!==1)throw new Error('Publication did not produce one fixed version; no corrective retry');
    label='source-update';const update=await setRoad(m,true);await save(join(evidence,'source-update.json'),update);const beforeRefresh=await mapState(m,session.id);
    label='S03';const refreshed=await ask(m,evidence,label,session.id,'道路来源有新变化，请重新查询核对并更新本会话地图中已有的同一道路标注，保留对象编号。写清当前状态、来源版本与时间，保存草稿，不改动或重新发布第一版。');
    const oldRoad=features(published.after).filter(o=>o.sourceRefs?.some(r=>r.objectId===m.objects.road.objectId)),newRoad=features(refreshed.after).filter(o=>o.sourceRefs?.some(r=>r.objectId===m.objects.road.objectId));
    const checks={skillRead:[first,published,refreshed].map(readSkill),initialComparison:comparisons,
      initialLayerCount:first.after.version?.document.layers.length,initialObjectCount:features(first.after).length,
      targetMatches:first.after.version?.document.layers.some(l=>l.name===layerName&&l.features.length===3),
      sourceUpdateDidNotChangeDraft:beforeRefresh.version?.hash===published.after.version?.hash,
      fixedPublicationUnchanged:JSON.stringify(published.after.publications)===JSON.stringify(refreshed.after.publications),
      taskCurrentUnchanged:JSON.stringify(before.current)===JSON.stringify(refreshed.after.current),
      roadIdsPreserved:oldRoad.length===1&&newRoad.length===1&&oldRoad[0].objectId===newRoad[0].objectId,
      comparison:sourceMatches(features(refreshed.after),update.after.objects.filter(o=>o.areaIds.includes(`${m.trialId}-zone-west`))),
      semanticReview:'pending: inspect receipts, batch revisions, times, geometry, tool errors, and prose separately'};
    result.checks=checks;await save(join(evidence,'checks.json'),checks);
    result.status=refreshed.failure||refreshed.cancelledForInteraction||refreshed.snapshot.lastResult?.status!=='succeeded'?'incomplete':'protocol_completed';
  }catch(error){result.status='incomplete';result.failure=String(error);}
  finally {
    if(trial){await cp(join(trial.manifest.dataDir,'sessions'),join(evidence,'native-sessions'),{recursive:true}).catch(()=>{});await save(join(evidence,'source-requests.json'),await control(trial.manifest.socket,['requests']).catch(e=>({error:String(e)})));}
    globalThis.fetch=originalFetch;await trial?.stop();await save(join(evidence,'result.json'),result);console.info(JSON.stringify({id,status:result.status,failure:result.failure}));
  }
  return result;
}
async function main() {
  const options=workflowOptions(process.argv.slice(2)),collection=join(packageRoot,'../../.local/agent-map-workflow',new Date().toISOString().replaceAll(':','-'));
  await mkdir(collection,{recursive:true,mode:0o700});await save(join(collection,'plan.json'),{options,cases:workflowCases()});console.info(JSON.stringify({collection,options}));
  const results=[];for(const spec of workflowCases())results.push(await runCase(spec,options,collection));
  await save(join(collection,'runs.json'),results);if(results.some(r=>r.status==='incomplete'))process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(String(e));process.exitCode=1;});
