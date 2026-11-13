import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager, type SessionEntry } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it } from 'vitest';
import { PiLab } from '../../src/pi/lab.js';
import { decodeExpertBinding, decodeExecutionManifest, expertBinding, EXPERT_BINDING, EXECUTION_MANIFEST } from '../../src/pi/capability-history.js';
import { validateHistoryEvidence } from '../../src/pi/history-evidence.js';
import type { ExpertBinding, ExecutionManifest } from '../../src/contracts/capabilities.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function recorded() {
  const dataDir = await mkdtemp(join(tmpdir(), 'axon-expert-history-')); cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
  const config = testConfig(dataDir); const fake = await fakeRuntime(config, () => ({ text: '实际 Pi 回答' }));
  const lab = await PiLab.create(config, fake.runtime); cleanup.push(() => lab.close()); const session = await lab.createSession();
  const request = lab.start(session.id, '实际请求'); await request.run(() => {});
  expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
  const directory = join(dataDir, 'sessions'); const name = (await readdir(directory)).find(name => name.endsWith(`_${session.id}.jsonl`))!;
  return { session, request, fake, entries: SessionManager.open(join(directory, name), directory).getBranch() };
}
function custom(entries: SessionEntry[], type: string) {
  const entry = entries.find(entry => entry.type === 'custom' && entry.customType === type);
  if (!entry || entry.type !== 'custom') throw new Error(`Missing real record: ${type}`);
  return entry;
}

describe('versioned native expert evidence', () => {
  it('decodes a session binding without requestId and the actual provider/tool manifest at its request boundary', async () => {
    const { session, request, fake, entries } = await recorded();
    const binding = custom(entries, EXPERT_BINDING).data as ExpertBinding;
    const manifest = custom(entries, EXECUTION_MANIFEST).data as ExecutionManifest;
    expect(binding).not.toHaveProperty('requestId');
    expect(decodeExpertBinding(binding, session.workspaceId, session.id)).toEqual(binding);
    expect(expertBinding(entries, session.workspaceId, session.id)).toEqual(binding);
    expect(decodeExecutionManifest(manifest, session.workspaceId, session.id)).toEqual(manifest);
    expect(manifest).toMatchObject({ requestId: request.requestId, expertRef: binding.expertRef, digest: binding.digest, mode: 'interactive', identity: { seatId: 'test-seat' } });
    expect(manifest.tools.sort()).toEqual(fake.calls[0].context.tools!.map(tool => tool.name).sort());
    expect(validateHistoryEvidence(entries, session.workspaceId, session.id)?.status).toBe('succeeded');
  });

  it('rejects cross-session/space bindings, duplicate bindings and unknown authority-bearing fields', async () => {
    const { session, entries } = await recorded(); const binding = custom(entries, EXPERT_BINDING).data as ExpertBinding;
    for (const value of [{ ...binding, sessionId: randomUUID() }, { ...binding, workspaceId: randomUUID() }, { ...binding, allowedTools: ['bash'] }, { ...binding, requestId: randomUUID() }, { ...binding, schemaVersion: 2 }]) {
      expect(() => decodeExpertBinding(value, session.workspaceId, session.id)).toThrow();
    }
    expect(() => expertBinding([...entries, structuredClone(custom(entries, EXPERT_BINDING))], session.workspaceId, session.id)).toThrow();
  });

  it('rejects forged manifest ownership, digest, mode, duplicate or missing execution evidence for a successful bound request', async () => {
    const { session, entries } = await recorded();
    for (const fields of [{ requestId: randomUUID() }, { sessionId: randomUUID() }, { workspaceId: randomUUID() },
      { digest: '0'.repeat(64) }, { identity: { seatId: 'foreign-seat' } }, { mode: 'delegated' },
      { expertRef: { expertId: 'foreign-expert', revisionId: `rev-${'0'.repeat(64)}` } }]) {
      const forged = structuredClone(entries); const entry = custom(forged, EXECUTION_MANIFEST); entry.data = { ...(entry.data as ExecutionManifest), ...fields };
      expect(() => validateHistoryEvidence(forged, session.workspaceId, session.id)).toThrow();
    }
    const duplicate = structuredClone(entries); const manifestIndex = duplicate.findIndex(entry => entry.type === 'custom' && entry.customType === EXECUTION_MANIFEST);
    duplicate.splice(manifestIndex, 0, structuredClone(duplicate[manifestIndex]));
    expect(() => validateHistoryEvidence(duplicate, session.workspaceId, session.id)).toThrow();
    const missing = entries.filter(entry => entry.type !== 'custom' || entry.customType !== EXECUTION_MANIFEST);
    expect(() => validateHistoryEvidence(missing, session.workspaceId, session.id)).toThrow();
  });
});
