import './layer-tree.css';
import { useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, MoreHorizontal, Pencil, X } from 'lucide-react';
import type { AnnotationLayer, AnnotationVersion } from '../../contracts/annotations';

export function LayerTreeRow({name,description,expanded,toggle,visibility,show,target,menu}:{name:string;description:ReactNode;expanded?:boolean;toggle?:()=>void;visibility:boolean|'mixed';show:()=>void;target?:ReactNode;menu?:ReactNode}) {
  const [more,setMore]=useState(false);const trigger=useRef<HTMLButtonElement>(null);
  const visibilityLabel=`${visibility===true?'隐藏':'显示'}${name}`;
  return <>
    <div className="annotation-tree-row">
      {toggle?<button type="button" className="annotation-tree-disclosure" aria-label={`${expanded?'收起':'展开'}${name}`} aria-expanded={expanded} onClick={toggle}>{expanded?<ChevronDown size={15} aria-hidden="true"/>:<ChevronRight size={15} aria-hidden="true"/>}<span><strong>{name}</strong><small>{description}</small></span></button>:<div className="annotation-tree-label"><strong>{name}</strong><small>{description}</small></div>}
      <div className="annotation-tree-target">{target}</div>
      <button type="button" className="icon-button annotation-tree-eye" aria-label={visibilityLabel} title={`${visibilityLabel}${visibility==='mixed'?'（部分显示）':''}`} aria-pressed={visibility} onClick={show}>{visibility?<Eye size={18} aria-hidden="true"/>:<EyeOff size={18} aria-hidden="true"/>}{visibility==='mixed'&&<span className="annotation-eye-partial" aria-hidden="true"/>}</button>
      <div className="annotation-tree-more">{menu&&<button ref={trigger} type="button" className="icon-button" aria-label={`更多操作：${name}`} title={`更多操作：${name}`} aria-expanded={more} onKeyDown={event=>{if(event.key==='Escape'&&more){event.stopPropagation();setMore(false);}}} onClick={()=>setMore(!more)}><MoreHorizontal size={18} aria-hidden="true"/></button>}</div>
    </div>
    {more&&<div className="annotation-tree-menu" role="group" aria-label={`更多操作：${name}`} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setMore(false);trigger.current?.focus();}}}><button type="button" className="icon-button annotation-tree-menu-close" aria-label={`关闭更多操作：${name}`} onClick={()=>{setMore(false);trigger.current?.focus();}}><X size={16} aria-hidden="true"/></button>{menu}</div>}
  </>;
}

function LayerRow({layer,shown,current,writable,disabled,show,select,menu,pick,picked}:{layer:AnnotationLayer;shown:boolean;current:boolean;writable:boolean;disabled:boolean;show:()=>void;select:()=>void;menu:ReactNode;pick:(objectId:string)=>void;picked?:string}) {
  const [expanded,setExpanded]=useState(false);
  return <div className="annotation-tree-layer" data-layer-id={layer.layerId}>
    <LayerTreeRow name={layer.name} description={`${layer.features.length} 个对象`} expanded={expanded} toggle={()=>setExpanded(!expanded)} visibility={shown} show={show} menu={menu} target={writable?(current?<span className="annotation-target-badge" title="当前绘制目标" aria-label={`当前绘制：${layer.name}`}>当前<br/>绘制</span>:<button type="button" className="icon-button" aria-label={`设为绘制目标：${layer.name}`} title={`设为绘制目标：${layer.name}`} disabled={disabled} onClick={select}><Pencil size={17} aria-hidden="true"/></button>):undefined}/>
    <ul className="annotation-tree-objects" hidden={!expanded}>{layer.features.map(feature=><li key={feature.objectId}><button type="button" aria-pressed={picked===feature.objectId} onClick={()=>pick(feature.objectId)}>{feature.name}<small>{feature.kind}</small></button></li>)}{!layer.features.length&&<li className="resource-help">暂无对象</li>}</ul>
  </div>;
}

export function AnnotationLayerGroup({item,own,writable,disabled,shown,target,groupMenu,layerMenu,add,form,toggleGroup,toggleLayer,selectTarget,pick,picked,emptyReady}:{item?:AnnotationVersion;own:boolean;writable:boolean;disabled:boolean;shown:string[];target:string;groupMenu?:ReactNode;layerMenu:(layer:AnnotationLayer)=>ReactNode;add?:ReactNode;form?:ReactNode;toggleGroup:()=>void;toggleLayer:(id:string)=>void;selectTarget:(id:string)=>void;pick:(layerId:string,objectId:string)=>void;picked?:string;emptyReady?:boolean}) {
  const [expanded,setExpanded]=useState(true);
  const layers=item?.document.layers || [];const shownCount=layers.filter(layer=>shown.includes(layer.layerId)).length;
  const name=own?'本会话标注':`参考标注 ${item?.title || ''}`;
  const counts=item || emptyReady?`${layers.length} 个图层 · ${layers.reduce((sum,layer)=>sum+layer.features.length,0)} 个对象 · 已显示 ${shownCount}/${layers.length} 层`:'标注尚未载入';
  return <section className="annotation-layer-group annotation-tree-group" aria-label={`${own?'本会话':'参考'}标注 ${item?.title || '空白草稿'}`}>
    <LayerTreeRow name={name} description={<>{own&&writable?'可编辑':'只读'} · {counts}</>} expanded={expanded} toggle={()=>setExpanded(!expanded)} visibility={shownCount===0?false:shownCount===layers.length?true:'mixed'} show={toggleGroup} target={add} menu={groupMenu}/>
    {form}
    <div hidden={!expanded}>{layers.slice().sort((a,b)=>a.order-b.order).map(layer=><LayerRow key={layer.layerId} layer={layer} shown={shown.includes(layer.layerId)} current={target===layer.layerId} writable={writable} disabled={disabled} show={()=>toggleLayer(layer.layerId)} select={()=>selectTarget(layer.layerId)} menu={layerMenu(layer)} pick={objectId=>pick(layer.layerId,objectId)} picked={picked}/>)}</div>
  </section>;
}
