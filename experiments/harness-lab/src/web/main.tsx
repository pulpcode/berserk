import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDown, ArrowUp, ArrowUpRight, BookOpen, Check, ChevronDown, CircleAlert, FileText, Menu, MessageSquare, Plus, RefreshCw, Square, X, Zap } from 'lucide-react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PublicMessage } from '../contracts/index';
import { useChat } from './useChat';
import './styles.css';

const markdownComponents: Components = {
  table: ({ children }) => <div className="markdown-table" role="region" aria-label="回复表格，可横向滚动" tabIndex={0}><table>{children}</table></div>,
};

function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark${small ? ' small' : ''}`} aria-hidden="true"><Zap size={small ? 16 : 23} strokeWidth={2.3} /></span>;
}

function Message({ message, active }: { message: PublicMessage; active: boolean }) {
  if (message.role === 'tool') return <details className={`tool-result${message.isError ? ' failed' : ''}`}>
    <summary><FileText size={16} aria-hidden="true" /><span>{message.text ? (message.isError ? '资料读取失败' : '已读取资料') : active ? '正在读取资料' : '资料读取未完成'}</span><ChevronDown size={14} aria-hidden="true" /></summary>
    <div className="tool-body"><span className="tool-label">{message.toolName}</span><pre>{message.text || (active ? '等待返回内容…' : '没有可用的返回内容。')}</pre></div>
  </details>;
  return <article className={`message ${message.role}`} aria-label={message.role === 'user' ? '你的消息' : 'Berserk 的回复'}>
    {message.role === 'assistant' && <div className="message-author"><BrandMark small /><span>Berserk</span></div>}
    <div className="message-content">{message.role === 'user' ? <p>{message.text}</p> : <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{message.text}</Markdown>}</div>
  </article>;
}

function App() {
  const chat = useChat();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [newContent, setNewContent] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const follow = useRef(true);
  const composing = useRef(false);
  const snapshot = chat.snapshots[chat.selected];
  const active = snapshot?.active;
  const busy = Boolean(active || chat.pending || chat.creating);
  const loadingSession = Boolean(chat.selected && !snapshot);
  const status = active?.status === 'stopping' ? '正在停止' : busy ? '回复中' : snapshot?.lastResult?.status === 'cancelled' ? '已停止' : snapshot?.lastResult?.status === 'succeeded' ? '回复完成' : snapshot?.lastResult?.status === 'failed' ? '回复未完成' : '可以开始对话';
  const messages = snapshot?.messages || [];
  const lastMessage = messages.at(-1);
  const error = chat.error || (snapshot?.lastResult?.status === 'failed' ? snapshot.lastResult.message || '本次回复未完成，请调整后重试。' : '');
  const canSend = !busy && !loadingSession && !chat.loading && Boolean(chat.info?.configured) && !snapshot?.recoveryWarning && Boolean(chat.draft.trim());

  useEffect(() => {
    const input = textarea.current;
    if (input) { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 180)}px`; }
  }, [chat.draft]);
  useEffect(() => {
    follow.current = true;
    const frame = requestAnimationFrame(() => {
      setNewContent(false);
      if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [chat.selected]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
      else if (busy) setNewContent(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [messages.length, lastMessage?.text, busy]);
  useEffect(() => {
    const desktop = matchMedia('(min-width: 768px)');
    const resize = () => { if (desktop.matches) setSidebarOpen(false); };
    desktop.addEventListener('change', resize);
    return () => desktop.removeEventListener('change', resize);
  }, []);
  useEffect(() => {
    if (!sidebarOpen) return;
    closeButton.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSidebarOpen(false); requestAnimationFrame(() => menuButton.current?.focus()); }
      if (event.key !== 'Tab') return;
      const items = sidebar.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary');
      if (!items?.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, [sidebarOpen]);

  function closeSidebar() { setSidebarOpen(false); requestAnimationFrame(() => menuButton.current?.focus()); }
  function suggest(text: string) { chat.setDraft(text); textarea.current?.focus(); }
  function selectSession(id: string) {
    chat.select(id); setSidebarOpen(false);
    if (sidebarOpen) requestAnimationFrame(() => textarea.current?.focus());
  }
  async function newChat() {
    const id = await chat.create();
    if (id) { setSidebarOpen(false); requestAnimationFrame(() => textarea.current?.focus()); }
  }

  return <div className="app-shell">
    <a className="skip-link" href="#conversation">跳至对话</a>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="关闭会话列表" onClick={closeSidebar} tabIndex={-1} />}
    <aside ref={sidebar} className={`sidebar${sidebarOpen ? ' open' : ''}`} aria-label="会话与资料">
      <div className="sidebar-brand"><BrandMark /><span>Berserk<span className="brand-subtitle">对话工作台</span></span><button ref={closeButton} className="icon-button mobile-only" onClick={closeSidebar} aria-label="关闭会话列表"><X size={20} /></button></div>
      <button className="new-chat" onClick={() => void newChat()} disabled={chat.creating || chat.loading}><Plus size={18} aria-hidden="true" />新建对话<span className="button-hint">开始新的想法</span></button>
      <div className="section-label">你的对话<span>{chat.sessions.length.toString().padStart(2, '0')}</span></div>
      <nav className="session-list" aria-label="会话列表">
        {chat.loading ? <p className="sidebar-empty">正在加载对话…</p> : chat.sessions.length === 0 ? <p className="sidebar-empty">从一条消息开始。<br />你的对话会保存在这里。</p> : chat.sessions.map(session => <button key={session.id} className={`session-item${session.id === chat.selected ? ' selected' : ''}`} aria-current={session.id === chat.selected ? 'page' : undefined} onClick={() => selectSession(session.id)}>
          <MessageSquare size={16} aria-hidden="true" /><span title={session.title}>{session.title}</span>{chat.snapshots[session.id]?.active && <span className="session-activity" aria-label="回复中" />}
        </button>)}
      </nav>
      <details className="sources" open>
        <summary><BookOpen size={16} aria-hidden="true" /><span>可用资料</span><ChevronDown size={14} aria-hidden="true" /></summary>
        <p>对话时可按需读取，作为回答的依据。</p>
        {chat.info?.sources.map(source => <button key={source.id} className="source-item" onClick={() => { suggest(`请读取《${source.title}》，梳理其中的关键信息。`); setSidebarOpen(false); requestAnimationFrame(() => textarea.current?.focus()); }} title={source.description}>
          <FileText size={15} aria-hidden="true" /><span>{source.title}<small>{source.description}</small></span><ArrowUpRight size={13} aria-hidden="true" />
        </button>)}
      </details>
      <div className="sidebar-footer"><span className="local-avatar">L</span><div>本地工作空间<small>对话独立保存</small></div></div>
    </aside>

    <main className="workspace" inert={sidebarOpen || undefined}>
      <header className="workspace-header">
        <div className="header-title"><button ref={menuButton} className="icon-button mobile-only" onClick={() => setSidebarOpen(true)} aria-label="打开会话列表" aria-expanded={sidebarOpen}><Menu size={20} /></button><span>{snapshot?.title || '新对话'}</span></div>
        <span className={`model-badge${chat.info?.configured ? '' : ' unconfigured'}`}><span className="status-dot" />{chat.info?.model || '模型配置'}<span className="model-state">{chat.info?.configured ? '已配置' : '待配置'}</span></span>
      </header>

      <div id="conversation" className="conversation-scroll" ref={scroll} tabIndex={0} aria-label="对话内容" onScroll={() => {
        const element = scroll.current;
        if (!element) return;
        follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
        if (follow.current) setNewContent(false);
      }}>
        {loadingSession || chat.loading ? <div className="loading-conversation" role="status"><span className="loading-dot" />正在读取会话…</div> : messages.length === 0 ? <div className="empty-state">
          <div className="welcome-symbol"><BrandMark /></div>
          <p className="eyebrow">想法，从这里展开</p>
          <h1>今天，我们一起处理什么？</h1>
          <p className="welcome-copy">说出你的目标，随时追问、补充或调整。<br />从梳理信息，到形成清晰的思路。</p>
          <div className="suggestions">
            <button onClick={() => suggest('我想梳理一个问题，请先帮我明确目标和需要补充的信息。')}><MessageSquare size={19} aria-hidden="true" /><strong>一起梳理思路</strong><span>从一个问题开始讨论</span><ArrowUpRight size={15} aria-hidden="true" /></button>
            {chat.info?.sources[0] && <button onClick={() => suggest(`请读取《${chat.info?.sources[0]?.title}》，提炼要点，并说明信息依据。`)}><BookOpen size={19} aria-hidden="true" /><strong>从资料中找线索</strong><span>读取资料，提炼关键信息</span><ArrowUpRight size={15} aria-hidden="true" /></button>}
          </div>
        </div> : <div className="message-list">{messages.map(message => <Message key={message.id} message={message} active={busy} />)}{busy && lastMessage?.role !== 'assistant' && <div className="thinking"><BrandMark small /><span>{active?.status === 'stopping' ? '正在停止本次回复…' : '正在思考…'}</span><span className="loading-dot" /></div>}</div>}
      </div>

      <div className="composer-dock">
        {newContent && <button className="new-content" onClick={() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; follow.current = true; setNewContent(false); }}><ArrowDown size={15} aria-hidden="true" />有新内容</button>}
        <div className="composer-container">
          {!chat.loading && !chat.info?.configured && <div className="notice configuration-notice"><CircleAlert size={16} aria-hidden="true" /><span>模型尚未配置，完成配置后即可开始对话。</span><button onClick={() => void chat.bootstrap()} aria-label="重新检查模型配置"><RefreshCw size={15} /></button></div>}
          {snapshot?.recoveryWarning && <div className="notice error-notice" role="alert"><CircleAlert size={17} aria-hidden="true" /><span>{snapshot.recoveryWarning}</span><button onClick={() => void newChat()}>新建对话</button></div>}
          {error && <div className="notice error-notice" role="alert"><CircleAlert size={17} aria-hidden="true" /><span>{error}</span><button onClick={() => void (chat.selected ? chat.refresh(chat.selected) : chat.bootstrap())}>查询状态</button></div>}
          {error && chat.submitted && chat.draft !== chat.submitted && <button className="restore-draft" onClick={chat.restoreSubmitted}>恢复刚才发送的内容</button>}
          <form className="composer" onSubmit={event => { event.preventDefault(); if (canSend) void chat.send(); }}>
            <label htmlFor="message-input">发送消息</label>
            <textarea id="message-input" ref={textarea} rows={2} value={chat.draft} placeholder="描述你的问题，或继续补充想法…" aria-describedby="input-hint" onChange={event => chat.setDraft(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !composing.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                event.preventDefault();
                if (canSend) void chat.send();
              }
            }} />
            <div className="composer-toolbar">{busy && <span className="composer-context"><MessageSquare size={14} aria-hidden="true" />可继续编辑，回复结束后发送</span>}{busy ? <button type="button" className="stop-button" disabled={!active || active.status === 'stopping'} onClick={() => void chat.cancel()}><Square size={13} fill="currentColor" aria-hidden="true" />{active?.status === 'stopping' ? '正在停止' : '停止回复'}</button> : <button type="submit" className="send-button" aria-label="发送消息" disabled={!canSend}><ArrowUp size={20} aria-hidden="true" /></button>}</div>
          </form>
          <div className="composer-footnote"><span className={`request-status${busy ? ' active' : ''}`} role="status" aria-live="polite">{busy ? <span className="loading-dot" /> : snapshot?.lastResult?.status === 'succeeded' ? <Check size={12} aria-hidden="true" /> : <span className="status-dot" />}{status}</span><span id="input-hint">Enter 发送<span className="shortcut-divider"> · </span>Shift + Enter 换行</span></div>
        </div>
      </div>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
