import type { ReactNode, Ref } from 'react';
import { PanelLeftClose, PanelLeftOpen, Settings, X } from 'lucide-react';

export function BrandMark({ small = false }: { small?: boolean }) {
  return <img className={`brand-mark${small ? ' small' : ''}`} src="/brand/axon-app-icon.svg" width={small ? 27 : 38} height={small ? 27 : 38} alt="" aria-hidden="true" />;
}

/** Shared Axon navigation chrome; callers supply only their permitted entries. */
export function ApplicationSidebar({ id, sidebarRef, closeButtonRef, open, collapsed, toggleCollapsed, close, settingsOpen, openSettings, children }: {
  id: string; sidebarRef?: Ref<HTMLElement>; closeButtonRef?: Ref<HTMLButtonElement>;
  open: boolean; collapsed: boolean; toggleCollapsed: () => void; close: () => void;
  settingsOpen: boolean; openSettings: () => void; children: ReactNode;
}) {
  return <aside id={id} ref={sidebarRef} className={`sidebar${open ? ' open' : ''}`} aria-label="会话与资料">
    <div className="sidebar-brand"><BrandMark /><img className="brand-wordmark" src="/brand/axon-wordmark.svg" width="81" height="27" alt="Axon" /><button className="icon-button sidebar-toggle" onClick={toggleCollapsed} aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'} title={collapsed ? '展开侧边栏' : '折叠侧边栏'} aria-expanded={!collapsed} aria-controls={id}>{collapsed ? <><BrandMark /><PanelLeftOpen size={20} aria-hidden="true" /></> : <PanelLeftClose size={20} aria-hidden="true" />}</button><button ref={closeButtonRef} className="icon-button mobile-only" onClick={close} aria-label="关闭会话列表"><X size={20} /></button></div>
    {children}
    <div className="sidebar-footer"><button className="settings-trigger" title="设置" aria-label="设置" onClick={openSettings} aria-haspopup="dialog" aria-expanded={settingsOpen}><Settings size={18} aria-hidden="true" /><span>设置</span></button></div>
  </aside>;
}
