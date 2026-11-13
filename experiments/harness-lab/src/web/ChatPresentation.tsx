import { useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Brain, ChevronDown, ListChecks } from 'lucide-react';
import type { RequestState, SessionSnapshot } from '../contracts/index';
import type { ChatFocusTransfer } from './useChatItemFocus';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useChatItemFocus } from './useChatItemFocus';
import { Message } from './ChatMessage';
import { SubagentCard, subagentStatus } from './SubagentCard';
import { FileOutputCard, FileOutputGroup } from './Files';
import { InteractionCard } from './InteractionCard';
import { chatBlocks, processLabel, toolActionLabel, turnFoldable, turnDuration, type DisplayItem, type ProcessGroup } from './processGroups';

export type ProcessChoices = Map<string, { open: boolean; manual: boolean; settled: boolean }>;
/** Running groups show only evidenced activity: stopping wins, then compaction, then the current tool. */
function activityLabel(group: ProcessGroup, active: RequestState): string {
  if (active.status === 'stopping') return '正在停止';
  if (active.phase === 'compacting') return '正在压缩上下文';
  if (active.phase === 'tool' && active.toolName) return `正在${toolActionLabel(active.toolName)}`;
  const last = group.items.at(-1);
  if (last?.kind === 'subagent' && (last.child.status === 'running' || last.child.status === 'stopping')) return subagentStatus(last.child);
  return '处理中';
}
function Process({ group, choiceKey, choices, canAutoCollapse, active, children }: { group: ProcessGroup; choiceKey: string; choices: ProcessChoices; canAutoCollapse: () => boolean; active?: RequestState | null; children: ReactNode }) {
  const element = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    const saved = choices.get(choiceKey) || { open: true, manual: false, settled: false };
    if (group.collapsible && !saved.settled) {
      if (!saved.manual && canAutoCollapse() && !node.contains(document.activeElement)) saved.open = false;
      saved.settled = true;
    }
    if (!group.collapsible && !saved.manual) saved.open = true;
    if (node.querySelector(':scope > .process-content')?.contains(document.activeElement)) saved.open = true;
    choices.set(choiceKey, saved);
    node.open = saved.open;
  }, [choices, choiceKey, group.collapsible, canAutoCollapse]);
  const current = active && active.requestId === group.requestId ? active : undefined;
  const running = Boolean(current);
  return <details ref={element} className={`process-group${running ? ' running' : ''}`} data-process-id={group.key}>
    <summary onClick={event => {
      event.preventDefault();
      const node = element.current;
      if (!node) return;
      const open = !node.open;
      choices.set(choiceKey, { open, manual: true, settled: group.collapsible });
      node.open = open;
      event.currentTarget.focus();
    }}><ListChecks size={15} aria-hidden="true" />{current && <span className="status-dot" aria-hidden="true" />}<span>{current ? activityLabel(group, current) : processLabel(group)}</span><ChevronDown size={14} aria-hidden="true" /></summary>
    <div className="process-content">{children}</div>
  </details>;
}
function Thinking({ text, running, focusKey, focusTransfers }: { text: string; running: boolean; focusKey: string; focusTransfers: ChatFocusTransfer }) {
  const ref = useChatItemFocus<HTMLDetailsElement>(focusKey, focusTransfers);
  const lines = text.trim().split(/\n\s*\n/);
  const preview = (running ? lines.at(-1) : lines[0])?.split('\n')[0].replaceAll('**', '') || '';
  return <details ref={ref} className="tool-result thinking-result"><summary><Brain size={15} aria-hidden="true" /><span>思考</span><span className="thinking-preview">{preview}</span><ChevronDown size={14} aria-hidden="true" /></summary><div className="message-content thinking-body"><Markdown remarkPlugins={[remarkGfm]} skipHtml>{text}</Markdown></div></details>;
}
type InteractionProps = ComponentProps<typeof InteractionCard>;
export function ChatPresentation({ snapshot, active, busy, choices, canAutoCollapse, submissions, respond, query }: {
  snapshot: SessionSnapshot; active?: RequestState | null; busy: boolean; choices: ProcessChoices; canAutoCollapse: () => boolean;
  submissions: Record<string, InteractionProps['submission']>; respond: InteractionProps['respond']; query: InteractionProps['query'];
}) {
  const [focusTransfers] = useState<ChatFocusTransfer>(() => new Map());
  const blocks = useMemo(() => chatBlocks(snapshot), [snapshot]);
  const root = useRef<HTMLDivElement>(null);
  const [, redraw] = useState(0);
  const turnKey = (requestId: string) => `${snapshot.id}:turn:${requestId}`;
  useLayoutEffect(() => {
    for (const turn of snapshot.turns || []) {
      const groups = blocks.filter((block): block is ProcessGroup => block.kind === 'process' && block.requestId === turn.requestId);
      const eligible = turnFoldable(snapshot, turn.requestId, groups);
      const key = `${snapshot.id}:turn:${turn.requestId}`;
      const previous = choices.get(key);
      const saved = previous || { open: true, manual: false, settled: false };
      if (!saved.settled && eligible) {
        const hasFocus = [...(root.current?.querySelectorAll<HTMLElement>('[data-turn-process-request]') || [])].some(node => node.dataset.turnProcessRequest === turn.requestId && node.contains(document.activeElement));
        if (!saved.manual && canAutoCollapse() && !hasFocus) saved.open = false;
        saved.settled = true;
      }
      if (!eligible && !saved.open) saved.open = true;
      choices.set(key, saved);
      for (const node of root.current?.querySelectorAll<HTMLElement>('[data-turn-process-request]') || []) if (node.dataset.turnProcessRequest === turn.requestId) node.hidden = eligible && !saved.open;
      for (const button of root.current?.querySelectorAll<HTMLButtonElement>('[data-turn-control]') || []) if (button.dataset.turnControl === turn.requestId && eligible) {
        button.setAttribute('aria-expanded', String(saved.open));
        button.querySelector('svg')?.classList.toggle('expanded', saved.open);
      }
    }
  }, [snapshot, blocks, choices, canAutoCollapse]);
  const render = (item: DisplayItem) => {
    if (item.kind === 'thinking') return <Thinking key={item.key} text={item.text} running={item.running} focusKey={`${snapshot.id}:${item.key}`} focusTransfers={focusTransfers} />;
    if (item.kind === 'file') return <FileOutputCard key={item.key} file={item.file} />;
    if (item.kind === 'interaction') return <InteractionCard key={item.key} interaction={item.interaction} result={item.result} canRespond={item.interaction.status === 'pending' && active?.requestId === item.interaction.requestId && active.status !== 'stopping'} executing={snapshot.interactions?.filter(entry => entry.kind === 'confirmation' && entry.status === 'approved' && entry.execution === undefined && entry.requestId === item.interaction.requestId && entry.toolName === item.interaction.toolName).length === 1 && item.interaction.kind === 'confirmation' && active?.requestId === item.interaction.requestId && active.status !== 'stopping' && active.phase === 'tool' && active.toolName === item.interaction.toolName} submission={submissions[item.interaction.interactionId]} respond={respond} query={query} />;
    if (item.kind === 'subagent') return <SubagentCard key={item.key} focusKey={`${snapshot.id}:${item.key}`} focusTransfers={focusTransfers} child={item.child} parentStopping={active?.requestId === item.child.parentRequestId && active.status === 'stopping'} />;
    return <Message key={item.key} focusKey={`${snapshot.id}:${item.key}`} focusTransfers={focusTransfers} message={item.message} finalAnswer={snapshot.turns?.some(turn=>turn.requestId===item.message.requestId && turn.finalMessageId===item.message.id) && (!item.message.content || item.key === `text:${item.message.content.filter(block => block.type === 'text' && block.text.trim()).at(-1)?.id}`)} evidence={snapshot.messages.slice(0,snapshot.messages.findIndex(message=>message.id===item.message.id))} workspaceId={snapshot.workspaceId} active={busy && item.message.requestId === active?.requestId} />;
  };
  const seen = new Set<string>();
  return <div className="chat-presentation" ref={root}>{blocks.map(block => {
    const requestId = block.kind === 'process' || block.kind === 'files' || block.kind === 'thinking' ? block.requestId : block.kind === 'message' ? block.message.requestId : block.kind === 'interaction' ? block.interaction.requestId : block.kind === 'subagent' ? block.child.parentRequestId : block.file.requestId;
    const turn = snapshot.turns?.find(entry => entry.requestId === requestId);
    const groups = blocks.filter((entry): entry is ProcessGroup => entry.kind === 'process' && entry.requestId === requestId);
    const foldable = requestId ? turnFoldable(snapshot, requestId, groups) : false;
    const open = !foldable || choices.get(turnKey(requestId!))?.open !== false;
    const duration = turnDuration(turn?.startedAt, turn?.completedAt);
    const controlHere = turn && !seen.has(turn.requestId) && (block.kind === 'process' || (!groups.length && block.kind === 'message' && block.message.id === turn.finalMessageId));
    if (controlHere) seen.add(turn.requestId);
    const status = turn?.status === 'succeeded' ? duration ? `已完成，用时 ${duration}` : '已完成' : turn?.status === 'failed' ? '执行失败' : '已停止';
    const control = controlHere ? <button type="button" className="turn-process-control" data-turn-control={turn?.requestId} aria-expanded={groups.length ? open : undefined} disabled={!foldable} onClick={() => {
      const key = turnKey(turn.requestId);
      const currentOpen = choices.get(key)?.open !== false;
      choices.set(key, { open: !currentOpen, manual: true, settled: true });
      if (currentOpen) {
        for (const group of groups) choices.set(`${snapshot.id}:${group.key}`, { open: false, manual: false, settled: true });
        for (const node of root.current?.querySelectorAll<HTMLElement>('[data-turn-process-request]') || []) if (node.dataset.turnProcessRequest === turn.requestId) {
          for (const detail of node.querySelectorAll('details')) detail.open = false;
        }
      }
      redraw(value => value + 1);
    }}>{foldable && <ChevronDown size={14} className={open ? 'expanded' : ''} aria-hidden="true" />}{status}</button> : null;
    return <div className="chat-block" key={block.key}>{control}{block.kind === 'process' ? <div hidden={!open} data-turn-process-request={block.requestId} onClickCapture={event => {
      if ((event.target as HTMLElement).closest('summary')) {
        choices.set(`${snapshot.id}:${block.key}`, { open: true, manual: true, settled: block.collapsible });
        const key = turnKey(block.requestId);
        choices.set(key, { open: true, manual: true, settled: choices.get(key)?.settled || false });
      }
    }}><Process group={block} choiceKey={`${snapshot.id}:${block.key}`} choices={choices} canAutoCollapse={canAutoCollapse} active={active}>{block.items.map(render)}</Process></div> : block.kind === 'files' ? <FileOutputGroup files={block.files} /> : render(block)}</div>;
  })}</div>;
}
