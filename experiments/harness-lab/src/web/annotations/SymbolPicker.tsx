import { useState } from 'react';
import { MAP_SYMBOLS, getMapSymbol } from '../../contracts/map-symbols';
import { symbolAssetUrl } from '../map-symbols';
export function SymbolPicker({value,select,disabled=false}:{value:string;select:(id:string)=>void;disabled?:boolean}) {
  const [query,setQuery]=useState('');
  const symbols=MAP_SYMBOLS.filter(item=>[item.name,item.category,item.standardRef || '',...item.aliases].some(text=>text.includes(query.trim())));
  const selected=getMapSymbol(value);
  return <div className="annotation-symbol-picker">
    <label>查找专业标号<input type="search" value={query} placeholder="名称、类别或标准条目" onChange={event=>setQuery(event.target.value)}/></label>
    <div className="annotation-symbol-grid" role="group" aria-label="专业标号目录">{symbols.map(item=><button type="button" key={item.id} disabled={disabled} aria-pressed={value===item.id} title={`${item.name} · ${item.sourceKind==='standard'?`XF/T 3013—2020 ${item.standardRef}`:'应用扩展'} · ${item.orientation==='heading'?'可设方向':'固定直立'}`} onClick={()=>select(item.id)}><img src={symbolAssetUrl(item.id)} alt="" width="40" height="40"/><span>{item.name}</span><small>{item.sourceKind==='standard'?`标准 ${item.standardRef}`:'应用扩展'}</small></button>)}</div>
    {!symbols.length&&<p>没有匹配的标号。</p>}
    {selected&&<p className="resource-help">{selected.name} · {selected.sourceKind==='standard'?`XF/T 3013—2020 ${selected.standardRef}`:'应用扩展'} · {selected.orientation==='heading'?'可设真北方向':'固定直立'}。标准颜色不表示业务状态。</p>}
  </div>;
}
