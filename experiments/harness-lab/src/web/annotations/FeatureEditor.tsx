import { useState } from 'react';
import type { AnnotationFeature, AnnotationLayer } from '../../contracts/annotations';
import type { SituationGeometry } from '../../contracts/context';
import { randomUUID } from '../random-uuid';

export function FeatureEditor({ feature, layers, layerId, busy, save, cancel, dirty }: { feature?: AnnotationFeature; layers: AnnotationLayer[]; layerId: string; busy: boolean; save: (feature: AnnotationFeature, layerId: string) => Promise<boolean>; cancel: (saved?:boolean) => void; dirty: (value: boolean) => void }) {
  const [kind,setKind]=useState(feature?.kind || 'point'); const [name,setName]=useState(feature?.name || ''); const [note,setNote]=useState(feature?.note || ''); const [target,setTarget]=useState(layerId);
  const [coordinates,setCoordinates]=useState(JSON.stringify(feature?.geometry.coordinates || [116.4,39.9],null,2)); const [attributes,setAttributes]=useState(JSON.stringify(feature?.attributes || {},null,2));
  const [color,setColor]=useState(feature?.style?.color || '#416858'); const [fillColor,setFillColor]=useState(feature?.style?.fillColor || '#416858'); const [label,setLabel]=useState(feature?.style?.label || '');
  const [symbol,setSymbol]=useState(feature?.style?.symbol || 'circle'); const [lineStyle,setLineStyle]=useState(feature?.style?.lineStyle || 'solid'); const [size,setSize]=useState(feature?.style?.size ?? 7); const [width,setWidth]=useState(feature?.style?.width ?? 3); const [opacity,setOpacity]=useState(feature?.style?.opacity ?? 0.35);const [error,setError]=useState('');
  async function submit() {
    try {
      const coords=JSON.parse(coordinates);const attrs=JSON.parse(attributes);
      if (!attrs || typeof attrs!=='object' || Array.isArray(attrs) || Object.values(attrs).some(value=>value!==null && !['string','number','boolean'].includes(typeof value))) throw new Error('业务属性必须是键值对象，值支持文字、数字、布尔值或 null。');
      if(!name.trim())throw new Error('请输入对象名称。');
      const geometry={type:kind==='point'||kind==='text'?'Point':kind==='line'?'LineString':'Polygon',coordinates:coords} as SituationGeometry;
      const saved=await save({...feature,objectId:feature?.objectId || randomUUID(),kind,name:name.trim(),note,attributes:attrs,geometry,style:{color,fillColor,label,symbol,lineStyle,size,width,opacity}},target);
      if(saved){dirty(false);cancel(true);}
    }catch(error){setError(error instanceof Error?error.message:'坐标格式无效。');}
  }
  return <form className="annotation-feature-form" aria-label="标注对象编辑" onSubmit={event=>{event.preventDefault();void submit();}} onChange={()=>dirty(true)}>
    <h3>{feature?'编辑对象':'通过坐标新增对象'}</h3><fieldset disabled={busy}>
    <label>对象类型<select value={kind} disabled={!!feature} onChange={e=>{const value=e.target.value as AnnotationFeature['kind'];setKind(value);setCoordinates(value==='line'?'[[116.4,39.9],[116.41,39.91]]':value==='polygon'?'[[[116.4,39.9],[116.41,39.9],[116.41,39.91],[116.4,39.9]]]':'[116.4,39.9]');}}><option value="point">点</option><option value="line">线</option><option value="polygon">面</option><option value="text">文字注记</option></select></label>
    <label>所属图层<select value={target} onChange={e=>setTarget(e.target.value)}>{layers.map(layer=><option key={layer.layerId} value={layer.layerId}>{layer.name}</option>)}</select></label>
    <label>对象名称<input value={name} maxLength={200} onChange={e=>setName(e.target.value)}/></label><label>备注<textarea value={note} onChange={e=>setNote(e.target.value)}/></label>
    <label>坐标 JSON（经度在前）<textarea rows={5} value={coordinates} onChange={e=>setCoordinates(e.target.value)}/></label><p className="resource-help">点：[经度,纬度]；线：坐标数组；面：单个闭合环的数组。不支持带洞面。</p>
    <details><summary>业务属性与样式</summary><label>业务属性 JSON<textarea value={attributes} onChange={e=>setAttributes(e.target.value)}/></label><div className="annotation-style-fields"><label>颜色<input type="color" value={color} onChange={e=>setColor(e.target.value)}/></label><label>填充色<input type="color" value={fillColor} onChange={e=>setFillColor(e.target.value)}/></label><label>点大小<input type="number" min="1" max="40" value={size} onChange={e=>setSize(Number(e.target.value))}/></label><label>线宽<input type="number" min="1" max="20" value={width} onChange={e=>setWidth(Number(e.target.value))}/></label><label>填充透明度<input type="number" min="0" max="1" step="0.05" value={opacity} onChange={e=>setOpacity(Number(e.target.value))}/></label><label>点符号<select value={symbol} onChange={e=>setSymbol(e.target.value as typeof symbol)}><option value="circle">圆</option><option value="square">方</option><option value="triangle">三角</option></select></label><label>线型<select value={lineStyle} onChange={e=>setLineStyle(e.target.value as typeof lineStyle)}><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label></div><label>地图标签<input value={label} onChange={e=>setLabel(e.target.value)}/></label></details>
    {error && <p role="alert">{error}</p>}<div className="annotation-actions"><button type="submit">保存对象</button><button type="button" onClick={()=>cancel()}>取消编辑</button></div></fieldset>
  </form>;
}
