import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../src/access/database.js';
import { AccessStore } from '../../src/access/store.js';
import type { BackgroundExecutionInput, RecordTaskAssessment } from '../../src/background/executor.js';
import type { BackgroundJob, BackgroundProfileSnapshot } from '../../src/contracts/background.js';
import { RequestError } from '../../src/contracts/errors.js';
import { ContextService } from '../../src/context/service.js';
import { createBackgroundExecutor, snapshotBackgroundProfile } from '../../src/pi/background-runner.js';
import { PiLab } from '../../src/pi/lab.js';
import { taskInformationTools } from '../../src/pi/task-information-tools.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn(); });
const assessmentName = 'information_record_task_assessment';
const readNames = ['task_information_list', 'task_information_read'];
const suggestion = {title: '编制盘点说明', goal: '形成新的盘点说明和待核实事项。', reason: '独立编制目标，已查询任务不能承接。'};

async function setup(reply: Parameters<typeof fakeRuntime>[1]) {
  const dataDir = await mkdtemp(join(tmpdir(), 'axon-task-information-pi-'));
  cleanup.push(() => rm(dataDir, {recursive: true, force: true}));
  const db = await openDatabase(dataDir), access = new AccessStore(db);
  const userId = await access.saveAccount({username: 'a', displayName: 'A', seatId: 'a', seatName: '席位 A',
    password: 'test-password-123', createPublicTask: true, manageModelSettings: false});
  const actor = access.identity(userId)!;
  const task = access.create(actor, {clientActionId: randomUUID(), title: '通道保障', goal: '保障西区道路通行', visibility: 'public'});
  access.create(actor, {clientActionId: randomUUID(), title: 'PRIVATE_TASK', goal: '', visibility: 'private'});
  db.close();
  const config = testConfig(dataDir, {seatId: 'a', auth: {secret: 'test-task-information-pi-secret-32-characters', sessionMs: 28800000}});
  const fake = await fakeRuntime(config, reply), lab = await PiLab.create(config, fake.runtime);
  cleanup.push(() => lab.close());
  lab.context = new ContextService({systems: [{id: 'intel', name: '特情', adapter: 'mock-information-http',
    baseUrl: 'https://no-network.invalid/intel', tokenEnv: 'CONTEXT_TOKEN'}],
  scopes: [{id: 'demo', name: '验证资料', systemIds: ['intel'], seatIds: ['a']}]}, {CONTEXT_TOKEN: 'test-only-token'});
  const profile: BackgroundProfileSnapshot = {id: 'analysis', name: '分析', goal: '分析收到的信息', contextScopeId: 'demo',
    tools: ['task_search', 'task_read', assessmentName, 'subagent'], instructions: '', resources: [], skillIds: [], agentIds: ['analyst']};
  const job: BackgroundJob = {id: randomUUID(), kind: 'preprocess', eventId: randomUUID(), sourceId: 'test', status: 'running', revision: 1,
    createdAt: new Date().toISOString(), sessionId: randomUUID(), requestId: randomUUID()};
  const record = vi.fn<RecordTaskAssessment>((input, evidence, toolCallId) => ({status: 'recorded', published: false,
    assessment: {recordedAt: new Date().toISOString(), toolCallId,
      items: input.relations.map(item => ({taskSpaceId: item.taskId, taskRevision: evidence.tasks.get(item.taskId)!, reason: item.reason})),
      ...(input.newTaskSuggestion ? {newTaskSuggestion: input.newTaskSuggestion} : {}), ...(input.emptyReason ? {emptyReason: input.emptyReason} : {})}}));
  const input: BackgroundExecutionInput = {text: '分析收到的资料并按需记录任务判断', files: [], directory: join(dataDir, 'background', 'jobs', job.id),
    profile: await snapshotBackgroundProfile(lab, profile), recordTaskAssessment: record, onEvent: () => {}, publish: async () => { throw new Error('not used'); }};
  return {lab, actor, task, profile, input, record, job, executor: createBackgroundExecutor(lab), ...fake};
}

describe('task information tools through native Pi', () => {
  it('passes only successful current-request task observations to the host and keeps actual results in native history', async () => {
    let taskId = '';
    const f = await setup((_context, index) => index === 0 ? {tools: [{name: 'task_search', arguments: {}}]}
      : index === 1 ? {tools: [{name: assessmentName, arguments: {relations: [{taskId, reason: '关注同一道路'}]}}]}
        : {text: '判断已完成。'});
    taskId = f.task.id;
    const result = await f.executor.execute(f.job, f.input);
    expect(result.snapshot.lastResult?.status).toBe('succeeded');
    expect(f.record).toHaveBeenCalledOnce();
    expect(f.record.mock.calls[0][1]).toEqual({queried: true, tasks: new Map([[taskId, 1]])});
    expect(f.record.mock.calls[0][2]).toBe('call-2-0');
    const call = f.calls[2].context.messages.find(message => message.role === 'toolResult' && message.toolName === assessmentName);
    expect(call).toMatchObject({isError: false, content: [{type: 'text', text: expect.stringContaining('"published":false')}]});
    expect(JSON.stringify(f.calls)).not.toContain('PRIVATE_TASK');
    const path = join(f.input.directory, 'sessions', (await readdir(join(f.input.directory, 'sessions')))[0]);
    expect(await readFile(path, 'utf8')).toContain('关注同一道路');
    expect((await f.executor.read(f.job))?.messages).toEqual(result.snapshot.messages);
  });

  it('records an empty successful search before a suggestion, without creating a public task or a workspace', async () => {
    const f = await setup((_context, index) => index === 0 ? {tools: [{name: 'task_search', arguments: {query: '无匹配的新编制需求'}}]}
      : index === 1 ? {tools: [{name: assessmentName, arguments: {relations: [], newTaskSuggestion: suggestion}}]}
        : {text: '建议新建公共任务，等待人员决定。'});
    const tasks = f.lab.access!.list('a'), workspaces = f.lab.workspaces.listAll();
    const result = await f.executor.execute(f.job, f.input);
    expect(result.snapshot.lastResult?.status).toBe('succeeded');
    expect(f.record.mock.calls[0][1]).toEqual({queried: true, tasks: new Map()});
    expect(f.record.mock.calls[0][0]).toEqual({relations: [], newTaskSuggestion: suggestion});
    expect(JSON.stringify(f.calls[2].context.messages)).toContain('尚未创建任务');
    expect(f.lab.access!.list('a')).toEqual(tasks);
    expect(f.lab.workspaces.listAll()).toEqual(workspaces);
  });

  it('can finish without recording a judgment, and does not manufacture a suggestion from no matches', async () => {
    const f = await setup((_context, index) => index === 0 ? {tools: [{name: 'task_search', arguments: {query: '没有匹配'}}]} : {text: '资料仅供参考。'});
    expect((await f.executor.execute(f.job, f.input)).snapshot.lastResult?.status).toBe('succeeded');
    expect(f.calls).toHaveLength(2); expect(f.record).not.toHaveBeenCalled();
  });

  it('returns host rejection as an ordinary tool error and lets Pi choose the next step', async () => {
    const f = await setup((_context, index) => index === 0 ? {tools: [{name: 'task_read', arguments: {taskId: randomUUID()}}]}
      : index === 1 ? {tools: [{name: assessmentName, arguments: {relations: [], newTaskSuggestion: suggestion}}]}
        : {text: '任务查询未成功，暂不能确定归口。'});
    f.record.mockImplementation(() => { throw new RequestError('TASK_QUERY_REQUIRED', '请先成功查询活动公共任务。', 409); });
    const result = await f.executor.execute(f.job, f.input);
    expect(result.snapshot.lastResult?.status).toBe('succeeded');
    expect(f.record.mock.calls[0][1]).toEqual({queried: false, tasks: new Map()});
    const message = f.calls[2].context.messages.find(item => item.role === 'toolResult' && item.toolName === assessmentName);
    expect(message).toMatchObject({isError: true}); expect(JSON.stringify(message)).toContain('TASK_QUERY_REQUIRED');
    expect(f.calls).toHaveLength(3);
  });

  it('preserves the revision actually observed even if task metadata changes before recording', async () => {
    const f: Awaited<ReturnType<typeof setup>> = await setup((_context, index) => {
      if (index === 0) return {tools: [{name: 'task_read', arguments: {taskId: f.task.id}}]};
      if (index === 1) {
        f.lab.access!.update(f.actor, f.task.id, 1, {goal: '已调整的目标'});
        return {tools: [{name: assessmentName, arguments: {relations: [{taskId: f.task.id, reason: '先前目标'}]}}]};
      }
      return {text: '任务已变化，需要重新查询。'};
    });
    f.record.mockImplementation((_input, evidence) => {
      expect(evidence).toEqual({queried: false, tasks: new Map([[f.task.id, 1]])});
      expect(f.lab.access!.getActivePublic(f.task.id).revision).toBe(2);
      throw new RequestError('TASK_CHANGED', '任务已变化，请重新查询。', 409);
    });
    expect((await f.executor.execute(f.job, f.input)).snapshot.lastResult?.status).toBe('succeeded');
    expect(JSON.stringify(f.calls[2].context.messages)).toContain('TASK_CHANGED');
  });

  it('does not inherit observations between preprocess requests or expose recording and reads to delegated roles', async () => {
    const f = await setup((_context, index) => index === 0 ? {tools: [{name: 'task_search', arguments: {}}]}
      : index === 1 ? {tools: [{name: 'subagent', arguments: {agent: 'analyst', task: '检查资料'}}]}
        : index === 2 ? {text: '子任务完成。'} : index === 3 ? {text: '本次结束。'}
          : index === 4 ? {tools: [{name: assessmentName, arguments: {relations: [], emptyReason: '当前尚无判断依据'}}]} : {text: '第二次结束。'});
    await f.executor.execute(f.job, f.input);
    const childTools = f.calls[2].context.tools?.map(tool => tool.name) ?? [];
    for (const name of [assessmentName, ...readNames, 'task_search', 'task_read']) expect(childTools).not.toContain(name);
    const nextJob = {...f.job, id: randomUUID(), sessionId: randomUUID(), requestId: randomUUID()};
    await f.executor.execute(nextJob, {...f.input, directory: join(f.lab.config.dataDir, 'background', 'jobs', nextJob.id)});
    expect(f.record.mock.calls[0][1]).toEqual({queried: false, tasks: new Map()});
  });

  it('retains recorded evidence on cancellation but never claims the queued job published it', async () => {
    const f = await setup((_context, index) => index === 0 ? {tools: [{name: assessmentName, arguments: {relations: [], emptyReason: '资料不足'}}]} : {waitForAbort: true});
    const pending = f.executor.execute(f.job, f.input);
    await vi.waitFor(() => expect(f.calls).toHaveLength(2));
    await f.executor.cancel(f.job);
    expect((await pending).snapshot.lastResult?.status).toBe('cancelled');
    expect(f.record).toHaveBeenCalledOnce();
    expect(f.calls[1].context.messages.find(message => message.role === 'toolResult' && message.toolName === assessmentName))
      .toMatchObject({content: [{type: 'text', text: expect.stringContaining('"published":false')}]});
    expect(f.job.status).toBe('running'); // Terminal persistence/publication belongs to the host queue.
  });

  it('leaves old profiles unchanged and fails preparation when an enabled recording callback is missing', async () => {
    const f = await setup(() => ({text: '完成'}));
    const disabled = {...f.input, profile: {...f.input.profile!, tools: ['task_search']}};
    await f.executor.execute(f.job, disabled);
    expect(f.calls[0].context.tools?.map(tool => tool.name)).not.toContain(assessmentName);
    expect(f.record).not.toHaveBeenCalled();
    const nextJob = {...f.job, id: randomUUID(), sessionId: randomUUID(), requestId: randomUUID()};
    await expect(f.executor.execute(nextJob, {...f.input, directory: join(f.lab.config.dataDir, 'background', 'jobs', nextJob.id), recordTaskAssessment: undefined})).rejects.toThrow('任务判断记录服务不可用');
    expect(f.calls).toHaveLength(1);
  });

  it.each(['foreground', 'seat_analysis'] as const)('registers seat information reads in %s without external context configuration', async mode => {
    const eventId = randomUUID(), jobId = randomUUID();
    const f = await setup((_context, index) => index === 0 ? {tools: [{name: 'task_information_list', arguments: {}}]}
      : index === 1 ? {tools: [{name: 'task_information_read', arguments: {eventId, jobId, section: 'analysis'}}]} : {text: '已读取关联分析。'});
    delete f.lab.context;
    const list = vi.fn(() => ({items: [{eventId, jobId, title: '已关联的信息'}], total: 1}));
    const read = vi.fn(() => ({text: 'EXACT_HISTORICAL_ANALYSIS'}));
    f.lab.taskInformation = {list, read};
    const workspace = await f.lab.workspaces.ensureWorkspace(f.task.id, 'a', f.task.title);
    const session = await f.lab.createSession(workspace.id, 'a');
    if (mode === 'foreground') await f.lab.start(session.id, '读取关联信息', {}, 'a').run(() => {});
    else {
      const job = {...f.job, kind: 'seat_analysis' as const, sessionId: session.id, seatId: 'a', workspaceId: workspace.id};
      await f.executor.execute(job, f.input);
    }
    expect(f.calls[0].context.tools?.map(tool => tool.name)).toEqual(expect.arrayContaining(readNames));
    expect(f.calls[0].context.tools?.map(tool => tool.name)).not.toContain(assessmentName);
    expect(list).toHaveBeenCalledWith('a', f.task.id, {}, expect.any(AbortSignal));
    expect(read).toHaveBeenCalledWith('a', f.task.id, {eventId, jobId, section: 'analysis'}, expect.any(AbortSignal));
    expect(JSON.stringify(f.calls[0].context)).not.toContain('EXACT_HISTORICAL_ANALYSIS');
    expect(JSON.stringify(f.calls[2].context.messages)).toContain('EXACT_HISTORICAL_ANALYSIS');
    expect(f.lab.get(session.id, 'a').lastResult?.status).toBe('succeeded');
  });

  it('does not offer seat information reads to service preprocessing', async () => {
    const f = await setup(() => ({text: '完成'}));
    const list = vi.fn(), read = vi.fn(); f.lab.taskInformation = {list, read};
    await f.executor.execute(f.job, f.input);
    for (const name of readNames) expect(f.calls[0].context.tools?.map(tool => tool.name)).not.toContain(name);
    expect(list).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });

  it('rejects oversized data and honors cancellation before and after authenticated callbacks', async () => {
    const controller = new AbortController(), authorize = vi.fn();
    const list = vi.fn(() => ({items: ['大'.repeat(100_000)]}));
    const read = vi.fn(async () => { controller.abort(); return {text: 'not returned'}; });
    const [listing, reading] = taskInformationTools({list, read}, 'a', randomUUID(), controller, authorize);
    const context = {} as Parameters<typeof listing.execute>[4];
    await expect(listing.execute('list', {}, undefined, undefined, context)).rejects.toThrow('TASK_INFORMATION_TOO_LARGE');
    await expect(reading.execute('read', {eventId: randomUUID(), jobId: randomUUID(), section: 'original'}, undefined, undefined, context)).rejects.toThrow();
    await expect(listing.execute('stopped', {}, undefined, undefined, context)).rejects.toThrow();
    expect(list).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledOnce();
  });
});
