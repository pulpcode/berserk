import { readFile } from 'node:fs/promises';
import { SessionManager, type SessionEntry } from '@earendil-works/pi-coding-agent';
import type { CompactionSummary, TokenUsage } from '../contracts/index.js';
import { stateError } from '../resources/files.js';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function tokenUsage(value: unknown): TokenUsage | null {
  if (!object(value)) return null;
  const fields = ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'] as const;
  if (!fields.every(field => Number.isSafeInteger(value[field]) && Number(value[field]) >= 0)) return null;
  return Object.fromEntries(fields.map(field => [field, value[field]])) as unknown as TokenUsage;
}
export function validCompactionSummary(value: unknown): value is CompactionSummary {
  if (!object(value) || !Object.keys(value).every(key => ['id', 'createdAt', 'reason', 'tokensBefore', 'tokensAfter', 'requestId', 'model', 'modelSettingsVersion', 'usage'].includes(key))) return false;
  return typeof value.id === 'string' && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
    && ['threshold', 'overflow', 'unknown'].includes(String(value.reason))
    && Number.isSafeInteger(value.tokensBefore) && Number(value.tokensBefore) >= 0
    && (value.tokensAfter === null || (Number.isSafeInteger(value.tokensAfter) && Number(value.tokensAfter) >= 0))
    && (value.usage === undefined || value.usage === null || tokenUsage(value.usage) !== null)
    && ['requestId', 'model', 'modelSettingsVersion'].every(key => value[key] === undefined || typeof value[key] === 'string');
}
/** Pi tolerates malformed JSONL; the host rejects it before Pi can silently skip evidence. */
export async function openStrictSession(file: string, sessionDir: string): Promise<SessionManager> {
  const lines = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as unknown);
  const header = lines.shift();
  if (!object(header) || header.type !== 'session' || typeof header.id !== 'string') throw stateError();
  const entries = new Map<string, Record<string, unknown>>();
  for (const entry of lines) {
    if (!object(entry) || typeof entry.type !== 'string' || typeof entry.id !== 'string' || entries.has(entry.id)
      || typeof entry.timestamp !== 'string' || !Number.isFinite(Date.parse(entry.timestamp))
      || (entry.parentId !== null && (typeof entry.parentId !== 'string' || !entries.has(entry.parentId)))) throw stateError();
    if (entry.type === 'compaction') {
      if (typeof entry.summary !== 'string' || !entry.summary.trim() || typeof entry.firstKeptEntryId !== 'string'
        || !Number.isSafeInteger(entry.tokensBefore) || Number(entry.tokensBefore) < 0
        || (entry.usage !== undefined && tokenUsage(entry.usage) === null)) throw stateError();
      let ancestor: unknown = entry.parentId;
      while (typeof ancestor === 'string' && ancestor !== entry.firstKeptEntryId) ancestor = entries.get(ancestor)?.parentId;
      if (ancestor !== entry.firstKeptEntryId || entries.get(entry.firstKeptEntryId)?.type === 'compaction') throw stateError();
      const keptBranch: Record<string, unknown>[] = [];
      let kept: unknown = entry.parentId;
      while (typeof kept === 'string') {
        const node = entries.get(kept)!; keptBranch.unshift(node);
        if (kept === entry.firstKeptEntryId) break;
        kept = node.parentId;
      }
      const firstVisible = keptBranch.find(node => ['message', 'custom_message', 'branch_summary'].includes(String(node.type)));
      if (!firstVisible || (firstVisible.type === 'message' && (!object(firstVisible.message) || firstVisible.message.role === 'toolResult'))) throw stateError();
    }
    entries.set(entry.id, entry);
  }
  const manager = SessionManager.open(file, sessionDir);
  if (manager.getEntries().length !== lines.length) throw stateError();
  return manager;
}
export function compactionSummary(entry: Extract<SessionEntry, { type: 'compaction' }>, metadata?: CompactionSummary): CompactionSummary {
  return { id: entry.id, createdAt: entry.timestamp, reason: metadata?.reason ?? 'unknown',
    tokensBefore: entry.tokensBefore, tokensAfter: metadata?.tokensAfter ?? null,
    ...(metadata?.requestId ? { requestId: metadata.requestId } : {}),
    ...(metadata?.model ? { model: metadata.model } : {}),
    ...(metadata?.modelSettingsVersion ? { modelSettingsVersion: metadata.modelSettingsVersion } : {}),
    usage: tokenUsage(entry.usage)?.totalTokens ? tokenUsage(entry.usage) : null };
}
/** Guard public append operations: a failed append may already have mutated Pi's in-memory tree. */
export function guardPersistence(manager: SessionManager, failed: () => void): void {
  let poisoned = false;
  for (const name of ['appendMessage', 'appendCompaction', 'appendCustomEntry', 'appendThinkingLevelChange', 'appendModelChange', 'appendCustomMessageEntry', 'appendSessionInfo', 'appendLabelChange'] as const) {
    const original = manager[name];
    Object.defineProperty(manager, name, { configurable: true, value: (...args: unknown[]) => {
      if (poisoned) throw new Error('会话记录保存失败，已停止继续写入。');
      try { return Reflect.apply(original, manager, args); }
      catch { poisoned = true; failed(); throw new Error('会话记录保存失败，已停止继续写入。'); }
    } });
  }
}
