/** Fixed readonly generalization cases. No retries, automatic answers, writes by the operator, or semantic auto-pass. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {appendFile,cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {AnnotationLayer} from '../src/contracts/annotations.js';
import {ANNOTATION_MODEL_FORMAT,ANNOTATION_EXPLAINED_MODEL_FORMAT} from '../src/contracts/annotation-results.js';
import type {PublicMessage} from '../src/contracts/index.js';
import {loadConfig} from '../src/server/config.js';
import {ask,mapState} from './probe-source-annotations.js';
import {mapTrialRequest,startMapTrial} from './probe-situation-map.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const save=(path:string,value:unknown)=>writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

export const readonlyCases=[
  {id:'G01',prompt:'请列出本会话地图“维修设施”图层中的对象，并说明这个图层共有多少个对象。只查看，不修改。'},
  {id:'G02',prompt:'请只展示本会话地图“仓储设施”图层按保存顺序的第4～5项摘要，说明这一页有哪些对象。只查看，不修改。'},
  {id:'G03',prompt:'请查看本会话地图中“北仓”的名称、类型和样式，向我说明。只查看，不修改。'},
] as const;

export function projectionOptions(args:string[]) {
  let prepareOnly=false,port=4371;
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--prepare-only')prepareOnly=true;
    else if(args[i]==='--port'&&/^\d+$/.test(args[i+1]??'')&&Number(args[i+1])>1023&&Number(args[i+1])<65536)port=Number(args[++i]);
    else throw new Error('用法：--port 4371 [--prepare-only]；固定三个独立会话，只读、无重试');
  }
  return {prepareOnly,port};
}

export function projectionLayers():AnnotationLayer[] {
  const layer=(layerId:string,name:string,names:string[],order:number):AnnotationLayer=>({
    layerId,name,order,defaultVisible:true,
    features:names.map((name,i)=>({objectId:`${layerId}-${i+1}`,name,kind:'point',
      geometry:{type:'Point',coordinates:[103.83+order*.01+i*.001,1.30+order*.01]},
      note:`${name}的已保存巡检记录`,attributes:{capacity:10+i,hash:`业务批次-${i+1}`},
      style:{color:order?'#245678':'#426789',size:10+i,symbol:i%2?'square':'circle'},
    })),
  });
  return [layer('storage','仓储设施',['北仓','南仓','河畔仓','东仓','山脚仓'],0),layer('repair','维修设施',['机修站','电修站'],1)];
}

/** Evidence coverage only. Never score the assistant's prose from these booleans. */
export function scopeObservations(messages:PublicMessage[]) {
  const reads:Record<string,unknown>[]=[];
  for(const message of messages) {
    if(message.role!=='tool'||message.toolName!=='annotation_read'||message.isError||message.resultMissing)continue;
    let parsed:unknown;try{parsed=JSON.parse(message.text);}catch{continue;}
    if(!record(parsed)||![ANNOTATION_MODEL_FORMAT,ANNOTATION_EXPLAINED_MODEL_FORMAT].includes(String(parsed.format))||!record(parsed.data))continue;
    const value=parsed.data;
    if(!record(value.query)||!record(value.objects)||!Array.isArray(value.objects.items))continue;
    reads.push({query:value.query,offset:value.objects.offset,limit:value.objects.limit,total:value.objects.total,hasMore:value.objects.hasMore,
      objects:value.objects.items.filter(record).map(item=>({objectId:item.objectId,fields:Object.keys(item)}))});
  }
  return {
    reads,
    layerFilterObserved:reads.some(r=>record(r.query)&&JSON.stringify(r.query.layerIds)==='["repair"]'),
    partialLastPageObserved:reads.some(r=>record(r.query)&&JSON.stringify(r.query.layerIds)==='["storage"]'&&r.offset===3&&r.limit===2&&r.total===5&&r.hasMore===false),
    selectedStyleObserved:reads.some(r=>record(r.query)&&JSON.stringify(r.query.objectIds)==='["storage-1"]'&&JSON.stringify(r.query.fields)==='["style"]'),
    writeToolAttempted:messages.some(m=>m.role==='tool'&&['annotation_action','annotation_from_source'].includes(m.toolName??'')),
    semanticReview:'pending_review',
  };
}

async function main() {
  const options=projectionOptions(process.argv.slice(2));
  const evidence=join(root,'../../.local/map-result-generalization',new Date().toISOString().replaceAll(':','-'));
  await mkdir(evidence,{recursive:true,mode:0o700});
  const config=loadConfig({...process.env,LAB_AUTH_MODE:'test',LAB_TEST_SEATS:undefined});
  const originalFetch=globalThis.fetch;
  let trial:Awaited<ReturnType<typeof startMapTrial>>|undefined,label='prepare',modelCalls=0;
  const results:Array<Record<string,unknown>>=[];
  const plan={options,cases:readonlyCases,layers:projectionLayers(),head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    scriptHash:hash(await readFile(fileURLToPath(import.meta.url))),model:config.model,provider:config.provider,
    notes:['One fresh formal isolated environment, three independent conversations.','No automatic answers or retries. Each unexpected interaction is retained and cancelled.','Coverage observations are not semantic judgments. No evaluator conclusions are sent to the model.']};
  await save(join(evidence,'plan.json'),plan);console.info(JSON.stringify({evidence,options}));
  globalThis.fetch=async(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    if(url.origin===new URL(config.baseUrl).origin) {
      assert.ok(!options.prepareOnly,'prepare-only blocked provider request');
      const body=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';
      assert.ok(!config.apiKey||!body.includes(config.apiKey),'Credential-bearing model body');
      await appendFile(join(evidence,'model-inputs.jsonl'),JSON.stringify({label,index:++modelCalls,at:new Date().toISOString(),payload:JSON.parse(body)})+'\n',{mode:0o600});
    }
    return originalFetch(input,init);
  };
  try {
    trial=await startMapTrial(options.port,{...process.env,LAB_EXECUTION_ENABLED:'false',LAB_LISTEN_HOST:'127.0.0.1',LAB_PUBLIC_ORIGIN:undefined},false);
    const m=trial.manifest;
    await save(join(evidence,'manifest.json'),m);
    const workspace=await mapTrialRequest<{id:string}>(m,`/api/tasks/${m.tasks.supply}/workspace`,'planning','POST',{});
    const prepared=[];
    for(const spec of readonlyCases) {
      const session=await mapTrialRequest<{id:string}>(m,'/api/sessions','planning','POST',{workspaceId:workspace.id});
      await mapTrialRequest(m,`/api/sessions/${session.id}/annotation/actions`,'planning','POST',{
        action:'create_draft',clientActionId:randomUUID(),baseRef:null,title:'设施核对记录',
        operations:projectionLayers().map(layer=>({op:'add_layer',layer})),
      });
      prepared.push({...spec,sessionId:session.id,before:await mapState(m,session.id)});
    }
    await save(join(evidence,'preparation.json'),prepared);assert.equal(modelCalls,0);
    if(options.prepareOnly){await save(join(evidence,'result.json'),{status:'prepared',modelCalls});return;}
    for(const spec of prepared) {
      label=spec.id;
      const result=await ask(m,evidence,spec.id,spec.sessionId,spec.prompt);
      const unchanged=JSON.stringify(result.before)===JSON.stringify(result.after);
      const observation=scopeObservations(result.toolResults);
      const status=!result.failure&&!result.cancelledForInteraction&&result.snapshot.lastResult?.status==='succeeded'&&unchanged&&!observation.writeToolAttempted?'protocol_completed':'incomplete';
      results.push({id:spec.id,requestId:result.requestId,status,unchanged,...observation});
      await save(join(evidence,'checks.json'),results);
      console.info(JSON.stringify({id:spec.id,status,unchanged}));
    }
    const finalStates=await Promise.all(prepared.map(spec=>mapState(m,spec.sessionId)));
    const allUnchanged=prepared.every((spec,index)=>JSON.stringify(spec.before)===JSON.stringify(finalStates[index]));
    await save(join(evidence,'final-states.json'),{allUnchanged,states:finalStates});
    if(!allUnchanged||results.some(r=>r.status==='incomplete'))process.exitCode=1;
    await save(join(evidence,'result.json'),{status:process.exitCode?'incomplete':'protocol_completed',allUnchanged,modelCalls,results,semanticReview:'pending_review'});
  }catch(error){await save(join(evidence,'result.json'),{status:'incomplete',error:String(error),modelCalls,results});process.exitCode=1;}
  finally {
    try{if(trial)await cp(join(trial.manifest.dataDir,'sessions'),join(evidence,'native-sessions'),{recursive:true});}
    finally{globalThis.fetch=originalFetch;await trial?.stop();}
    console.info(JSON.stringify({evidence,modelCalls,finished:true}));
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(String(error));process.exitCode=1;});
