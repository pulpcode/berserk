import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExpertRevision } from '../../src/contracts/capabilities.js';
import type { ExpertTrialRecord, ManagementActor } from '../../src/contracts/capability-management.js';
import type { LabConfig } from '../../src/server/config.js';
import { DockerExecutionService, type DockerRunner } from '../../src/execution/docker.js';
import { CapabilityTrials, type CapabilityTrialsOptions } from '../../src/pi/capability-trials.js';
import { capabilityDigest, skillRevision } from '../../src/capabilities/service.js';
import { loadControlledSkills } from '../../src/resources/service.js';
import { RequestError } from '../../src/contracts/errors.js';
import { openStrictSession } from '../../src/pi/compaction-history.js';
import { PiLab } from '../../src/pi/lab.js';
import { syntheticTrialTools } from '../../src/pi/trial-tools.js';
import { EXECUTION_MANIFEST } from '../../src/pi/capability-history.js';
import { fakeRuntime, testConfig, type Reply } from './fake-runtime.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
const actor = { userId: 'admin-a', seatId: 'production-seat' };
async function fixed(tools: string[] = [], skills = false): Promise<ExpertRevision> {
  const body = { schemaVersion: 1 as const, expertId: 'organization-trial', releaseVersion: 'trial', name: '隔离试用专家',
    description: '只用合成资料', instructions: 'FIXED-DRAFT-INSTRUCTIONS', modes: ['interactive' as const],
    selectable: false, system: false, allowedTools: [...tools].sort(), skills: skills ? (await loadControlledSkills(['synthesis'])).map(skillRevision) : [] };
  const digest = capabilityDigest(body); return { ...body, revisionId: `rev-${digest}`, digest };
}
function prepared(expert: ExpertRevision): ExpertTrialRecord {
  return { trialId: randomUUID(), expertId: expert.expertId, ownerId: actor.userId, draftDigest: 'a'.repeat(64), validationId: randomUUID(),
    input: '请读取合成样例，明确依据后形成结论。', status: 'prepared', createdAt: new Date().toISOString() };
}
async function setup(reply: Parameters<typeof fakeRuntime>[1] = () => ({ text: '代表性任务完成' })) {
  const root = await mkdtemp(join(tmpdir(), 'axon-r2-trial-')); cleanups.push(() => rm(root, { recursive: true, force: true }));
  const model = { ...testConfig(root), auth: { secret: 'production-secret-do-not-copy-'.repeat(2), sessionMs: 3600000 },
    testSeats: [{ id: 'production-seat', name: '不可借用' }], agentRolesDir: '/production/private-role-path' };
  let authorized = true;
  const captured: Array<Awaited<ReturnType<typeof fakeRuntime>>> = [];
  const configs: LabConfig[] = [];
  const updates: ExpertTrialRecord[] = [];
  const options: CapabilityTrialsOptions = { dataDir: root, modelConfig: () => model,
    authorize: () => { if (!authorized) throw new RequestError('FORBIDDEN', '管理员已撤权。', 403); },
    runtimeFactory: async (config: LabConfig) => { configs.push(config); const fake = await fakeRuntime(config, reply); captured.push(fake); return fake.runtime; },
    onUpdate: (_actor: ManagementActor, trial: ExpertTrialRecord) => { updates.push(trial); }, authorizationPollMs: 10 };
  const service = await CapabilityTrials.open(options); cleanups.push(() => service.close());
  return { root, service, options, configs, captured, updates, revoke: () => { authorized = false; } };
}

describe('R2 isolated draft trials using the native Pi loop', () => {
  it('uses a fixed unpublished snapshot, synthetic sources and native trial manifests without copying production config', async () => {
    const env = await setup(context => context.messages.at(-1)?.role === 'toolResult' ? { text: '已核对合成资料' }
      : { tools: [{ name: 'source_read', arguments: { id: 'meeting-notes' } }] });
    const expert = await fixed(['source_read'], true); const trial = prepared(expert);
    await env.service.start(actor, { trial, expert }); const done = await env.service.wait(actor, trial.trialId);
    expect(done.trial.status).toBe('succeeded'); expect(done.trial.confirmedAt).toBeUndefined();
    expect(done.trial.evidence).toMatchObject({ success: true, tools: ['source_read'], fileEnvironmentVerified: false });
    expect(done.environment).toMatchObject({ sources: 'synthetic-fixtures', businessWrites: false });
    expect(done.calls[0]).toMatchObject({ name: 'source.read', status: 'completed', isError: false });
    expect(done.calls[0].output).toContain('虚构样例');
    expect(env.configs[0]).toMatchObject({ seatId: 'trial-seat' });
    expect(env.configs[0].auth).toBeUndefined(); expect(env.configs[0].testSeats).toBeUndefined(); expect(env.configs[0].agentRolesDir).toBeUndefined();
    expect(env.captured[0].calls[0].context.systemPrompt).toContain('FIXED-DRAFT-INSTRUCTIONS');
    expect(env.captured[0].calls[0].context.tools?.map(tool => tool.name)).toEqual(['source_read']);
    const stored = await readFile(join(env.root, 'capability-trials', trial.trialId, 'record.json'), 'utf8');
    expect(stored).not.toContain('production-secret'); expect(await readdir(env.root)).toEqual(['capability-trials']);
    const scanSecrets = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await scanSecrets(path);
        else { const bytes = await readFile(path, 'utf8'); expect(bytes).not.toContain('fake-key-NEVER-LEAK-123'); expect(bytes).not.toContain('production-secret'); }
      }
    };
    await scanSecrets(join(env.root, 'capability-trials', trial.trialId));
    const sessionDir = join(env.root, 'capability-trials', trial.trialId, 'data', 'sessions');
    const path = (await readdir(sessionDir)).find(name => name.endsWith('.jsonl'))!;
    const manager = await openStrictSession(join(sessionDir, path), sessionDir);
    expect(manager.getEntries().find(e => e.type === 'custom' && e.customType === EXECUTION_MANIFEST)).toMatchObject({ data: { mode: 'trial', digest: expert.digest } });
  });

  it('deduplicates concurrent/restarted same trial starts and rejects changed samples without replay', async () => {
    const env = await setup(); const expert = await fixed(); const trial = prepared(expert);
    const starts = await Promise.all(Array.from({ length: 3 }, () => env.service.start(actor, { trial, expert }, [{ name: 'sample.csv', content: 'name,count\na,1' }])));
    expect(starts.every(r => r.trial.trialId === trial.trialId)).toBe(true);
    await env.service.wait(actor, trial.trialId); expect(env.captured).toHaveLength(1); expect(env.captured[0].calls).toHaveLength(1);
    await expect(env.service.start(actor, { trial, expert }, [{ name: 'sample.csv', content: 'changed' }])).rejects.toMatchObject({ code: 'EXPERT_TRIAL_UNAVAILABLE' });
    await env.service.close(); const reopened = await CapabilityTrials.open(env.options); cleanups.push(() => reopened.close());
    expect(reopened.get(actor, trial.trialId).trial.status).toBe('succeeded');
    await reopened.start(actor, { trial, expert }, [{ name: 'sample.csv', content: 'name,count\na,1' }]); expect(env.captured).toHaveLength(1);
  });

  it('fails unavailable file/business environments before any model call and rejects path-bearing sample names', async () => {
    const env = await setup();
    for (const tools of [['write'], ['unimplemented_external_tool']]) {
      const expert = await fixed(tools); const trial = prepared(expert);
      await env.service.start(actor, { trial, expert }); const done = await env.service.wait(actor, trial.trialId);
      expect(done.trial.status).toBe('failed'); expect(done.trial.evidence?.success).toBe(false);
      expect(done.trial.evidence?.fileEnvironmentVerified).toBe(false);
    }
    expect(env.captured.flatMap(f => f.calls)).toHaveLength(0);
    const expert = await fixed();
    await expect(env.service.start(actor, { trial: prepared(expert), expert }, [{ name: '../secret', content: 'x' }])).rejects.toMatchObject({ code: 'EXPERT_TRIAL_UNAVAILABLE' });
  });

  it('runs explicit business test substitutes without production services or false external verification', async () => {
    const env = await setup(context => context.messages.at(-1)?.role === 'toolResult' ? { text: '仅为模拟试用，未执行正式业务' }
      : { tools: [{ name: 'work_item_read', arguments: { scenario: '合成示例' } }] });
    const expert = await fixed(['work_item_read', 'work_item_action']); const trial = prepared(expert);
    await env.service.start(actor, { trial, expert }); const done = await env.service.wait(actor, trial.trialId);
    expect(done.trial.status).toBe('succeeded');
    expect(done.trial.evidence?.unverified).toContain('work_item_read:real-business-integration-and-schema');
    expect(done.trial.evidence?.tools).toEqual(['work_item_read']);
    expect(done.trial.evidence?.unverified).toContain('excluded:work_item_action');
    expect(done.calls[0].output).toContain('"productionEffect":false');
    expect(done.calls[0].output).toContain('"simulated":true');
    expect(done.snapshot?.fileOutputs || []).toEqual([]);
    const control = join(env.root, 'control');
    await expect(PiLab.create(testConfig(control), undefined, undefined, { extraTrialTools: syntheticTrialTools(['work_item_read']) }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await readdir(env.root)).not.toContain('control');
  });

  it('routes file creation and frozen downloads through an isolated execution environment', async () => {
    const env = await setup((_context, index) => index === 0 ? { tools: [{ name: 'write', arguments: { path: 'trial-report.md', content: '# Synthetic report\nTotal: 3\n' } }] }
      : index === 1 ? { tools: [{ name: 'file_output', arguments: { path: 'trial-report.md' } }] } : { text: '合成报告已交付' });
    let workspace = '';
    const result = (body = '') => ({ code: 0, stdout: Buffer.from(body), stderr: Buffer.alloc(0) });
    const runner: DockerRunner = async (args, options) => {
      if (args[0] === 'info') return result('linux');
      if (args[0] === 'run') {
        const mount = args.find(arg => arg.startsWith('type=bind,src=') && arg.endsWith(',dst=/workspace'))!;
        workspace = mount.slice('type=bind,src='.length, -',dst=/workspace'.length); return result();
      }
      if (args[0] !== 'exec') return result();
      const at = args.indexOf('/opt/berserk/files.py'); const [operation, file] = args.slice(at + 1);
      const path = join(workspace, file.replace(/^\/workspace\/?/, ''));
      if (operation === 'write') { await writeFile(path, options!.input!); return result(); }
      if (operation === 'mkdir') { await mkdir(path, { recursive: true }); return result(); }
      if (operation === 'stat') return result(JSON.stringify({ directory: file === '/workspace' }));
      if (operation === 'read') return { ...result(), stdout: await readFile(path) };
      if (operation === 'exists') return result('true');
      throw new Error(`Unexpected fake operation ${operation}`);
    };
    env.options.executionFactory = config => new DockerExecutionService({ instanceId: config.dataDir }, runner);
    const expert = await fixed(['write', 'file_output']); const trial = prepared(expert);
    await env.service.start(actor, { trial, expert }); const done = await env.service.wait(actor, trial.trialId);
    expect(done.trial.status).toBe('succeeded'); expect(done.trial.evidence?.fileEnvironmentVerified).toBe(true);
    expect(workspace).toContain(join('capability-trials', trial.trialId, 'data'));
    const output = done.snapshot!.fileOutputs![0]; expect(output.name).toBe('trial-report.md');
    const download = await env.service.download(actor, trial.trialId, output.downloadId); const chunks: Buffer[] = [];
    for await (const chunk of download.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toContain('Total: 3');
    await writeFile(join(workspace, 'trial-report.md'), 'changed later');
    const frozen = await env.service.download(actor, trial.trialId, output.downloadId); const saved: Buffer[] = [];
    for await (const chunk of frozen.stream) saved.push(Buffer.from(chunk));
    expect(Buffer.concat(saved).toString()).toContain('Total: 3');
  });

  it('does not pass a representative trial that attempts an excluded business write', async () => {
    const env = await setup(context => context.messages.at(-1)?.role === 'toolResult' ? { text: '不能执行该业务写入' }
      : { tools: [{ name: 'work_item_action', arguments: { action: 'submit' } }] });
    const expert = await fixed(['work_item_action']); const trial = prepared(expert);
    await env.service.start(actor, { trial, expert }); const done = await env.service.wait(actor, trial.trialId);
    expect(done.trial.status).toBe('failed'); expect(done.trial.evidence?.success).toBe(false);
    expect(done.trial.confirmedAt).toBeUndefined();
  });

  it('cancels a waiting question; closed/reopened trials do not retry or become publishable', async () => {
    const env = await setup(() => ({ tools: [{ name: 'ask_user', arguments: { questions: [{ id: 'format', prompt: '请确认测试格式' }] } }] }));
    const expert = await fixed(['ask_user']); const trial = prepared(expert);
    await env.service.start(actor, { trial, expert });
    await vi.waitFor(() => expect(env.service.get(actor, trial.trialId).snapshot?.active?.phase).toBe('waiting_answer'));
    expect(() => env.service.get({ userId: 'other-admin' }, trial.trialId)).toThrowError(expect.objectContaining({ statusCode: 404 }));
    const cancelled = await env.service.cancel(actor, trial.trialId);
    expect(cancelled.trial.status).toBe('cancelled'); expect(cancelled.trial.evidence?.success).toBe(false);
    expect(env.captured[0].calls).toHaveLength(1);
    await env.service.close(); const reopened = await CapabilityTrials.open(env.options); cleanups.push(() => reopened.close());
    expect(reopened.get(actor, trial.trialId).snapshot?.active).toBeNull(); expect(env.captured[0].calls).toHaveLength(1);
  });

  it('revokes administrator access while waiting and blocks further tools/confirmation', async () => {
    const env = await setup((_context, index): Reply => index === 0
      ? { tools: [{ name: 'ask_user', arguments: { questions: [{ id: 'format', prompt: '确认?' }] } }] } : { tools: [{ name: 'source_read', arguments: { id: 'meeting-notes' } }] });
    const expert = await fixed(['ask_user', 'source_read']); const trial = prepared(expert);
    await env.service.start(actor, { trial, expert });
    await vi.waitFor(() => expect(env.service.get(actor, trial.trialId).snapshot?.active?.phase).toBe('waiting_answer'));
    env.revoke();
    expect(() => env.service.get(actor, trial.trialId)).toThrowError(expect.objectContaining({ statusCode: 403 }));
    await vi.waitFor(() => expect(env.updates.at(-1)?.status).toBe('failed'));
    expect(env.captured[0].calls).toHaveLength(1); expect(env.updates.at(-1)?.evidence?.success).toBe(false);
  });

  it('does not automatically repeat a chargeable trial when the provider returns a transient error', async () => {
    const env = await setup(() => ({ error: '429 rate limit exceeded' }));
    const expert = await fixed(); const trial = prepared(expert);
    await env.service.start(actor, { trial, expert }); const done = await env.service.wait(actor, trial.trialId);
    expect(done.trial.status).toBe('failed'); expect(env.captured[0].calls).toHaveLength(1);
    await env.service.start(actor, { trial, expert }); expect(env.captured[0].calls).toHaveLength(1);
  });

  it('marks persisted in-flight trials interrupted on process recovery without constructing a runtime', async () => {
    const env = await setup(); const expert = await fixed(); const trial = prepared(expert);
    await env.service.start(actor, { trial, expert }); await env.service.wait(actor, trial.trialId); await env.service.close();
    const path = join(env.root, 'capability-trials', trial.trialId, 'record.json'); const record = JSON.parse(await readFile(path, 'utf8'));
    record.trial.status = 'running'; record.snapshot.active = { requestId: randomUUID(), status: 'responding' }; await writeFile(path, JSON.stringify(record));
    const reopened = await CapabilityTrials.open(env.options); cleanups.push(() => reopened.close());
    const recovered = reopened.get(actor, trial.trialId);
    expect(recovered.trial.status).toBe('interrupted'); expect(recovered.trial.evidence?.success).toBe(false); expect(recovered.snapshot?.active).toBeNull();
    await reopened.start(actor, { trial, expert }); expect(env.captured).toHaveLength(1);
  });
});
