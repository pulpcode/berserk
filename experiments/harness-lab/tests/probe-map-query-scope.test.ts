import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import type {Api,Model,Tool} from '@earendil-works/pi-ai';
import {Type} from 'typebox';
import {queryOptions,querySchedule,diagnosticContext,diagnosticRuntime} from '../scripts/probe-map-query-scope.js';
import {annotationTools} from '../src/pi/annotation-tools.js';
import {controlledStream,emptyUsage} from '../src/pi/controlled-stream.js';
import {PiLab} from '../src/pi/lab.js';
import {testConfig} from './pi/fake-runtime.js';

const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();vi.unstubAllGlobals();});

it('fixes 3 repetitions, paired ordering, and separates 30 business requests from 15 controlled interpretations',()=>{
  const schedule=querySchedule();expect(schedule).toHaveLength(45);
  expect(new Set(schedule.map(item=>item.id)).size).toBe(45);
  expect(schedule.filter(item=>item.kind==='business')).toHaveLength(30);
  expect(schedule.filter(item=>item.kind==='diagnostic')).toHaveLength(15);
  expect(schedule.filter(item=>item.condition==='B')).toHaveLength(15);
  for(const id of ['G02-order','H01','H02','Q01','Q02']){
    expect(schedule.filter(item=>item.caseId===id).map(item=>item.condition)).toEqual(['A','B','B','A','A','B']);
  }
  expect(()=>queryOptions(['--entry','H03-1-B','--output','/tmp/not-used'])).toThrow();
  expect(()=>queryOptions(['--entry','H01-4-A','--output','/tmp/not-used'])).toThrow();
  expect(()=>queryOptions(['--entry','H01-1-A','--output','/tmp/not-used','--retry'])).toThrow();
  expect(queryOptions(['--entry','H01-1-A','--output','/tmp/not-used','--prepare-only']).prepareOnly).toBe(true);
});
it('supplies exact driver results and real contract text without evaluator state or callable tools',()=>{
  const model={api:'openai-completions',provider:'diagnostic',id:'model'} as Model<Api>;
  const tools:Tool[]=[{name:'annotation_read',description:'read contract',parameters:Type.Object({})},{name:'annotation_action',description:'reporting contract',parameters:Type.Object({})}];
  const content=[{type:'text' as const,text:JSON.stringify({format:'annotation.model-result.v1',data:{query:{fields:['style']},objects:{items:[{objectId:'one',style:{color:'#123456'}}],total:1}}})}];
  const ctx=diagnosticContext(model,tools,{mode:'draft',fields:['style']},{content},'解释此结果');
  expect(ctx.tools).toBeUndefined();expect(ctx.messages).toHaveLength(4);
  expect(ctx.systemPrompt).toContain('测试驱动');expect(ctx.systemPrompt).toContain('read contract');expect(ctx.systemPrompt).toContain('reporting contract');
  expect(ctx.messages[2]).toMatchObject({role:'toolResult',content,isError:false});
  expect(JSON.stringify(ctx)).not.toContain('evaluator');
  expect(ctx.messages.at(-1)).toMatchObject({role:'user',content:'解释此结果'});
});

it('serializes genuine driver-issued results through the public SDK with no callable tools or hidden fixture fields',async()=>{
  interface WireMessage {role:string;content:string|null;tool_call_id?:string;tool_calls?:Array<{id:string;function:{name:string;arguments:string}}>}
  const payloads:Array<{messages:WireMessage[];tools?:unknown[];model:string;thinking:unknown;max_tokens:number}>=[];
  vi.stubGlobal('fetch',async(input:Request|string|URL,init?:RequestInit)=>{
    payloads.push(JSON.parse(String(init?.body??(input instanceof Request?await input.text():''))));
    const chunks=[
      {id:'diagnostic-test',object:'chat.completion.chunk',created:1,model:'deepseek-flash',choices:[{index:0,delta:{role:'assistant',content:'诊断完成'},finish_reason:null}]},
      {id:'diagnostic-test',object:'chat.completion.chunk',created:1,model:'deepseek-flash',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:2,total_tokens:4}},
    ];
    return new Response(chunks.map(chunk=>`data: ${JSON.stringify(chunk)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  });
  const dir=await mkdtemp(join(tmpdir(),'berserk-query-diagnostic-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));
  const config=testConfig(dir,{provider:'deepseek',model:'deepseek-flash',maxOutputTokens:393216,contextWindow:1048576,seatId:'alpha',testSeats:[{id:'alpha',name:'甲'}]});
  const lab=await PiLab.create(config);cleanup.push(()=>lab.close());
  const session=await lab.createSession(undefined,'alpha'),service=lab.annotations!,actor=service.actorForSeat('alpha');
  const taskId=lab.workspaces.get(session.workspaceId,'alpha').taskSpaceId!;
  const created=service.action(actor,session.id,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,operations:[
    {op:'add_layer',layer:{layerId:'places',name:'位置',order:0,defaultVisible:true,features:[{objectId:'one',name:'位置一',kind:'point',geometry:{type:'Point',coordinates:[103,1]},note:'HIDDEN_NOTE_NOT_READ',attributes:{evaluator:'HIDDEN_EXPECTED_ANSWER'},style:{color:'#123456'}}]}},
    {op:'add_layer',layer:{layerId:'others',name:'其他',order:1,defaultVisible:true,features:[{objectId:'two',name:'位置二',kind:'point',geometry:{type:'Point',coordinates:[104,1]}}]}},
  ]});
  const signal=new AbortController().signal,tools=annotationTools(service,{actor,sessionId:session.id,taskId,requestId:randomUUID(),signal,check:()=>signal.throwIfAborted()});
  const params={mode:'draft' as const,objectIds:['one'],fields:['style' as const]};
  const read=tools.find(tool=>tool.name==='annotation_read')!;
  const intersection=await read.execute('intersection',{...params,layerIds:['places']},undefined,undefined,{} as never);
  expect(JSON.parse((intersection.content[0] as {text:string}).text).data.objects.items.map((item:{objectId:string})=>item.objectId)).toEqual(['one']);
  await expect(read.execute('outside-layer',{...params,layerIds:['others']},undefined,undefined,{} as never)).rejects.toThrow();
  expect(()=>service.resolveSelections(actor,taskId,[{...created.ref!,layerIds:['places'],objectIds:['one']}])).toThrow();
  const toolResult=await read.execute('driver-issued-read',params,undefined,undefined,{} as never);
  const runtime=await diagnosticRuntime(config),model=runtime.getModel(config.provider,config.model)!;
  const context=diagnosticContext(model,tools,params,toolResult,'解释此结果'),usage=emptyUsage();
  const stream=controlledStream(runtime,config,model,context,undefined,'reply','本次仅解释测试驱动提供的真实读取结果。',signal,usage);
  for await(const event of stream)void event;
  expect((await stream.result()).stopReason).toBe('stop');
  expect(payloads).toHaveLength(1);
  const payload=payloads[0],wire=JSON.stringify(payload);
  expect(payload).toMatchObject({model:config.model,thinking:{type:'disabled'},max_tokens:config.maxOutputTokens});
  expect(payload.tools??[]).toEqual([]);
  const call=payload.messages.find(message=>message.tool_calls)?.tool_calls?.[0];
  expect(call?.function.name).toBe('annotation_read');
  expect(JSON.parse(call!.function.arguments)).toEqual(params);
  const returned=payload.messages.find(message=>message.role==='tool')!;
  expect(returned.tool_call_id).toBe(call!.id);
  expect(returned.content).toBe(toolResult.content.map(block=>block.type==='text'?block.text:'').join('\n'));
  expect(wire).toContain('测试驱动');expect(wire).toContain('基础摘要始终包含');expect(wire).toContain('完成用户要求的结果说明与必要分析');
  for(const hidden of ['HIDDEN_NOTE_NOT_READ','HIDDEN_EXPECTED_ANSWER','evaluator',config.apiKey!])expect(wire).not.toContain(hidden);
  expect(payload.messages.at(-1)).toMatchObject({role:'user',content:'解释此结果'});
  expect(usage).toMatchObject({modelAttempts:1,toolCalls:0});
});
