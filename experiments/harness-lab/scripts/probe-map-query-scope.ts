/** Fixed single entries from the reviewed batch; no retries or product experiment flags. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {appendFile,cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {InMemoryCredentialStore,InMemoryModelsStore,type Context,type Model,type Api,type Tool} from '@earendil-works/pi-ai';
import {ModelRuntime} from '@earendil-works/pi-coding-agent';
import {annotationTools} from '../src/pi/annotation-tools.js';
import {projectAnnotationResult} from '../src/contracts/annotation-results.js';
import {controlledStream,emptyUsage} from '../src/pi/controlled-stream.js';
import {loadConfig} from '../src/server/config.js';
import {ask,mapState} from './probe-source-annotations.js';
import {startMapTrial,mapTrialRequest} from './probe-situation-map.js';
import {scopeObservations} from './probe-map-result-projection.js';
import {queryCases,prepareCase,diagnosticParams} from './probe-map-query-cases.js';

const save=(path:string,value:unknown)=>writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export function querySchedule() {
  return [1,2,3].flatMap(repeat=>queryCases.flatMap(spec=>(spec.paired?(repeat===2?['B','A']:['A','B']):['A']).map(condition=>({
    id:`${spec.id}-${repeat}-${condition}`,caseId:spec.id,kind:spec.kind,repeat,condition:condition as 'A'|'B',
  }))));
}
export function queryOptions(args:string[]) {
  let entry='',output='',port=4381,prepareOnly=false;
  for(let i=0;i<args.length;i++) {
    const arg=args[i],value=args[i+1];
    if(arg==='--prepare-only')prepareOnly=true;
    else if(arg==='--entry'&&value){entry=value;i++;}
    else if(arg==='--output'&&value){output=resolve(value);i++;}
    else if(arg==='--port'&&/^\d+$/.test(value??'')&&Number(value)>1023&&Number(value)<65536){port=Number(value);i++;}
    else throw new Error('用法：--entry 固定案例序号 --output 新证据目录 [--port 4381] [--prepare-only]；无重试选项');
  }
  const spec=querySchedule().find(item=>item.id===entry);
  if(!spec||!output)throw new Error('需要固定计划中的entry及output');
  return {spec,output,port,prepareOnly};
}
/** Driver-issued history is explicit; no hidden document, scores, or subsequent callable tools. */
export function diagnosticContext(model:Model<Api>,tools:Tool[],params:unknown,result:{content:Context['messages'][number]['content']},prompt:string):Context {
  const read=tools.find(tool=>tool.name==='annotation_read')!,action=tools.find(tool=>tool.name==='annotation_action')!;
  return {systemPrompt:'这是受控工具结果解释测试。以下读取由测试驱动预先执行，不是你自主选择的操作。本次只能解释已提供的结果，没有后续可调用工具。\n实际读取工具契约：'+JSON.stringify({name:read.name,description:read.description,parameters:read.parameters})+'\n实际操作工具的说明（含通用报告规则，仅作语义参考，不提供操作能力）：'+action.description,
    messages:[
      {role:'user',content:'测试驱动将提供一次已完成读取的参数与真实结果。',timestamp:1},
      {role:'assistant',content:[{type:'text',text:'以下是测试驱动执行的读取记录。'},{type:'toolCall',id:'driver-issued-read',name:'annotation_read',arguments:params as Record<string,unknown>}],api:model.api,provider:model.provider,model:model.id,timestamp:2,stopReason:'toolUse',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}},
      {role:'toolResult',toolCallId:'driver-issued-read',toolName:'annotation_read',content:result.content as Extract<Context['messages'][number],{role:'toolResult'}>['content'],isError:false,timestamp:3},
      {role:'user',content:prompt,timestamp:4},
    ]};
}
export async function diagnosticRuntime(config:ReturnType<typeof loadConfig>) {
  // Same configured public SDK boundary and provider parameters as PiLab; no private runtime access.
  const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
  runtime.registerProvider(config.provider,{baseUrl:config.baseUrl,api:'openai-completions',models:[{id:config.model,name:config.model,reasoning:false,input:['text'],contextWindow:config.contextWindow??8192,maxTokens:config.maxOutputTokens??1,cost:{input:0,output:0,cacheRead:0,cacheWrite:0},compat:{supportsStore:false,supportsDeveloperRole:false,maxTokensField:'max_tokens'}}]});
  if(config.apiKey)await runtime.setRuntimeApiKey(config.provider,config.apiKey);
  return runtime;
}
async function main() {
  const options=queryOptions(process.argv.slice(2)),{spec,output}=options;
  // A scheduled entry cannot silently overwrite a failed attempt.
  await mkdir(output,{mode:0o700});
  const config=loadConfig({...process.env,LAB_AUTH_MODE:'test',LAB_TEST_SEATS:undefined});
  const originalFetch=globalThis.fetch;let trial:Awaited<ReturnType<typeof startMapTrial>>|undefined,modelCalls=0;
  const result:Record<string,unknown>={...spec,status:'preparing',semanticReview:'pending_review'};
  await save(join(output,'plan.json'),{options,model:config.model,provider:config.provider,schedule:querySchedule(),
    sources:await Promise.all(['src/pi/annotation-tools.ts','src/pi/annotation-results.ts','scripts/probe-map-query-cases.ts','scripts/probe-map-query-scope.ts'].map(async file=>({file,hash:hash(await readFile(join(root,file)))})))});
  globalThis.fetch=async(input,init)=>{
    if(new URL(input instanceof Request?input.url:String(input)).origin===new URL(config.baseUrl).origin){
      assert.ok(!options.prepareOnly,'prepare-only blocked provider call');
      const body=String(init?.body??(input instanceof Request?await input.clone().text():''));
      assert.ok(!config.apiKey||!body.includes(config.apiKey),'credential-bearing request');
      await appendFile(join(output,'model-inputs.jsonl'),JSON.stringify({index:++modelCalls,at:new Date().toISOString(),payload:JSON.parse(body)})+'\n',{mode:0o600});
    }
    return originalFetch(input,init);
  };
  try {
    trial=await startMapTrial(options.port,{...process.env,LAB_EXECUTION_ENABLED:'false',LAB_LISTEN_HOST:'127.0.0.1',LAB_PUBLIC_ORIGIN:undefined},false);
    const {manifest:m,lab}=trial,prepared=await prepareCase(m,spec.caseId);
    await save(join(output,'manifest.json'),m);await save(join(output,'preparation.json'),prepared);
    const service=lab.annotations!,actor=service.actorForSeat('seat-planning'),controller=new AbortController();
    const tools=annotationTools(service,{actor,sessionId:prepared.sessionId,taskId:m.tasks.supply,requestId:randomUUID(),signal:controller.signal,check:()=>controller.signal.throwIfAborted()});
    const read=tools.find(tool=>tool.name==='annotation_read')!;
    const firstLayer=prepared.before.version!.document.layers[0],firstObject=firstLayer.features[0];
    const ref=prepared.before.version!.ref;
    // Check real adapter output against service values in both builds, before any model call.
    const checks=[];
    for(const [index,query] of [{},{layerIds:[firstLayer.layerId]},{objectIds:[firstObject.objectId],fields:['style']},{offset:999,limit:2}].entries()){
      const params={mode:'read',ref,...query};
      const returned=await read.execute(`contract-${index}`,params as never,undefined,undefined,{} as never);
      const data=JSON.parse((returned.content[0] as {text:string}).text).data;
      const actual=service.read(actor,m.tasks.supply,{ref,...query} as never);
      const expectedQuery=Object.fromEntries(Object.entries(query).filter(([key])=>['objectIds','layerIds','fields'].includes(key)));
      if(spec.condition==='B')expectedQuery.scope='objectIds' in query?'objects':'layerIds' in query?'layers':'all_objects';
      assert.deepEqual(data,{...projectAnnotationResult(actual) as object,query:expectedQuery});
      assert.deepEqual(returned.details,{});checks.push({params,returned});
    }
    const intersected=await read.execute('intersection',{mode:'draft',layerIds:[firstLayer.layerId],objectIds:[firstObject.objectId]} as never,undefined,undefined,{} as never);
    const intersectionData=JSON.parse((intersected.content[0] as {text:string}).text).data;
    assert.equal(intersectionData.objects.total,1);
    assert.equal(intersectionData.objects.items[0].objectId,firstObject.objectId);
    if(spec.condition==='B')assert.equal(intersectionData.query.scope,'objects');
    await assert.rejects(()=>read.execute('missing-object',{mode:'draft',objectIds:['missing-case-object']} as never,undefined,undefined,{} as never));
    const compare=await read.execute('compare',{mode:'compare',left:ref,right:ref} as never,undefined,undefined,{} as never);
    assert.deepEqual(JSON.parse((compare.content[0] as {text:string}).text).data,service.compare(actor,m.tasks.supply,ref,ref));
    const sessionInfo=await mapTrialRequest<{workspaceId:string}>(m,`/api/sessions/${prepared.sessionId}`,'planning');
    const emptySession=await mapTrialRequest<{id:string}>(m,'/api/sessions','planning','POST',{workspaceId:sessionInfo.workspaceId});
    const emptyRead=annotationTools(service,{actor,sessionId:emptySession.id,taskId:m.tasks.supply,requestId:randomUUID(),signal:controller.signal,check:()=>{}}).find(t=>t.name==='annotation_read')!;
    const emptyResult=await emptyRead.execute('empty',{mode:'draft'} as never,undefined,undefined,{} as never);
    const emptyData=JSON.parse((emptyResult.content[0] as {text:string}).text).data;assert.equal(emptyData.status,'empty');assert.ok(!('query' in emptyData));
    await save(join(output,'adapter-checks.json'),{checks,intersected,compare,emptyResult});
    if(prepared.kind==='diagnostic') {
      const params=diagnosticParams(spec.caseId),toolResult=await read.execute('driver-issued-read',params as never,undefined,undefined,{} as never);
      const runtime=await diagnosticRuntime(config),model=runtime.getModel(config.provider,config.model)!;
      const context=diagnosticContext(model,tools,params,toolResult,prepared.prompt);
      await save(join(output,'diagnostic-input.json'),{driverIssued:true,params,toolResult,context});
      if(!options.prepareOnly){
        const usage=emptyUsage(),started=Date.now();
        const stream=controlledStream(runtime,config,model,context,undefined,'reply','本次仅解释测试驱动提供的真实读取结果。',controller.signal,usage);
        for await(const event of stream)await appendFile(join(output,'diagnostic-events.jsonl'),JSON.stringify(event)+'\n',{mode:0o600});
        const answer=await stream.result();
        await save(join(output,'diagnostic-answer.json'),{answer,usage,elapsedMs:Date.now()-started});
        Object.assign(result,{status:answer.stopReason==='stop'?'protocol_completed':'incomplete',usage,elapsedMs:Date.now()-started});
      }
    } else if(!options.prepareOnly){
      const answer=await ask(m,output,spec.id,prepared.sessionId,prepared.prompt),observations=scopeObservations(answer.toolResults);
      Object.assign(result,{status:!answer.failure&&!answer.cancelledForInteraction&&answer.snapshot.lastResult?.status==='succeeded'&&!observations.writeToolAttempted?'protocol_completed':'incomplete',requestId:answer.requestId,observations,usage:answer.usage,elapsedMs:answer.elapsedMs});
    }
    const after=await mapState(m,prepared.sessionId);await save(join(output,'final-state.json'),after);
    assert.deepEqual(after,prepared.before,'readonly state changed');
    result.unchanged=true;
    if(options.prepareOnly){assert.equal(modelCalls,0);result.status='prepared';}
  } catch(error){result.status='incomplete';result.failure=String(error);}
  finally{
    if(trial)await cp(join(trial.manifest.dataDir,'sessions'),join(output,'native-sessions'),{recursive:true}).catch(()=>{});
    await trial?.stop();globalThis.fetch=originalFetch;result.modelCalls=modelCalls;
    await save(join(output,'result.json'),result);console.info(JSON.stringify({output,...result}));
    if(result.status==='incomplete')process.exitCode=1;
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(String(error));process.exitCode=1;});
