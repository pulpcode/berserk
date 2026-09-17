import { mkdir, readdir, readFile, lstat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';

/** Read-only, offline evidence for probes; provider prices are deliberately not reported. */
export async function readNativeUsage(dataDir: string) {
  const usage = { modelMessages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
  const sessions: Array<{ sessionId: string; modelMessages: number }> = [];
  const directory = join(dataDir, 'sessions');
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.jsonl')) continue;
    const path = join(directory, name);
    if (!(await lstat(path)).isFile()) continue;
    for (const line of (await readFile(path, 'utf8')).trim().split('\n')) JSON.parse(line);
    const manager = SessionManager.open(path, directory);
    let modelMessages = 0;
    for (const entry of manager.getEntries()) {
      if (entry.type !== 'message' || entry.message.role !== 'assistant' || entry.message.provider === 'validation-fixture') continue;
      modelMessages++; usage.modelMessages++;
      for (const field of ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'] as const) {
        usage[field] += entry.message.usage[field] || 0;
      }
    }
    sessions.push({ sessionId: manager.getSessionId(), modelMessages });
  }
  return { usage, sessions };
}

/** Public text and native boundaries only: never export provider credentials or thinking blocks. */
export async function readNativeCompactionEvidence(dataDir: string, sessionId: string) {
  const directory = join(dataDir, 'sessions');
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.jsonl')) continue;
    const path = join(directory, name);
    if (!(await lstat(path)).isFile()) continue;
    const manager = SessionManager.open(path, directory);
    if (manager.getSessionId() !== sessionId) continue;
    return manager.getBranch().flatMap<{ id: string; type: string; summary?: string; firstKeptEntryId?: string; tokensBefore?: number; role?: string; text?: string }>(entry => {
      if (entry.type === 'compaction') return [{ id: entry.id, type: 'compaction', summary: entry.summary,
        firstKeptEntryId: entry.firstKeptEntryId, tokensBefore: entry.tokensBefore }];
      if (entry.type !== 'message') return [];
      const message = entry.message;
      if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'toolResult') return [];
      const text = typeof message.content === 'string' ? message.content : message.content
        .filter(block => block.type === 'text').map(block => block.text).join('\n');
      return [{ id: entry.id, type: 'message', role: message.role, text }];
    });
  }
  throw new Error('验收会话不存在。');
}

/** Synthetic legacy fixture written with the pinned Pi SDK, never to a user's directory. */
export async function createLegacyValidationSession(dataDir: string) {
  const sessionDir = join(dataDir, 'sessions');
  await mkdir(sessionDir, { recursive: true });
  let manager = SessionManager.create(dataDir, sessionDir);
  const file = manager.getSessionFile()!;
  await writeFile(file, `${JSON.stringify(manager.getHeader())}\n`, { flag: 'wx', mode: 0o600 });
  manager = SessionManager.open(file, sessionDir);
  manager.appendMessage({ role: 'user', content: '这是迁移验收的合成历史：项目代号是桦树，参加人数为37。', timestamp: Date.now() });
  manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: '已记录：项目代号桦树，参加人数37。' }],
    api: 'openai-completions', provider: 'validation-fixture', model: 'synthetic-history', timestamp: Date.now(), stopReason: 'stop',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  return { sessionId: manager.getSessionId(), file, bytes: await readFile(file) };
}
