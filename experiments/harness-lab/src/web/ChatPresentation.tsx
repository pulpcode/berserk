import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { ChevronDown, ListChecks } from 'lucide-react';
import type { RequestState, SessionSnapshot } from '../contracts/index';
import type { ChatFocusTransfer } from './useChatItemFocus';
import { Message } from './ChatMessage';
import { SubagentCard } from './SubagentCard';
import { FileOutputCard } from './Files';
import { InteractionCard } from './InteractionCard';
import { chatBlocks, processLabel, type DisplayItem, type ProcessGroup } from './processGroups';

export type ProcessChoices = Map<string, { open: boolean; manual: boolean; settled: boolean }>;
function Process({ group, choiceKey, choices, canAutoCollapse, children }: { group: ProcessGroup; choiceKey: string; choices: ProcessChoices; canAutoCollapse: () => boolean; children: ReactNode }) {
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
  return <details ref={element} className="process-group" data-process-id={group.key}>
    <summary onClick={event => {
      event.preventDefault();
      const node = element.current;
      if (!node) return;
      const open = !node.open;
      choices.set(choiceKey, { open, manual: true, settled: group.collapsible });
      node.open = open;
      event.currentTarget.focus();
    }}><ListChecks size={15} aria-hidden="true" /><span>{processLabel(group)}</span><ChevronDown size={14} aria-hidden="true" /></summary>
    <div className="process-content">{children}</div>
  </details>;
}
type InteractionProps = ComponentProps<typeof InteractionCard>;
export function ChatPresentation({ snapshot, active, busy, choices, canAutoCollapse, submissions, respond, query }: {
  snapshot: SessionSnapshot; active?: RequestState | null; busy: boolean; choices: ProcessChoices; canAutoCollapse: () => boolean;
  submissions: Record<string, InteractionProps['submission']>; respond: InteractionProps['respond']; query: InteractionProps['query'];
}) {
  const [focusTransfers] = useState<ChatFocusTransfer>(() => new Map());
  const blocks = chatBlocks(snapshot);
  const render = (item: DisplayItem) => {
    if (item.kind === 'file') return <FileOutputCard key={item.key} file={item.file} />;
    if (item.kind === 'interaction') return <InteractionCard key={item.key} interaction={item.interaction} result={item.result} canRespond={item.interaction.status === 'pending' && active?.requestId === item.interaction.requestId && active.status !== 'stopping'} submission={submissions[item.interaction.interactionId]} respond={respond} query={query} />;
    if (item.kind === 'subagent') return <SubagentCard key={item.key} focusKey={`${snapshot.id}:${item.key}`} focusTransfers={focusTransfers} child={item.child} parentStopping={active?.requestId === item.child.parentRequestId && active.status === 'stopping'} />;
    return <Message key={item.key} focusKey={`${snapshot.id}:${item.key}`} focusTransfers={focusTransfers} message={item.message} workspaceId={snapshot.workspaceId} active={busy && item.message.requestId === active?.requestId} />;
  };
  return <>{blocks.map(block => block.kind === 'process' ? <Process key={block.key} group={block} choiceKey={`${snapshot.id}:${block.key}`} choices={choices} canAutoCollapse={canAutoCollapse}>{block.items.map(render)}</Process> : render(block))}</>;
}
