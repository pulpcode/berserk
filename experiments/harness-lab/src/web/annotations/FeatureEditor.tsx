import { useEffect, useState } from 'react';
import type { AnnotationFeature, AnnotationLayer } from '../../contracts/annotations';
import type { SituationGeometry } from '../../contracts/context';
import { validateAnnotationGeometry } from '../../contracts/annotation-geometry';
import { getMapSymbol } from '../../contracts/map-symbols';
import { symbolAssetUrl } from '../map-symbols';
import { SymbolPicker } from './SymbolPicker';
import { randomUUID } from '../random-uuid';

export function FeatureEditor({ feature, layers, layerId, busy, save, cancel, dirty, preview }: { feature?: AnnotationFeature; layers: AnnotationLayer[]; layerId: string; busy: boolean; save: (feature: AnnotationFeature, layerId: string) => Promise<boolean>; cancel: (saved?:boolean) => void; dirty: (value: boolean) => void; preview: (value:AnnotationFeature | undefined,layerId:string)=>void }) {
  const [objectId]=useState(()=>feature?.objectId || randomUUID());
  const [role,setRole]=useState<AnnotationFeature['informationRole']>(feature ? feature.informationRole : 'plan');
  const [symbolId,setSymbolId]=useState(feature?.style?.symbolId || '');const [iconSize,setIconSize]=useState(feature?.style?.iconSize ?? 32);const [heading,setHeading]=useState(feature?.style?.heading?.toString() || '');const [lineEnd,setLineEnd]=useState(feature?.style?.lineEnd || 'none');
  const definition=getMapSymbol(symbolId);
  const [kind,setKind]=useState(feature?.kind || 'point'); const [name,setName]=useState(feature?.name || ''); const [note,setNote]=useState(feature?.note || ''); const [target,setTarget]=useState(layerId);
  const [coordinates,setCoordinates]=useState(JSON.stringify(feature?.geometry.coordinates || [116.4,39.9],null,2)); const [attributes,setAttributes]=useState(JSON.stringify(feature?.attributes || {},null,2));
  const [color,setColor]=useState(feature?.style?.color || '#416858'); const [fillColor,setFillColor]=useState(feature?.style?.fillColor || '#416858'); const [label,setLabel]=useState(feature?.style?.label || '');
  const [symbol,setSymbol]=useState(feature?.style?.symbol || 'circle'); const [lineStyle,setLineStyle]=useState(feature?.style?.lineStyle || 'solid'); const [size,setSize]=useState(feature?.style?.size ?? 7); const [width,setWidth]=useState(feature?.style?.width ?? 3); const [opacity,setOpacity]=useState(feature?.style?.opacity ?? 0.35);const [error,setError]=useState('');
  const style={...feature?.style,color,fillColor,label,symbol,lineStyle,size,width,opacity,symbolId:kind==='point'&&symbolId?symbolId:undefined,iconSize:kind==='point'&&symbolId?iconSize:undefined,heading:kind==='point'&&definition?.orientation==='heading'&&heading!==''?Number(heading):undefined,lineEnd:kind==='line'?lineEnd:undefined};
  // Share the server's bounded geometry validator: invalid coordinate text stays input-only.
  let previewValue:AnnotationFeature | undefined;
  try { const geometry=validateAnnotationGeometry({type:kind==='point'||kind==='text'?'Point':kind==='line'?'LineString':'Polygon',coordinates:JSON.parse(coordinates)},kind);if(!symbolId || definition && Number.isFinite(iconSize) && iconSize>=20 && iconSize<=64 && (heading==='' || Number.isFinite(Number(heading))&&Number(heading)>=0&&Number(heading)<360)) previewValue={...feature,objectId,kind,geometry,name:name.trim() || '未命名草稿',informationRole:role,style}; } catch { /* Invalid coordinate text must not become a map object. */ }
  const previewKey=JSON.stringify(previewValue || null);
  useEffect(()=>{preview(JSON.parse(previewKey) || undefined,target);},[previewKey,target,preview]);
  async function submit() {
    try {
      const coords=JSON.parse(coordinates);const attrs=JSON.parse(attributes);
      if (!attrs || typeof attrs!=='object' || Array.isArray(attrs) || Object.values(attrs).some(value=>value!==null && !['string','number','boolean'].includes(typeof value))) throw new Error('业务属性必须是键值对象，值支持文字、数字、布尔值或 null。');
      if(!name.trim())throw new Error('请输入对象名称。');
      if (kind==='point' && symbolId && (!definition || !Number.isFinite(iconSize) || iconSize<20 || iconSize>64 || heading!=='' && (!Number.isFinite(Number(heading)) || Number(heading)<0 || Number(heading)>=360))) throw new Error('请检查标号、尺寸（20–64 px）和方向（0 至小于 360°）。');
      const geometry={type:kind==='point'||kind==='text'?'Point':kind==='line'?'LineString':'Polygon',coordinates:coords} as SituationGeometry;
      const saved=await save({...feature,objectId,kind,name:name.trim(),note,attributes:attrs,geometry,informationRole:role,style},target);
      if(saved){dirty(false);cancel(true);}
    }catch(error){setError(error instanceof Error?error.message:'坐标格式无效。');}
  }
  return <form className="annotation-feature-form" aria-label="标注对象编辑" onSubmit={event=>{event.preventDefault();void submit();}} onChange={()=>dirty(true)}>
    <fieldset className="annotation-feature-fields" disabled={busy}>
    {!feature&&<label>对象类型<select value={kind} onChange={e=>{const value=e.target.value as AnnotationFeature['kind'];setKind(value);setCoordinates(value==='line'?'[[116.4,39.9],[116.41,39.91]]':value==='polygon'?'[[[116.4,39.9],[116.41,39.9],[116.41,39.91],[116.4,39.9]]]':'[116.4,39.9]');}}><option value="point">点</option><option value="line">线</option><option value="polygon">面</option><option value="text">文字注记</option></select></label>}
    <label>对象名称<input value={name} maxLength={200} onChange={e=>setName(e.target.value)}/></label>
    <label>信息性质<select value={role || ''} onChange={event=>setRole(event.target.value as AnnotationFeature['informationRole'] || undefined)}><option value="" disabled={!!feature?.informationRole}>未注明</option><option value="plan">拟定方案</option><option value="assessment">研判</option><option value="observation">现场记录</option></select></label>
    {kind==='point'&&<><div className="annotation-current-symbol">{definition&&<img src={symbolAssetUrl(definition.id)} alt="" width="40" height="40"/>}<div><strong>{definition?.name || '普通点'}</strong>{definition&&<small>{definition.sourceKind==='standard'?`标准 ${definition.standardRef}`:'应用扩展'}</small>}</div></div>{symbolId&&<div className="annotation-style-fields"><label>图标尺寸（px）<input type="number" min="20" max="64" value={iconSize} onChange={event=>setIconSize(Number(event.target.value))}/></label><label>真北方向（°）<input type="number" min="0" max="359.99" step="any" disabled={definition?.orientation!=='heading'} value={heading} placeholder={definition?.orientation==='heading'?'方向未设置':'固定直立'} onChange={event=>setHeading(event.target.value)}/></label></div>}<details><summary>更换专业标号</summary><SymbolPicker value={symbolId} select={id=>{setSymbolId(id);setHeading('');dirty(true);}}/>{symbolId&&<button type="button" onClick={()=>{setSymbolId('');setHeading('');dirty(true);}}>改用普通点</button>}</details></>}
    {kind==='line'&&<label>路线末端<select value={lineEnd} onChange={event=>setLineEnd(event.target.value as typeof lineEnd)}><option value="none">普通路线</option><option value="arrow">方向箭头</option></select></label>}
    {kind==='polygon'&&<label>应用区域模板<select defaultValue="" onChange={event=>{if(!event.target.value)return;setColor(event.target.value==='search'?'#416858':'#a26913');setFillColor(event.target.value==='search'?'#416858':'#a26913');setLineStyle('dashed');setOpacity(0.18);if(!name || name==='新标注')setName(event.target.value==='search'?'搜救区域':'警戒区域');}}><option value="">自定义区域</option><option value="search">搜救区域（应用表达）</option><option value="warning">警戒区域（应用表达）</option></select></label>}
    <details open={!feature}><summary>图层与坐标</summary><label>所属图层<select value={target} onChange={e=>setTarget(e.target.value)}>{layers.map(layer=><option key={layer.layerId} value={layer.layerId}>{layer.name}</option>)}</select></label><label>坐标 JSON（经度在前）<textarea rows={5} value={coordinates} onChange={e=>setCoordinates(e.target.value)}/></label><p className="resource-help">点：[经度,纬度]；线：坐标数组；面：单个闭合环的数组。不支持带洞面。</p></details>
    <details><summary>备注与业务属性</summary><label>备注<textarea value={note} onChange={e=>setNote(e.target.value)}/></label><label>业务属性 JSON<textarea value={attributes} onChange={e=>setAttributes(e.target.value)}/></label></details>
    <details><summary>更多样式</summary><div className="annotation-style-fields"><label>颜色<input type="color" disabled={kind==='point'&&!!symbolId} value={color} onChange={e=>setColor(e.target.value)}/></label><label>填充色<input type="color" value={fillColor} onChange={e=>setFillColor(e.target.value)}/></label><label>点大小<input type="number" disabled={kind==='point'&&!!symbolId} min="1" max="40" value={size} onChange={e=>setSize(Number(e.target.value))}/></label><label>线宽<input type="number" min="1" max="20" value={width} onChange={e=>setWidth(Number(e.target.value))}/></label><label>填充透明度<input type="number" min="0" max="1" step="0.05" value={opacity} onChange={e=>setOpacity(Number(e.target.value))}/></label><label>点符号<select disabled={kind==='point'&&!!symbolId} value={symbol} onChange={e=>setSymbol(e.target.value as typeof symbol)}><option value="circle">圆</option><option value="square">方</option><option value="triangle">三角</option></select></label><label>线型<select value={lineStyle} onChange={e=>setLineStyle(e.target.value as typeof lineStyle)}><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label></div><label>地图标签<input value={label} onChange={e=>setLabel(e.target.value)}/></label></details>
    {feature?.sourceRefs?.length ? <details><summary>来源关联 · 快照，不自动跟随</summary>{feature.sourceRefs.map(ref=><p key={JSON.stringify([ref.systemId,ref.objectType,ref.objectId])}>{ref.systemId} / {ref.objectType} / {ref.objectId}{ref.revision!==undefined?` · r${ref.revision}`:''}</p>)}</details>:null}
    <p className="resource-help">保存至会话草稿；发布或采用不代表已到场。</p>
    </fieldset>
    <fieldset className="annotation-feature-footer" disabled={busy}>{error&&<p role="alert">{error}</p>}<div className="annotation-actions"><button type="submit">保存对象</button><button type="button" onClick={()=>cancel()}>取消编辑</button></div></fieldset>
  </form>;
}
