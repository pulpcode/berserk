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
import { methodAdvice } from './skill-method-advice.js';
const strict={additionalProperties:false};
const id=Type.String({pattern:'^[A-Za-z0-9_.:-]{1,128}$'}),longId=Type.String({minLength:1,maxLength:1024});
const sourceText=Type.String({minLength:1,maxLength:128});
const ref=Type.Object({systemId:sourceText,objectType:sourceText,objectId:sourceText},strict);
const relation=Type.Union(['contains','intersects','disjoint'].map(v=>Type.Literal(v)));
const input=Type.Union([
  Type.Object({kind:Type.Literal('source'),systemId:sourceText,objectRefs:Type.Optional(Type.Array(ref,{minItems:1,maxItems:20})),areaIds:Type.Optional(Type.Array(sourceText,{minItems:1,maxItems:10})),revisions:Type.Optional(Type.Array(Type.Object({ref,revision:Type.Integer({minimum:1})},strict),{maxItems:100}))},strict),
  Type.Object({kind:Type.Literal('annotation'),ref:annotationRefSchema,layerIds:Type.Optional(Type.Array(id,{minItems:1,maxItems:32})),objectIds:Type.Optional(Type.Array(id,{minItems:1,maxItems:500}))},strict),
  Type.Object({kind:Type.Literal('result'),resultRef:longId,itemIds:Type.Optional(Type.Array(longId,{minItems:1,maxItems:500,description:'从原结果 items 选择完整 item.id；不是 referenceItems，也不是对象短 ID。'})),geometry:Type.Optional(Type.Boolean({description:'true 使用生成的固定 geometry；false 使用原 items。存在生成几何时必须显式选此字段或 itemIds。'}))},strict),
]);
const inputRef=Type.Unsafe<SpatialRequest extends {input:infer I}?I:never>({$ref:'#/$defs/input'});
const inputFor=(description:string)=>({...inputRef,description});
const distance=Type.Number({minimum:0,maximum:50000,description:'米；比较候选点至 target 点或线的距离 ≤ 此值，不增加隐式容差。'});
export const spatialAnalyzeSchema=Type.Union([
  Type.Object({operation:Type.Literal('read'),resultRef:longId},strict),
  Type.Object({operation:Type.Literal('measure'),metric:Type.Union(['distance','point_to_line','length','area'].map(v=>Type.Literal(v))),input:inputFor('恰好一个测量对象：distance/point_to_line 为点，length 为线，area 为面。'),target:Type.Optional(inputFor('distance 为单点；point_to_line 为一条线；length/area 不传 target。'))},strict),
  Type.Object({operation:Type.Literal('relate'),relation,input:inputFor('一个对象；contains 时必须是包含区域（面），判断 input 是否覆盖 target。'),target:inputFor('一个被判断对象；contains 中它是被区域覆盖的对象。')},strict),
  Type.Object({operation:Type.Literal('classify_points'),input:inputFor('待分类的候选点集合；逐个返回 interior/boundary/exterior 及完整分类计数。'),target:inputFor('恰好一个 Polygon，可含孔；外环/内环边界均为 boundary，孔内部为 exterior，不支持 MultiPolygon，不加距离容差。')},strict),
  Type.Object({operation:Type.Literal('buffer'),input:inputFor('一个点或一条线；生成范围在 geometry，items 仍是原输入对象。'),distanceM:Type.Number({exclusiveMinimum:0,maximum:50000,description:'缓冲半径，单位米；大于 0 且不超过 50000。'})},strict),
  Type.Object({operation:Type.Literal('filter'),input:inputFor('待筛选候选集合；返回 items 是命中对象，candidateCount 是筛选前候选数。'),spatial:Type.Optional(Type.Union([Type.Object({target:inputFor('单个参照对象；contains 时为区域，判断 target 是否覆盖每个 input 候选，方向与 relate 相反。'),relation},strict),Type.Object({target:inputFor('一个参考点或一条线；input 候选必须为点。'),distanceM:distance},strict)])),attributes:Type.Optional(Type.Array(Type.Object({field:Type.String({minLength:1,maxLength:128}),op:Type.Union(['eq','ne','gt','gte','lt','lte'].map(v=>Type.Literal(v))),value:Type.Union([Type.String({maxLength:4000}),Type.Number(),Type.Boolean(),Type.Null()])},strict),{minItems:1,maxItems:20}))},strict),
  Type.Object({operation:Type.Literal('nearest'),input:inputFor('已完成属性/区域筛选的候选点集合。'),target:inputFor('一个参考点。'),count:Type.Integer({minimum:1,maximum:500,description:'最多返回多少项；items 按 distanceM 升序，再按完整身份排序，同距不扩大数量。'})},strict),
  Type.Object({operation:Type.Literal('summarize'),input:inputFor('实际待统计集合，通常引用 filter 的 resultRef；按完整身份去重。'),field:Type.String({minLength:1,maxLength:128,description:'已存在的顶层标量属性；按类别计对象数量，不对该属性求和；缺字段失败。'})},strict),
],{type:'object',$defs:{input}});
export function spatialTools(annotations:AnnotationService,context:ContextService|undefined,manager:SessionManager,scope:{actor:AnnotationActor;sessionId:string;taskId:string;requestId:string;signal:AbortSignal;check:()=>void;state:AnnotationRequestState;skillIds?:readonly string[]}) {
  const service=new SpatialAnalysisService(annotations,context);
  const captured=(signal?:AbortSignal)=>({...scope,signal:signal?AbortSignal.any([scope.signal,signal]):scope.signal,check:()=>{scope.check();annotations.actorForSeat(scope.actor.seatId,scope.actor.userId);annotations.binding(scope.actor,scope.sessionId);},resolveResult:(ref:string)=>resolveSpatialResult(manager.getBranch(),ref)});
  return [defineTool({name:'spatial_analyze',label:'空间分析',description:'只读基础空间分析。input 为明确来源范围、固定标绘版本或本会话真实 resultRef；来源范围自动完整分页（最多500对象），缺几何/字段、缺页或超限明确失败，不能解释为零。source objectRefs最多20个完整引用，areaIds最多10个区域标签；省略 objectRefs/areaIds 表示该来源全体授权对象；与当前视口无关。measure: distance点点球面米、point_to_line点到线最短米、length折线米、area面平方米。relate: input contains target（闭区域包含边界），对点命中不能单独区分内部与边界；intersects含边界接触，disjoint分离。filter: spatial.target 是区域或参考点/线，contains 表示区域包含候选；distanceM 为点候选到参考点/线距离≤阈值，attributes为实际顶层标量字段的AND条件。nearest: input候选点，target单点；先完成所有筛选后取count，同距按完整身份排序，不代表最快/路线/专业派遣。classify_points: input候选点，target单个Polygon（可含孔）；classifications 按 itemId 返回 interior内部/boundary边界/exterior外部，values 返回各类数量与 total。孔内为外部，内外环边界均为边界，不加距离容差，不支持MultiPolygon。summarize按实际字段去重分类。buffer仅点线，距离(0,50000]米，生成几何可通过{kind:result,resultRef,geometry:true}继续使用；若结果含生成geometry，必须显式选择geometry:true使用固定生成范围，或geometry:false/itemIds使用原对象；都省略时返回AMBIGUOUS，不会默取原点。结果未生成geometry时可省略选择并复用items。显式选择读取原快照，无需重算或额外用户确认。read按resultRef读取固定原结果并重检权限，不替换为最新数据。scope 是实际计算选择，candidateCount 是该次输入候选数量，items 是可继续使用的结果集合，referenceItems 仅为参照对象；nearest 保留返回顺序及 distanceM。每次一项操作，无需复制坐标。',
    parameters:spatialAnalyzeSchema,executionMode:'sequential',execute:async(callId,params,signal)=>{
      try {const active=captured(signal);const result=await service.analyze(params as unknown as SpatialRequest,active,scope.requestId,callId);
        return spatialToolResult(params.operation==='read'?{...result,delivery:{requestId:scope.requestId,toolCallId:callId}}:result);
      }catch(error){scope.signal.throwIfAborted();throw new Error(JSON.stringify({code:error instanceof RequestError?error.code:'SPATIAL_CALCULATION_FAILED',message:error instanceof Error?error.message:'空间分析失败。',outcome:'not_committed',...methodAdvice(error,scope.skillIds)}));}
    }}),defineTool({name:'annotation_from_analysis',label:'保存分析几何',description:'仅用户要求保存时，将本会话可信 resultRef 的原始生成范围（不填itemId）或结果对象（指定itemId）精确保存至当前已有草稿图层。先 annotation_read mode:draft 获取可写依据，当前请求刚创建的草稿可继续。本工具设置几何、名称及目标图层，不接收信息性质、样式或备注；用户明确要求这些属性时，保存成功后以同一对象ID用 annotation_action update_object 继续完成，不重复创建或重新计算。无需抄写坐标。权限重检、CAS、幂等、取消和不确定回执遵循 annotation_action；不支持无损保存含孔面/多面时明确拒绝。不发布、不设为任务当前。',
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
        active.signal.throwIfAborted();throw new Error(JSON.stringify({code:unknown?'ANNOTATION_RESULT_UNCERTAIN':error instanceof RequestError?error.code:'SPATIAL_SAVE_FAILED',message:unknown?'保存结果尚未可靠返回，请查询原动作回执；不要换动作重试。':error instanceof Error?error.message:'保存失败。',...(error instanceof AnnotationError?error.recovery:{outcome:'not_committed'}),...(unknown?{outcome:'unknown',clientActionIds:[clientActionId]}:methodAdvice(error,scope.skillIds))}));}
    }})];
}
