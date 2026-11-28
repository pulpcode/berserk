import type { Context, TextContent, UserMessage } from '@earendil-works/pi-ai';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { LabConfig } from '../server/config.js';
import { isVerifiedDeepSeekModel } from '../server/config.js';
import type { ResourceSnapshot } from '../resources/service.js';
import { RESOURCE_ENTRY } from './resource-tools.js';
import { decodeResourceRecord } from './history-evidence.js';

export type ContextEvalStrategy = 'A' | 'B' | 'C' | 'D1' | 'D2';

export interface InstructionSnapshotEntry {
  fileId: 'common' | 'workspace';
  name: string;
  hash: string | null;
  content: string;
}

export interface ContextEvalPlan {
  strategy: ContextEvalStrategy;
  agentsFiles: Array<{ path: string; content: string }>;
  wireSystemReminder: string;
  contextUserReminder: string;
  changedSincePrevious: boolean;
  changeSummary: 'initial' | 'unchanged' | 'updated' | 'cleared';
  topSnapshotSource: 'current' | 'frozen-initial';
}

function toAgentsFiles(instructions: ReadonlyArray<{ name: string; hash: string | null; content: string }>) {
  return instructions.filter(file => file.hash !== null).map(file => ({ path: file.name, content: file.content }));
}

function instructionPayloadJson(instructions: ReadonlyArray<{ fileId: string; hash: string | null; content: string }>) {
  return JSON.stringify(instructions.map(({ fileId, hash, content }) => ({ fileId, hash, content })));
}

function legacyDeepSeekReminder(snapshot: ResourceSnapshot): string {
  return `\n\n<host_request_instructions>
宿主本轮提醒：下面是本次请求的完整通用和工作区指令快照，与系统消息中的 project_context 相同，仅本请求有效。当前规则以此为准；历史读写结果或助手承诺不能恢复已删除规则。工作区正文为空或 hash 为 null 表示本轮没有工作区约定，不继承历史回答的格式、装饰性标记或称呼，按当前用户要求正常回答。即使本轮保存新内容，也只在下一请求生效。自然回答用户，无需复述此提醒、hash 或加载机制。
${instructionPayloadJson(snapshot.instructions)}
</host_request_instructions>`;
}

function fullSystemReminder(snapshot: ResourceSnapshot): string {
  const workspace = snapshot.instructions.find(file => file.fileId === 'workspace');
  const cleared = !workspace || workspace.hash === null || workspace.content.trim() === '';
  return `<system-reminder>
宿主本轮规则快照（仅本次请求有效，优先级高于历史对话风格、历史工具读取结果及旧助手承诺；自然回答用户，不要复述此提醒或内部 hash）：
${cleared
    ? '当前工作区指令为空（无工作区格式、前缀或装饰性标记约定）。请不要继承历史回答中的任何格式前缀、方括号/书名号标记或称呼约定；如用户询问当前是否有约定，如实说明当前没有工作区约定。'
    : `当前工作区指令正文如下，请严格遵守：\n${workspace.content}`}
完整指令快照：${instructionPayloadJson(snapshot.instructions)}
即使本轮通过 instructions_update 保存新内容，新内容也只在下一请求生效。
</system-reminder>`;
}

function deltaSystemReminder(snapshot: ResourceSnapshot, change: 'updated' | 'cleared', frozenTop: boolean): string {
  const workspace = snapshot.instructions.find(file => file.fileId === 'workspace');
  const topOverride = frozenTop
    ? '注意：顶部系统提示中的旧工作区快照已过期，本声明具有更高优先级并完全覆盖顶部旧工作区规则。'
    : '顶部 <project_context> 已同步更新，请以本最新规则为准。';
  if (change === 'cleared') {
    return `<system-reminder>
[工作区规则变更声明：已清空]
工作区指令已在上一轮之后被清空（当前正文为空、无工作区约定）。${topOverride}
请立即停止使用历史回答中的所有格式前缀、装饰性标记或称呼约定，也不要自行臆造新的装饰标记；如用户询问当前约定，请明确说明当前没有工作区约定。自然回答用户，不要复述此声明。
</system-reminder>`;
  }
  return `<system-reminder>
[工作区规则变更声明：已更新]
工作区指令已在上一轮之后更新。${topOverride}
旧规则已彻底失效，禁止继续沿用历史回答中的旧格式或旧前缀。最新工作区指令如下：
${workspace?.content ?? ''}
即使本轮调用 instructions_update 再次修改，也只在下一请求生效。自然回答用户，不要复述此声明。
</system-reminder>`;
}

function priorInstructionSnapshots(branch: SessionEntry[], workspaceId: string, currentRequestId: string): InstructionSnapshotEntry[][] {
  const result: InstructionSnapshotEntry[][] = [];
  for (const entry of branch) {
    if (entry.type !== 'custom' || entry.customType !== RESOURCE_ENTRY) continue;
    const data = entry.data as { requestId?: string } | undefined;
    if (!data?.requestId || data.requestId === currentRequestId) continue;
    const decoded = decodeResourceRecord(entry.data, workspaceId);
    result.push(decoded.instructions.map(file => ({
      fileId: file.fileId,
      name: file.name,
      hash: file.hash,
      content: file.content,
    })));
  }
  return result;
}

function workspaceState(instructions: ReadonlyArray<{ fileId: string; hash: string | null; content: string }>) {
  const ws = instructions.find(file => file.fileId === 'workspace');
  const content = ws?.content ?? '';
  const empty = !ws || ws.hash === null || content.trim() === '';
  return { hash: ws?.hash ?? null, content, empty };
}

function commonState(instructions: ReadonlyArray<{ fileId: string; hash: string | null; content: string }>) {
  const common = instructions.find(file => file.fileId === 'common');
  return { hash: common?.hash ?? null, content: common?.content ?? '' };
}

export function resolveContextEvalPlan(
  strategy: ContextEvalStrategy,
  config: Readonly<LabConfig>,
  snapshot: ResourceSnapshot,
  branch: SessionEntry[],
  workspaceId: string,
  currentRequestId: string,
): ContextEvalPlan {
  const currentAgents = toAgentsFiles(snapshot.instructions);
  const prior = priorInstructionSnapshots(branch, workspaceId, currentRequestId);
  const previous = prior.at(-1);
  const first = prior[0];

  const currWs = workspaceState(snapshot.instructions);
  const currCommon = commonState(snapshot.instructions);
  let changeSummary: ContextEvalPlan['changeSummary'] = 'initial';
  if (previous) {
    const prevWs = workspaceState(previous);
    const prevCommon = commonState(previous);
    const same = prevWs.hash === currWs.hash && prevWs.content === currWs.content
      && prevCommon.hash === currCommon.hash && prevCommon.content === currCommon.content;
    if (same) changeSummary = 'unchanged';
    else if (currWs.empty && !prevWs.empty) changeSummary = 'cleared';
    else changeSummary = 'updated';
  }
  const changedSincePrevious = changeSummary === 'updated' || changeSummary === 'cleared';

  switch (strategy) {
    case 'A':
      return {
        strategy,
        agentsFiles: currentAgents,
        wireSystemReminder: '',
        contextUserReminder: '',
        changedSincePrevious,
        changeSummary,
        topSnapshotSource: 'current',
      };
    case 'B': {
      const api = config.api ?? 'openai-completions';
      if (api !== 'openai-completions') {
        throw new Error(`Strategy B (onPayload mid-stream system insertion) is invalid for protocol ${api}.`);
      }
      return {
        strategy,
        agentsFiles: currentAgents,
        wireSystemReminder: legacyDeepSeekReminder(snapshot),
        contextUserReminder: '',
        changedSincePrevious,
        changeSummary,
        topSnapshotSource: 'current',
      };
    }
    case 'C':
      return {
        strategy,
        agentsFiles: currentAgents,
        wireSystemReminder: '',
        contextUserReminder: fullSystemReminder(snapshot),
        changedSincePrevious,
        changeSummary,
        topSnapshotSource: 'current',
      };
    case 'D1':
      return {
        strategy,
        agentsFiles: currentAgents,
        wireSystemReminder: '',
        contextUserReminder: changedSincePrevious ? deltaSystemReminder(snapshot, changeSummary as 'updated' | 'cleared', false) : '',
        changedSincePrevious,
        changeSummary,
        topSnapshotSource: 'current',
      };
    case 'D2': {
      const topSnapshot = first ?? snapshot.instructions;
      return {
        strategy,
        agentsFiles: toAgentsFiles(topSnapshot),
        wireSystemReminder: '',
        contextUserReminder: changedSincePrevious ? deltaSystemReminder(snapshot, changeSummary as 'updated' | 'cleared', true) : '',
        changedSincePrevious,
        changeSummary,
        topSnapshotSource: first ? 'frozen-initial' : 'current',
      };
    }
  }
}

/**
 * Attach a transient protocol-neutral reminder to the latest native UserMessage
 * inside a shallow Context copy. Never mutates persisted messages or SessionManager.
 */
export function applyTransientUserReminder(context: Context, reminder: string): Context {
  if (!reminder) return context;
  const index = context.messages.findLastIndex(message => message.role === 'user');
  if (index < 0) return context;
  const target = context.messages[index] as UserMessage;
  const reminderBlock: TextContent = { type: 'text', text: `\n\n${reminder}` };
  const nextContent: UserMessage['content'] = typeof target.content === 'string'
    ? [{ type: 'text', text: target.content }, reminderBlock]
    : [...target.content, reminderBlock];
  const nextMessages = context.messages.slice();
  nextMessages[index] = { ...target, content: nextContent };
  return { ...context, messages: nextMessages };
}

export function defaultRequestReminder(config: Readonly<LabConfig>, snapshot: ResourceSnapshot): string {
  return isVerifiedDeepSeekModel(config) ? legacyDeepSeekReminder(snapshot) : '';
}
