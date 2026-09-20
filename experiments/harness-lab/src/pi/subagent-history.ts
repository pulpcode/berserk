import { isDeepStrictEqual } from 'node:util';
import { agentInfo, composerHistory, selectedChildInput, validSkill } from './composer-input.js';
import { fileHistory, validFileRef } from './file-history.js';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { FileRef, SkillFile, SubagentSummary, UsageSummary } from '../contracts/index.js';
import { hashContent, stateError } from '../resources/files.js';
import { UUID } from '../workspaces/store.js';
import { tokenUsage } from './compaction-history.js';
import { readonlyToolNames, type AgentRole } from './roles.js';

export const SUBAGENT_START = 'berserk.subagent-start.v1';
export const SUBAGENT_RESULT = 'berserk.subagent-result.v1';
export const CHILD_ORIGIN = 'berserk.subagent-origin.v1';
export interface SubagentStart {
  requestId: string; parentSessionId: string; workspaceId: string; childSessionId: string;
  subagentId: string; toolCallId: string; task: string; role: AgentRole; promptHash: string;
  effectiveTools: string[]; startedAt: string;
  input?: { skill?: SkillFile; files: FileRef[] };
}
export interface SubagentResult { requestId: string; subagentId: string; summary: SubagentSummary; usage: UsageSummary }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function validUsage(value: unknown): value is UsageSummary {
  return object(value) && keys(value, ['modelAttempts', 'replyAttempts', 'compactionAttempts', 'toolCalls', 'unknownUsageAttempts', 'actual'])
    && ['modelAttempts', 'replyAttempts', 'compactionAttempts', 'toolCalls', 'unknownUsageAttempts'].every(key => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0)
    && value.modelAttempts === Number(value.replyAttempts) + Number(value.compactionAttempts)
    && Number(value.unknownUsageAttempts) <= Number(value.modelAttempts)
    && (value.actual === null || (object(value.actual) && keys(value.actual, ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']) && tokenUsage(value.actual) !== null));
}
export function addUsage(target: UsageSummary, source: UsageSummary): void {
  for (const key of ['modelAttempts', 'replyAttempts', 'compactionAttempts', 'toolCalls', 'unknownUsageAttempts'] as const) target[key] += source[key];
  if (source.actual) {
    target.actual ||= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'] as const) target.actual[key] += source.actual[key];
  }
}
export function decodeSubagentStart(value: unknown, workspaceId: string, parentSessionId?: string): SubagentStart {
  if (!object(value) || !keys(value, ['requestId', 'parentSessionId', 'workspaceId', 'childSessionId', 'subagentId', 'toolCallId', 'task', 'role', 'promptHash', 'effectiveTools', 'startedAt', 'input'])
    || !['requestId', 'parentSessionId', 'childSessionId', 'subagentId'].every(key => uuid(value[key])) || value.workspaceId !== workspaceId
    || (parentSessionId !== undefined && value.parentSessionId !== parentSessionId) || typeof value.toolCallId !== 'string' || !value.toolCallId
    || typeof value.task !== 'string' || !value.task.trim() || !date(value.startedAt)) throw stateError();
  if (value.input !== undefined && (!object(value.input) || !keys(value.input, ['skill', 'files'])
    || (value.input.skill !== undefined && !validSkill(value.input.skill, true)) || !Array.isArray(value.input.files)
    || !value.input.files.every(file => validFileRef(file) && object(file) && keys(file, ['path', 'name', 'size', 'hash']))
    || new Set(value.input.files.map(file => file.path)).size !== value.input.files.length)) throw stateError();
  const role = value.role;
  if (!object(role) || !keys(role, ['name', 'description', 'tools', 'systemPrompt', 'hash'])
    || typeof role.name !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(role.name) || typeof role.description !== 'string' || !role.description.trim()
    || typeof role.systemPrompt !== 'string' || !role.systemPrompt.trim() || hashContent(role.systemPrompt) !== value.promptHash
    || typeof role.hash !== 'string' || !/^[0-9a-f]{64}$/.test(role.hash) || !Array.isArray(role.tools)
    || !role.tools.every(tool => typeof tool === 'string' && (readonlyToolNames as readonly string[]).includes(tool)) || new Set(role.tools).size !== role.tools.length
    || JSON.stringify(value.effectiveTools) !== JSON.stringify(role.tools)) throw stateError();
  return structuredClone(value) as unknown as SubagentStart;
}
export function initialSubagent(start: SubagentStart): SubagentSummary {
  return { subagentId: start.subagentId, parentRequestId: start.requestId, toolCallId: start.toolCallId,
    role: start.role.name, description: start.role.description, task: start.task, status: 'running', phase: 'preparing', startedAt: start.startedAt };
}
export function subagentResultText(summary: SubagentSummary): string {
  return summary.status === 'succeeded' ? `子任务 ${summary.role} 已完成：\n${summary.result}`
    : `子任务 ${summary.role} ${summary.status === 'cancelled' ? '已取消' : '失败'}：${summary.error}`;
}
export function decodeSubagentResult(value: unknown, start: SubagentStart): SubagentResult {
  if (!object(value) || !keys(value, ['requestId', 'subagentId', 'summary', 'usage']) || value.requestId !== start.requestId
    || value.subagentId !== start.subagentId || !validUsage(value.usage) || !object(value.summary)) throw stateError();
  const summary = value.summary;
  if (!keys(summary, ['subagentId', 'parentRequestId', 'toolCallId', 'role', 'description', 'task', 'status', 'result', 'error', 'startedAt', 'completedAt'])
    || !['succeeded', 'failed', 'cancelled'].includes(String(summary.status)) || !date(summary.completedAt)
    || Object.entries(initialSubagent(start)).some(([key, item]) => !['status', 'phase'].includes(key) && summary[key] !== item)
    || (summary.status === 'succeeded' ? typeof summary.result !== 'string' || !summary.result.trim() || summary.error !== undefined
      : typeof summary.error !== 'string' || !summary.error.trim() || summary.result !== undefined)) throw stateError();
  return structuredClone(value) as unknown as SubagentResult;
}

/** Validate ordering/ownership against native calls; incomplete work is projected, never replayed. */
export function subagentHistory(entries: SessionEntry[], workspaceId: string, parentSessionId?: string): { starts: SubagentStart[]; summaries: SubagentSummary[]; results: SubagentResult[] } {
  const selections = composerHistory(entries, workspaceId, parentSessionId);
  const files = fileHistory(entries, workspaceId, parentSessionId).inputs;
  const starts = new Map<string, SubagentStart>(); const results = new Map<string, SubagentResult>();
  const returned = new Set<string>();
  const calls = new Map<string, { requestId: string | undefined; agent: unknown; task: unknown }>();
  let requestId: string | undefined;
  for (const entry of entries) {
    if (entry.type === 'custom' && entry.customType === 'berserk.request-resources.v1') requestId = (entry.data as { requestId: string }).requestId;
    if (entry.type === 'message' && entry.message.role === 'assistant') for (const block of entry.message.content) {
      if (block.type === 'toolCall' && block.name === 'subagent') calls.set(block.id, { requestId, agent: block.arguments.agent, task: block.arguments.task });
    }
    if (entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === 'subagent') {
      const message = entry.message;
      const start = [...starts.values()].find(start => start.requestId === requestId && start.toolCallId === message.toolCallId);
      if (start) {
        const saved = results.get(start.subagentId);
        const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
        // Pi can persist a failed tool result after child/association persistence failed.
        // Without a committed end record this remains interrupted, never a completed child.
        if (!saved) { if (!message.isError) throw stateError(); continue; }
        if (returned.has(start.subagentId) || text !== subagentResultText(saved.summary) || message.isError !== (saved.summary.status !== 'succeeded')
          || !object(message.details) || !keys(message.details, ['subagent']) || JSON.stringify(message.details.subagent) !== JSON.stringify(saved.summary)) throw stateError();
        returned.add(start.subagentId);
      }
    }
    if (entry.type !== 'custom') continue;
    if (entry.customType === SUBAGENT_START) {
      const start = decodeSubagentStart(entry.data, workspaceId, parentSessionId); const call = calls.get(start.toolCallId);
      if (start.requestId !== requestId || !call || call.requestId !== requestId || call.agent !== start.role.name || call.task !== start.task
        || starts.has(start.subagentId) || [...starts.values()].some(other => other.childSessionId === start.childSessionId || (other.requestId === start.requestId && other.toolCallId === start.toolCallId))) throw stateError();
      const selected = selections.get(start.requestId);
      if (selected?.agent?.name === start.role.name && !isDeepStrictEqual(selected.agent, agentInfo(start.role))) throw stateError();
      if (!isDeepStrictEqual(start.input, selectedChildInput(selections.get(start.requestId), files.get(start.requestId) ?? [], start.role.name))) throw stateError();
      starts.set(start.subagentId, start);
    } else if (entry.customType === SUBAGENT_RESULT) {
      if (!object(entry.data) || typeof entry.data.subagentId !== 'string') throw stateError();
      const start = starts.get(entry.data.subagentId);
      if (!start || start.requestId !== requestId || results.has(start.subagentId)) throw stateError();
      results.set(start.subagentId, decodeSubagentResult(entry.data, start));
    } else if (entry.customType === 'berserk.request-result.v1') {
      const terminalRequestId = object(entry.data) ? entry.data.requestId : undefined;
      if ([...starts.values()].some(start => start.requestId === terminalRequestId && !results.has(start.subagentId))) throw stateError();
      if (object(entry.data) && entry.data.status === 'succeeded' && [...starts.values()].some(start => start.requestId === terminalRequestId && !returned.has(start.subagentId))) throw stateError();
      requestId = undefined;
    }
  }
  return { starts: [...starts.values()], results: [...results.values()], summaries: [...starts.values()].map(start => results.get(start.subagentId)?.summary
    ?? { ...initialSubagent(start), status: 'interrupted', phase: undefined, error: '上次子任务未完整提交，原始记录已保留；不会自动重新委派。' }) };
}
