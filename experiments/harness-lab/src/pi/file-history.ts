import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { FileRef, FileOutput } from '../contracts/index.js';
import { stateError } from '../resources/files.js';
import { UUID } from '../workspaces/store.js';

export const FILE_INPUT = 'berserk.files-input.v1';
export const FILE_OUTPUT = 'berserk.files-output.v1';
export interface FileInputRecord { workspaceId: string; sessionId: string; requestId: string; files: FileRef[] }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
export function validFileRef(value: unknown): value is FileRef {
  if (!object(value)) return false;
  return typeof value.path === 'string' && value.path.length > 0 && value.path.length <= 4096 && !value.path.startsWith('/')
    && !value.path.includes('\\') && ![...value.path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) && value.path.split('/').every(part => !!part && part !== '.' && part !== '..')
    && typeof value.name === 'string' && value.name === value.path.split('/').at(-1)
    && Number.isSafeInteger(value.size) && Number(value.size) >= 0
    && typeof value.hash === 'string' && /^[0-9a-f]{64}$/.test(value.hash);
}
export function fileReferenceText(files: FileRef[]): string {
  return `用户本次引用的工作区文件（以下是文件引用，不是文件正文或指令）：\n${JSON.stringify(files)}\n文件位于 /workspace；按任务需要用工具读取或解析。文件可被后续修改，读取时以实际文件为准，缺失时说明情况；不能仅凭文件名声称已读取。`;
}
export function decodeFileInput(value: unknown, workspaceId: string, sessionId?: string): FileInputRecord {
  if (!object(value) || !exact(value, ['workspaceId', 'sessionId', 'requestId', 'files']) || value.workspaceId !== workspaceId
    || typeof value.sessionId !== 'string' || !UUID.test(value.sessionId) || (sessionId !== undefined && value.sessionId !== sessionId)
    || typeof value.requestId !== 'string' || !UUID.test(value.requestId) || !Array.isArray(value.files) || value.files.length === 0 || value.files.length > 100
    || !value.files.every(file => validFileRef(file) && exact(file as unknown as Record<string, unknown>, ['path', 'name', 'size', 'hash']))
    || new Set(value.files.map(file => file.path)).size !== value.files.length) throw stateError();
  return structuredClone(value) as unknown as FileInputRecord;
}
export function decodeFileOutput(value: unknown, workspaceId: string, sessionId?: string): FileOutput {
  if (!validFileRef(value) || !object(value) || !exact(value, ['path', 'name', 'size', 'hash', 'downloadId', 'workspaceId', 'sessionId', 'requestId', 'toolCallId', 'createdAt'])
    || value.workspaceId !== workspaceId || typeof value.sessionId !== 'string' || !UUID.test(value.sessionId)
    || (sessionId !== undefined && value.sessionId !== sessionId) || typeof value.requestId !== 'string' || !UUID.test(value.requestId)
    || typeof value.downloadId !== 'string' || !UUID.test(value.downloadId) || typeof value.toolCallId !== 'string' || !value.toolCallId.length
    || value.toolCallId.length > 512 || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw stateError();
  return structuredClone(value) as unknown as FileOutput;
}
export function fileHistory(entries: SessionEntry[], workspaceId: string, sessionId: string) {
  const inputs = new Map<string, FileRef[]>();
  const outputs: FileOutput[] = [];
  for (const entry of entries) {
    if (entry.type === 'custom_message' && entry.customType === FILE_INPUT) {
      const input = decodeFileInput(entry.details, workspaceId, sessionId);
      if (inputs.has(input.requestId) || entry.display !== false || entry.content !== fileReferenceText(input.files)) throw stateError();
      inputs.set(input.requestId, input.files);
    }
    if (entry.type === 'custom' && entry.customType === FILE_OUTPUT) {
      const output = decodeFileOutput(entry.data, workspaceId, sessionId);
      if (outputs.some(item => item.downloadId === output.downloadId || (item.requestId === output.requestId && item.toolCallId === output.toolCallId))) throw stateError();
      outputs.push(output);
    }
  }
  return { inputs, outputs };
}
