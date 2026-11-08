import { DatabaseSync } from 'node:sqlite';
import { CommandService } from '../src/commands/service.js';
import { commandHash } from '../src/commands/validation.js';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { parseBackgroundConfig } from '../src/background/config.js';
import { BackgroundStore } from '../src/background/store.js';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { createMockContextServer } from '../scripts/mock-context/server.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';
import type { AuthSession } from '../src/contracts/access.js';
import type { CommandInput, CommandRecord, CommandReceipt } from '../src/contracts/commands.js';
import type { ContextConfig } from '../src/context/config.js';
import type { ScenarioMutationResult, ScenarioTaskInitialization, ScenarioInstances } from '../src/contracts/scenarios.js';
import type { ConfirmationInteraction, InteractionResponse } from '../src/contracts/index.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const director = 'seat-director', control = 'seat-control', overall = 'seat-overall';
const password = 'command-integration-password';
async function login(app: FastifyInstance, seatId: string) {
  const boot = await app.inject('/api/auth/session');
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: {
    cookie: boot.cookies.map(c => `${c.name}=${c.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': boot.json<AuthSession>().csrf!,
  }, payload: { seatId, password } });
  expect(response.statusCode, response.body).toBe(200);
  const auth = response.json<AuthSession>();
  const headers = { cookie: response.cookies.map(c => `${c.name}=${c.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': auth.csrf!, 'x-axon-view': auth.viewId! };
  return { auth, call: (url: string, payload?: object) => app.inject({ url, method: payload === undefined ? 'GET' : 'POST', headers, ...(payload === undefined ? {} : { payload }) }) };
}
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'axon-commands-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const env = { QUERY: 'command-query-token', CONTROL: 'command-control-token', INTEL: 'command-intel-source-token', SITUATION: 'command-situation-source-token' };
  let source = createMockContextServer({ token: env.QUERY, controlToken: env.CONTROL, scenariosEnabled: true, databasePath: join(directory, 'source.sqlite') });
  const base = await source.listen(); cleanup.push(() => source.close());
  const config = testConfig(join(directory, 'axon'), { auth: { secret: 'command-test-secret-with-at-least-32-characters', sessionMs: 28800000 }, seatId: overall });
  const db = await openDatabase(config.dataDir), access = new AccessStore(db);
  for (const seatId of [director, control, overall]) await access.saveAccount({ username: seatId, displayName: seatId, seatId, seatName: seatId,
    password, createPublicTask: seatId !== control, manageModelSettings: false, controlScenarios: seatId === director });
  db.close();
  const context: ContextConfig = { systems: [
    { id: 'intel', name: '特情', adapter: 'mock-information-http', baseUrl: `${base}/intel`, tokenEnv: 'QUERY', scenarioClock: true },
    { id: 'situation', name: '态势', adapter: 'mock-situation-http', baseUrl: `${base}/situation`, tokenEnv: 'QUERY', scenarioClock: true },
  ], scopes: [{ id: 'scene', name: '场景资料', systemIds: ['intel', 'situation'], seatIds: [director, control, overall] }],
  commands: { enabled: true, seatIds: [control] }, simulation: { enabled: true, baseUrl: base, tokenEnv: 'CONTROL', directorSeatId: director,
    sources: [{ systemId: 'intel', sourceId: 'intel-source' }, { systemId: 'situation', sourceId: 'situation-source' }] } };
  const background = parseBackgroundConfig({ enabled: true, sources: [
    { sourceId: 'intel-source', systemId: 'intel', name: '特情', credentialRef: 'INTEL', allowedProfileIds: ['analysis'], allowedRecipientSeatIds: [overall] },
    { sourceId: 'situation-source', systemId: 'situation', name: '态势', credentialRef: 'SITUATION', allowedProfileIds: ['analysis'], allowedRecipientSeatIds: [overall] },
  ], profiles: [{ id: 'analysis', name: '普通分析', goal: '读取来源', tools: ['source_read'] }] });
  let nextCommand: CommandInput | undefined;
  const fake = await fakeRuntime(config, ctx => {
    if (ctx.messages.at(-1)?.role === 'user' && nextCommand) return { tools: [{ name: 'simulation_command_send', arguments: { command: nextCommand } }] };
    return { text: '已核对本次实际工具结果。' };
  });
  async function open() {
    const lab = await PiLab.create(config, fake.runtime);
    const app = await createApp(lab, false, { config: background, env }, { config: context, env });
    const store = new BackgroundStore(lab.access!.db);
    for (const sourceId of ['intel-source', 'situation-source']) store.grant('seat', director, sourceId, 'view');
    return { lab, app };
  }
  let host = await open(); cleanup.push(() => host.app.close());
  async function create() {
    const d = await login(host.app, director);
    const created = await d.call('/api/simulation/instances', { definitionId: 'harbor-fire', version: '4', mode: 'source_replay', clientActionId: randomUUID() });
    expect(created.statusCode, created.body).toBe(200);
    const run = created.json<ScenarioMutationResult>();
    const initialized = await d.call(`/api/simulation/instances/${run.instance.instanceId}/initialize`, { clientActionId: randomUUID() });
    expect(initialized.statusCode, initialized.body).toBe(200);
    const tasks = initialized.json<ScenarioTaskInitialization>();
    const list = (await d.call('/api/simulation/instances')).json<ScenarioInstances>();
    if (list.activeInstanceId) {
      const old = list.items.find(item => item.instanceId === list.activeInstanceId)!;
      const paused = await d.call(`/api/simulation/instances/${old.instanceId}/control`, { clientActionId: randomUUID(), expectedRevision: old.revision, action: 'pause' });
      expect(paused.statusCode, paused.body).toBe(200);
    }
    const active = await d.call(`/api/simulation/instances/${run.instance.instanceId}/activate`, { clientActionId: randomUUID(), expectedRevision: run.instance.revision, expectedActiveRevision: list.activeRevision });
    expect(active.statusCode, active.body).toBe(200);
    return { run, taskId: tasks.tasks[0].taskId };
  }
  const a = await create(), c = await login(host.app, control);
  const ws = await c.call(`/api/tasks/${a.taskId}/workspace`, {});
  expect(ws.statusCode, ws.body).toBe(200);
  const workspaceId = ws.json<{ id: string }>().id;
  const ref = (suffix: string, objectType = 'resource') => ({ systemId: 'situation' as const, objectType, objectId: `${a.run.instance.instanceId}-${suffix}` });
  const command: CommandInput = { vehicles: [ref('V01')], destination: ref('L01'), route: [ref('R03', 'road')], notes: '核对后下达支援安排' };
  return { get source() { return source; }, env, base, context, command, a, workspaceId, create, get lab() { return host.lab; }, get app() { return host.app; },
    restartSource: async () => {
      await source.close();
      source = createMockContextServer({ token: env.QUERY, controlToken: env.CONTROL, scenariosEnabled: true, databasePath: join(directory, 'source.sqlite') });
      return source.listen();
    },
    setCommand(value: CommandInput) { nextCommand = value; },
    restart: async () => { await host.app.close(); host = await open(); },
    prepare: async () => {
      const client = await login(host.app, control);
      const response = await client.call('/api/commands/prepare', { workspaceId, clientActionId: randomUUID(), command });
      expect(response.statusCode, response.body).toBe(200);
      return { client, record: response.json<CommandRecord>() };
    } };
}

describe('指令下达与外部接收', () => {
  it('只有显式授权控制席可以下达，无文档、审核或工作交接也可接收；不改变车辆和场景时间', async () => {
    const f = await setup();
    const c = await login(f.app, control), o = await login(f.app, overall), d = await login(f.app, director);
    expect(c.auth.identity?.canIssueCommands).toBe(true);
    expect(o.auth.identity?.canIssueCommands).toBe(false);
    expect(d.auth.identity?.canIssueCommands).toBe(false);
    expect(c.auth.seats?.map(s => s.id)).toContain(control);
    for (const client of [o, d]) expect((await client.call(`/api/commands?taskId=${f.a.taskId}`)).statusCode).toBe(403);
    const { record, client } = await f.prepare();
    expect(record.status).toBe('prepared'); expect(record.attachment).toBeUndefined();
    const before = await f.lab.context!.query('situation_query', { systemId: 'situation', mode: 'current', limit: 100 }, { kind: 'seat', seatId: control, scenarioInstanceId: f.a.run.instance.instanceId });
    const committed = await client.call(`/api/commands/${record.id}/commit`, { confirm: true });
    expect(committed.statusCode, committed.body).toBe(200);
    const received = committed.json<CommandRecord>();
    expect(received).toMatchObject({ status: 'received', receipt: { commandId: record.id, contentHash: record.contentHash, status: 'received' } });
    expect(JSON.stringify(received)).not.toContain('scenarioInstanceId');
    const after = await f.lab.context!.query('situation_query', { systemId: 'situation', mode: 'current', limit: 100 }, { kind: 'seat', seatId: control, scenarioInstanceId: f.a.run.instance.instanceId });
    expect(after.data).toEqual(before.data);
    const retry = await client.call(`/api/commands/${record.id}/commit`, { confirm: true });
    expect(retry.json()).toEqual(received);
    expect(f.source.requests.filter(r => r.method === 'POST' && r.path === '/control/commands')).toHaveLength(1);
    await f.restart();
    const re = await login(f.app, control);
    expect((await re.call(`/api/commands/${record.id}`)).json()).toEqual(received);
  }, 30000);

  it('准备去重、取消、对象校验与普通任务入口可用性', async () => {
    const f = await setup(), c = await login(f.app, control), id = randomUUID();
    const input = { workspaceId: f.workspaceId, clientActionId: id, command: f.command };
    const first = (await c.call('/api/commands/prepare', input)).json<CommandRecord>();
    expect((await c.call('/api/commands/prepare', input)).json()).toEqual(first);
    expect((await c.call(`/api/commands?taskId=${f.a.taskId}&clientActionId=${id}`)).json()).toEqual([first]);
    expect((await c.call('/api/commands/prepare', { ...input, command: { ...f.command, notes: '改变内容' } })).statusCode).toBe(409);
    expect((await c.call('/api/commands/prepare', { ...input, clientActionId: randomUUID(), command: { ...f.command, vehicles: [f.command.destination] } })).statusCode).toBe(400);
    expect((await c.call(`/api/commands/${first.id}/cancel`, {})).json()).toMatchObject({ status: 'cancelled' });
    expect((await c.call(`/api/commands/${first.id}/commit`, { confirm: true })).statusCode).toBe(409);
    const o = await login(f.app, overall);
    const ordinary = (await o.call('/api/tasks', { title: '普通业务', goal: '无来源创建', visibility: 'public', clientActionId: randomUUID() })).json<{ id: string }>();
    expect((await c.call(`/api/commands/availability?taskId=${ordinary.id}`)).json()).toEqual({ canRead: false, canPrepare: false });
    expect(f.source.requests.filter(r => r.method === 'POST' && r.path === '/control/commands')).toHaveLength(0);
  }, 30000);

  it('控制席原生工具等待人员确认，page不能代替agent确认；历史重开保留真实回执', async () => {
    const f = await setup(); f.setCommand(f.command);
    const session = await f.lab.createSession(f.workspaceId, control);
    const run = f.lab.start(session.id, '下达本次安排', {}, control), done = run.run(() => {});
    await vi.waitFor(() => expect(f.lab.get(session.id, control).interactions?.some(x => x.status === 'pending')).toBe(true), { timeout: 10000 });
    const item = f.lab.get(session.id, control).interactions!.find(x => x.status === 'pending') as ConfirmationInteraction;
    expect(item.toolName).toBe('simulation_command_send');
    expect(f.source.requests.filter(r => r.method === 'POST' && r.path === '/control/commands')).toHaveLength(0);
    const client = await login(f.app, control);
    expect((await client.call(`/api/commands/${item.action.commandReference!.id}/commit`, { confirm: true })).statusCode).toBe(409);
    f.lab.respondInteraction(session.id, item.interactionId, { requestId: item.requestId, kind: 'confirmation', decision: 'approve' } as InteractionResponse, control);
    await done;
    expect(f.lab.get(session.id, control).interactions?.[0]).toMatchObject({ status: 'approved', execution: 'succeeded' });
    const receipt = (await client.call(`/api/commands/${item.action.commandReference!.id}`)).json<CommandRecord>();
    expect(receipt.status).toBe('received');
    await f.restart();
    expect(f.lab.get(session.id, control).interactions?.[0]).toMatchObject({ status: 'approved', execution: 'succeeded' });
  }, 30000);

  it('确认之前切轮，旧准备不能发送到新轮；已经接收的回执仍属于原指令', async () => {
    const f = await setup(), { record, client } = await f.prepare();
    await f.create();
    expect((await client.call(`/api/commands/${record.id}/commit`, { confirm: true })).statusCode).toBe(409);
    expect((await client.call(`/api/commands/${record.id}`)).json()).toMatchObject({ id: record.id, status: 'prepared' });
    const late = await fetch(`${f.base}/control/commands`, { method: 'POST', headers: { Authorization: `Bearer ${f.env.CONTROL}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: record.id, scenarioInstanceId: f.a.run.instance.instanceId, taskId: f.a.taskId, issuedBy: { seatId: control, seatName: control }, command: f.command, contentHash: commandHash(f.command) }) });
    expect(late.status).toBe(409);
    expect(f.source.requests.filter(r => r.method === 'POST' && r.path === '/control/commands' && r.status === 200)).toHaveLength(0);
  }, 30000);
  it('外部已接收但响应丢失时只核对原回执，重启和并发查询保持同一结果', async () => {
    const f = await setup(), { record, client } = await f.prepare();
    const original = globalThis.fetch;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const result = await original(input, init);
      if (String(input).endsWith('/control/commands') && init?.method === 'POST') {
        await result.text();
        throw new TypeError('response lost');
      }
      return result;
    });
    try {
      const result = (await client.call(`/api/commands/${record.id}/commit`, { confirm: true })).json<CommandRecord>();
      expect(result.status).toBe('unknown');
      expect((await client.call(`/api/commands/${record.id}/commit`, { confirm: true })).json<CommandRecord>().status).toBe('unknown');
    } finally { spy.mockRestore(); }
    await f.restart();
    const c = await login(f.app, control);
    const results = await Promise.all([c.call(`/api/commands/${record.id}/reconcile`, {}), c.call(`/api/commands/${record.id}/reconcile`, {})]);
    const receipts = results.map(r => r.json<CommandRecord>().receipt);
    expect(receipts[0]).toMatchObject({ commandId: record.id, status: 'received' });
    expect(receipts[1]).toEqual(receipts[0]);
    expect(f.source.requests.filter(r => r.method === 'POST' && r.path === '/control/commands')).toHaveLength(1);
    const external = await fetch(`${f.base}/control/commands/${record.id}`, { headers: { Authorization: `Bearer ${f.env.CONTROL}` } });
    expect(await external.json() as CommandReceipt).toEqual(receipts[0]);
  }, 30000);

  it('拒绝原生确认不发送，确认期间撤销授权也不能发送', async () => {
    const f = await setup(); f.setCommand(f.command);
    for (const revoke of [false, true]) {
      const session = await f.lab.createSession(f.workspaceId, control);
      const run = f.lab.start(session.id, '下达指令', {}, control), done = run.run(() => {});
      await vi.waitFor(() => expect(f.lab.get(session.id, control).interactions?.some(x => x.status === 'pending')).toBe(true), { timeout: 10000 });
      const item = f.lab.get(session.id, control).interactions!.find(x => x.status === 'pending') as ConfirmationInteraction;
      if (revoke) f.lab.context!.config.commands!.seatIds = [];
      f.lab.respondInteraction(session.id, item.interactionId, { requestId: item.requestId, kind: 'confirmation', decision: revoke ? 'approve' : 'reject' } as InteractionResponse, control);
      await done;
    }
    expect(f.source.requests.filter(r => r.method === 'POST' && r.path === '/control/commands')).toHaveLength(0);
  }, 30000);

  it('损坏的已接收记录缺少回执时重开失败并保留原数据', async () => {
    const f = await setup(), { record, client } = await f.prepare();
    expect((await client.call(`/api/commands/${record.id}/commit`, { confirm: true })).json<CommandRecord>().status).toBe('received');
    await f.app.close();
    const db = new DatabaseSync(join(f.lab.config.dataDir, 'commands', 'commands.sqlite'));
    const row = db.prepare('SELECT body FROM commands WHERE id=?').get(record.id)!;
    const original = JSON.parse(String(row.body));
    for (const defect of ['missing', 'wrong-id', 'wrong-hash', 'empty-receipt-id']) {
      const broken = structuredClone(original);
      if (defect === 'missing') delete broken.receipt;
      if (defect === 'wrong-id') broken.receipt.commandId = randomUUID();
      if (defect === 'wrong-hash') broken.receipt.contentHash = '0'.repeat(64);
      if (defect === 'empty-receipt-id') broken.receipt.receiptId = '';
      db.prepare('UPDATE commands SET body=? WHERE id=?').run(JSON.stringify(broken), record.id);
      await expect(CommandService.open(f.lab, f.env)).rejects.toThrow();
    }
    db.close();
  }, 30000);

  it('大车组分批核对来源，二十四辆车可以准备，重复车辆仍拒绝', async () => {
    const f = await setup(), c = await login(f.app, control);
    const vehicles = Array.from({ length: 24 }, (_, index) => ({ systemId: 'situation' as const, objectType: 'resource', objectId: `${f.a.run.instance.instanceId}-V${String(index + 1).padStart(2, '0')}` }));
    const prepared = await c.call('/api/commands/prepare', { workspaceId: f.workspaceId, clientActionId: randomUUID(), command: { ...f.command, vehicles, route: [] } });
    expect(prepared.statusCode, prepared.body).toBe(200);
    expect(prepared.json<CommandRecord>().command.vehicles).toHaveLength(24);
    const duplicate = await c.call('/api/commands/prepare', { workspaceId: f.workspaceId, clientActionId: randomUUID(), command: { ...f.command, vehicles: [vehicles[0], vehicles[0]] } });
    expect(duplicate.statusCode).toBe(400);
  }, 30000);

  it.each(['unknown', 'rejected'] as const)('原生指令返回%s时不投影成接收成功，历史重开保留该结果', async status => {
    const f = await setup(); f.setCommand(f.command);
    const session = await f.lab.createSession(f.workspaceId, control);
    const run = f.lab.start(session.id, '下达指令', {}, control), done = run.run(() => {});
    await vi.waitFor(() => expect(f.lab.get(session.id, control).interactions?.some(x => x.status === 'pending')).toBe(true), { timeout: 10000 });
    const item = f.lab.get(session.id, control).interactions!.find(x => x.status === 'pending') as ConfirmationInteraction;
    const original = globalThis.fetch;
    let spy: ReturnType<typeof vi.spyOn> | undefined;
    if (status === 'unknown') {
      spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const response = await original(input, init);
        if (String(input).endsWith('/control/commands') && init?.method === 'POST') { await response.text(); throw new TypeError('lost response'); }
        return response;
      });
    } else {
      // End A at the actual source while the already-prepared host still holds A.
      const actor = { userId: randomUUID(), seatId: director };
      const call = async (path: string, payload?: object) => {
        const response = await original(`${f.base}/control/${path}`, { method: payload ? 'POST' : 'GET', headers: { Authorization: `Bearer ${f.env.CONTROL}`, 'Content-Type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
        expect(response.status, await response.clone().text()).toBe(200);
        return response.json();
      };
      const b = await call('instances', { definitionId: 'harbor-fire', version: '4', mode: 'source_replay', clientActionId: randomUUID(), actor }) as ScenarioMutationResult;
      const a = await call(`instances/${f.a.run.instance.instanceId}`) as { instance: { revision: number } };
      await call(`instances/${f.a.run.instance.instanceId}/control`, { action: 'pause', clientActionId: randomUUID(), expectedRevision: a.instance.revision, actor });
      const list = await call('instances') as ScenarioInstances;
      await call(`instances/${b.instance.instanceId}/activate`, { clientActionId: randomUUID(), expectedRevision: b.instance.revision, expectedActiveRevision: list.activeRevision, actor });
    }
    try {
      f.lab.respondInteraction(session.id, item.interactionId, { requestId: item.requestId, kind: 'confirmation', decision: 'approve' } as InteractionResponse, control);
      await done;
    } finally { spy?.mockRestore(); }
    const expected = status === 'unknown' ? 'unknown' : 'failed';
    expect(f.lab.get(session.id, control).interactions?.[0]).toMatchObject({ status: 'approved', execution: expected });
    expect(f.lab.commands!.read(control, item.action.commandReference!.id).status).toBe(status);
    await f.restart();
    expect(f.lab.get(session.id, control).interactions?.[0]).toMatchObject({ status: 'approved', execution: expected });
  }, 30000);

  it('外部接收端自身重启仍返回原回执，相同编号修改内容被拒绝', async () => {
    const f = await setup(), { record, client } = await f.prepare();
    const received = (await client.call(`/api/commands/${record.id}/commit`, { confirm: true })).json<CommandRecord>();
    const input = { commandId: record.id, scenarioInstanceId: f.a.run.instance.instanceId, taskId: f.a.taskId,
      issuedBy: { seatId: control, seatName: control }, command: f.command, contentHash: record.contentHash };
    const restartedBase = await f.restartSource();
    const send = (body: object) => fetch(`${restartedBase}/control/commands`, { method: 'POST', headers: { Authorization: `Bearer ${f.env.CONTROL}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const duplicate = await send(input);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual(received.receipt);
    const invalid = { ...f.command, vehicles: [f.command.destination] };
    const rejected = await send({ ...input, commandId: randomUUID(), command: invalid, contentHash: commandHash(invalid) });
    expect(rejected.status).toBe(400);
    expect((await rejected.json() as { error: { code: string } }).error.code).toBe('INVALID_ARGUMENT');
    const changed = { ...f.command, notes: '另一份执行内容' };
    const conflict = await send({ ...input, command: changed, contentHash: commandHash(changed) });
    expect(conflict.status).toBe(409);
    expect((await conflict.json() as { error: { code: string } }).error.code).toBe('ACTION_CONFLICT');
    const read = await fetch(`${restartedBase}/control/commands/${record.id}`, { headers: { Authorization: `Bearer ${f.env.CONTROL}` } });
    expect(await read.json()).toEqual(received.receipt);
  }, 30000);

});
