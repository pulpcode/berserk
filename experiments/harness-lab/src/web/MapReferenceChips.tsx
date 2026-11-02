import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { ContextQueryResult, ContextRef, SituationCurrent } from '../contracts/context';
import type { AnnotationSelection, AnnotationVersion } from '../contracts/annotations';
import { useApi } from './api';
import { annotationLabel, annotationPath } from './annotations/helpers';
import { useSituationMap } from './situation/MapContext';
import { refKey } from './situation/evidence';
function ReferenceName({source,annotation}:{source?:ContextRef;annotation?:AnnotationSelection}) {
 const {api}=useApi();const key=JSON.stringify({source,annotation});const [loaded,setLoaded]=useState<{key:string;name:string}>();
 useEffect(()=>{let active=true;const selection=JSON.parse(key) as {source?:ContextRef;annotation?:AnnotationSelection};
 async function read(){try{let name:string;if(selection.source){const query=await api<ContextQueryResult>('/api/context/situation',{systemId:selection.source.systemId,mode:'current',objectRefs:[selection.source]});const object=(query.data as SituationCurrent).items.find(item=>refKey(item.ref)===refKey(selection.source!));if(!object)throw new Error();name=object.name;}else {const ref=selection.annotation!;const value=await api<AnnotationVersion>(annotationPath(ref));const layers=value.document.layers.filter(layer=>!ref.layerIds||ref.layerIds.includes(layer.layerId));const names=ref.objectIds?layers.flatMap(layer=>layer.features.filter(f=>ref.objectIds!.includes(f.objectId)).map(f=>`${layer.name} / ${f.name}${layer.features.filter(other=>other.name===f.name).length>1?`（${f.objectId}）`:''}`)):ref.layerIds?layers.map(layer=>layer.name):[value.title];name=names.join('、')||'引用范围已不可读取';}if(active)setLoaded({key,name});}catch{if(active)setLoaded({key,name:'引用暂不可读取，请移除或重新核对'});}}
 void read();return()=>{active=false;};},[api,key]);
 return <><span className="map-reference-name" title={loaded?.key===key?loaded.name:undefined}>{loaded?.key===key?loaded.name:'正在读取名称…'}</span><small>{source?`来源 ${source.systemId} / ${source.objectType} / ${source.objectId} · 发送时读取最新`:`固定标注 · ${annotationLabel(annotation!)} · ${annotation?.objectIds?.length?`${annotation.objectIds.length} 个对象`:annotation?.layerIds?.length?`${annotation.layerIds.length} 个图层`:'整个版本'}`}</small></>;
}
export function MapReferenceChips({sources,annotations,removeSource,removeAnnotation}:{sources:ContextRef[];annotations:AnnotationSelection[];removeSource:(ref:ContextRef)=>void;removeAnnotation:(index:number)=>void}) {
 const map=useSituationMap();
 return <><div className="context-reference-chips" aria-label="本次引用的地图对象">{sources.map(ref=><span key={refKey(ref)}><button type="button" className="map-object-link" title="在地图核对来源引用" onClick={()=>map.open({ref,href:'/situation'})}><ReferenceName source={ref}/></button><button type="button" className="icon-button" aria-label={`移除 ${ref.objectId}`} onClick={()=>removeSource(ref)}><X size={13}/></button></span>)}</div><div className="context-reference-chips" aria-label="本次引用的标注版本">{annotations.map((ref,index)=><span key={JSON.stringify(ref)}><button type="button" className="map-object-link" title="在地图核对固定标注引用" onClick={()=>map.openAnnotations(ref)}><ReferenceName annotation={ref}/></button><button type="button" aria-label={`移除标注引用 ${index+1}`} onClick={()=>removeAnnotation(index)}><X size={13}/></button></span>)}</div></>;
}
