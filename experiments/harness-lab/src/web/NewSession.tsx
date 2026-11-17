import { useId, useLayoutEffect, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { BriefcaseBusiness, Check, ChevronDown, Folder, Plus, UserRound } from 'lucide-react';
import type { Workspace } from '../contracts/index';

/** The ordinary chat draft owns space selection; opening it writes no conversation. */
export function NewSession({ workspaces, workspaceId, taskMeta, choosing, choose, createPersonal, createTask }: {
  workspaces: Workspace[]; workspaceId: string; choosing: boolean; choose: (workspaceId: string) => void;
  taskMeta?: Record<string, { visibility: 'public' | 'private' }>;
  createPersonal: () => void; createTask?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const firstFocus = useRef<'selected' | 'first' | 'last'>('selected');
  const menuId = useId();
  const current = workspaces.find(workspace => workspace.id === workspaceId);
  const currentVisibility = current && taskMeta?.[current.id]?.visibility;
  const CurrentIcon = currentVisibility === 'public' ? BriefcaseBusiness : currentVisibility === 'private' ? UserRound : Folder;
  const groups = [{ visibility: 'public', label: '任务空间', Icon: BriefcaseBusiness }, { visibility: 'private', label: '个人空间', Icon: UserRound }, { visibility: undefined, label: '空间', Icon: Folder }]
    .map(group => ({ ...group, workspaces: workspaces.filter(workspace => taskMeta?.[workspace.id]?.visibility === group.visibility) })).filter(group => group.workspaces.length);
  const visible = open && !choosing;
  const items = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') || []);

  useLayoutEffect(() => {
    if (!visible) return;
    const choices = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') || []);
    const selected = choices.find(item => item.getAttribute('aria-checked') === 'true');
    (firstFocus.current === 'last' ? choices.at(-1) : firstFocus.current === 'first' ? choices[0] : selected || choices[0])?.focus();
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const outside = (event: Event) => {
      if (root.current?.contains(event.target as Node)) return;
      setOpen(false);
      if (event.type === 'pointerdown') trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [visible]);

  function dismiss() { setOpen(false); trigger.current?.focus(); }
  function show(focus: 'selected' | 'first' | 'last') { firstFocus.current = focus; setOpen(true); }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); return; }
    const choices = items(), index = choices.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length;
      choices[next]?.focus();
    } else if (event.key === 'Tab') {
      event.preventDefault(); setOpen(false);
      const controls = Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')).filter(item => item.tabIndex >= 0 && !item.matches(':disabled') && item.getClientRects().length && !menu.current?.contains(item));
      const next = controls[controls.indexOf(trigger.current!) + (event.shiftKey ? -1 : 1)];
      (next || trigger.current)?.focus();
    }
  }
  return <div ref={root} className="new-chat-space" aria-label="新对话空间">
    <button ref={trigger} type="button" className="new-chat-space-trigger" aria-label="对话保存位置" title={current?.name || '选择空间'} aria-haspopup="menu" aria-expanded={visible} aria-controls={visible ? menuId : undefined} disabled={choosing} onClick={() => visible ? dismiss() : show('selected')} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(event.key === 'ArrowDown' ? 'first' : 'last'); }
    }}><CurrentIcon size={17} aria-hidden="true" />{currentVisibility && <span className="new-chat-space-type">{currentVisibility === 'public' ? '任务' : '个人'}</span>}<span className="new-chat-space-name">{current?.name || '选择空间'}</span><ChevronDown size={14} aria-hidden="true" /></button>
    {visible && <div ref={menu} id={menuId} className="new-chat-space-menu" role="menu" aria-label="选择空间" onKeyDown={keyboard}>
      {!!groups.length && <div className="new-chat-space-options">{groups.map(({ visibility, label, Icon, workspaces: entries }) => <div key={visibility || 'space'} className="new-chat-space-group" role="group" aria-label={label}><div className="new-chat-space-group-title">{label}</div>{entries.map(workspace => <button type="button" key={workspace.id} role="menuitemradio" aria-checked={workspace.id === workspaceId} title={workspace.name} onClick={() => { dismiss(); choose(workspace.id); }}><Icon size={16} aria-hidden="true" /><span>{workspace.name}</span>{workspace.id === workspaceId && <Check size={15} aria-hidden="true" />}</button>)}</div>)}</div>}
      {!!workspaces.length && <div className="new-chat-space-divider" role="separator" />}
      <div className="new-chat-space-actions">{createTask && <button type="button" role="menuitem" onClick={() => { dismiss(); createTask(); }}><Plus size={16} aria-hidden="true" /><span>新建任务空间</span></button>}<button type="button" role="menuitem" onClick={() => { dismiss(); createPersonal(); }}><Plus size={16} aria-hidden="true" /><span>新建个人空间</span></button></div>
    </div>}
  </div>;
}
