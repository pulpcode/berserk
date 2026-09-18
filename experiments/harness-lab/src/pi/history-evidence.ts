import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { InstructionUpdate, RequestResourcesRecord, RequestResult } from '../contracts/index.js';
import { validCompactionSummary } from './compaction-history.js';
import { SUBAGENT_START, SUBAGENT_RESULT, subagentHistory, validUsage, addUsage } from './subagent-history.js';
import { emptyUsage } from './controlled-stream.js';
import { hashContent, stateError } from '../resources/files.js';
import { UUID } from '../workspaces/store.js';
import { CHANGE_ENTRY, RESOURCE_ENTRY, RESULT_ENTRY, SKILL_ENTRY } from './resource-tools.js';
import { FILE_INPUT, FILE_OUTPUT, decodeFileInput, decodeFileOutput, fileReferenceText } from './file-history.js';
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hash = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
function instruction(value: unknown, readonly = false) {
  if (!object(value) || !keys(value, ['fileId', 'name', 'content', 'hash', 'editable']) || !['common', 'workspace'].includes(String(value.fileId)) || typeof value.name !== 'string' || typeof value.content !== 'string' || value.editable !== (!readonly && value.fileId === 'workspace')) return false;
  if (Buffer.byteLength(value.content) > (value.fileId === 'common' ? 4096 : 16384)) return false;
  return value.hash === null ? value.content === '' : hash(value.hash) && value.hash === hashContent(value.content);
}
function skill(value: unknown, content: boolean) {
  if (!object(value) || !keys(value, ['id', 'name', 'description', 'version', 'hash', ...(content ? ['content'] : [])]) || !['synthesis', 'review'].includes(String(value.id)) || typeof value.name !== 'string' || typeof value.description !== 'string' || typeof value.version !== 'string' || !hash(value.hash)) return false;
  return !content || (typeof value.content === 'string' && Buffer.byteLength(value.content) <= 16384 && hashContent(value.content) === value.hash);
}
function change(value: unknown): value is InstructionUpdate {
  return object(value) && keys(value, ['fileId', 'status', 'previousHash', 'hash', 'effectiveFrom']) && value.fileId === 'workspace' && ['updated', 'unchanged'].includes(String(value.status)) && (value.previousHash === null || hash(value.previousHash)) && hash(value.hash) && value.effectiveFrom === 'next_request';
}
export function decodeResourceRecord(value: unknown, workspaceId: string, readonly = false): Extract<RequestResourcesRecord, { status: 'available' }> {
  if (!object(value) || value.status !== 'available' || typeof value.requestId !== 'string' || !UUID.test(value.requestId) || value.workspaceId !== workspaceId || !Array.isArray(value.instructions) || value.instructions.length !== 2 || !value.instructions.every(item => instruction(item, readonly)) || new Set(value.instructions.map(file => file.fileId)).size !== 2 || !Array.isArray(value.skills) || value.skills.length !== 2 || !value.skills.every(item => skill(item, false)) || new Set(value.skills.map(item => item.id)).size !== 2 || !Array.isArray(value.readSkills) || !value.readSkills.every(item => skill(item, true)) || JSON.stringify(value.editableFileIds) !== (readonly ? '[]' : '["workspace"]')) throw stateError();
  if (!keys(value, ['status', 'requestId', 'workspaceId', 'instructions', 'skills', 'readSkills', 'editableFileIds'])) throw stateError();
  const record = structuredClone(value) as Extract<RequestResourcesRecord, { status: 'available' }>;
  if (!record.readSkills.every(read => record.skills.some(allowed => allowed.id === read.id && allowed.hash === read.hash && allowed.version === read.version))) throw stateError();
  return record;
}
/** Reject incompatible/cross-workspace host entries before exposing or resuming native history. */
export function validateHistoryEvidence(entries: SessionEntry[], workspaceId: string, parentSessionId?: string, readonly = false): RequestResult | null {
  const children = subagentHistory(entries, workspaceId, parentSessionId);
  const requests = new Map<string, Extract<RequestResourcesRecord, { status: 'available' }>>();
  const completed = new Set<string>();
  let currentRequest: string | undefined;
  let result: RequestResult | null = null;
  const compactedBy = new Map<string, string | undefined>();
  const fileInputs = new Set<string>();
  const fileOutputs = new Map<string, ReturnType<typeof decodeFileOutput>>();
  const outputDownloads = new Set<string>();
  const fileCalls = new Map<string, {requestId: string | undefined; path: unknown}>();
  const fileReturned = new Set<string>();
  let currentRequestHasUser = false;
  for (const entry of entries) {
    if (entry.type === 'message' && entry.message.role === 'user') currentRequestHasUser = true;
    if (entry.type === 'message' && entry.message.role === 'assistant') for (const block of entry.message.content) {
      if (block.type === 'toolCall' && block.name === 'file_output') {
        const key = `${currentRequest}:${block.id}`;
        if (fileCalls.has(key)) throw stateError();
        fileCalls.set(key, {requestId: currentRequest, path: block.arguments.path});
      }
    }
    if (entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === 'file_output') {
      const message = entry.message; const key = `${currentRequest}:${message.toolCallId}`; const saved = fileOutputs.get(key);
      if (saved) {
        if (fileReturned.has(key)) throw stateError();
        if (!message.isError && (message.content.length !== 1 || message.content[0].type !== 'text' || message.content[0].text !== `文件已提供下载：${saved.name}（${saved.size} 字节）。` || !object(message.details) || !keys(message.details, ['file']) || JSON.stringify(message.details.file) !== JSON.stringify(saved))) throw stateError();
        fileReturned.add(key);
      } else if (currentRequest && !message.isError) throw stateError();
    }
    if (entry.type === 'custom_message' && entry.customType.startsWith('berserk.')) {
      if (readonly || entry.customType !== FILE_INPUT) throw stateError();
      const input = decodeFileInput(entry.details, workspaceId, parentSessionId);
      if (currentRequestHasUser || currentRequest !== input.requestId || fileInputs.has(input.requestId) || entry.display !== false || entry.content !== fileReferenceText(input.files)) throw stateError();
      fileInputs.add(input.requestId);
    }
    if (entry.type === 'compaction') compactedBy.set(entry.id, currentRequest);
    if (entry.type !== 'custom' || !entry.customType.startsWith('berserk.')) continue;
    if (entry.customType === RESOURCE_ENTRY) {
      const resources = decodeResourceRecord(entry.data, workspaceId, readonly);
      if (requests.has(resources.requestId) || completed.has(resources.requestId)) throw stateError();
      requests.set(resources.requestId, resources);
      currentRequest = resources.requestId; currentRequestHasUser = false;
      continue;
    }
    const data = entry.data;
    if (!object(data) || typeof data.requestId !== 'string' || !UUID.test(data.requestId)) throw stateError();
    if (entry.customType === RESULT_ENTRY) {
      // Preparation failures and pre-open cancellation legitimately have no resource entry.
      if (!['succeeded', 'failed', 'cancelled'].includes(String(data.status)) || (data.message !== undefined && typeof data.message !== 'string') || (data.instructionChanges !== undefined && (!Array.isArray(data.instructionChanges) || !data.instructionChanges.every(change))) || (data.instructionOutcomeUncertain !== undefined && typeof data.instructionOutcomeUncertain !== 'boolean')) throw stateError();
      if (!keys(data, ['requestId', 'status', 'message', 'instructionChanges', 'instructionOutcomeUncertain', 'compactionIds', 'compactions', 'usageSummary', 'subagentUsage']) || completed.has(data.requestId) || (currentRequest !== undefined && currentRequest !== data.requestId) || (!requests.has(data.requestId) && (data.status === 'succeeded' || (Array.isArray(data.instructionChanges) && data.instructionChanges.length)))) throw stateError();
      if (data.compactionIds !== undefined && (!Array.isArray(data.compactionIds) || !data.compactionIds.every(id => typeof id === 'string' && compactedBy.get(id) === data.requestId))) throw stateError();
      if (Array.isArray(data.compactionIds) && new Set(data.compactionIds).size !== data.compactionIds.length) throw stateError();
      if (data.compactions !== undefined && (!Array.isArray(data.compactions) || !data.compactions.every(item => validCompactionSummary(item) && item.requestId === data.requestId && Array.isArray(data.compactionIds) && data.compactionIds.includes(item.id) && entries.some(native => native.type === 'compaction' && native.id === item.id && native.timestamp === item.createdAt && native.tokensBefore === item.tokensBefore)))) throw stateError();
      if (data.usageSummary !== undefined && !validUsage(data.usageSummary)) throw stateError();
      const delegated = children.results.filter(child => child.requestId === data.requestId);
      if (data.subagentUsage !== undefined || delegated.length) {
        const aggregate = emptyUsage(); for (const child of delegated) addUsage(aggregate, child.usage);
        if (!validUsage(data.subagentUsage) || JSON.stringify(data.subagentUsage) !== JSON.stringify(aggregate)) throw stateError();
      }
      if (data.status === 'succeeded' && [...fileOutputs].some(([key, output]) => output.requestId === data.requestId && !fileReturned.has(key))) throw stateError();
      result = data as unknown as RequestResult;
      completed.add(data.requestId);
      currentRequest = undefined;
    } else if (entry.customType === FILE_OUTPUT) {
      const output = decodeFileOutput(data, workspaceId, parentSessionId);
      const key = `${output.requestId}:${output.toolCallId}`;
      const call = fileCalls.get(key);
      const normalizedPath = typeof call?.path === 'string' && call.path.startsWith('/workspace/') ? call.path.slice('/workspace/'.length) : call?.path;
      if (readonly || currentRequest !== output.requestId || fileOutputs.has(key) || outputDownloads.has(output.downloadId)
        || !call || call.requestId !== currentRequest || normalizedPath !== output.path) throw stateError();
      fileOutputs.set(key, output); outputDownloads.add(output.downloadId);
    } else if (entry.customType === SKILL_ENTRY) {
      const request = requests.get(data.requestId);
      if (!keys(data, ['requestId', 'skill']) || currentRequest !== data.requestId || !request || !skill(data.skill, true) || !object(data.skill) || !request.skills.some(item => item.id === (data.skill as Record<string, unknown>).id && item.hash === (data.skill as Record<string, unknown>).hash && item.version === (data.skill as Record<string, unknown>).version)) throw stateError();
    } else if (entry.customType === CHANGE_ENTRY) {
      if (readonly || !keys(data, ['requestId', 'change']) || currentRequest !== data.requestId || !requests.has(data.requestId) || !change(data.change)) throw stateError();
    } else if (entry.customType === SUBAGENT_START || entry.customType === SUBAGENT_RESULT) {
      if (readonly || currentRequest !== data.requestId || !requests.has(data.requestId)) throw stateError();
    } else { throw stateError(); }
  }
  return result;
}
