import { ResourceFacts } from './ResourceFacts';
import { useState } from 'react';
import type { SituationObject } from '../../contracts/context';
import type { AnnotationLayer } from '../../contracts/annotations';
export function SourceImport({item,layers,disabled,save}:{item:SituationObject;layers:AnnotationLayer[];disabled:boolean;save:(layerId:string)=>Promise<boolean>}) {
 const [target,setTarget]=useState(layers[0]?.layerId??'');const [saved,setSaved]=useState(false);
 return <details className="source-import"><summary>导入为会话标注</summary><p className="resource-help">保存来源当前修订的位置及资源信息到草稿。{item.resourceData?.entityId?'来源提供了实体标识，保存时保留可靠关联。':'来源未提供实体标识，只保留来源依据，不按名称合并实体。'}此操作不发布、不采用，也不修改来源。</p>{item.resourceData&&<ResourceFacts resource={item.resourceData.resource}/>}<label>导入目标图层<select value={target} disabled={disabled} onChange={e=>{setTarget(e.target.value);setSaved(false);}}>{layers.map(layer=><option key={layer.layerId} value={layer.layerId}>{layer.name}</option>)}</select></label>{!layers.length&&<p>请先创建会话草稿图层。</p>}{!item.geometry&&<p>来源没有位置，不能导入为地图标注。</p>}<button type="button" disabled={disabled||!item.geometry||!layers.some(l=>l.layerId===target)||saved} onClick={()=>void save(target).then(ok=>{if(ok)setSaved(true);})}>{saved?'已保存到会话草稿':'确认导入到草稿'}</button></details>;
}
