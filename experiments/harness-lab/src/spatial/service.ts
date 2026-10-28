import type { AnnotationService } from '../annotations/service.js';
import type { ContextService } from '../context/service.js';
import type { SpatialInput, SpatialItem, SpatialRequest, SpatialResult } from '../contracts/spatial.js';
import { SpatialInputs, type SpatialScope } from './inputs.js';
import { spatialRequestValid } from '../contracts/spatial.js';
import { LIMITS, spatialError, validateItems } from './validation.js';
import { calculationDescription } from './geometry.js';
import { runCalculation } from './worker.js';
const one=(items:SpatialItem[])=>{if(items.length!==1) throw spatialError('AMBIGUOUS','该位置必须解析为恰好一个对象；请明确对象范围。');return items[0];};
export class SpatialAnalysisService {
  readonly inputs:SpatialInputs;
  constructor(annotations:AnnotationService|undefined,context?:ContextService) {this.inputs=new SpatialInputs(annotations,context);}
  async analyze(request:SpatialRequest,scope:SpatialScope,requestId:string,toolCallId:string):Promise<SpatialResult> {
    if(!spatialRequestValid(request)) throw spatialError('INVALID_INPUT','空间分析参数无效或不支持；不要补造坐标。');
    if(request.operation==='read') {const result=scope.resolveResult(request.resultRef);this.inputs.authorize(result,scope);return structuredClone(result);}
    const data=await this.inputs.read(request.input,scope),targetInput='target' in request?request.target:request.operation==='filter'?request.spatial?.target:undefined;
    const target=targetInput?await this.inputs.read(targetInput,scope):undefined;
    validateItems([...data.items,...(target?.items??[])]);
    if(request.operation==='nearest' && one(target!.items).geometry.type!=='Point') throw spatialError('UNSUPPORTED_GEOMETRY','邻近排序参考对象必须是单点。');
    if(request.operation==='filter' && request.spatial) {const g=one(target!.items).geometry;if('distanceM' in request.spatial && !['Point','LineString'].includes(g.type) || 'relation' in request.spatial && request.spatial.relation==='contains' && !['Polygon','MultiPolygon'].includes(g.type)) throw spatialError('UNSUPPORTED_GEOMETRY','空间筛选参考几何类型不支持。');}
    if(request.operation==='classify_points' && (one(target!.items).geometry.type!=='Polygon' || data.items.some(item=>item.geometry.type!=='Point'))) throw spatialError('UNSUPPORTED_GEOMETRY','点面分类要求候选均为点，参照为恰好一个 Polygon（可含孔），不支持 MultiPolygon。');
    const refs:SpatialInput[]=[request.input,...(targetInput?[targetInput]:[])];
    const result:SpatialResult={schemaVersion:request.operation==='classify_points'?2:1,resultRef:`spatial:${requestId}:${encodeURIComponent(toolCallId)}`,requestId,toolCallId,operation:request.operation,parameters:structuredClone(request),createdAt:new Date().toISOString(),scope:structuredClone(refs),completeness:{status:'complete',candidateCount:data.items.length},items:structuredClone(data.items),...(target?{referenceItems:structuredClone(target.items)}:{}),...calculationDescription(request),provenance:[...data.provenance,...(target?.provenance??[])]};
    result.provenance=[...new Map(result.provenance.map(p=>[JSON.stringify(p),p])).values()];
    if(result.provenance.length>100) throw spatialError('LIMIT','分析依赖的独立读取超过 100 项，未截断依据。');
    const calculated=await runCalculation({request,data,target,result},scope.signal);
    this.inputs.authorize(calculated,scope);

    if(Buffer.byteLength(JSON.stringify(calculated))>LIMITS.bytes) throw spatialError('LIMIT','分析结果超过 1 MiB，未截断输出。');
    return calculated;
  }
}
