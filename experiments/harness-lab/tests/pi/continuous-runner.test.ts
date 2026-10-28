import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackgroundExecutionInput, TaskAssessmentEvidence } from '../../src/background/executor.js';
import type { BackgroundJob, BackgroundProfileSnapshot } from '../../src/contracts/background.js';
import type { AnalysisUpdateInput, ContinuousStream, ContinuousRoundDetail } from '../../src/contracts/continuous.js';
import { RequestError } from '../../src/contracts/errors.js';
import { PiLab } from '../../src/pi/lab.js';
import { createBackgroundExecutor, snapshotBackgroundProfile } from '../../src/pi/background-runner.js';
import { processingText } from '../../src/background/service.js';
import { queryEvidence } from '../../src/background/context-evidence.js';
import { ContextService } from '../../src/context/service.js';
import { AccessStore } from '../../src/access/store.js';
import { openDatabase } from '../../src/access/database.js';
import { createMockContextServer } from '../../scripts/mock-context/server.js';
import { hashContent } from '../../src/resources/files.js';
import { RESULT_ENTRY } from '../../src/pi/resource-tools.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const empty: AnalysisUpdateInput = {taskUpdates: [], unassigned: {significant: false, reason: '本轮无重要变化'}, uncertainties: []};
const profile: BackgroundProfileSnapshot = {id: 'continuous', name: '持续研判', goal: '分析变化', instructions: 'READONLY_PROFILE',
  tools: ['source_list', 'source_read', 'skill_read', 'bash', 'subagent', 'file_output', 'information_record_task_assessment'],
  skillIds: [], agentIds: [], resources: [{id: 'incoming', title: '资料', content: 'ORIGINAL_SOURCE'}]};

async function setup(reply: Parameters<typeof fakeRuntime>[1], context = false, capacity = false) {
  const dataDir = await mkdtemp(join(tmpdir(), 'axon-continuous-runner-')); cleanup.push(() => rm(dataDir, {recursive: true, force: true}));
  const actorId = randomUUID();
  const config = testConfig(dataDir, capacity ? {contextWindow: 8192, maxOutputTokens: 6000, compactionReserveTokens: 5000, compactionKeepRecentTokens: 2000} : {});
  const fake = await fakeRuntime(config, reply); const lab = await PiLab.create(config, fake.runtime); cleanup.push(() => lab.close());
  let frozen = {...profile, tools: profile.tools.filter(tool => tool !== 'information_record_task_assessment')};
  if (context) {
    const mock = createMockContextServer({token: 'query-token'}); const baseUrl = await mock.listen(); cleanup.push(() => mock.close());
    lab.context = new ContextService({systems: [{id: 'intel', name: '特情', adapter: 'mock-information-http', baseUrl: `${baseUrl}/intel`, tokenEnv: 'TOKEN'}],
      scopes: [{id: 'scope', name: '共同范围', systemIds: ['intel'], seatIds: ['a']}]}, {TOKEN: 'query-token'});
    frozen = {...frozen, contextScopeId: 'scope', tools: [...frozen.tools, 'information_read', 'task_search', 'task_read']} as typeof frozen;
    const db = await openDatabase(dataDir); cleanup.push(() => db.close()); lab.access = new AccessStore(db);
    db.prepare('INSERT INTO seats(id,name,create_public,manage_model) VALUES(?,?,?,?)').run('a', '席位', 1, 0);
    db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,1)').run(actorId, 'a', 'a', 'a', 'unused-test-salt', 'unused-test-hash');
  }
  const savedProfile = await snapshotBackgroundProfile(lab, frozen);
  const stream: ContinuousStream = {id: randomUUID(), epochId: randomUUID(), sessionId: randomUUID(), revision: 1, state: 'active',
    name: '测试研判', sourceIds: ['intel'], profileId: profile.id, recipientSeatIds: ['a'], enabled: true, profile: savedProfile,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdByUserId: actorId, pendingInputs: 0};
  const records: Array<{input: AnalysisUpdateInput; evidence: TaskAssessmentEvidence}> = [];
  function next() {
    const job: BackgroundJob = {id: randomUUID(), kind: 'continuous_analysis', streamEpochId: stream.epochId, batchId: randomUUID(),
      status: 'running', revision: 1, createdAt: new Date().toISOString(), sessionId: stream.sessionId, requestId: randomUUID()};
    const input: BackgroundExecutionInput = {text: 'BATCH_INPUT', directory: join(dataDir, 'background', 'streams', stream.epochId, stream.sessionId), files: [],
      profile: savedProfile, continuous: {stream: structuredClone(stream), inputs: [], requiredTaskIds: [], batch: {id: job.batchId!, epochId: stream.epochId,
        jobId: job.id, inputIds: [], requiredTaskIds: [], createdAt: job.createdAt, inputCutoff: job.createdAt}}, onEvent: () => {},
      publish: async () => {throw new Error('no file writes');}, readAnalysisCurrent: async () => ({items: [], total: 0}),
      recordAnalysisUpdate: (value, evidence, toolCallId) => {
        records.push({input: value, evidence});
        for (const task of value.taskUpdates) if (!evidence.tasks.has(task.taskId)) throw new RequestError('TASK_NOT_QUERIED', '本轮未查询任务。', 409);
        return {update: {...value, taskCoverage:value.taskCoverage?.map(item=>({...item,taskRevision:evidence.tasks.get(item.taskId)!,taskTitle:'公共任务'})), taskUpdates: value.taskUpdates.map(task => ({...task, taskRevision: evidence.tasks.get(task.taskId)!, taskTitle: '公共任务'})), toolCallId, recordedAt: new Date().toISOString()}, published: false};
      }};
    return {job, input};
  }
  return {lab, config, actorId, stream, records, next, executor: createBackgroundExecutor(lab), ...fake};
}

describe('native continuous background execution', () => {
  it('shares healthy native history, restricts tools and reads exact earlier requests after restart', async () => {
    const f = await setup((_context, index) => index % 2 === 0 ? {text: `INTERMEDIATE_${index}`, tools: [{name: 'information_record_analysis_update', arguments: {...empty}}]}
      : {text: `FINAL_${index}`});
    const first = f.next(); const one = await f.executor.execute(first.job, first.input);
    const second = f.next(); second.input.text = 'NEW_BATCH_INPUT'; const two = await f.executor.execute(second.job, second.input);
    expect(one.snapshot.lastResult?.status).toBe('succeeded'); expect(two.snapshot.lastResult?.status).toBe('succeeded');
    expect(two.snapshot.messages.every(message => message.requestId === second.job.requestId)).toBe(true);
    expect(JSON.stringify(f.calls[2].context.messages)).toContain('FINAL_1');
    const names = f.calls[0].context.tools!.map(tool => tool.name);
    for (const name of ['bash', 'write', 'edit', 'file_output', 'ask_user', 'instructions_update', 'subagent', 'information_record_task_assessment', 'annotation_create', 'work_item_action']) expect(names).not.toContain(name);
    expect(names).toContain('analysis_current_read'); expect(names).toContain('information_record_analysis_update');
    expect(f.records).toHaveLength(2); expect(f.calls).toHaveLength(4);
    await expect(f.executor.execute(first.job, first.input)).rejects.toThrow('已有执行记录');
    await f.lab.close(); const restored = await PiLab.create(f.config, f.runtime); cleanup.push(() => restored.close());
    const exact = await createBackgroundExecutor(restored).read(first.job);
    expect(exact?.lastResult).toEqual(one.snapshot.lastResult); expect(exact?.messages).toEqual(one.snapshot.messages);
    expect(processingText(exact, first.job.requestId)).toContain('## 最终答复\n\nFINAL_1');
    expect(processingText(exact, first.job.requestId)).not.toContain('FINAL_3');
  });

  it('leaves publication policy to the host when no completion check is supplied', async () => {
    const f = await setup((_context, index) => index === 0 ? {text: 'NO_RECORD'} : index === 1
      ? {tools: [{name: 'information_record_analysis_update', arguments: {...empty, taskUpdates: [{taskId: randomUUID(), inputIds: [randomUUID()], change: 'changed', reason: '未查询', significant: true}]}}]}
      : {text: 'RECORD_FAILED'});
    const missing = f.next(); const first = await f.executor.execute(missing.job, missing.input);
    expect(first.snapshot.lastResult?.status).toBe('succeeded'); expect(f.records).toHaveLength(0); expect(f.calls).toHaveLength(1);
    // Adapter reports execution; the queue decides publication and whether another round is allowed.
    const failed = f.next(); const second = await f.executor.execute(failed.job, failed.input);
    expect(second.snapshot.lastResult?.status).toBe('succeeded');
    expect(second.snapshot.messages.find(message => message.toolName === 'information_record_analysis_update')).toMatchObject({isError: true});
    expect(f.calls).toHaveLength(3);
  });

  it('rejects continuation after an interrupted native tail and explicit recovery excludes unpublished content', async () => {
    const f = await setup((_context, index) => ({text: index === 0 ? 'PUBLISHED' : index === 1 ? 'UNPUBLISHED_TAIL' : 'RECOVERED'}));
    const first = f.next(); await f.executor.execute(first.job, first.input);
    const second = f.next(); await f.executor.execute(second.job, second.input);
    const directory = join(second.input.directory, 'sessions'); const file = join(directory, (await readdir(directory))[0]);
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    const last = lines.findLastIndex(line => JSON.parse(line).customType === RESULT_ENTRY);
    const interrupted = lines.slice(0, last).join('\n') + '\n'; await writeFile(file, interrupted);
    const third = f.next(); await expect(f.executor.execute(third.job, third.input)).rejects.toThrow('显式恢复');
    expect(f.calls).toHaveLength(2); expect(await readFile(file, 'utf8')).toBe(interrupted);
    const old = await f.executor.read(first.job); expect(processingText(old, first.job.requestId)).toBe('PUBLISHED');
    f.stream.sessionId = randomUUID(); const recovery = f.next(); await f.executor.execute(recovery.job, recovery.input);
    expect(JSON.stringify(f.calls[2].context.messages)).not.toContain('UNPUBLISHED_TAIL');
    expect(await readFile(file, 'utf8')).toBe(interrupted);
  });

  it('uses native readonly file tools with only authorized fixed batch files and verifies bytes', async () => {
    const f = await setup((_context, index) => index === 0 ? {tools: [{name: 'ls', arguments: {}}, {name: 'find', arguments: {pattern: '*.txt'}},
      {name: 'read', arguments: {path: '/workspace/allowed.txt'}}, {name: 'read', arguments: {path: '/workspace/old.txt'}},
      {name: 'read', arguments: {path: '/etc/passwd'}}]} : {text: 'FILES_CHECKED'});
    const {job, input} = f.next(); const directory = join(input.directory, 'files'); await mkdir(directory, {recursive: true});
    await writeFile(join(directory, 'allowed.txt'), 'FIXED_BATCH_TEXT'); await writeFile(join(directory, 'old.txt'), 'PRIOR_BATCH_PRIVATE');
    input.files = [{name: 'allowed.txt', path: 'allowed.txt', size: Buffer.byteLength('FIXED_BATCH_TEXT'), hash: hashContent('FIXED_BATCH_TEXT')}];
    const result = await f.executor.execute(job, input);
    expect(result.snapshot.lastResult?.status).toBe('succeeded');
    const messages = f.calls[1].context.messages.filter(message => message.role === 'toolResult');
    expect(messages.map(message => message.isError)).toEqual([false, false, false, true, true]);
    expect(JSON.stringify(messages[2])).toContain(hashContent('FIXED_BATCH_TEXT'));
    expect(JSON.stringify(messages[2])).toContain('allowed.txt');
    expect(JSON.stringify(messages)).toContain('FIXED_BATCH_TEXT'); expect(JSON.stringify(messages)).not.toContain('PRIOR_BATCH_PRIVATE');
    expect(JSON.stringify(messages)).not.toContain('root:');
    expect((await f.executor.read(job))?.messages).toEqual(result.snapshot.messages);
  });

  it.each(['changed', 'symlink', 'binary', 'oversized', 'pdf', 'image'] as const)('rejects %s fixed attachments without exposing bytes', async kind => {
    const f = await setup((_context, index) => index === 0 ? {tools: [{name: 'read', arguments: {path: '/workspace/input.txt'}}]} : {text: 'GAP_REPORTED'});
    const {job, input} = f.next(); const directory = join(input.directory, 'files'); await mkdir(directory, {recursive: true});
    const content = kind === 'pdf' ? '%PDF-1.4\nPDF_MARKER' : kind === 'image' ? Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) : kind === 'binary' ? 'BINARY_MARKER\0' : kind === 'oversized' ? 'SIZE_MARKER'.repeat(110000) : 'CHANGED_MARKER';
    await writeFile(join(directory, 'other.txt'), content);
    if (kind === 'symlink') await symlink(join(directory, 'other.txt'), join(directory, 'input.txt'));
    else await writeFile(join(directory, 'input.txt'), content);
    input.files = [{name: 'input.txt', path: 'input.txt', size: Buffer.byteLength(content), hash: createHash('sha256').update(kind === 'changed' ? 'ORIGINAL' : content).digest('hex')}];
    const result = await f.executor.execute(job, input);
    expect(result.snapshot.lastResult?.status).toBe('succeeded');
    const tool = f.calls[1].context.messages.find(message => message.role === 'toolResult');
    expect(tool).toMatchObject({isError: true});
    for (const marker of ['CHANGED_MARKER', 'BINARY_MARKER', 'SIZE_MARKER', 'PDF_MARKER']) expect(JSON.stringify(tool)).not.toContain(marker);
  });

  it('retains exact prior requests and raw source evidence through native default compaction', async () => {
    let answers = 0;
    const f = await setup(context => !context.tools?.length ? {text: '## Goal\nContinue the input analysis.\n## Progress\nRead source.'}
      : ++answers <= 3 ? {tools: [{name: 'source_read', arguments: {id: 'incoming'}}], usageInput: 2000}
      : answers === 4 ? {error: 'context length exceeded'} : {text: 'COMPACTED_FINAL'}, false, true);
    const first = f.next(); first.input.profile = {...first.input.profile!, resources: [{id: 'incoming', title: '长资料', content: 'ORIGINAL_LONG_SOURCE ' + '资料内容'.repeat(2500)}]};
    const before = await f.executor.execute(first.job, first.input);
    expect(before.snapshot.latestCompaction).toBeDefined();
    expect(before.snapshot.lastResult?.usageSummary?.compactionAttempts).toBeGreaterThan(0);
    const second = f.next(); await f.executor.execute(second.job, second.input);
    const read = await f.executor.read(first.job); expect(read?.lastResult).toEqual(before.snapshot.lastResult); expect(read?.messages).toEqual(before.snapshot.messages);
    const directory = join(first.input.directory, 'sessions'); const path = join(directory, (await readdir(directory))[0]);
    expect(await readFile(path, 'utf8')).toContain('ORIGINAL_LONG_SOURCE');
    expect(JSON.stringify(f.calls.filter(call => !call.context.tools?.length))).not.toContain('READONLY_PROFILE');
  });

  it('passes stable evidence slices unchanged and exposes their continuation offsets to the model', async () => {
    const body = 'ORIGINAL_EVIDENCE_' + '原文'.repeat(20000); const evidenceId = `input:${randomUUID()}`;
    const f = await setup((_context, index) => index < 2 ? {tools: [{name: 'analysis_current_read', arguments: {
      jobId: publishedJob, section: 'evidence', evidenceId, textOffset: index * 32000, textLimit: 32000,
    }}]} : {text: 'BOTH_SLICES_READ'});
    const {job, input} = f.next(); const publishedJob = randomUUID(); const requests: unknown[] = [];
    input.readAnalysisCurrent = async query => {
      requests.push(query); const offset = query.textOffset!; const text = body.slice(offset, offset + query.textLimit!);
      return {items: [], total: 1, evidence: {id: evidenceId, text, offset, total: body.length,
        ...(offset + text.length < body.length ? {nextOffset: offset + text.length} : {})}};
    };
    await f.executor.execute(job, input);
    expect(requests).toEqual([0, 32000].map(textOffset => ({jobId: publishedJob, section: 'evidence', evidenceId, textOffset, textLimit: 32000})));
    const pieces = f.calls[2].context.messages.filter(message => message.role === 'toolResult' && message.toolName === 'analysis_current_read')
      .map(message => {if (message.role !== 'toolResult' || message.content[0].type !== 'text') throw new Error('missing evidence'); return JSON.parse(message.content[0].text).evidence;});
    expect(pieces[0].nextOffset).toBe(32000); expect(pieces[1].nextOffset).toBeUndefined();
    expect(pieces.map(piece => piece.text).join('')).toBe(body);
    expect(f.calls).toHaveLength(3);
  });

  it('observes current task revisions only within each request and exposes original native queries to recovery', async () => {
    let taskId = ''; const inputId = randomUUID();
    const value = () => ({...empty, taskUpdates: [{taskId, inputIds: [inputId], change: 'changed' as const, reason: '条件已核对', significant: false}]});
    const f = await setup((_context, index) => index === 0 ? {tools: [{name: 'task_search', arguments: {}},
      {name: 'information_read', arguments: {systemId: 'intel', reportId: 'report-west-01', revision: 1}}]}
      : index === 1 || index === 3 ? {tools: [{name: 'information_record_analysis_update', arguments: value()}]}
      : index === 5 ? {tools: [{name: 'analysis_current_read', arguments: {jobId: publishedJob, section: 'evidence'}}]}
      : {text: 'NATIVE_FINAL'}, true);
    const actor = f.lab.access!.identity(f.actorId)!;
    const task = f.lab.access!.create(actor, {title: '公共任务', goal: '3辆车', visibility: 'public', clientActionId: randomUUID()}); taskId = task.id;
    const first = f.next(); const publishedJob = first.job.id; const result = await f.executor.execute(first.job, first.input);
    expect(f.records[0].evidence.queried, JSON.stringify(result.snapshot.messages)).toBe(true); expect(f.records[0].evidence.tasks.get(task.id)).toBe(task.revision);
    const evidence = queryEvidence(result.snapshot, first.job.requestId); expect(evidence.map(message => message.toolName)).toContain('information_read');
    const second = f.next(); const unobserved = await f.executor.execute(second.job, second.input);
    expect(f.records[1].evidence.tasks.size).toBe(0);
    expect(unobserved.snapshot.messages.find(message => message.toolName === 'information_record_analysis_update')).toMatchObject({isError: true});
    f.stream.sessionId = randomUUID(); const recovery = f.next();
    const detail: ContinuousRoundDetail = {jobId: first.job.id, streamId: f.stream.id, epochId: f.stream.epochId, streamName: f.stream.name,
      sourceIds: f.stream.sourceIds, batch: first.input.continuous!.batch, status: 'succeeded', publication: 'published', createdAt: first.job.createdAt,
      pendingInputs: 0, streamState: 'active', text: processingText(result.snapshot, first.job.requestId), queryMessages: evidence};
    recovery.input.readAnalysisCurrent = async query => {expect(query).toEqual({jobId: publishedJob, section: 'evidence'}); return {items: [], total: 1, detail};};
    await f.executor.execute(recovery.job, recovery.input);
    const tool = f.calls[6].context.messages.find(message => message.role === 'toolResult' && message.toolName === 'analysis_current_read');
    expect(JSON.stringify(tool)).toContain('report-west-01'); expect(JSON.stringify(tool)).toContain('queriedAt');
    expect(tool?.role).toBe('toolResult');
    if (tool?.role !== 'toolResult' || tool.content[0].type !== 'text') throw new Error('missing native evidence');
    expect(JSON.parse(tool.content[0].text).detail.queryMessages).toEqual(evidence);
    expect(f.calls).toHaveLength(7);
  });
});
