import { useState } from 'react';
import type { EditChoices, EditDifference } from './edit-changes';
function display(value:unknown){return value===undefined?'未设置 / 已删除':typeof value==='string'?(value===''?'空文字':value):JSON.stringify(value);}
export function EditComparison({differences,busy,confirm,cancel}:{differences:EditDifference[];busy:boolean;confirm:(choices:EditChoices)=>void;cancel:()=>void}){
  const [choices,setChoices]=useState<EditChoices>({});
  const unresolved=differences.some(item=>item.conflict&&!choices[item.id]);
  return <section className="annotation-edit-comparison" aria-label="核对对象修改" onChange={event=>event.stopPropagation()}><h4>核对最新保存内容</h4><p>不同属性的修改将保留；有冲突的属性请逐项选择。</p>{differences.length?differences.map(item=><div key={item.id} className="annotation-edit-difference"><strong>{item.label}{item.conflict?' · 需要选择':''}</strong><dl><dt>开始编辑时</dt><dd>{display(item.before)}</dd><dt>我的修改</dt><dd>{display(item.local)}</dd><dt>最新保存值</dt><dd>{display(item.latest)}</dd></dl>{item.conflict&&<label>采用{item.label}<select value={choices[item.id]||''} disabled={busy} onChange={event=>setChoices({...choices,[item.id]:event.target.value as 'local'|'latest'})}><option value="" disabled>请选择</option><option value="local">我的修改</option><option value="latest">最新保存值</option></select></label>}</div>):<p>这个对象未发生变化，仅保存版本有更新。</p>}<div className="annotation-actions"><button type="button" disabled={busy||unresolved} onClick={()=>confirm(choices)}>合并我的修改并保存</button><button type="button" disabled={busy} onClick={cancel}>取消核对</button></div></section>;
}
