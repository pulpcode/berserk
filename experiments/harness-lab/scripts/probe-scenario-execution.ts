/** Isolated v5 execution driver. Control actions are scripted human decisions; model semantics remain pending review. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccessStore } from '../src/access/store.js';
import { openDatabase } from '../src/access/database.js';
import { parseBackgroundConfig } from '../src/background/config.js';
import { BackgroundStore } from '../src/background/store.js';
import type { AuthSession, TaskSpace } from '../src/contracts/access.js';
import type { BackgroundJob, InboxDetail, InformationRule } from '../src/contracts/background.js';
import type { Workspace } from '../src/contracts/index.js';
import type { ScenarioAction, ScenarioDefinitions, ScenarioInstanceDetail, ScenarioInstances, ScenarioMutationResult, ScenarioPreview, ScenarioTaskInitialization } from '../src/contracts/scenarios.js';
import type { CommandInput, CommandRecord } from '../src/contracts/commands.js';
import type { TaskLinksView, TaskSuggestionCreateResult } from '../src/contracts/task-information.js';
import { parseContextConfig } from '../src/context/config.js';
import { createBackgroundExecutor } from '../src/pi/background-runner.js';
import { PiLab } from '../src/pi/lab.js';
import { configuredRuntime } from '../src/pi/model-runtime.js';
import { createApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import { createMockContextServer } from './mock-context/server.js';
import type { NotificationTarget } from './mock-context/control-api.js';
import { guardScenarioRuntime, ScenarioBudgetGuard } from './probe-scenario-budget.js';

import { scenarioBusinessOptions } from './probe-scenario-business.js';

const root = fileURLToPath(new URL('../', import.meta.url));
export const scenarioExecutionOptions = scenarioBusinessOptions;

export async function runScenarioExecution(options: ReturnType<typeof scenarioBusinessOptions>) {
  // No existing output, source database, accounts or model settings may be reused.
  await mkdir(options.output, { mode: 0o700 });
  const guard = new ScenarioBudgetGuard(options.budget, options.accounting), secrets: string[] = [];
  const encode = (value: unknown) => {
    let text = JSON.stringify(value, null, 2);
    for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]');
    return `${text}\n`;
  };
  const save = (name: string, value: unknown) => writeFile(join(options.output, name), encode(value), { mode: 0o600 });
  const record = async (kind: string, value: unknown) => {
    await appendFile(join(options.output, `${kind}.jsonl`), encode(value).trim().replace(/\n\s*/g, '') + '\n', { mode: 0o600 });
  };
  const config = loadConfig({ ...process.env, LAB_AUTH_MODE: 'test', LAB_TEST_SEATS: undefined, LAB_EXECUTION_ENABLED: 'false',
    LAB_LISTEN_HOST: '127.0.0.1', LAB_PUBLIC_ORIGIN: undefined, LAB_DATA_DIR: join(options.output, 'data'),
    ...(options.live ? {} : { LLM_API_KEY: '' }) });
  assert.ok(!options.live || config.apiKey, 'Live requires an explicitly configured model credential');
  assert.ok(config.contextReady, 'Explicit, verified model context/output configuration required');
  config.auth = { secret: randomBytes(40).toString('hex'), sessionMs: 8 * 60 * 60 * 1000 };
  config.seatId = 'seat-overall'; config.testSeats = undefined;
  config.agentRunTimeoutMs = options.budget ? options.budget.maxSeconds * 1000 : 0;
  const password = randomBytes(24).toString('hex'); secrets.push(password, config.auth.secret, config.apiKey);
  const env: NodeJS.ProcessEnv = {}, targets: NotificationTarget[] = [];
  const backgroundTemplate = parseBackgroundConfig(JSON.parse(await readFile(join(root, 'fixtures/scenario-demo/background.example.json'), 'utf8')));
  const contextTemplate = parseContextConfig(JSON.parse(await readFile(join(root, 'fixtures/scenario-demo/context.example.json'), 'utf8')));
  assert.equal(backgroundTemplate.sources.length, 2); assert.deepEqual(backgroundTemplate.sources.map(source => source.systemId).sort(), ['intel', 'situation']);
  assert.ok(contextTemplate.simulation?.enabled); assert.equal(contextTemplate.simulation.directorSeatId, 'seat-director');
  for (const key of [...backgroundTemplate.sources.map(source => source.credentialRef), ...contextTemplate.systems.map(system => system.tokenEnv), contextTemplate.simulation.tokenEnv]) {
    env[key] ??= randomBytes(32).toString('hex'); secrets.push(env[key]!);
  }
  const source = createMockContextServer({ token: env[contextTemplate.systems[0].tokenEnv]!, controlToken: env[contextTemplate.simulation.tokenEnv]!,
    databasePath: join(options.output, 'source.sqlite'), scenariosEnabled: true, targets });
  let app: Awaited<ReturnType<typeof createApp>> | undefined, lab: PiLab | undefined;
  const evidence: Record<string, unknown> = { schemaVersion: 1, mode: options.live ? 'live' : 'prepare-only',
    protocolCompleted: false, semanticReviewPending: true, scriptedControl: true, startedAt: new Date().toISOString(),
    budgetPolicy: options.accounting
      ? 'Usage-only: record actual requests, input+cache and output at supplied upper CNY rates without cumulative request/token/cost/time stopping. Individual provider limits, operator cancellation, evidence/provider failures and no automatic retries remain enforced. Not an account billing setting.'
      : 'Reserve explicitly verified provider input limit (independent of host compaction window) + maxOutputTokens output before each SDK request; settle reported input+cache and output (including reasoning) at supplied upper CNY rates. Unknown usage retains full reservation and stops. No HTTP retries, redirects, model discovery or fallback. This policy bounds dispatch under the verified model limits/rates; it is not an account billing setting.',
    model: { provider: config.provider, model: config.model, baseUrl: config.baseUrl, contextWindow: config.contextWindow, maxOutputTokens: config.maxOutputTokens,
      thinkingMode: config.thinkingMode ?? 'off', compactionReserveTokens: config.compactionReserveTokens, compactionKeepRecentTokens: config.compactionKeepRecentTokens },
    limits: options.budget ?? null, accountingOnly: options.accounting ?? null,
    rateReference: { url: 'https://docs.volcengine.com/docs/ark/model-pricing?lang=zh&redirect=1', currency: 'CNY',
      modelRow: 'deepseek-v4-1-flash', ownerVerifiedOn: '2026-11-06', peakInputPerMillion: 2, peakOutputPerMillion: 8,
      note: 'Reference metadata only. The batch owner must verify selected endpoint/model and upper rates before --live; no billing settings or prepaid/fallback assumptions.' },
    steps: [], scriptedActionsFile: 'scripted-actions.jsonl' };
  const timer = options.budget ? setTimeout(() => guard.stop('wall_time_budget'), options.budget.maxSeconds * 1000) : undefined;
  const interrupted = () => guard.stop('operator_interrupt'); process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  try {
    await save('validation.json', evidence);
    const sourceUrl = await source.listen();
    const context = parseContextConfig({ ...contextTemplate,
      systems: contextTemplate.systems.map(system => ({ ...system, baseUrl: `${sourceUrl}/${system.id}` })),
      simulation: { ...contextTemplate.simulation, baseUrl: sourceUrl } });
    const background = parseBackgroundConfig({ ...backgroundTemplate, concurrency: 1, modelConcurrency: 1,
      sources: backgroundTemplate.sources.map(source => ({ ...source, allowedRecipientSeatIds: ['seat-overall'] })) });
    const db = await openDatabase(config.dataDir), access = new AccessStore(db);
    for (const seatId of ['seat-director', 'seat-overall', 'seat-intelligence', 'seat-planning', 'seat-situation', 'seat-control']) await access.saveAccount({
      username: seatId, displayName: seatId, seatId, seatName: seatId, password, createPublicTask: seatId === 'seat-director' || seatId === 'seat-overall',
      manageModelSettings: false, controlScenarios: seatId === 'seat-director' });
    db.close();
    const runtime = await configuredRuntime(config);
    guardScenarioRuntime(runtime, guard, new URL(config.baseUrl).origin, record);
    lab = await PiLab.create(config, runtime); app = await createApp(lab, false, { config: background, env }, { config: context, env });
    const appUrl = await app.listen({ host: '127.0.0.1', port: 0 }), store = new BackgroundStore(lab.access!.db);
    for (const source of background.sources) {
      store.grant('seat', 'seat-overall', source.sourceId, 'manage'); store.grant('seat', 'seat-director', source.sourceId, 'view');
      targets.push({ systemId: source.systemId!, sourceId: source.sourceId, url: appUrl, token: env[source.credentialRef]! });
      store.grant('seat', 'seat-control', source.sourceId, 'view');
    }
    // Use real HTTP, including formal Cookie login, CSRF and captured identity view.
    async function login(seatId: string) {
      const initial = await fetch(`${appUrl}/api/auth/session`), initialBody = await initial.json() as AuthSession;
      const response = await fetch(`${appUrl}/api/auth/login`, { method: 'POST', headers: { cookie: initial.headers.getSetCookie().map(value => value.split(';')[0]).join('; '),
        origin: `http://localhost:${config.port}`, 'content-type': 'application/json', 'x-csrf-token': initialBody.csrf! }, body: JSON.stringify({ seatId, password }) });
      assert.equal(response.status, 200, 'Synthetic login failed'); const auth = await response.json() as AuthSession;
      const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); secrets.push(cookie, auth.csrf!, auth.viewId!);
      return async <T>(path: string, body?: object): Promise<T> => {
        guard.check();
        const result = await fetch(`${appUrl}${path}`, { method: body ? 'POST' : 'GET',
          headers: { cookie, origin: `http://localhost:${config.port}`, 'x-csrf-token': auth.csrf!, 'x-axon-view': auth.viewId!, 'content-type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}), signal: guard.controller.signal });
        if (!result.ok) throw new Error(`${path} returned ${result.status}: ${encode(await result.json())}`);
        return result.json() as Promise<T>;
      };
    }
    const director = await login('seat-director'), overall = await login('seat-overall'), control = await login('seat-control');
    const rules: InformationRule[] = [];
    for (const source of background.sources) rules.push(await overall<InformationRule>('/api/information/rules', { clientActionId: randomUUID(), sourceId: source.sourceId,
      profileId: source.allowedProfileIds[0], name: `${source.name}普通初析`, recipientSeatIds: ['seat-overall'], enabled: true }));
    const definitions = await director<ScenarioDefinitions>('/api/simulation/scenarios');
    const definition = definitions.items.find(item => item.id === 'harbor-fire' && item.version === '5');
    assert.ok(definition, 'The execution probe requires the v5 execution scenario');
    const created = await director<ScenarioMutationResult>('/api/simulation/instances', { definitionId: definition.id, version: definition.version, mode: 'source_replay', clientActionId: randomUUID() });
    const id = created.instance.instanceId, initialized = await director<ScenarioTaskInitialization>(`/api/simulation/instances/${id}/initialize`, { clientActionId: randomUUID() });
    assert.equal(initialized.initialized, true); assert.deepEqual(initialized.tasks.map(task => task.code), ['T02', 'T03']);
    const instances = await director<ScenarioInstances>('/api/simulation/instances');
    let current = await director<ScenarioMutationResult>(`/api/simulation/instances/${id}/activate`, { clientActionId: randomUUID(), expectedRevision: created.instance.revision, expectedActiveRevision: instances.activeRevision });
    assert.equal((await overall<TaskSpace[]>('/api/tasks')).length, 2); assert.equal(store.listJobs().length, 0);
    const detail = await director<ScenarioInstanceDetail>(`/api/simulation/instances/${id}`);
    Object.assign(evidence, { preparationCompleted: true, definition, initialized, rules, background, context, instanceId: id,
      evidenceHashes: await Promise.all(['scripts/probe-scenario-execution.ts', 'scripts/probe-scenario-budget.ts', 'fixtures/scenario-demo/background.example.json', 'fixtures/scenario-demo/context.example.json', 'scripts/mock-context/scenarios/data.ts', 'scripts/mock-context/scenarios/execution.ts', 'scripts/mock-context/scenarios/routing.ts', 'scripts/mock-context/scenarios/store.ts', 'scripts/mock-context/scenarios/geography.ts'].map(async file => ({ file, sha256: createHash('sha256').update(await readFile(join(root, file))).digest('hex') }))) });
    await save('preparation.json', { definition, initialized, rules, detail, modelCalls: guard.snapshot().apiRequests });
    if (!options.live) { assert.equal(guard.snapshot().apiRequests, 0); return evidence; }
    let mainTask: TaskSpace | undefined;
    let workspace: Workspace | undefined;
    let local: CommandRecord | undefined;
    let cross: CommandRecord | undefined;
    let localArrival: CommandRecord['execution'];
    const appliedSteps = new Set<string>();
    const processedActions = new Set<string>();
    const baseSteps = new Set<string>();
    async function observeCommands() {
      const executions: CommandRecord[] = [];
      for (const item of [local, cross]) if (item) {
        const next = await control<CommandRecord>(`/api/commands/${item.id}/execution`);
        assert.equal(next.status, 'received'); assert.equal(next.executionError, undefined);
        assert.ok(next.execution); executions.push(next);
        if (next.id === local?.id) local = next; else cross = next;
      }
      return executions;
    }
    async function flush(entry: Record<string, unknown>) {
      const provenance = await lab!.scenario!.provenance(id) as { actions: ScenarioAction[] };
      for (const action of provenance.actions) {
        if (processedActions.has(action.id)) continue;
        assert.equal(action.sendState, 'unsent', 'New driver action already sent by another operator');
        const notice: Record<string, unknown> = { actionId: action.id, stepId: action.stepId, input: action.notification };
        (entry.notices as unknown[]).push(notice); await save('validation.json', evidence);
        notice.sent = await director<ScenarioAction>(`/api/simulation/actions/${action.id}/send`, {});
        const event = store.getEvent((notice.sent as ScenarioAction).receipt!.eventId);
        assert.ok(event.initialJobId, 'Receipt without analysis job');
        let job: BackgroundJob;
        do {
          guard.check(); job = store.getJob(event.initialJobId);
          if (['queued', 'running'].includes(job.status)) await new Promise(resolve => setTimeout(resolve, 100));
        } while (['queued', 'running'].includes(job.status));
        notice.event = event; notice.job = job; notice.snapshot = await createBackgroundExecutor(lab!).read(job);
        await save('validation.json', evidence);
        assert.equal(job.status, 'succeeded', 'Analysis failed; retain original native evidence');
        let deliveries = store.listDeliveries(job.id);
        while (deliveries.length !== 1 || deliveries.some(delivery => delivery.status === 'pending')) {
          guard.check(); await new Promise(resolve => setTimeout(resolve, 100)); deliveries = store.listDeliveries(job.id);
        }
        assert.equal(deliveries[0].recipientSeatId, 'seat-overall'); assert.equal(deliveries[0].status, 'delivered');
        notice.deliveries = deliveries;
        notice.inbox = await overall<InboxDetail>(`/api/inbox/${deliveries[0].id}`);
        notice.taskLinks = await overall<TaskLinksView>(`/api/information/events/${event.id}/task-links?jobId=${job.id}`);
        if (action.stepId === 'E01' && !mainTask) {
          const input = { jobId: job.id, clientActionId: randomUUID(), title: '临港仓储烟情核实与处置研判',
            goal: '核实临港仓储烟情的具体位置、当前道路及资源事实，整理不确定事项和进一步核实需求，为总体席后续处置决策提供依据。',
            reason: '探针脚本代表总体席作出立项核实决定；本决定不作为模型判断正确的证据。' };
          const created = await overall<TaskSuggestionCreateResult>(`/api/information/events/${event.id}/tasks`, input);
          assert.equal(lab!.access!.get(created.task.id, 'seat-overall').scenarioInstanceId, id);
          mainTask = created.task; evidence.mainTask = created;
          workspace = await control<Workspace>(`/api/tasks/${mainTask.id}/workspace`, {});
          await record('scripted-actions', { kind: 'human-source-task-create', eventId: event.id, jobId: job.id, input, result: created });
        }
        processedActions.add(action.id); notice.completedAt = new Date().toISOString();
        await save('validation.json', evidence);
        console.info(JSON.stringify({ step: action.stepId, eventId: event.id, jobId: job.id, status: job.status, delivered: true, semanticReviewPending: true }));
      }
    }
    const ref = (code: string, objectType = 'resource') => ({ systemId: 'situation' as const, objectType, objectId: `${id}-${code}` });
    async function issue(command: CommandInput) {
      assert.ok(workspace);
      const input = { workspaceId: workspace.id, clientActionId: randomUUID(), command };
      const prepared = await control<CommandRecord>('/api/commands/prepare', input);
      await record('scripted-actions', { kind: 'human-command-prepare', input, result: prepared });
      const result = await control<CommandRecord>(`/api/commands/${prepared.id}/commit`, { confirm: true });
      await record('scripted-actions', { kind: 'human-command-confirm', commandId: prepared.id, input: { confirm: true }, result });
      assert.equal(result.status, 'received'); assert.equal(result.executionError, undefined);
      assert.ok(result.execution, 'No execution returned for a confirmed v5 command');
      assert.notEqual(result.execution.status, 'refused', result.execution.reason);
      return result;
    }
    for (;;) {
      guard.check();
      const before = await director<ScenarioInstanceDetail>(`/api/simulation/instances/${id}`);
      const preview = await director<ScenarioPreview>(`/api/simulation/instances/${id}/preview`, { expectedRevision: before.instance.revision });
      if (!preview.step) break;
      assert.ok(preview.canApply, preview.reason);
      assert.ok(!appliedSteps.has(preview.step.id), 'A simulation node repeated without progress');
      const entry: Record<string, unknown> = { stepId: preview.step.id, preview, startedAt: new Date().toISOString(), notices: [] };
      (evidence.steps as unknown[]).push(entry); await save('validation.json', evidence);
      current = await director<ScenarioMutationResult>(`/api/simulation/instances/${id}/steps/${preview.step.id}`, { clientActionId: randomUUID(), expectedRevision: before.instance.revision });
      appliedSteps.add(preview.step.id); entry.applied = current;
      if (/^E\d+$/.test(preview.step.id)) baseSteps.add(preview.step.id);
      await flush(entry);
      if (preview.step.id === 'E05') {
        local = await issue({ action: 'dispatch', vehicles: ['V01', 'V03', 'V06'].map(code => ref(code)), destination: ref('L01'), route: [ref('R03', 'road')], notes: '脚本代表人员确认本地车辆支援，控制决策不作为模型能力证据。' });
        cross = await issue({ action: 'dispatch', vehicles: ['V07', 'V08', 'V11', 'V13'].map(code => ref(code)), destination: ref('L01'), route: ['R01', 'R03'].map(code => ref(code, 'road')), notes: '脚本代表人员确认跨站支援，经中轴桥接近现场。' });
        evidence.dispatch = { local, cross }; await flush(entry);
      }
      entry.executions = await observeCommands();
      if (preview.step.id === 'E08') {
        evidence.atClosure = { local: local?.execution, cross: cross?.execution };
        assert.ok(cross?.execution?.vehicles.some(vehicle => vehicle.state === 'blocked'), 'Canonical cross-station dispatch did not exercise a blocked vehicle');
        if (local?.execution?.status === 'completed') localArrival = structuredClone(local.execution);
      }
      if (preview.step.id === 'E09') {
        assert.ok(cross?.execution?.vehicles.some(vehicle => vehicle.state === 'blocked'), 'An older open-road observation cleared current blockage');
      }
      if (preview.step.id === 'E10') {
        assert.ok(cross?.execution);
        const blocked = cross.execution.vehicles.filter(vehicle => vehicle.state === 'blocked');
        assert.ok(blocked.length, 'No blocked vehicles available for the scripted reroute');
        const revised = await issue({ action: 'reroute', targetCommandId: cross.id, expectedExecutionRevision: cross.execution.revision,
          vehicles: blocked.map(vehicle => vehicle.vehicle as CommandInput['vehicles'][number]), destination: ref('L01'), route: ['R02', 'R03'].map(code => ref(code, 'road')),
          notes: '脚本代表总体席复核后由控制席确认绕行；保留已到场事实。' });
        evidence.reroute = revised; await flush(entry); entry.executionsAfterControl = await observeCommands();
      }
      entry.source = await director<ScenarioInstanceDetail>(`/api/simulation/instances/${id}`);
      entry.completedAt = new Date().toISOString(); await save('validation.json', evidence);
    }
    assert.equal(baseSteps.size, 12, 'Not all preset source steps completed');
    assert.ok(local && cross);
    await observeCommands();
    assert.ok(local.execution && cross.execution);
    assert.equal(local.execution.status, 'completed'); assert.equal(cross.execution.status, 'completed');
    const vehicles = [...local.execution.vehicles, ...cross.execution.vehicles];
    assert.equal(vehicles.length, 7); assert.equal(new Set(vehicles.map(vehicle => vehicle.vehicle.objectId)).size, 7);
    assert.ok(vehicles.every(vehicle => vehicle.state === 'arrived' && vehicle.arrivedAt));
    if (localArrival) assert.deepEqual(local.execution.vehicles.map(vehicle => vehicle.arrivedAt), localArrival.vehicles.map(vehicle => vehicle.arrivedAt));
    const final = await director<ScenarioInstanceDetail>(`/api/simulation/instances/${id}`);
    const vehicleIds = new Set(vehicles.map(vehicle => vehicle.vehicle.objectId));
    assert.ok(final.objects.filter(object => vehicleIds.has(object.ref.objectId)).every(object => object.resourceData?.resource.availability?.state === 'unavailable'));
    assert.equal(final.objects.filter(object => vehicleIds.has(object.ref.objectId)).length, 7);
    for (const execution of [local.execution, cross.execution]) for (const vehicle of execution.vehicles) {
      const sourceObject = final.objects.find(object => object.ref.objectId === vehicle.vehicle.objectId)!;
      assert.deepEqual(sourceObject.geometry, { type: 'Point', coordinates: vehicle.position });
      assert.ok('executionCommandId' in sourceObject.properties && 'executionState' in sourceObject.properties);
      assert.equal(sourceObject.properties.executionCommandId, execution.rootCommandId);
      assert.equal(sourceObject.properties.executionState, vehicle.state);
      assert.equal(sourceObject.revision, vehicle.trace.at(-1)!.sourceRevision);
    }
    assert.equal(store.listJobs().length, processedActions.size); assert.equal(store.listEvents().length, processedActions.size);
    evidence.final = { analysedNotices: processedActions.size, predefinedSteps: baseSteps.size, source: final, local: local.execution, cross: cross.execution, arrivedVehicles: vehicles.length,
      allArrivedBy0935: vehicles.every(vehicle => Date.parse(vehicle.arrivedAt!) <= Date.parse('2026-11-03T09:35:00+08:00')) };
    evidence.protocolCompleted = true; return evidence;
  } catch (error) {
    guard.stop('driver_stopped'); evidence.failure = error instanceof Error ? error.message : String(error); throw error;
  } finally {
    clearTimeout(timer); process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
    await app?.close(); await source.close();
    Object.assign(evidence, { endedAt: new Date().toISOString(), accounting: guard.snapshot(), sourceRequests: source.requests });
    await save('validation.json', evidence);
    console.info(JSON.stringify({ evidence: join(options.output, 'validation.json'), preparationCompleted: evidence.preparationCompleted === true,
      protocolCompleted: evidence.protocolCompleted, semanticReviewPending: true, accounting: guard.snapshot() }));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runScenarioExecution(scenarioExecutionOptions(process.argv.slice(2))).catch(() => { console.error('Scenario probe stopped; inspect validation.json. No automatic retry.'); process.exitCode = 1; });
}
