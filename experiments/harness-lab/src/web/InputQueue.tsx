import { useEffect, useRef, useState } from 'react';
import { CornerDownRight, ListEnd, MoreHorizontal, Trash2 } from 'lucide-react';
import type { InputReceipt } from '../contracts/index';

export function InputQueue({ items, disabled, act }: {
  items: InputReceipt[]; disabled: boolean;
  act: (item: InputReceipt, action: 'steer' | 'delete' | 'takeback') => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => { if (!root.current?.contains(event.target as Node)) setMenu(''); };
    document.addEventListener('pointerdown', close); document.addEventListener('focusin', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('focusin', close); };
  }, [menu]);
  if (!items.length) return null;
  return <div className="input-queue" ref={root} aria-label="待发送消息" onKeyDown={event => { if (event.key === 'Escape' && menu) { event.preventDefault(); setMenu(''); opener.current?.focus(); } }}>
    <ul>{(expanded ? items : items.slice(0, 3)).map(item => <li key={item.submissionId} className="input-queue-row">
      {item.mode === 'steer' ? <CornerDownRight size={17} aria-hidden="true" /> : <ListEnd size={17} aria-hidden="true" />}
      <span className="input-queue-text" title={item.text}>{item.text}</span>
      {item.mode === 'steer' ? <span className="input-queue-label">等待引导</span> : <button type="button" className="queue-guide" disabled={disabled} onClick={() => act(item, 'steer')}><CornerDownRight size={15} aria-hidden="true" />引导</button>}
      <button type="button" className="icon-button" aria-label="删除排队消息" title="删除" disabled={disabled} onClick={() => act(item, 'delete')}><Trash2 size={16} aria-hidden="true" /></button>
      <div className="queue-more"><button type="button" className="icon-button" aria-label="更多消息操作" title="更多" disabled={disabled} aria-expanded={menu === item.submissionId} onClick={event => { opener.current = event.currentTarget; setMenu(menu === item.submissionId ? '' : item.submissionId); }}><MoreHorizontal size={18} aria-hidden="true" /></button>
        {menu === item.submissionId && <div className="queue-menu"><button type="button" disabled={disabled} onClick={() => { setMenu(''); act(item, 'takeback'); }}>取回编辑</button></div>}
      </div>
    </li>)}</ul>
    {items.length > 3 && <button type="button" className="queue-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起' : `展开其余 ${items.length - 3} 条`}</button>}
  </div>;
}

export function QueueSend({ disabled, guide }: { disabled: boolean; guide: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('focusin', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('focusin', close); };
  }, [open]);
  return <div ref={root} className="queue-send-picker" onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } }}>
    <button type="submit" disabled={disabled}>排队</button>
    <button ref={button} type="button" className="icon-button" aria-label="选择追加方式" aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)}><MoreHorizontal size={16} aria-hidden="true" /></button>
    {open && <div className="queue-menu"><button type="button" disabled={disabled} onClick={() => { setOpen(false); guide(); }}><CornerDownRight size={15} aria-hidden="true" />引导发送</button></div>}
  </div>;
}
