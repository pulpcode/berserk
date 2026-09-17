import { ChevronDown, GitBranch } from 'lucide-react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PublicMessage, SubagentSummary } from '../contracts/index';

const markdownComponents: Components = {
  table: ({ children }) => <div className="markdown-table" role="region" aria-label="子任务结果表格，可横向滚动" tabIndex={0}><table>{children}</table></div>,
};

export function subagentStatus(child: SubagentSummary, parentStopping = false): string {
  if (child.status === 'succeeded') return '已完成';
  if (child.status === 'failed') return '执行失败';
  if (child.status === 'cancelled') return '已取消';
  if (child.status === 'interrupted') return '执行中断';
  if (parentStopping || child.status === 'stopping') return '正在停止';
  if (child.phase === 'compacting') return '正在压缩上下文';
  if (child.phase === 'retrying') return '正在重试';
  if (child.phase === 'preparing') return '正在准备';
  if (child.phase === 'tool') {
    const tool = child.toolName?.replaceAll('_', '.');
    if (tool === 'source.list' || tool === 'source.read') return '正在读取资料';
    if (tool === 'instructions.read') return '正在读取指令';
    if (tool === 'skill.read') return '正在读取 Skill';
    return '正在使用工具';
  }
  return '正在处理';
}

export function SubagentCard({ child, parentStopping }: { child: SubagentSummary; parentStopping: boolean }) {
  const status = subagentStatus(child, parentStopping);
  const failed = child.status === 'failed' || child.status === 'interrupted';
  const running = child.status === 'running' || child.status === 'stopping';
  return <details className={`subagent-card${failed ? ' failed' : ''}`} data-subagent-id={child.subagentId}>
    <summary aria-label={`${child.role} 子任务：${status}`}><GitBranch size={16} aria-hidden="true" /><strong>{child.role}</strong><span className={`subagent-status${running ? ' running' : ''}`}>{running && <span className="status-dot" />}{status}</span><ChevronDown className="subagent-chevron" size={15} aria-hidden="true" /></summary>
    <div className="subagent-body">
      <p className="subagent-description">{child.description}</p>
      <h4>本次任务</h4><p className="subagent-task">{child.task}</p>
      {running && <p className="subagent-progress">{status}。完成后主 Agent 将继续处理。</p>}
      {child.status === 'succeeded' && <><h4>执行结果</h4><div className="message-content subagent-result"><Markdown remarkPlugins={[remarkGfm]} components={markdownComponents} skipHtml>{child.result || '未记录可展示的结果。'}</Markdown></div></>}
      {(failed || child.status === 'cancelled') && <p className="subagent-error">{child.error || (child.status === 'interrupted' ? '执行中断，未自动重新委派。' : child.status === 'cancelled' ? '本次子任务已取消。' : '子任务未能完成，请查看主回复中的处理说明。')}</p>}
    </div>
  </details>;
}

type ConversationItem = { kind: 'message'; key: string; message: PublicMessage } | { kind: 'subagent'; key: string; child: SubagentSummary };
/** Keep child evidence at its owning tool position, including native histories after reload. */
export function conversationItems(messages: PublicMessage[], subagents: SubagentSummary[], activeRequestId?: string): ConversationItem[] {
  const children = [...new Map(subagents.map(child => [child.subagentId, child])).values()];
  const byTool = new Map(children.map(child => [child.toolCallId, child]));
  const byRequest = new Map<string, SubagentSummary[]>();
  for (const child of children) byRequest.set(child.parentRequestId, [...(byRequest.get(child.parentRequestId) || []), child]);
  const childForMessage = (message: PublicMessage) => {
    if (message.role !== 'tool' || message.toolName !== 'subagent') return undefined;
    const child = byTool.get(message.toolCallId || message.id);
    return child && (!message.requestId || message.requestId === child.parentRequestId) ? child : undefined;
  };
  const anchored = new Set<string>();
  const lastRequestIndex = new Map<string, number>();
  messages.forEach((message, index) => {
    if (message.requestId) lastRequestIndex.set(message.requestId, index);
    const child = childForMessage(message);
    if (child) anchored.add(child.subagentId);
  });
  const rendered = new Set<string>();
  const items: ConversationItem[] = [];
  const add = (child: SubagentSummary) => { if (!rendered.has(child.subagentId)) { rendered.add(child.subagentId); items.push({ kind: 'subagent', key: `child:${child.subagentId}`, child }); } };
  messages.forEach((message, index) => {
    const child = childForMessage(message);
    if (child) add(child);
    else items.push({ kind: 'message', key: `message:${message.id}`, message });
    // A start/interruption record can precede the native tool-result message.
    if (message.requestId && lastRequestIndex.get(message.requestId) === index) {
      (byRequest.get(message.requestId) || []).filter(child => !anchored.has(child.subagentId)).forEach(add);
    }
  });
  // During preparation a stream can have a child update before its first projected message.
  if (activeRequestId) (byRequest.get(activeRequestId) || []).filter(child => !anchored.has(child.subagentId)).forEach(add);
  return items;
}
