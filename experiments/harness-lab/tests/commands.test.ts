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
import type { CommandInput, CommandRecord, CommandReceipt, TaskExecutionSummary } from '../src/contracts/commands.js';
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
async function setup(version = '4') {
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
    const created = await d.call('/api/simulation/instances', { definitionId: 'harbor-fire', version, mode: 'source_replay', clientActionId: randomUUID() });
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


describe('外部执行进展与调整集成', () => {
  it('接收与执行分别返回，查询不推进场景时间，调整须引用根指令和最新执行版本', async () => {
    const f = await setup('5');
    const { record, client } = await f.prepare();
    const sent = await client.call(`/api/commands/${record.id}/commit`, { confirm: true });
    expect(sent.statusCode, sent.body).toBe(200);
    const accepted = sent.json<CommandRecord>();
    expect(accepted.status).toBe('received');
    expect(accepted.executionError).toBeUndefined();
    expect(accepted.execution).toMatchObject({ protocolVersion: 2, commandId: record.id, rootCommandId: record.id, status: 'accepted' });
    const snapshot = accepted.execution!;
    expect(snapshot.vehicles.map(item => item.vehicle.objectId)).toEqual(f.command.vehicles.map(item => item.objectId));
    const read = (await client.call(`/api/commands/${record.id}/execution`)).json<CommandRecord>();
    expect(read.execution).toEqual(snapshot);
    const invalid = await client.call('/api/commands/prepare', { workspaceId: f.workspaceId, clientActionId: randomUUID(), command: { ...f.command, action: 'reroute' } });
    expect(invalid.statusCode).toBe(400);
    const changed = await client.call('/api/commands/prepare', { workspaceId: f.workspaceId, clientActionId: randomUUID(), command: {
      ...f.command, action: 'reroute', targetCommandId: record.id, expectedExecutionRevision: snapshot.revision + 1,
    } });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error.code).toBe('COMMAND_EXECUTION_CONFLICT');
  }, 30000);

  it('取消执行通过新的确认指令提交，保留原接收回执并更新根进展', async () => {
    const f = await setup('5');
    const { record, client } = await f.prepare();
    const original = (await client.call(`/api/commands/${record.id}/commit`, { confirm: true })).json<CommandRecord>();
    expect(original.execution?.status).toBe('accepted');
    const prepared = await client.call('/api/commands/prepare', { workspaceId: f.workspaceId, clientActionId: randomUUID(), command: {
      ...f.command, action: 'cancel', route: [], targetCommandId: record.id, expectedExecutionRevision: original.execution!.revision,
    } });
    expect(prepared.statusCode, prepared.body).toBe(200);
    const operation = prepared.json<CommandRecord>();
    expect(operation.status).toBe('prepared');
    expect((await client.call(`/api/commands/${record.id}/execution`)).json<CommandRecord>().execution?.revision).toBe(original.execution!.revision);
    const cancelled = (await client.call(`/api/commands/${operation.id}/commit`, { confirm: true })).json<CommandRecord>();
    expect(cancelled.status).toBe('received');
    expect(cancelled.executionError).toBeUndefined();
    expect(cancelled.execution).toMatchObject({ commandId: operation.id, rootCommandId: record.id, status: 'cancelled' });
    const root = (await client.call(`/api/commands/${record.id}/execution`)).json<CommandRecord>();
    expect(root.receipt).toEqual(original.receipt);
    expect(root.execution?.vehicles.every(item => item.state === 'cancelled')).toBe(true);
    expect(root.execution!.revision).toBeGreaterThan(original.execution!.revision);
    expect(root.execution?.history.some(item => item.commandId === operation.id && item.action === 'cancel')).toBe(true);
  }, 30000);

  it('旧接收回执查询不生成执行，错误调整和外任务原指令被拒绝', async () => {
    const f = await setup();
    const { record, client } = await f.prepare();
    const original = (await client.call(`/api/commands/${record.id}/commit`, { confirm: true })).json<CommandRecord>();
    expect(original.execution).toBeUndefined();
    expect(original.executionError).toBeUndefined();
    expect((await client.call(`/api/commands/${record.id}/execution`)).json<CommandRecord>().execution).toBeUndefined();
    const response = await client.call('/api/commands/prepare', { workspaceId: f.workspaceId, clientActionId: randomUUID(), command: {
      ...f.command, action: 'cancel', targetCommandId: record.id, expectedExecutionRevision: 1,
    } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('COMMAND_EXECUTION_UNAVAILABLE');
    const changed = await client.call('/api/commands/prepare', { workspaceId: f.workspaceId, clientActionId: randomUUID(), command: {
      ...f.command, action: 'reroute', targetCommandId: randomUUID(), expectedExecutionRevision: 1,
    } });
    expect(changed.statusCode).toBe(404);
  }, 30000);

  it('来源执行查询失败或返回错指令时，保留真实接收和上次进展并提示查询失败', async () => {
    const f = await setup('5');
    const { record, client } = await f.prepare();
    const original = (await client.call(`/api/commands/${record.id}/commit`, { confirm: true })).json<CommandRecord>();
    expect(original.execution).toBeDefined();
    const fetch = globalThis.fetch;
    for (const wrongId of [false, true]) {
      const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
        if (String(input).endsWith(`/commands/${record.id}/execution`)) {
          if (!wrongId) throw new TypeError('source unavailable');
          return Promise.resolve(new Response(JSON.stringify({ ...original.execution!, commandId: randomUUID() }), { headers: { 'Content-Type': 'application/json' } }));
        }
        return fetch(input, init);
      });
      try {
        const read = (await client.call(`/api/commands/${record.id}/execution`)).json<CommandRecord>();
        expect(read.status).toBe('received');
        expect(read.receipt).toEqual(original.receipt);
        expect(read.execution).toEqual(original.execution);
        expect(read.executionError).toBeTruthy();
      } finally { spy.mockRestore(); }
    }
    expect((await client.call(`/api/commands/${record.id}/execution`)).json<CommandRecord>().executionError).toBeUndefined();
  }, 30000);
});


describe('执行拒绝保持接收事实', () => {
  it('忙碌车辆指令可被接收但执行拒绝，原确认成功不能冒充车辆出发', async () => {
    const f = await setup('5'), client = await login(f.app, control);
    const command = { ...f.command, vehicles: [{ ...f.command.vehicles[0], objectId: `${f.a.run.instance.instanceId}-V02` }] };
    const prepared = await client.call('/api/commands/prepare', { workspaceId: f.workspaceId, clientActionId: randomUUID(), command });
    expect(prepared.statusCode, prepared.body).toBe(200);
    const id = prepared.json<CommandRecord>().id;
    const response = await client.call(`/api/commands/${id}/commit`, { confirm: true });
    expect(response.statusCode, response.body).toBe(200);
    const record = response.json<CommandRecord>();
    expect(record.status).toBe('received');
    expect(record.receipt?.commandId).toBe(id);
    expect(record.executionError).toBeUndefined();
    expect(record.execution).toMatchObject({ status: 'refused', commandId: id, rootCommandId: id });
    expect(record.execution?.reason).toBeTruthy();
    expect(record.execution?.vehicles.some(vehicle => vehicle.state === 'en_route' || vehicle.state === 'arrived')).toBe(false);
  }, 30000);
});

describe('调整确认中的执行版本竞争', () => {
  it('同修订准备两条调整，先提交的改道成功，后提交的旧修订取消收到执行拒绝', async () => {
    const f = await setup('5');
    const { record, client } = await f.prepare();
    const sent = (await client.call(`/api/commands/${record.id}/commit`, { confirm: true })).json<CommandRecord>();
    const revision = sent.execution!.revision;
    const prepare = async (action: 'reroute' | 'cancel') => {
      const response = await client.call('/api/commands/prepare', { workspaceId: f.workspaceId, clientActionId: randomUUID(), command: {
        ...f.command, action, targetCommandId: record.id, expectedExecutionRevision: revision,
      } });
      expect(response.statusCode, response.body).toBe(200);
      return response.json<CommandRecord>();
    };
    const [reroute, cancel] = await Promise.all([prepare('reroute'), prepare('cancel')]);
    const changed = (await client.call(`/api/commands/${reroute.id}/commit`, { confirm: true })).json<CommandRecord>();
    expect(changed.executionError).toBeUndefined();
    expect(changed.execution?.status).not.toBe('refused');
    expect(changed.execution!.revision).toBeGreaterThan(revision);
    const rejected = (await client.call(`/api/commands/${cancel.id}/commit`, { confirm: true })).json<CommandRecord>();
    expect(rejected.status).toBe('received');
    expect(rejected.executionError).toBeUndefined();
    expect(rejected.execution).toMatchObject({ status: 'refused', rootCommandId: record.id, commandId: cancel.id });
    expect(rejected.execution?.reason).toBeTruthy();
    const current = (await client.call(`/api/commands/${record.id}/execution`)).json<CommandRecord>();
    expect(current.execution?.vehicles.every(vehicle => vehicle.state === 'waiting')).toBe(true);
    expect(current.execution?.history.some(item => item.commandId === reroute.id && item.action === 'reroute')).toBe(true);
  }, 30000);
});

describe('任务首页只读执行摘要', () => {
  it('总体席读取来源事实但不能读取完整指令，摘要不写回指令或推进来源', async () => {
    const f = await setup('7'), { record, client } = await f.prepare();
    const sent = (await client.call(`/api/commands/${record.id}/commit`, { confirm: true })).json<CommandRecord>();
    expect(sent.execution?.vehicles[0].state).toBe('waiting');
    const before = f.lab.commands!.read(control, record.id);
    const postCount = f.source.requests.filter(item => item.method === 'POST').length;
    const o = await login(f.app, overall);
    expect((await o.call(`/api/commands/${record.id}`)).statusCode).toBe(404);
    const response = await o.call(`/api/tasks/${f.a.taskId}/execution-summary`);
    expect(response.statusCode, response.body).toBe(200);
    const summary = response.json<TaskExecutionSummary>();
    expect(summary).toMatchObject({ available: true, readOnly: false, complete: true, counts: { waiting: 1, arrived: 0 } });
    expect(summary.businessNow).toBe(sent.execution!.businessNow);
    expect(summary.groups).toHaveLength(1);
    expect(summary.groups[0]).toMatchObject({ id: record.id, status: 'current', vehicles: [{ ref: f.command.vehicles[0], state: 'waiting' }] });
    expect(summary.groups[0].destination.name).not.toContain('名称待核实');
    expect(summary.groups[0].vehicles[0].name).not.toContain('名称待核实');
    expect(summary.groups[0].commandId).toBeUndefined();
    for (const key of ['workspaceId', 'attachment', 'notes', 'issuedByUserId', 'preparedByUserId', 'scenarioInstanceId', 'history', 'path', 'trace']) expect(response.body).not.toContain(`"${key}"`);
    const own = (await client.call(`/api/tasks/${f.a.taskId}/execution-summary`)).json<TaskExecutionSummary>();
    expect(own.groups[0].commandId).toBe(record.id);
    expect(f.lab.commands!.read(control, record.id)).toEqual(before);
    expect(f.source.requests.filter(item => item.method === 'POST')).toHaveLength(postCount);
  }, 30000);

  it('准备、未知结果及其他任务不产生本任务执行，普通任务与停用集成返回不可用', async () => {
    const f = await setup('7'), { record } = await f.prepare(), o = await login(f.app, overall);
    const empty = await o.call(`/api/tasks/${f.a.taskId}/execution-summary`);
    expect(empty.json<TaskExecutionSummary>().groups).toEqual([]);
    const db = new DatabaseSync(join(f.lab.config.dataDir, 'commands', 'commands.sqlite'));
    try {
      const raw = JSON.parse(String(db.prepare('SELECT body FROM commands WHERE id=?').get(record.id)!.body));
      raw.status = 'unknown'; raw.issuedByUserId = raw.preparedByUserId;
      db.prepare('UPDATE commands SET body=? WHERE id=?').run(JSON.stringify(raw), record.id);
      expect((await o.call(`/api/tasks/${f.a.taskId}/execution-summary`)).json<TaskExecutionSummary>().groups).toEqual([]);
    } finally { db.close(); }
    const ordinary = (await o.call('/api/tasks', { title: '普通任务', goal: '无来源任务', visibility: 'public', clientActionId: randomUUID() })).json<{ id: string }>();
    expect((await o.call(`/api/tasks/${ordinary.id}/execution-summary`)).json<TaskExecutionSummary>()).toMatchObject({ available: false, groups: [], complete: false });
    expect((await o.call(`/api/tasks/${randomUUID()}/execution-summary`)).statusCode).toBe(404);
    f.context.commands!.enabled = false;
    await f.restart();
    const re = await login(f.app, overall);
    expect((await re.call(`/api/tasks/${f.a.taskId}/execution-summary`)).json<TaskExecutionSummary>()).toMatchObject({ available: false, groups: [] });
  }, 30000);

  it('来源授权与当前账号在读取前后均核验，来源403不能回退显示缓存', async () => {
    const f = await setup('7'), { record, client } = await f.prepare();
    await client.call(`/api/commands/${record.id}/commit`, { confirm: true });
    const o = await login(f.app, overall), scope = f.lab.context!.config.scopes[0];
    scope.seatIds = scope.seatIds.filter(id => id !== overall);
    expect((await o.call(`/api/tasks/${f.a.taskId}/execution-summary`)).statusCode).toBe(403);
    scope.seatIds.push(overall);
    const original = globalThis.fetch;
    for (const revoke of ['http403', 'scope', 'account'] as const) {
      const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        if (String(input).endsWith(`/commands/${record.id}/execution`)) {
          if (revoke === 'http403') return new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), { status: 403, headers: { 'Content-Type': 'application/json' } });
          const response = await original(input, init);
          if (revoke === 'scope') scope.seatIds = scope.seatIds.filter(id => id !== overall);
          else f.lab.access!.disable(overall);
          return response;
        }
        return original(input, init);
      });
      try {
        const response = await o.call(`/api/tasks/${f.a.taskId}/execution-summary`);
        expect(response.statusCode, response.body).toBe(403);
        expect(response.body).not.toContain('vehicles');
      } finally { spy.mockRestore(); }
      if (revoke === 'scope') scope.seatIds.push(overall);
    }
  }, 30000);

  it('取消与改道归并原派遣，混合时点、缺失对象和来源失败不返回完整总数', async () => {
    const f = await setup('7'), { record, client } = await f.prepare();
    const sent = (await client.call(`/api/commands/${record.id}/commit`, { confirm: true })).json<CommandRecord>();
    const operation = (await client.call('/api/commands/prepare', { workspaceId: f.workspaceId, clientActionId: randomUUID(), command: { ...f.command, action: 'cancel', targetCommandId: record.id, expectedExecutionRevision: sent.execution!.revision } })).json<CommandRecord>();
    await client.call(`/api/commands/${operation.id}/commit`, { confirm: true });
    const o = await login(f.app, overall);
    const cancelled = (await o.call(`/api/tasks/${f.a.taskId}/execution-summary`)).json<TaskExecutionSummary>();
    expect(cancelled.groups).toHaveLength(1);
    expect(cancelled.counts?.cancelled).toBe(1);
    expect(cancelled.counts?.arrived).toBe(0);
    const original = globalThis.fetch;
    for (const fault of ['time', 'names', 'offline'] as const) {
      const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const path = String(input);
        if (fault === 'offline' && path.endsWith(`/commands/${record.id}/execution`)) throw new TypeError('offline');
        const response = await original(input, init);
        if (fault === 'time' && path.endsWith(`/commands/${record.id}/execution`)) {
          const body = await response.json();
          return new Response(JSON.stringify({ ...body, businessNow: '2026-11-03T09:11:00+08:00' }), { headers: { 'Content-Type': 'application/json' } });
        }
        if (fault === 'names' && path.includes('/situation/objects')) {
          const body = await response.json();
          return new Response(JSON.stringify({ ...body, items: [], unknownRefs: [...f.command.vehicles, f.command.destination] }), { headers: { 'Content-Type': 'application/json' } });
        }
        return response;
      });
      try {
        const summary = (await o.call(`/api/tasks/${f.a.taskId}/execution-summary`)).json<TaskExecutionSummary>();
        expect(summary.complete).toBe(false);
        expect(summary.counts).toBeUndefined();
        if (fault !== 'time') expect(summary.groups[0].status).toBe('saved');
      } finally { spy.mockRestore(); }
    }
  }, 30000);

  it('旧版本无执行与执行拒绝不冒充出发，历史任务保留本轮事实', async () => {
    const legacy = await setup(), prepared = await legacy.prepare();
    await prepared.client.call(`/api/commands/${prepared.record.id}/commit`, { confirm: true });
    const legacySummary = await legacy.lab.commands!.summary(overall, legacy.a.taskId);
    expect(legacySummary.groups[0].status).toBe('unsupported');
    expect(legacySummary.counts).toBeUndefined();
    const f = await setup('7'), c = await login(f.app, control);
    const busy = { ...f.command, vehicles: [{ ...f.command.vehicles[0], objectId: `${f.a.run.instance.instanceId}-V02` }] };
    const rejected = (await c.call('/api/commands/prepare', { workspaceId: f.workspaceId, clientActionId: randomUUID(), command: busy })).json<CommandRecord>();
    await c.call(`/api/commands/${rejected.id}/commit`, { confirm: true });
    const refused = await f.lab.commands!.summary(overall, f.a.taskId);
    expect(refused.groups[0].status).toBe('refused');
    expect(refused.counts).toBeUndefined();
    const { record, client } = await f.prepare();
    await client.call(`/api/commands/${record.id}/commit`, { confirm: true });
    f.lab.scenario!.close(f.a.run.instance.instanceId);
    const history = await f.lab.commands!.summary(overall, f.a.taskId);
    expect(history.readOnly).toBe(true);
    expect(history.groups.some(group => group.id === record.id && group.status === 'saved')).toBe(true);
    expect(history.counts).toBeUndefined();
    expect(JSON.stringify(history)).not.toContain('scenarioInstanceId');
  }, 45000);
});

describe('执行摘要重复派遣与边界', () => {
  it('取消后同车再派遣保留原行动历史而不双计，其他任务看不到本任务车辆', async () => {
    const f = await setup('7'), { record, client } = await f.prepare();
    const sent = (await client.call(`/api/commands/${record.id}/commit`, { confirm: true })).json<CommandRecord>();
    const cancel = (await client.call('/api/commands/prepare', { workspaceId: f.workspaceId, clientActionId: randomUUID(), command: { ...f.command, action: 'cancel', targetCommandId: record.id, expectedExecutionRevision: sent.execution!.revision } })).json<CommandRecord>();
    await client.call(`/api/commands/${cancel.id}/commit`, { confirm: true });
    const again = (await client.call('/api/commands/prepare', { workspaceId: f.workspaceId, clientActionId: randomUUID(), command: f.command })).json<CommandRecord>();
    const received = (await client.call(`/api/commands/${again.id}/commit`, { confirm: true })).json<CommandRecord>();
    expect(received.execution?.status).toBe('accepted');
    const result = await f.lab.commands!.summary(overall, f.a.taskId);
    expect(result.groups).toHaveLength(2);
    expect(result.groups.find(group => group.id === record.id)).toMatchObject({ status: 'saved', vehicles: [{ state: 'cancelled' }] });
    expect(result.groups.find(group => group.id === again.id)).toMatchObject({ status: 'current', vehicles: [{ state: 'waiting' }] });
    expect(result.complete).toBe(false);
    expect(result.counts).toBeUndefined();
    const fetchSource = globalThis.fetch;
    const ambiguous = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const response = await fetchSource(input, init);
      if (String(input).includes('/situation/objects')) {
        const body = await response.json();
        for (const object of body.items) object.properties = {};
        return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
      }
      return response;
    });
    try {
      const uncertain = await f.lab.commands!.summary(overall, f.a.taskId);
      expect(uncertain.groups.every(group => group.status === 'current')).toBe(true);
      expect(uncertain.complete).toBe(false);
      expect(uncertain.counts).toBeUndefined();
    } finally { ambiguous.mockRestore(); }
    const task = f.lab.access!.get(f.a.taskId, overall), actor = f.lab.access!.identityForSeat(director)!;
    const other = f.lab.access!.create(actor, { title: '另一个任务', goal: '同一世界中的其他业务', visibility: 'public', clientActionId: randomUUID() }, task.scenarioInstanceId);
    const separate = await f.lab.commands!.summary(overall, other.id);
    expect(separate.groups).toEqual([]);
    expect(JSON.stringify(separate)).not.toContain(record.id);
    const privateTask = f.lab.access!.create(actor, { title: '私有资料', goal: '不可共享', visibility: 'private', clientActionId: randomUUID() }, task.scenarioInstanceId);
    await expect(f.lab.commands!.summary(control, privateTask.id)).rejects.toMatchObject({ statusCode: 404 });
  }, 30000);

  it('大量根记录明确拒绝而不截断，最终撤销控制授权后不保留指令详情入口', async () => {
    const f = await setup('7'), { record, client } = await f.prepare();
    await client.call(`/api/commands/${record.id}/commit`, { confirm: true });
    const original = globalThis.fetch;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const response = await original(input, init);
      if (String(input).endsWith(`/commands/${record.id}/execution`)) f.lab.context!.config.commands!.seatIds = [];
      return response;
    });
    try {
      const summary = await f.lab.commands!.summary(control, f.a.taskId);
      expect(summary.groups).toHaveLength(1);
      expect(summary.groups[0].commandId).toBeUndefined();
    } finally { spy.mockRestore(); }
    const db = new DatabaseSync(join(f.lab.config.dataDir, 'commands', 'commands.sqlite'));
    try {
      const raw = JSON.parse(String(db.prepare('SELECT body FROM commands WHERE id=?').get(record.id)!.body));
      for (let index = 0; index < 100; index++) {
        const id = randomUUID();
        db.prepare('INSERT INTO commands VALUES(?,?,?)').run(id, `summary-limit-${index}`, JSON.stringify({ ...raw, id, dedupKey: `summary-limit-${index}`, receipt: { ...raw.receipt, commandId: id }, execution: undefined }));
      }
      const before = f.source.requests.length;
      await expect(f.lab.commands!.summary(overall, f.a.taskId)).rejects.toMatchObject({ code: 'COMMAND_SUMMARY_LIMIT', statusCode: 503 });
      expect(f.source.requests).toHaveLength(before);
    } finally { db.close(); }
  }, 30000);
});
