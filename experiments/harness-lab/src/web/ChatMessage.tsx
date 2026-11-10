import { createContext, useContext, type ReactNode } from 'react';
import { ChevronDown, Terminal, PencilLine, Wrench } from 'lucide-react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PublicMessage } from '../contracts/index';
import { HistoricalFile } from './Files';
import { useChatItemFocus, type ChatFocusTransfer } from './useChatItemFocus';
import { MapLink, EvidenceMapLinks } from './situation/MapContext';
import { requestMapEvidence } from './situation/evidence';
import { AnnotationHistoryLinks } from './situation/MapContext';
import { SelectionHistory } from './ComposerReferences';
import { ResourceResultCard } from './ResourceResultCard';
import { toolActionLabel } from './processGroups';
import { resourceResultValid } from '../contracts/resource-results';
const MarkdownEvidence = createContext<PublicMessage[]>([]);
function EvidenceLink({href,children}:{href?:string;children?:ReactNode}) {
  const evidence=useContext(MarkdownEvidence);
  return <MapLink href={href} messages={evidence} external>{children}</MapLink>;
}
const markdownComponents: Components = {
  a: EvidenceLink,
  table: ({ children }) => <div className="markdown-table" role="region" aria-label="回复表格，可横向滚动" tabIndex={0}><table>{children}</table></div>,
};
export function Message({ message, active, workspaceId, focusKey, focusTransfers, evidence = [], finalAnswer = false }: { finalAnswer?: boolean; evidence?: PublicMessage[]; message: PublicMessage; active: boolean; workspaceId: string; focusKey: string; focusTransfers: ChatFocusTransfer }) {
  const focusRef = useChatItemFocus<HTMLElement>(focusKey, focusTransfers);
  if (message.role === 'tool' && message.toolName === 'subagent') return <p className="subagent-placeholder">{message.isError ? 'Agent 任务未完成，请查看回复中的说明。' : message.text || !active ? '未记录可展示的 Agent 任务详情。' : '正在准备 Agent 任务…'}</p>;
  const action = toolActionLabel(message.toolName);
  // Match the executor's exact cancellation response, including old history and optional archived log.
  // A nonzero exit, timeout or cleanup failure must keep its failure label even in a cancelled request.
  const cancelled = message.toolName === 'bash' && message.isError && /^命令已取消(?:。|；已保存文件不会回滚。)(?:\n已保留命令日志：\/logs\/[0-9a-f-]{36}\/[0-9a-f]{64}\.log)?$/.test(message.text);
  const ToolIcon = message.toolName === 'bash' ? Terminal : message.toolName === 'write' || message.toolName === 'edit' ? PencilLine : Wrench;
  if (message.role === 'tool') return <details ref={focusRef as React.RefObject<HTMLDetailsElement>} className={`tool-result${message.isError && !cancelled ? ' failed' : ''}`}>
    <summary><ToolIcon size={15} aria-hidden="true" /><span>{message.resultMissing ? '未收到执行结果' : cancelled ? '命令已停止' : message.text ? (message.isError ? `${action}失败` : `已${action}`) : active ? `正在${action}` : `${action}未完成`}</span><ChevronDown size={14} aria-hidden="true" /></summary>
    {!message.isError&&!message.resultMissing&&message.toolName==='task_resource_query'&&resourceResultValid(message.resourceResult)&&<ResourceResultCard key={message.resourceResult.resultRef} result={message.resourceResult}/>}<EvidenceMapLinks messages={[message]}/><div className="tool-body"><span className="tool-label">{message.toolName}</span><pre>{message.text || (active ? '等待返回内容…' : '没有可用的返回内容。')}</pre></div>
  </details>;
  return <article ref={focusRef} className={`message ${message.role}`} aria-label={message.role === 'user' ? '你的消息' : 'Axon 的回复'}>
    <div className="message-content">{message.role === 'user' ? <><p>{message.text}</p><SelectionHistory selections={message.selections} /><AnnotationHistoryLinks message={message}/><EvidenceMapLinks messages={[message]}/>{message.attachments?.length ? <ul className="message-attachments" aria-label="本条消息引用的文件">{message.attachments.map((file, index) => <HistoricalFile key={`${workspaceId}:${file.path}:${file.hash}:${index}`} file={file} workspaceId={workspaceId} />)}</ul> : null}</> : <MarkdownEvidence.Provider value={evidence}><Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{message.text}</Markdown>{finalAnswer && <EvidenceMapLinks messages={requestMapEvidence(message,evidence)}/>}</MarkdownEvidence.Provider>}</div>
  </article>;
}
