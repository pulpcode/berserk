import type { FileOutput, PublicMessage, SessionSnapshot } from '../contracts/index';
import { conversationItems, type ConversationItem } from './SubagentCard';

export type DisplayItem = ConversationItem | { kind: 'file'; key: string; file: FileOutput };
export type ProcessGroup = { kind: 'process'; key: string; requestId: string; items: DisplayItem[]; collapsible: boolean; tools: number; agents: number; notes: number };
export type ChatBlock = DisplayItem | ProcessGroup;
const requestOf = (item: DisplayItem) => item.kind === 'message' ? item.message.requestId : item.kind === 'subagent' ? item.child.parentRequestId : item.kind === 'interaction' ? item.interaction.requestId : item.file.requestId;
const matchesOutput = (message: PublicMessage, file: FileOutput) => message.role === 'tool' && message.toolName === 'file_output' && message.requestId === file.requestId && message.toolCallId === file.toolCallId;

/** Presentation only: native evidence controls completion; boundaries never reorder items. */
export function chatBlocks(snapshot: SessionSnapshot): ChatBlock[] {
  const files = [...new Map((snapshot.fileOutputs || []).map(file => [file.downloadId, file])).values()];
  const items: DisplayItem[] = [];
  const usedFiles = new Set<string>();
  for (const item of conversationItems(snapshot.messages, snapshot.subagents || [], snapshot.active?.requestId, snapshot.interactions || [])) {
    const outputs = item.kind === 'message' ? files.filter(file => matchesOutput(item.message, file)) : [];
    if (!outputs.length || (item.kind === 'message' && item.message.isError)) items.push(item);
    for (const file of outputs) if (!usedFiles.has(file.downloadId)) {
      usedFiles.add(file.downloadId); items.push({ kind: 'file', key: `file:${file.downloadId}`, file });
    }
  }
  for (const file of files) if (!usedFiles.has(file.downloadId)) items.push({ kind: 'file', key: `file:${file.downloadId}`, file });
  const finals = new Map((snapshot.turns || []).filter(turn => turn.status === 'succeeded' && turn.requestId !== snapshot.active?.requestId && snapshot.messages.some(message => message.id === turn.finalMessageId && message.requestId === turn.requestId && message.role === 'assistant' && message.text.trim())).map(turn => [turn.requestId, turn.finalMessageId]));
  const lastMessage = new Map<string, string>();
  for (const message of snapshot.messages) if (message.requestId) lastMessage.set(message.requestId, message.id);
  const blocks: ChatBlock[] = [];
  for (const item of items) {
    const requestId = requestOf(item);
    const process = requestId && (item.kind === 'subagent' ? ['running', 'stopping', 'succeeded'].includes(item.child.status) : item.kind === 'message' && (item.message.role === 'tool' ? !item.message.isError && !item.message.resultMissing && item.message.toolName !== 'file_output' && item.message.toolName !== 'subagent' : item.message.role === 'assistant' && item.message.id !== finals.get(requestId) && item.message.id !== lastMessage.get(requestId)));
    if (!process || !requestId) { blocks.push(item); continue; }
    const previous = blocks.at(-1);
    const group: ProcessGroup = previous?.kind === 'process' && previous.requestId === requestId ? previous : { kind: 'process', key: `process:${requestId}:${item.key}`, requestId, items: [], collapsible: finals.has(requestId), tools: 0, agents: 0, notes: 0 };
    if (group !== previous) blocks.push(group);
    group.items.push(item);
    if (item.kind === 'subagent') { group.agents++; if (item.child.status !== 'succeeded') group.collapsible = false; }
    else if (item.kind === 'message' && item.message.role === 'tool') group.tools++;
    else group.notes++;
  }
  return blocks;
}
export function processLabel(group: ProcessGroup): string {
  return ['处理过程', group.tools ? `${group.tools} 次工具调用` : '', group.agents ? `${group.agents} 个 Agent 任务` : '', group.notes ? `${group.notes} 条说明` : ''].filter(Boolean).join(' · ');
}
