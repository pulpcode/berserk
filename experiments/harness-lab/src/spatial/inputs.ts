import type { AnnotationService, AnnotationActor } from '../annotations/service.js';
import type { ContextService } from '../context/service.js';
import type { SpatialInput, SpatialItem, SpatialProvenance, SpatialResult } from '../contracts/spatial.js';
import { spatialError, validateItems, LIMITS } from './validation.js';
import type { ContextRef } from '../contracts/context.js';
export interface SpatialScope {actor:AnnotationActor; sessionId:string; taskId:string; check:()=>void; signal:AbortSignal; resolveResult:(ref:string)=>SpatialResult}
export const sourceKey=(ref:ContextRef)=>JSON.stringify([ref.systemId,ref.objectType,ref.objectId]);
export interface SpatialDataset {items:SpatialItem[]; provenance:SpatialProvenance[]}
export class SpatialInputs {
  constructor(readonly annotations:AnnotationService,readonly context?:ContextService) {}
  authorize(result:SpatialResult,scope:SpatialScope) {
    scope.signal.throwIfAborted();scope.check();this.annotations.binding(scope.actor,scope.sessionId);
    const systems=new Set(this.context?.catalog(scope.actor.seatId).systems.map(s=>s.id)??[]);
    for(const p of result.provenance) {
      if(p.input.kind==='source' && !systems.has(p.input.systemId)) throw spatialError('FORBIDDEN','当前身份无法读取分析的来源。');
      if(p.input.kind==='annotation') this.annotations.version(scope.actor,scope.taskId,p.input.ref);
    }
  }
  async read(input:SpatialInput,scope:SpatialScope):Promise<SpatialDataset> {
    scope.signal.throwIfAborted();scope.check();this.annotations.binding(scope.actor,scope.sessionId);
    let items:SpatialItem[]=[],provenance:SpatialProvenance[]=[];
    if(input.kind==='result') {
      const result=scope.resolveResult(input.resultRef);this.authorize(result,scope);
      provenance=structuredClone(result.provenance);
      if(input.geometry) {
        if(input.itemIds || !result.geometry) throw spatialError('GEOMETRY_MISSING','该结果未生成独立范围；可指定结果中的对象。');
        items=[{id:result.resultRef,name:'分析范围',geometry:structuredClone(result.geometry),properties:{}}];
      } else {
        items=structuredClone(result.items);
        if(input.itemIds) {if(input.itemIds.some(id=>!items.some(i=>i.id===id))) throw spatialError('OBJECT_NOT_FOUND','所选分析对象不在固定结果中。');items=items.filter(i=>input.itemIds!.includes(i.id));}
      }
    } else if(input.kind==='annotation') {
      const version=this.annotations.version(scope.actor,scope.taskId,input.ref),now=new Date().toISOString();
      if(input.layerIds?.some(id=>!version.document.layers.some(l=>l.layerId===id))) throw spatialError('OBJECT_NOT_FOUND','固定版本中缺少指定图层。');
      const layers=version.document.layers.filter(l=>!input.layerIds || input.layerIds.includes(l.layerId));
      const features=layers.flatMap(l=>l.features.map(f=>({f,layerId:l.layerId})));
      if(input.objectIds?.some(id=>!features.some(({f})=>f.objectId===id))) throw spatialError('OBJECT_NOT_FOUND','固定版本所选范围中缺少指定对象。');
      items=features.filter(({f})=>!input.objectIds || input.objectIds.includes(f.objectId)).map(({f,layerId})=>({id:JSON.stringify(['annotation',input.ref,f.objectId]),name:f.name,geometry:f.geometry,
        properties:{...f.attributes,name:f.name,kind:f.kind,layerId},annotation:{ref:input.ref,objectId:f.objectId}}));
      provenance=[{input:structuredClone(input),queriedAt:now,asOf:version.createdAt,hash:version.hash}];
    } else {
      if(!this.context) throw spatialError('UNAVAILABLE','未配置来源系统。');
      let cursor:string|undefined,asOf:string|undefined,changeCursor:string|undefined;
      const seen=new Set<string>(),expected=new Map(input.revisions?.map(v=>[sourceKey(v.ref),v.revision])??[]);
      do {
        const query=await this.context.query('situation_query',{systemId:input.systemId,mode:'current',...(input.objectRefs?{objectRefs:input.objectRefs}:{}),...(input.areaIds?{areaIds:input.areaIds}:{}),limit:100,...(cursor?{cursor}:{})},{kind:'seat',seatId:scope.actor.seatId},scope.signal);
        scope.signal.throwIfAborted();scope.check();
        if(!('changeCursor' in query.data)) throw spatialError('INCOMPLETE','来源未返回当前对象快照。');
        const data=query.data;
        if((asOf!==undefined && (asOf!==data.asOf || changeCursor!==data.changeCursor)) || data.unknownRefs.length) throw spatialError('INCOMPLETE','来源分页版本变化或指定对象不存在，无法给出完整结论。');
        asOf=data.asOf;changeCursor=data.changeCursor;
        for(const item of data.items) {
          const key=sourceKey(item.ref),required=expected.get(key);
          if(required!==undefined && item.revision!==required) throw spatialError('REVISION_CHANGED','来源对象修订变化，请核对后重新分析。');
          if(!item.geometry) throw spatialError('GEOMETRY_MISSING',`对象 ${item.name} 缺少几何；未将缺失数据计为不匹配。`);
          const existing=items.find(i=>i.id===key);
          if(existing) {if(existing.source!.revision!==item.revision || JSON.stringify(existing.geometry)!==JSON.stringify(item.geometry) || existing.name!==item.name || existing.source!.effectiveAt!==item.effectiveAt || JSON.stringify(existing.source!.validTime)!==JSON.stringify(item.validTime) || JSON.stringify(existing.properties)!==JSON.stringify({...item.properties,name:item.name,objectType:item.ref.objectType})) throw spatialError('INCOMPLETE','重复对象在分页中发生变化。');continue;}
          items.push({id:key,name:item.name,geometry:item.geometry,properties:{...item.properties,name:item.name,objectType:item.ref.objectType},source:{ref:item.ref,revision:item.revision,queriedAt:query.queriedAt,effectiveAt:item.effectiveAt,validTime:item.validTime}});
        }
        provenance.push({input:structuredClone(input),queriedAt:query.queriedAt,asOf:data.asOf,sourceRefs:data.items.map(i=>({...i.ref,revision:i.revision}))});
        if(items.length>LIMITS.objects) throw spatialError('LIMIT','声明范围超过 500 个对象；没有返回截断的完整结论。');
        if(data.hasMore && (!data.nextCursor || seen.has(data.nextCursor))) throw spatialError('INCOMPLETE','来源分页无法继续。');
        cursor=data.hasMore?data.nextCursor!:undefined;if(cursor) seen.add(cursor);
        if(seen.size>50) throw spatialError('LIMIT','来源分页超过上限。');
      } while(cursor);
      if(input.objectRefs?.some(ref=>!items.some(i=>i.id===sourceKey(ref))) || [...expected.keys()].some(key=>!items.some(i=>i.id===key))) throw spatialError('INCOMPLETE','指定对象未完整返回。');
    }
    validateItems(items);return {items,provenance};
  }
}
