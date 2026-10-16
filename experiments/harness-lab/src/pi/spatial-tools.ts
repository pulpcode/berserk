import { defineTool } from '@earendil-works/pi-coding-agent';
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { AnnotationService, AnnotationActor } from '../annotations/service.js';
import type { ContextService } from '../context/service.js';
import type { SpatialRequest } from '../contracts/spatial.js';
import { SpatialAnalysisService } from '../spatial/service.js';
import { annotationActionId, annotationRefSchema } from './annotation-tools.js';
import { AnnotationRequestState } from './annotation-state.js';
import { annotationToolResult } from './annotation-results.js';
import { resolveSpatialResult, spatialToolResult } from './spatial-results.js';
import { RequestError } from '../contracts/errors.js';
import { AnnotationError } from '../annotations/errors.js';
const strict={additionalProperties:false};
const id=Type.String({pattern:'^[A-Za-z0-9_.:-]{1,128}$'}),longId=Type.String({minLength:1,maxLength:1024});
const sourceText=Type.String({minLength:1,maxLength:128});
const ref=Type.Object({systemId:sourceText,objectType:sourceText,objectId:sourceText},strict);
const relation=Type.Union(['contains','intersects','disjoint'].map(v=>Type.Literal(v)));
const input=Type.Union([
  Type.Object({kind:Type.Literal('source'),systemId:sourceText,objectRefs:Type.Optional(Type.Array(ref,{minItems:1,maxItems:20})),areaIds:Type.Optional(Type.Array(sourceText,{minItems:1,maxItems:10})),revisions:Type.Optional(Type.Array(Type.Object({ref,revision:Type.Integer({minimum:1})},strict),{maxItems:100}))},strict),
  Type.Object({kind:Type.Literal('annotation'),ref:annotationRefSchema,layerIds:Type.Optional(Type.Array(id,{minItems:1,maxItems:32})),objectIds:Type.Optional(Type.Array(id,{minItems:1,maxItems:500}))},strict),
  Type.Object({kind:Type.Literal('result'),resultRef:longId,itemIds:Type.Optional(Type.Array(longId,{minItems:1,maxItems:500})),geometry:Type.Optional(Type.Boolean())},strict),
]);
const inputRef=Type.Unsafe<SpatialRequest extends {input:infer I}?I:never>({$ref:'#/$defs/input'});
const distance=Type.Number({minimum:0,maximum:50000});
export const spatialAnalyzeSchema=Type.Union([
  Type.Object({operation:Type.Literal('read'),resultRef:longId},strict),
  Type.Object({operation:Type.Literal('measure'),metric:Type.Union(['distance','point_to_line','length','area'].map(v=>Type.Literal(v))),input:inputRef,target:Type.Optional(inputRef)},strict),
  Type.Object({operation:Type.Literal('relate'),relation,input:inputRef,target:inputRef},strict),
  Type.Object({operation:Type.Literal('buffer'),input:inputRef,distanceM:Type.Number({exclusiveMinimum:0,maximum:50000})},strict),
  Type.Object({operation:Type.Literal('filter'),input:inputRef,spatial:Type.Optional(Type.Union([Type.Object({target:inputRef,relation},strict),Type.Object({target:inputRef,distanceM:distance},strict)])),attributes:Type.Optional(Type.Array(Type.Object({field:Type.String({minLength:1,maxLength:128}),op:Type.Union(['eq','ne','gt','gte','lt','lte'].map(v=>Type.Literal(v))),value:Type.Union([Type.String({maxLength:4000}),Type.Number(),Type.Boolean(),Type.Null()])},strict),{minItems:1,maxItems:20}))},strict),
  Type.Object({operation:Type.Literal('nearest'),input:inputRef,target:inputRef,count:Type.Integer({minimum:1,maximum:500})},strict),
  Type.Object({operation:Type.Literal('summarize'),input:inputRef,field:Type.String({minLength:1,maxLength:128})},strict),
],{type:'object',$defs:{input}});
export function spatialTools(annotations:AnnotationService,context:ContextService|undefined,manager:SessionManager,scope:{actor:AnnotationActor;sessionId:string;taskId:string;requestId:string;signal:AbortSignal;check:()=>void;state:AnnotationRequestState}) {
  const service=new SpatialAnalysisService(annotations,context);
  const captured=(signal?:AbortSignal)=>({...scope,signal:signal?AbortSignal.any([scope.signal,signal]):scope.signal,check:()=>{scope.check();annotations.actorForSeat(scope.actor.seatId,scope.actor.userId);annotations.binding(scope.actor,scope.sessionId);},resolveResult:(ref:string)=>resolveSpatialResult(manager.getBranch(),ref)});
  return [defineTool({name:'spatial_analyze',label:'空间分析',description:'只读基础空间分析。input 为明确来源范围、固定标绘版本或本会话真实 resultRef；来源范围自动完整分页（最多500对象），缺几何/字段、缺页或超限明确失败，不能解释为零。source objectRefs最多20个完整引用，areaIds最多10个区域标签；省略 objectRefs/areaIds 表示该来源全体授权对象；与当前视口无关。measure: distance点点球面米、point_to_line点到线最短米、length折线米、area面平方米。relate: input contains target（闭区域包含边界），intersects含边界接触，disjoint分离。filter: spatial.target 是区域或参考点/线，contains 表示区域包含候选；distanceM 为点候选到参考点/线距离≤阈值，attributes为实际顶层标量字段的AND条件。nearest: input候选点，target单点；先完成所有筛选后取count，同距按完整身份排序，不代表最快/路线/专业派遣。summarize按实际字段去重分类。buffer仅点线，距离(0,50000]米，生成几何可通过{kind:result,resultRef,geometry:true}继续使用；省略geometry则复用结果对象。read按resultRef读取固定原结果并重检权限，不替换为最新数据。每次一项操作，无需复制坐标。',
    parameters:spatialAnalyzeSchema,executionMode:'sequential',execute:async(callId,params,signal)=>{
      try {const active=captured(signal);const result=await service.analyze(params as unknown as SpatialRequest,active,scope.requestId,callId);
        return spatialToolResult(params.operation==='read'?{...result,delivery:{requestId:scope.requestId,toolCallId:callId}}:result);
      }catch(error){scope.signal.throwIfAborted();throw new Error(JSON.stringify({code:error instanceof RequestError?error.code:'SPATIAL_CALCULATION_FAILED',message:error instanceof Error?error.message:'空间分析失败。',outcome:'not_committed'}));}
    }}),defineTool({name:'annotation_from_analysis',label:'保存分析几何',description:'仅用户要求保存时，将本会话可信 resultRef 的原始生成范围（不填itemId）或结果对象（指定itemId）精确保存至当前已有草稿图层。先 annotation_read mode:draft 获取可写依据，当前请求刚创建的草稿可继续。只需指定名称和新标注ID，无需抄写坐标。权限重检、CAS、幂等、取消和不确定回执遵循 annotation_action；不支持无损保存含孔面/多面时明确拒绝。不发布、不设为任务当前。',
    parameters:Type.Object({resultRef:longId,itemId:Type.Optional(longId),layerId:id,objectId:id,name:Type.String({minLength:1,maxLength:120})},strict),executionMode:'sequential',execute:async(callId,params,signal)=>{
      const active=captured(signal),clientActionId=annotationActionId(scope.requestId,callId);let dispatched=false,committed=false;
      try {
        active.signal.throwIfAborted();active.check();
        const result=active.resolveResult(params.resultRef);service.inputs.authorize(result,active);
        const intent={...params,action:'from_analysis' as const,clientActionId};
        const replay=annotations.hostReplay(scope.actor,scope.sessionId,intent);
        if(replay) return annotationToolResult({...replay.receipt,replayed:true},'annotation_from_analysis');
        const basis=scope.state.draftBasis();dispatched=true;
        const saved=annotations.fromAnalysisFromHost(scope.actor,scope.sessionId,intent,result,basis,active.signal,()=>{committed=true;scope.state.noteWrite(callId,clientActionId);});
        scope.state.committed(saved.receipt,saved.replayed);active.signal.throwIfAborted();active.check();
        return annotationToolResult({...saved.receipt,...(saved.replayed?{replayed:true}:{})},'annotation_from_analysis');
      }catch(error){scope.state.rejectResult(callId);const unknown=dispatched&&(committed||!(error instanceof RequestError)||(error instanceof AnnotationError&&error.recovery.outcome==='unknown'));if(unknown) scope.state.markUncertain(clientActionId);
        active.signal.throwIfAborted();throw new Error(JSON.stringify({code:unknown?'ANNOTATION_RESULT_UNCERTAIN':error instanceof RequestError?error.code:'SPATIAL_SAVE_FAILED',message:unknown?'保存结果尚未可靠返回，请查询原动作回执；不要换动作重试。':error instanceof Error?error.message:'保存失败。',...(error instanceof AnnotationError?error.recovery:{outcome:'not_committed'}),...(unknown?{outcome:'unknown',clientActionIds:[clientActionId]}:{})}));}
    }})];
}
