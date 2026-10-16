import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach,expect,it,vi } from 'vitest';
import { PiLab } from '../../src/pi/lab.js';
import { fakeRuntime,testConfig } from './fake-runtime.js';
import type { SpatialInput,SpatialResult } from '../../src/contracts/spatial.js';
import { SpatialAnalysisService } from '../../src/spatial/service.js';
import { annotationActionId } from '../../src/pi/annotation-tools.js';
const fault=vi.hoisted(()=>({mode:''}));
vi.mock('@earendil-works/pi-coding-agent',async original=>{
  const sdk=await original<typeof import('@earendil-works/pi-coding-agent')>();
  return {...sdk,createAgentSession:async(...args:Parameters<typeof sdk.createAgentSession>)=>{
    const result=await sdk.createAgentSession(...args);const after=result.session.agent.afterToolCall;
    result.session.agent.afterToolCall=async context=>{const old=await after?.(context);if(context.toolCall.name==='spatial_analyze'&&fault.mode==='mutate') {(context.result.details as {spatialResult:SpatialResult}).spatialResult.items[0].name='altered';}if(context.toolCall.name==='annotation_from_analysis'&&fault.mode==='save') return {...old,content:[{type:'text',text:'lost receipt'}]};return old;};return result;
  }};
});
const clean:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{fault.mode='';for(const fn of clean.splice(0).reverse()) await fn();});
async function setup(reply:Parameters<typeof fakeRuntime>[1],overrides:Partial<ReturnType<typeof testConfig>>={}) {
  const dir=await mkdtemp(join(tmpdir(),'spatial-native-'));clean.push(()=>rm(dir,{recursive:true,force:true}));
  const config=testConfig(dir,{seatId:'alpha',testSeats:[{id:'alpha',name:'甲'},{id:'bravo',name:'乙'}],...overrides});
  const fake=await fakeRuntime(config,reply),lab=await PiLab.create(config,fake.runtime);clean.push(()=>lab.close());
  const session=await lab.createSession(undefined,'alpha'),actor=lab.annotations!.actorForSeat('alpha');
  const receipt=lab.annotations!.action(actor,session.id,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,operations:[{op:'add_layer',layer:{layerId:'points',name:'点',order:0,defaultVisible:true,features:[
    {objectId:'center',kind:'point',name:'中心',geometry:{type:'Point',coordinates:[120,30]},attributes:{category:'origin'}},
    {objectId:'near',kind:'point',name:'附近',geometry:{type:'Point',coordinates:[120.001,30]},attributes:{category:'rescue'}},
    {objectId:'far',kind:'point',name:'远处',geometry:{type:'Point',coordinates:[120.02,30]},attributes:{category:'rescue'}},
  ]}}]});
  const ref=receipt.ref!,input:SpatialInput={kind:'annotation',ref,objectIds:['center']};return {config,lab,session,actor,ref,input,fake};
}
function lastResult(context:Parameters<Parameters<typeof fakeRuntime>[1]>[0]) {
  const message=context.messages.findLast(m=>m.role==='toolResult'&&m.toolName==='spatial_analyze');
  if(!message || message.role!=='toolResult') throw Error('missing result');
  return JSON.parse(message.content.filter(c=>c.type==='text').map(c=>c.text).join('\n')).data as SpatialResult;
}
it('runs buffer → filter → statistics and saves exact original geometry, then reads after restart without recomputing',async()=>{
  let bufferRef='';
  const s=await setup((context,index)=>{
    if(index===0)return {tools:[{name:'spatial_analyze',arguments:{operation:'buffer',input:s.input,distanceM:500}},{name:'annotation_read',arguments:{mode:'draft'}}]};
    if(index===1){bufferRef=lastResult(context).resultRef;return {tools:[{name:'spatial_analyze',arguments:{operation:'filter',input:{kind:'annotation',ref:s.ref,objectIds:['near','far']},spatial:{target:{kind:'result',resultRef:bufferRef,geometry:true},relation:'contains'}}}]};}
    if(index===2)return {tools:[{name:'spatial_analyze',arguments:{operation:'summarize',input:{kind:'result',resultRef:lastResult(context).resultRef},field:'category'}},{name:'annotation_from_analysis',arguments:{resultRef:bufferRef,layerId:'points',objectId:'range',name:'500米范围'}}]};
    return {text:'已完成，结果仅代表固定候选。'};
  });
  await s.lab.start(s.session.id,'查找500米内资源并保存范围',{},'alpha').run(()=>{});
  const snapshot=s.lab.get(s.session.id,'alpha'),tools=snapshot.messages.filter(m=>m.role==='tool');
  expect(tools.map(m=>[m.toolName,m.isError])).toEqual([['spatial_analyze',false],['annotation_read',false],['spatial_analyze',false],['spatial_analyze',false],['annotation_from_analysis',false]]);
  const buffer=tools[0].spatialResult!;expect(buffer.geometry?.type).toBe('Polygon');
  expect(tools[2].spatialResult!.items.map(i=>i.name)).toEqual(['附近']);
  expect(tools[2].spatialResult!.referenceItems?.[0].geometry).toEqual(buffer.geometry);
  expect(tools[2].text).not.toContain('coordinates');
  expect(tools[3].spatialResult!.values).toEqual({total:1,groups:[{value:'rescue',count:1}]});
  expect(tools[0].text).not.toContain('coordinates');
  const saved=tools[4].annotationResult!.receipt;
  expect(s.lab.annotations!.version(s.actor,saved.taskId,saved.ref!).document.layers[0].features.find(f=>f.objectId==='range')!.geometry).toEqual(buffer.geometry);
  expect(saved.fromAnalysis?.resultRef).toBe(bufferRef);
  await s.lab.close();const runtime=await fakeRuntime(s.config,(_c,index)=>index%2===0?{tools:[{name:'spatial_analyze',arguments:{operation:'read',resultRef:bufferRef}}]}:{text:'已核对原结果'});
  const reopened=await PiLab.create(s.config,runtime.runtime);clean.push(()=>reopened.close());
  expect(reopened.get(s.session.id,'alpha').messages).toEqual(snapshot.messages);
  await reopened.start(s.session.id,'查看刚才范围',{},'alpha').run(()=>{});
  const read=reopened.get(s.session.id,'alpha').messages.findLast(m=>m.toolName==='spatial_analyze')!;
  expect(read.isError).toBe(false);expect(read.spatialResult).toEqual({...buffer,delivery:{requestId:read.requestId,toolCallId:read.toolCallId}});
  const other=await reopened.createSession(undefined,'alpha');await reopened.start(other.id,'不能读取外会话结果',{},'alpha').run(()=>{});
  expect(reopened.get(other.id,'alpha').messages.findLast(m=>m.toolName==='spatial_analyze')?.text).toContain('SPATIAL_RESULT_NOT_FOUND');
});
it('rejects altered native result details as downstream authority',async()=>{
  const s=await setup((_c,index)=>index===0?{tools:[{name:'spatial_analyze',arguments:{operation:'buffer',input:s.input,distanceM:100}}]}:{text:'结束'});fault.mode='mutate';
  await s.lab.start(s.session.id,'预览',{},'alpha').run(()=>{});const message=s.lab.get(s.session.id,'alpha').messages.find(m=>m.toolName==='spatial_analyze')!;
  expect(message.spatialResult).toBeNull();
  expect(message.text).not.toContain('altered');expect(message.text).not.toContain('中心');
  expect(()=>s.lab.start(s.session.id,'继续引用该结果',{},'alpha')).toThrow('完整性校验');
});
it('records uncertain exact-save effects and blocks a second same-output write',async()=>{
  const s=await setup((context,index)=>index===0?{tools:[{name:'spatial_analyze',arguments:{operation:'buffer',input:s.input,distanceM:100}},{name:'annotation_read',arguments:{mode:'draft'}}]}:index===1?{tools:[{name:'annotation_from_analysis',arguments:{resultRef:lastResult(context).resultRef,layerId:'points',objectId:'range',name:'范围'}},{name:'annotation_action',arguments:{action:'apply',operations:[{op:'rename_set',title:'不应写入'}]}}]}:{text:'需核对回执'});fault.mode='save';
  await s.lab.start(s.session.id,'保存',{},'alpha').run(()=>{});const snapshot=s.lab.get(s.session.id,'alpha');
  const write=snapshot.messages.find(m=>m.toolName==='annotation_from_analysis')!;expect(write.annotationResult).toBeNull();
  expect(snapshot.messages.find(m=>m.toolName==='annotation_action')?.text).toContain('ANNOTATION_RESULT_UNCERTAIN');
  const receipt=s.lab.annotations!.receipt(s.actor,annotationActionId(write.requestId!,write.toolCallId!))!;expect(receipt.fromAnalysis).toBeDefined();
  expect(s.lab.annotations!.binding(s.actor,s.session.id).draft?.headRevision).toBe(2);
});
it('rejects missing attributes, unsupported empty-scope target, cancellation and foreign fixed references',async()=>{
  const s=await setup(()=>({text:'unused'})),service=new SpatialAnalysisService(s.lab.annotations!);const controller=new AbortController();
  const scope={actor:s.actor,sessionId:s.session.id,taskId:s.lab.workspaces.get(s.session.workspaceId,'alpha').taskSpaceId!,signal:controller.signal,check:()=>{},resolveResult:()=>{throw Error('missing');}};
  await expect(service.analyze({operation:'summarize',input:s.input,field:'missing'},scope,randomUUID(),'x')).rejects.toMatchObject({code:'SPATIAL_ATTRIBUTE_MISSING'});
  const wrong={...s.input,ref:{setId:randomUUID(),revision:1}} as SpatialInput;
  await expect(service.analyze({operation:'buffer',input:wrong,distanceM:100},scope,randomUUID(),'x')).rejects.toMatchObject({code:'ANNOTATION_NOT_FOUND'});
  controller.abort();await expect(service.analyze({operation:'buffer',input:s.input,distanceM:100},scope,randomUUID(),'x')).rejects.toThrow();
});
it('reads and saves a fixed result after actual native automatic compaction',async()=>{
  let replies=0,resultRef='';
  const s=await setup((context)=>{
    if(!context.tools?.length) return {text:`摘要：空间结果 ${resultRef} 已计算，继续核对。`,usageInput:50};
    replies++;
    if(replies===1)return {tools:[{name:'spatial_analyze',arguments:{operation:'buffer',input:s.input,distanceM:100}}]};
    if(replies===2){resultRef=lastResult(context).resultRef;return {text:'固定范围已生成，等待继续。'.repeat(500),usageInput:1800};}
    if(replies===3)return {tools:[{name:'spatial_analyze',arguments:{operation:'read',resultRef}},{name:'annotation_read',arguments:{mode:'draft'}}]};
    if(replies===4)return {tools:[{name:'annotation_from_analysis',arguments:{resultRef,layerId:'points',objectId:'after-compact',name:'压缩后原范围'}}]};
    return {text:'已保存同一范围。'};
  },{contextWindow:8192,maxOutputTokens:6000,compactionReserveTokens:7000,compactionKeepRecentTokens:128});
  await s.lab.start(s.session.id,'计算范围',{},'alpha').run(()=>{});
  const original=s.lab.get(s.session.id,'alpha').messages.find(m=>m.toolName==='spatial_analyze')!.spatialResult!;
  await s.lab.start(s.session.id,'保存刚才范围',{},'alpha').run(()=>{});
  const snapshot=s.lab.get(s.session.id,'alpha');expect(snapshot.latestCompaction).toBeDefined();expect(s.fake.calls.some(c=>!c.context.tools?.length)).toBe(true);
  const read=snapshot.messages.findLast(m=>m.toolName==='spatial_analyze')!;expect(read.isError).toBe(false);expect(read.spatialResult?.geometry).toEqual(original.geometry);expect(read.spatialResult?.resultRef).toBe(resultRef);
  const saved=snapshot.messages.findLast(m=>m.toolName==='annotation_from_analysis')!;expect(saved.isError).toBe(false);
  const receipt=saved.annotationResult!.receipt;expect(s.lab.annotations!.version(s.actor,receipt.taskId,receipt.ref!).document.layers[0].features.find(f=>f.objectId==='after-compact')?.geometry).toEqual(original.geometry);
});

it('keeps ordinary spatial parameter/data failures recoverable in a later request',async()=>{
  const s=await setup((_c,index)=>index===0?{tools:[{name:'spatial_analyze',arguments:{operation:'summarize',input:s.input,field:'missing'}}]}:{text:'请核对已有字段。'});
  await s.lab.start(s.session.id,'按缺失字段统计',{},'alpha').run(()=>{});
  const error=s.lab.get(s.session.id,'alpha').messages.find(m=>m.toolName==='spatial_analyze')!;
  expect(error.isError).toBe(true);expect(error.text).toContain('SPATIAL_ATTRIBUTE_MISSING');
  await s.lab.start(s.session.id,'我知道字段缺失，继续讨论',{},'alpha').run(()=>{});
  expect(s.lab.get(s.session.id,'alpha').lastResult?.status).toBe('succeeded');
});

it('delivers result-selection ambiguity and recovers with the same fixed geometry in the native loop',async()=>{
  let resultRef='',sawActionableError=false;
  const s=await setup((context,index)=>{
    if(index===0)return {tools:[{name:'spatial_analyze',arguments:{operation:'buffer',input:s.input,distanceM:500}}]};
    if(index===1)resultRef=lastResult(context).resultRef;
    if(index===2){
      const error=context.messages.findLast(m=>m.role==='toolResult');
      expect(error?.role).toBe('toolResult');
      if(error?.role==='toolResult'){
        const text=error.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
        expect(error.isError).toBe(true);expect(text).toContain('SPATIAL_AMBIGUOUS');
        expect(text).toContain('geometry:true');expect(text).toContain('geometry:false');
        sawActionableError=true;
      }
    }
    if(index===1 || index===2)return {tools:[{name:'spatial_analyze',arguments:{operation:'filter',input:{kind:'annotation',ref:s.ref,objectIds:['near','far']},spatial:{target:{kind:'result',resultRef,...(index===2?{geometry:true}:{})},relation:'contains'}}}]};
    return {text:'已使用同一固定范围筛选，未重算或保存。'};
  });
  await s.lab.start(s.session.id,'生成范围后沿用它筛选，只分析',{},'alpha').run(()=>{});
  const snapshot=s.lab.get(s.session.id,'alpha'),results=snapshot.messages.filter(m=>m.toolName==='spatial_analyze');
  expect(sawActionableError).toBe(true);expect(snapshot.lastResult?.status).toBe('succeeded');
  expect(results.map(m=>m.isError)).toEqual([false,true,false]);
  expect(results[1].spatialResult).toBeNull();
  expect(results[2].spatialResult?.referenceItems?.[0].geometry).toEqual(results[0].spatialResult?.geometry);
  expect(results[2].spatialResult?.items.map(i=>i.annotation?.objectId)).toEqual(['near']);
  expect(results[2].spatialResult?.scope[1]).toEqual({kind:'result',resultRef,geometry:true});
  expect(s.lab.annotations!.binding(s.actor,s.session.id).draft?.headRevision).toBe(1);
});
