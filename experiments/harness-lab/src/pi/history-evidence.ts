import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { InstructionUpdate, RequestResourcesRecord, RequestResult } from '../contracts/index.js';
import { hashContent, stateError } from '../resources/files.js';
import { UUID } from '../workspaces/store.js';
import { CHANGE_ENTRY, RESOURCE_ENTRY, RESULT_ENTRY, SKILL_ENTRY } from './resource-tools.js';
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hash = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
function instruction(value: unknown) {
  if (!object(value) || !keys(value, ['fileId', 'name', 'content', 'hash', 'editable']) || !['common', 'workspace'].includes(String(value.fileId)) || typeof value.name !== 'string' || typeof value.content !== 'string' || value.editable !== (value.fileId === 'workspace')) return false;
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
export function decodeResourceRecord(value: unknown, workspaceId: string): Extract<RequestResourcesRecord, { status: 'available' }> {
  if (!object(value) || value.status !== 'available' || typeof value.requestId !== 'string' || !UUID.test(value.requestId) || value.workspaceId !== workspaceId || !Array.isArray(value.instructions) || value.instructions.length !== 2 || !value.instructions.every(instruction) || new Set(value.instructions.map(file => file.fileId)).size !== 2 || !Array.isArray(value.skills) || value.skills.length !== 2 || !value.skills.every(item => skill(item, false)) || new Set(value.skills.map(item => item.id)).size !== 2 || !Array.isArray(value.readSkills) || !value.readSkills.every(item => skill(item, true)) || JSON.stringify(value.editableFileIds) !== '["workspace"]') throw stateError();
  if (!keys(value, ['status', 'requestId', 'workspaceId', 'instructions', 'skills', 'readSkills', 'editableFileIds'])) throw stateError();
  const record = structuredClone(value) as Extract<RequestResourcesRecord, { status: 'available' }>;
  if (!record.readSkills.every(read => record.skills.some(allowed => allowed.id === read.id && allowed.hash === read.hash && allowed.version === read.version))) throw stateError();
  return record;
}
/** Reject incompatible/cross-workspace host entries before exposing or resuming native history. */
export function validateHistoryEvidence(entries: SessionEntry[], workspaceId: string): RequestResult | null {
  const requests = new Map<string, Extract<RequestResourcesRecord, { status: 'available' }>>();
  const completed = new Set<string>();
  let currentRequest: string | undefined;
  let result: RequestResult | null = null;
  for (const entry of entries) {
    if (entry.type !== 'custom' || !entry.customType.startsWith('berserk.')) continue;
    if (entry.customType === RESOURCE_ENTRY) {
      const resources = decodeResourceRecord(entry.data, workspaceId);
      if (requests.has(resources.requestId) || completed.has(resources.requestId)) throw stateError();
      requests.set(resources.requestId, resources);
      currentRequest = resources.requestId;
      continue;
    }
    const data = entry.data;
    if (!object(data) || typeof data.requestId !== 'string' || !UUID.test(data.requestId)) throw stateError();
    if (entry.customType === RESULT_ENTRY) {
      // Preparation failures and pre-open cancellation legitimately have no resource entry.
      if (!['succeeded', 'failed', 'cancelled'].includes(String(data.status)) || (data.message !== undefined && typeof data.message !== 'string') || (data.instructionChanges !== undefined && (!Array.isArray(data.instructionChanges) || !data.instructionChanges.every(change))) || (data.instructionOutcomeUncertain !== undefined && typeof data.instructionOutcomeUncertain !== 'boolean')) throw stateError();
      if (!keys(data, ['requestId', 'status', 'message', 'instructionChanges', 'instructionOutcomeUncertain']) || completed.has(data.requestId) || (currentRequest !== undefined && currentRequest !== data.requestId) || (!requests.has(data.requestId) && (data.status === 'succeeded' || (Array.isArray(data.instructionChanges) && data.instructionChanges.length)))) throw stateError();
      result = data as unknown as RequestResult;
      completed.add(data.requestId);
      currentRequest = undefined;
    } else if (entry.customType === SKILL_ENTRY) {
      const request = requests.get(data.requestId);
      if (!keys(data, ['requestId', 'skill']) || currentRequest !== data.requestId || !request || !skill(data.skill, true) || !object(data.skill) || !request.skills.some(item => item.id === (data.skill as Record<string, unknown>).id && item.hash === (data.skill as Record<string, unknown>).hash && item.version === (data.skill as Record<string, unknown>).version)) throw stateError();
    } else if (entry.customType === CHANGE_ENTRY) {
      if (!keys(data, ['requestId', 'change']) || currentRequest !== data.requestId || !requests.has(data.requestId) || !change(data.change)) throw stateError();
    } else { throw stateError(); }
  }
  return result;
}
