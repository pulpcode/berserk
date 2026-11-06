/** Isolated S4 driver. Default preparation never calls a provider; live output requires semantic review. */
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
import type { WorkAction, WorkDetail, WorkPrepareInput, WorkReceipt } from '../src/contracts/collaboration.js';
import type { SessionSnapshot, Workspace } from '../src/contracts/index.js';
import type { ScenarioAction, ScenarioDefinitions, ScenarioInstanceDetail, ScenarioInstances, ScenarioMutationResult, ScenarioTaskInitialization } from '../src/contracts/scenarios.js';
import type { TaskLinksView, TaskSuggestionCreateResult } from '../src/contracts/task-information.js';
import { parseContextConfig } from '../src/context/config.js';
import { createBackgroundExecutor } from '../src/pi/background-runner.js';
import { PiLab } from '../src/pi/lab.js';
import { configuredRuntime } from '../src/pi/model-runtime.js';
import { createApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import { createMockContextServer } from './mock-context/server.js';
import type { NotificationTarget } from './mock-context/control-api.js';
import { guardScenarioRuntime, ScenarioBudgetGuard, type ScenarioProbeAccounting, type ScenarioProbeBudget } from './probe-scenario-budget.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const numericFlags = {
  '--max-api-requests': 'maxApiRequests', '--max-input-tokens': 'maxInputTokens', '--max-output-tokens': 'maxOutputTokens',
  '--max-seconds': 'maxSeconds', '--max-cost-cny': 'maxCostCny',
  '--input-cny-per-million': 'inputCnyPerMillion', '--output-cny-per-million': 'outputCnyPerMillion',
  '--provider-input-limit-tokens': 'providerInputLimitTokens',
} as const;
const accountingFlags = ['--provider-input-limit-tokens', '--input-cny-per-million', '--output-cny-per-million'];
export function scenarioBusinessOptions(args: string[]) {
  let output = '', live = false, prepare = false, scriptedHandoff = false, usageOnly = false;
  const budget: Partial<ScenarioProbeBudget> = {}, seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]; assert.ok(!seen.has(flag), `Duplicate argument: ${flag}`); seen.add(flag);
    if (flag === '--live') live = true;
    else if (flag === '--prepare-only') prepare = true;
    else if (flag === '--scripted-handoff') scriptedHandoff = true;
    else if (flag === '--usage-only') usageOnly = true;
    else if (flag === '--output') { assert.ok(args[i + 1] && !args[i + 1].startsWith('--'), '--output requires a new directory'); output = resolve(args[++i]); }
    else if (flag in numericFlags) {
      const value = Number(args[++i]); assert.ok(Number.isFinite(value) && value > 0, `Finite positive value required: ${flag}`);
      const key = numericFlags[flag as keyof typeof numericFlags];
      if (!['maxCostCny', 'inputCnyPerMillion', 'outputCnyPerMillion'].includes(key)) assert.ok(Number.isSafeInteger(value), `Integer required: ${flag}`);
      budget[key] = value;
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  assert.ok(output, 'Use --output NEW_DIRECTORY [--prepare-only], or --live with explicit budgets or --usage-only accounting flags');
  assert.ok(!(live && prepare), '--live and --prepare-only are mutually exclusive');
  assert.ok(!usageOnly || live, '--usage-only requires explicit --live');
  assert.ok(!live || (usageOnly ? accountingFlags : Object.keys(numericFlags)).every(flag => seen.has(flag)),
    usageOnly ? '--usage-only requires provider input limit and both rates' : '--live requires all request/token/time/cost/rate budgets');
  assert.ok(!usageOnly || Object.keys(budget).length === accountingFlags.length, '--usage-only cannot include cumulative budget flags');
  assert.ok(live || !Object.keys(budget).length, 'Budget flags require explicit --live');
  return { output, live, scriptedHandoff, budget: live && !usageOnly ? budget as ScenarioProbeBudget : undefined,
    ...(usageOnly ? { accounting: budget as ScenarioProbeAccounting } : {}) };
}

export async function runScenarioBusiness(options: ReturnType<typeof scenarioBusinessOptions>) {
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
  config.auth = { secret: randomBytes(40).toString('hex'), sessionMs: 3600000 };
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
    protocolCompleted: false, semanticReviewPending: true, scriptedHandoff: options.scriptedHandoff, startedAt: new Date().toISOString(),
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
    for (const seatId of ['seat-director', 'seat-overall', 'seat-intelligence', 'seat-planning', 'seat-situation']) await access.saveAccount({
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
      if (options.scriptedHandoff) store.grant('seat', 'seat-intelligence', source.sourceId, 'view');
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
    const director = await login('seat-director'), overall = await login('seat-overall');
    const rules: InformationRule[] = [];
    for (const source of background.sources) rules.push(await overall<InformationRule>('/api/information/rules', { clientActionId: randomUUID(), sourceId: source.sourceId,
      profileId: source.allowedProfileIds[0], name: `${source.name}普通初析`, recipientSeatIds: ['seat-overall'], enabled: true }));
    const definition = (await director<ScenarioDefinitions>('/api/simulation/scenarios')).items[0]; assert.equal(definition.version, '4');
    const created = await director<ScenarioMutationResult>('/api/simulation/instances', { definitionId: definition.id, version: definition.version, mode: 'source_replay', clientActionId: randomUUID() });
    const id = created.instance.instanceId, initialized = await director<ScenarioTaskInitialization>(`/api/simulation/instances/${id}/initialize`, { clientActionId: randomUUID() });
    assert.equal(initialized.initialized, true); assert.deepEqual(initialized.tasks.map(task => task.code), ['T02', 'T03']);
    const instances = await director<ScenarioInstances>('/api/simulation/instances');
    let current = await director<ScenarioMutationResult>(`/api/simulation/instances/${id}/activate`, { clientActionId: randomUUID(), expectedRevision: created.instance.revision, expectedActiveRevision: instances.activeRevision });
    assert.equal((await overall<TaskSpace[]>('/api/tasks')).length, 2); assert.equal(store.listJobs().length, 0);
    const detail = await director<ScenarioInstanceDetail>(`/api/simulation/instances/${id}`);
    Object.assign(evidence, { preparationCompleted: true, definition, initialized, rules, background, context, instanceId: id,
      evidenceHashes: await Promise.all(['scripts/probe-scenario-business.ts', 'scripts/probe-scenario-budget.ts', 'fixtures/scenario-demo/background.example.json', 'fixtures/scenario-demo/context.example.json', 'scripts/mock-context/scenarios/data.ts'].map(async file => ({ file, sha256: createHash('sha256').update(await readFile(join(root, file))).digest('hex') }))) });
    await save('preparation.json', { definition, initialized, rules, detail, modelCalls: guard.snapshot().apiRequests });
    if (!options.live) { assert.equal(guard.snapshot().apiRequests, 0); return evidence; }
    let mainTask: TaskSpace | undefined;
    for (const step of detail.steps) {
      guard.check(); const entry: Record<string, unknown> = { stepId: step.id, startedAt: new Date().toISOString(), notices: [] };
      (evidence.steps as unknown[]).push(entry); await save('validation.json', evidence);
      current = await director<ScenarioMutationResult>(`/api/simulation/instances/${id}/steps/${step.id}`, { clientActionId: randomUUID(), expectedRevision: current.instance.revision });
      entry.applied = current;
      for (const action of current.actions) {
        const notice: Record<string, unknown> = { actionId: action.id, input: action.notification }; (entry.notices as unknown[]).push(notice);
        await save('validation.json', evidence);
        notice.sent = await director<ScenarioAction>(`/api/simulation/actions/${action.id}/send`, {});
        const event = store.getEvent((notice.sent as ScenarioAction).receipt!.eventId); assert.ok(event.initialJobId, 'Receipt without analysis job');
        let job: BackgroundJob;
        do { guard.check(); job = store.getJob(event.initialJobId); if (['queued', 'running'].includes(job.status)) await new Promise(resolve => setTimeout(resolve, 200)); }
        while (['queued', 'running'].includes(job.status));
        notice.event = event; notice.job = job; notice.snapshot = await createBackgroundExecutor(lab).read(job);
        notice.deliveries = store.listDeliveries(job.id); await save('validation.json', evidence);
        assert.equal(job.status, 'succeeded', 'Analysis did not succeed; original native evidence retained');
        while (store.listDeliveries(job.id).some(delivery => delivery.status === 'pending')) { guard.check(); await new Promise(resolve => setTimeout(resolve, 100)); }
        const deliveries = store.listDeliveries(job.id); notice.deliveries = deliveries;
        assert.equal(deliveries.length, 1); assert.equal(deliveries[0].recipientSeatId, 'seat-overall'); assert.equal(deliveries[0].status, 'delivered');
        notice.inbox = await overall<InboxDetail>(`/api/inbox/${deliveries[0].id}`);
        notice.taskLinks = await overall<TaskLinksView>(`/api/information/events/${event.id}/task-links?jobId=${job.id}`);
        if (step.id === 'E01') {
          // Explicitly scripted human decision, independent of whether the model suggested creation.
          const input = { jobId: job.id, clientActionId: randomUUID(), title: '临港仓储烟情核实与处置研判',
            goal: '核实临港仓储烟情的具体位置、当前道路及资源事实，整理不确定事项和进一步核实需求，为总体席后续处置决策提供依据。',
            reason: '探针脚本代表总体席作出立项核实决定；本决定不作为模型判断正确的证据。' };
          const result = await overall<TaskSuggestionCreateResult>(`/api/information/events/${event.id}/tasks`, input);
          assert.equal(lab.access!.get(result.task.id, 'seat-overall').scenarioInstanceId, id); mainTask = result.task;
          await record('scripted-actions', { kind: 'human-source-task-create', eventId: event.id, jobId: job.id, input, result }); evidence.mainTask = result;
        }
        notice.completedAt = new Date().toISOString(); await save('validation.json', evidence);
        console.info(JSON.stringify({ step: step.id, eventId: event.id, jobId: job.id, status: job.status, delivered: true, semanticReviewPending: true }));
      }
    }
    assert.equal((evidence.steps as unknown[]).length, 12); assert.equal(store.listEvents().length, 13); assert.equal(store.listJobs().length, 13);
    if (options.scriptedHandoff) {
      assert.ok(mainTask); const intel = await login('seat-intelligence');
      const sender = await overall<Workspace>(`/api/tasks/${mainTask.id}/workspace`, {}), receiver = await intel<Workspace>(`/api/tasks/${mainTask.id}/workspace`, {});
      await writeFile(join(lab.files.filesDirectory(sender.id, 'seat-overall'), '脚本核实要求.md'), '探针脚本分派：核实位置与道路事实。本材料不表示模型完成核实、人员审查或车辆行动。', { mode: 0o600 });
      async function work(actor: typeof overall, input: WorkPrepareInput) {
        const action = await actor<WorkAction>('/api/work-items/prepare', { ...input, clientActionId: randomUUID() });
        const receipt = await actor<WorkReceipt>(`/api/work-actions/${action.operationId}/commit`, { confirm: true });
        await record('scripted-actions', { kind: 'page-work-action', input, action, receipt }); return receipt;
      }
      const assigned = await work(overall, { kind: 'assign', taskSpaceId: mainTask.id, payload: { workspaceId: sender.id, assigneeSeatId: 'seat-intelligence', title: '脚本事实核实交接', goal: '核对固定附件并提交核实记录；脚本验收不等于语义审查。', inputPaths: ['脚本核实要求.md'] } });
      const claimed = await work(intel, { kind: 'claim', workItemId: assigned.workItemId, expectedRevision: assigned.revision, payload: {} });
      await intel<SessionSnapshot>('/api/sessions', { workspaceId: receiver.id, workItemId: assigned.workItemId });
      const workDetail = await intel<WorkDetail>(`/api/work-items/${assigned.workItemId}`), file = workDetail.inputFiles[0];
      assert.match(await readFile(join(lab.files.filesDirectory(receiver.id, 'seat-intelligence'), '收到资料', assigned.workItemId, file.fileId, file.name), 'utf8'), /探针脚本分派/);
      await writeFile(join(lab.files.filesDirectory(receiver.id, 'seat-intelligence'), '脚本交接记录.md'), '这是脚本生成的协议检查材料，不是模型结论或人工事实核实。原始模型输出与引用需另行审阅。', { mode: 0o600 });
      const submitted = await work(intel, { kind: 'submit', workItemId: assigned.workItemId, expectedRevision: claimed.revision, payload: { workspaceId: receiver.id, path: '脚本交接记录.md' } });
      const reviewed = await work(overall, { kind: 'review', workItemId: assigned.workItemId, expectedRevision: submitted.revision, payload: { submissionId: submitted.submissionId!, decision: 'accept' } });
      assert.equal(reviewed.state, 'completed'); evidence.scriptedHandoffReceipt = reviewed;
    }
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
  runScenarioBusiness(scenarioBusinessOptions(process.argv.slice(2))).catch(() => { console.error('Scenario probe stopped; inspect validation.json. No automatic retry.'); process.exitCode = 1; });
}
