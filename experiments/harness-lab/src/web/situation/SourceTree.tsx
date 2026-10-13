import { useState, type ReactNode } from 'react';
import type { SituationObject } from '../../contracts/context';
import { LayerTreeRow } from '../annotations/LayerTree';
import { refKey } from './evidence';
import { objectStatus } from './map-data';
export const sourceCategories=[['road','道路'],['resource','资源池'],['area','区域']] as const;
export function SourceTree({objects,visible,layers,toggleGroup,toggleLayer,selected,select,filters,summary,busy,feedback}:{objects:SituationObject[];visible:boolean;layers:string[];toggleGroup:()=>void;toggleLayer:(kind:string)=>void;selected:string;select:(item:SituationObject,trigger:HTMLButtonElement)=>void;filters:ReactNode;summary:string;busy:boolean;feedback?:ReactNode}) {
  const [expanded,setExpanded]=useState(true);const [categories,setCategories]=useState<string[]>([]);
  const shown=visible?objects.filter(item=>item.geometry&&layers.includes(item.ref.objectType)).length:0;
  const visibility=!visible || !layers.length?false:layers.length===sourceCategories.length?true:'mixed';
  return <section className="annotation-layer-group annotation-tree-group situation-source-tree" aria-label="来源态势">
    <LayerTreeRow name="来源态势" description={<>来源资料 · 只读<br/><span>{objects.length} 个对象</span> · 地图显示 {shown}</>} expanded={expanded} toggle={()=>setExpanded(!expanded)} visibility={visibility} show={toggleGroup}/>
    <p className="source-scope-summary">{summary}{busy?' · 正在更新…':''}</p>
    {feedback}
    <div hidden={!expanded}>
      <details className="source-query-controls"><summary>筛选来源与范围</summary>{filters}</details>
      {sourceCategories.map(([kind,name])=>{const items=objects.filter(item=>item.ref.objectType===kind);const open=categories.includes(kind);return <div className="annotation-tree-layer" key={kind}>
        <LayerTreeRow name={name} description={`${items.length} 个对象`} expanded={open} toggle={()=>setCategories(old=>open?old.filter(item=>item!==kind):[...old,kind])} visibility={visible&&layers.includes(kind)} show={()=>toggleLayer(kind)}/>
        <ul className="annotation-tree-objects source-tree-objects" hidden={!open}>{items.map(item=><li key={refKey(item.ref)}><button type="button" aria-pressed={selected===refKey(item.ref)} onClick={event=>select(item,event.currentTarget)}><strong>{item.name}</strong><small>{objectStatus(item)}{!item.geometry?' · 暂无位置':''}{item.geometry&&(!visible || !layers.includes(kind))?' · 地图已隐藏':''}</small></button></li>)}{!items.length&&<li className="resource-help">当前范围没有对象</li>}</ul>
      </div>;})}
    </div>
  </section>;
}
