import type { FileOutput, PublicMessage, SessionSnapshot } from '../contracts/index';
import { conversationItems, type ConversationItem } from './SubagentCard';

export type DisplayItem = ConversationItem | { kind: 'file'; key: string; file: FileOutput };
export type ProcessGroup = { kind: 'process'; key: string; requestId: string; items: DisplayItem[]; collapsible: boolean; tools: number; agents: number; categories: string[] };
export type ChatBlock = DisplayItem | ProcessGroup;
const requestOf = (item: DisplayItem) => item.kind === 'message' ? item.message.requestId : item.kind === 'subagent' ? item.child.parentRequestId : item.kind === 'interaction' ? item.interaction.requestId : item.file.requestId;
const matchesOutput = (message: PublicMessage, file: FileOutput) => message.role === 'tool' && message.toolName === 'file_output' && message.requestId === file.requestId && message.toolCallId === file.toolCallId;

const toolActions: Record<string, string> = {
  read: '读取文件', write: '写入文件', edit: '修改文件', bash: '执行命令', ls: '列出文件', find: '查找文件',
  file_output: '提供文件', task_resource_query: '查询资源', spatial_analyze: '空间分析',
  work_item_list: '查看工作待办', work_item_read: '查看工作详情', work_item_action: '工作交接', work_item_prepare: '准备交接', work_item_commit: '执行交接', handoff_import_file: '复制交接文件',
  'work_item.list': '查看工作待办', 'work_item.read': '查看工作详情', 'work_item.prepare': '准备交接', 'work_item.commit': '执行交接', 'handoff.import_file': '复制交接文件',
  'instructions.update': '更新指令', 'instructions.read': '读取指令', 'skill.read': '读取 Skill', 'source.read': '读取资料', 'source.list': '读取资料',
};
/** Neutral Chinese action for a tool row; unknown tools keep a generic label. */
export function toolActionLabel(toolName?: string): string {
  return toolName && Object.hasOwn(toolActions, toolName) ? toolActions[toolName] : '调用工具';
}
/** Group summaries cite known categories without exposing unknown internal names. */
function toolCategory(toolName?: string): string | undefined {
  if (!toolName) return undefined;
  return Object.hasOwn(toolActions, toolName) ? toolActions[toolName] : '其他工具';
}

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
  const blocks: ChatBlock[] = [];
  for (const item of items) {
    const requestId = requestOf(item);
    // Every ordinary assistant reply stays visible; only tool results and eligible Agent records fold.
    const process = requestId && (item.kind === 'subagent' ? ['running', 'stopping', 'succeeded'].includes(item.child.status) : item.kind === 'message' && item.message.role === 'tool' && !item.message.isError && !item.message.resultMissing && item.message.toolName !== 'file_output' && item.message.toolName !== 'subagent');
    if (!process || !requestId) { blocks.push(item); continue; }
    const previous = blocks.at(-1);
    const group: ProcessGroup = previous?.kind === 'process' && previous.requestId === requestId ? previous : { kind: 'process', key: `process:${requestId}:${item.key}`, requestId, items: [], collapsible: finals.has(requestId), tools: 0, agents: 0, categories: [] };
    if (group !== previous) blocks.push(group);
    group.items.push(item);
    if (item.kind === 'subagent') { group.agents++; if (item.child.status !== 'succeeded') group.collapsible = false; }
    else if (item.kind === 'message' && item.message.role === 'tool') {
      group.tools++;
      const category = toolCategory(item.message.toolName);
      if (category && !group.categories.includes(category)) group.categories.push(category);
    }
  }
  return blocks;
}
export function processLabel(group: ProcessGroup): string {
  const tools = group.tools ? `${group.tools} 次工具调用${group.categories.length ? `（${group.categories.join('、')}）` : ''}` : '';
  return ['处理过程', tools, group.agents ? `${group.agents} 个 Agent 任务` : ''].filter(Boolean).join(' · ');
}
