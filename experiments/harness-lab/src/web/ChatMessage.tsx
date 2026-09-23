import { ChevronDown, Terminal, PencilLine, Wrench } from 'lucide-react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PublicMessage } from '../contracts/index';
import { HistoricalFile } from './Files';
import { useChatItemFocus, type ChatFocusTransfer } from './useChatItemFocus';
import { SelectionHistory } from './ComposerReferences';
const markdownComponents: Components = {
  table: ({ children }) => <div className="markdown-table" role="region" aria-label="回复表格，可横向滚动" tabIndex={0}><table>{children}</table></div>,
};
export function Message({ message, active, workspaceId, focusKey, focusTransfers }: { message: PublicMessage; active: boolean; workspaceId: string; focusKey: string; focusTransfers: ChatFocusTransfer }) {
  const focusRef = useChatItemFocus<HTMLElement>(focusKey, focusTransfers);
  if (message.role === 'tool' && message.toolName === 'subagent') return <p className="subagent-placeholder">{message.isError ? 'Agent 任务未完成，请查看回复中的说明。' : message.text || !active ? '未记录可展示的 Agent 任务详情。' : '正在准备 Agent 任务…'}</p>;
  const fileActions: Record<string, string> = { read: '读取文件', write: '写入文件', edit: '修改文件', bash: '执行命令', ls: '列出文件', find: '查找文件', file_output: '提供文件', work_item_list: '查看工作待办', work_item_read: '查看工作详情', work_item_action: '工作交接', work_item_prepare: '准备交接', work_item_commit: '执行交接', handoff_import_file: '复制交接文件', 'work_item.list': '查看工作待办', 'work_item.read': '查看工作详情', 'work_item.prepare': '准备交接', 'work_item.commit': '执行交接', 'handoff.import_file': '复制交接文件' };
  const action = (message.toolName && fileActions[message.toolName]) || (message.toolName === 'instructions.update' ? '更新指令' : message.toolName === 'instructions.read' ? '读取指令' : message.toolName === 'skill.read' ? '读取 Skill' : message.toolName === 'source.read' || message.toolName === 'source.list' ? '读取资料' : '调用工具');
  // Match the executor's exact cancellation response, including old history and optional archived log.
  // A nonzero exit, timeout or cleanup failure must keep its failure label even in a cancelled request.
  const cancelled = message.toolName === 'bash' && message.isError && /^命令已取消(?:。|；已保存文件不会回滚。)(?:\n已保留命令日志：\/logs\/[0-9a-f-]{36}\/[0-9a-f]{64}\.log)?$/.test(message.text);
  const ToolIcon = message.toolName === 'bash' ? Terminal : message.toolName === 'write' || message.toolName === 'edit' ? PencilLine : Wrench;
  if (message.role === 'tool') return <details ref={focusRef as React.RefObject<HTMLDetailsElement>} className={`tool-result${message.isError && !cancelled ? ' failed' : ''}`}>
    <summary><ToolIcon size={15} aria-hidden="true" /><span>{message.resultMissing ? '未收到执行结果' : cancelled ? '命令已停止' : message.text ? (message.isError ? `${action}失败` : `已${action}`) : active ? `正在${action}` : `${action}未完成`}</span><ChevronDown size={14} aria-hidden="true" /></summary>
    <div className="tool-body"><span className="tool-label">{message.toolName}</span><pre>{message.text || (active ? '等待返回内容…' : '没有可用的返回内容。')}</pre></div>
  </details>;
  return <article ref={focusRef} className={`message ${message.role}`} aria-label={message.role === 'user' ? '你的消息' : 'Axon 的回复'}>
    <div className="message-content">{message.role === 'user' ? <><p>{message.text}</p><SelectionHistory selections={message.selections} />{message.attachments?.length ? <ul className="message-attachments" aria-label="本条消息引用的文件">{message.attachments.map((file, index) => <HistoricalFile key={`${workspaceId}:${file.path}:${file.hash}:${index}`} file={file} workspaceId={workspaceId} />)}</ul> : null}</> : <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{message.text}</Markdown>}</div>
  </article>;
}
