import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmod, lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PiLab } from '../pi/lab.js';
import type { CommandInput, CommandRecord, CommandReceipt, ExternalCommand, TaskExecutionSummary, TaskExecutionSummaryGroup } from '../contracts/commands.js';
import type { ContextRef, SituationObject } from '../contracts/context.js';
import { RequestError } from '../contracts/errors.js';
import { readContextJson } from '../context/http.js';
import { atomicWrite, checkDirectory, readControlled, stateError } from '../resources/files.js';
import { assertCommandObjects, commandExecution, commandHash, commandInput, stableCommand } from './validation.js';

interface StoredCommand extends CommandRecord {
  scenarioInstanceId: string;
  dedupKey: string;
  preparedByUserId: string;
  issuedByUserId?: string;
}
const unavailable = () => new RequestError('COMMAND_UNAVAILABLE', '指挥接口暂不可用。', 503);

/** Durable send intent. A lost response is queried, never automatically resent. */
export class CommandService {
  private constructor(private readonly db: DatabaseSync, private readonly lab: PiLab, private readonly env: NodeJS.ProcessEnv) {}
  static async open(lab: PiLab, env: NodeJS.ProcessEnv = process.env) {
    const directory = join(lab.config.dataDir, 'commands');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await checkDirectory(directory);
    const path = join(directory, 'commands.sqlite');
    const marker = await readControlled(join(directory, '.initialized'), 100, true);
    const stat = await lstat(path).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    if ((marker === null) !== (stat === undefined) || marker !== null && marker !== 'commands-v1\n'
      || stat && (!stat.isFile() || stat.nlink !== 1 || stat.isSymbolicLink())) throw stateError();
    const db = new DatabaseSync(path);
    try {
      db.exec('PRAGMA synchronous=FULL;');
      if (!stat) {
        db.exec('CREATE TABLE commands(id TEXT PRIMARY KEY,dedup_key TEXT UNIQUE NOT NULL,body TEXT NOT NULL CHECK(json_valid(body))); PRAGMA user_version=1;');
        await chmod(path, 0o600);
        await atomicWrite(join(directory, '.initialized'), 'commands-v1\n');
      }
      if (db.prepare('PRAGMA user_version').get()?.user_version !== 1 || db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw stateError();
      const service = new CommandService(db, lab, env);
      for (const raw of db.prepare('SELECT body FROM commands').all()) {
        const record = service.decode(String(raw.body));
        if (record.status === 'prepared') service.save({ ...record, status: 'cancelled' });
      }
      return service;
    } catch (error) { db.close(); throw error; }
  }
  close() { this.db.close(); }
  private decode(body: string): StoredCommand {
    const record = JSON.parse(body) as StoredCommand;
    if (!record.id || !record.taskSpaceId || !record.scenarioInstanceId || !record.seatId || !record.dedupKey || !record.preparedByUserId
      || !['prepared', 'cancelled', 'unknown', 'received', 'rejected'].includes(record.status)
      || commandHash(this.externalInput(commandInput(record.command))) !== record.contentHash) throw stateError();
    if ((record.status === 'received') !== (record.receipt !== undefined)
      || record.receipt !== undefined && !this.validReceipt(record.receipt, record)) throw stateError();
    if (['unknown', 'received', 'rejected'].includes(record.status) && !record.issuedByUserId) throw stateError();
    if (record.execution !== undefined) {
      const execution = commandExecution(record.execution);
      if (record.status !== 'received' || execution.commandId !== record.id
        || execution.rootCommandId !== (record.command.targetCommandId ?? record.id)) throw stateError();
    }
    return record;
  }
  private validReceipt(value: unknown, record: Pick<StoredCommand, 'id' | 'contentHash'>): value is CommandReceipt {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const receipt = value as Partial<CommandReceipt>;
    return receipt.commandId === record.id && receipt.contentHash === record.contentHash && receipt.status === 'received'
      && typeof receipt.receiptId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(receipt.receiptId)
      && typeof receipt.receivedAt === 'string' && Number.isFinite(Date.parse(receipt.receivedAt))
      && Object.keys(receipt).every(key => ['commandId', 'contentHash', 'status', 'receiptId', 'receivedAt'].includes(key));
  }
  private externalInput(command: CommandInput) {
    const { attachmentFileId: _attachment, ...input } = command;
    void _attachment;
    return input;
  }
  private raw(id: string): StoredCommand {
    const row = this.db.prepare('SELECT body FROM commands WHERE id=?').get(id);
    if (!row) throw new RequestError('COMMAND_NOT_FOUND', '指令不存在。', 404);
    return this.decode(String(row.body));
  }
  private save(record: StoredCommand) {
    this.db.prepare('INSERT INTO commands VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(record.id, record.dedupKey, JSON.stringify(record));
  }
  private public(record: StoredCommand): CommandRecord {
    const { scenarioInstanceId: _owner, dedupKey: _key, preparedByUserId: _preparedBy, issuedByUserId: _issuedBy, ...result } = record;
    void _owner; void _key; void _preparedBy; void _issuedBy;
    return structuredClone(result);
  }
  allowed(seatId: string) { return this.lab.access?.canIssueCommands(seatId) === true; }
  private authorize(seatId: string, taskId: string, write = true) {
    const access = this.lab.access;
    if (!access || !this.allowed(seatId)) throw new RequestError('FORBIDDEN', '当前席位无权下达或核查指令。', 403);
    const task = access.get(taskId, seatId);
    if (!task.scenarioInstanceId) throw new RequestError('COMMAND_SCOPE_REQUIRED', '此任务尚无可核验的执行资料归属。', 409);
    if (write) {
      if (task.state !== 'active') throw new RequestError('TASK_ARCHIVED', '任务已归档。', 409);
      if (!this.lab.scenario) throw unavailable();
      this.lab.scenario.assertWritable(task.scenarioInstanceId);
    }
    const config = this.lab.context?.config;
    if (!config?.commands?.enabled || !config.simulation?.enabled
      || !config.scopes.some(scope => scope.seatIds.includes(seatId) && scope.systemIds.includes('situation'))) throw unavailable();
    return { task, actor: access.identityForSeat(seatId)!, config: config.simulation };
  }
  private owned(seatId: string, id: string, write = false) {
    const record = this.raw(id);
    if (record.seatId !== seatId) throw new RequestError('COMMAND_NOT_FOUND', '指令不存在。', 404);
    const { task } = this.authorize(seatId, record.taskSpaceId, write);
    if (task.scenarioInstanceId !== record.scenarioInstanceId) throw stateError();
    return record;
  }
  availability(seatId: string, taskId: string) {
    const task = this.lab.access!.get(taskId, seatId);
    const canRead = this.allowed(seatId) && task.scenarioInstanceId !== undefined;
    return { canRead, canPrepare: canRead && task.state === 'active' && this.lab.scenario?.isWritable(task.scenarioInstanceId!) === true };
  }
  read(seatId: string, id: string) { return this.public(this.owned(seatId, id)); }
  list(seatId: string, taskId: string, clientActionId?: string) {
    this.authorize(seatId, taskId, false);
    return this.db.prepare('SELECT body FROM commands ORDER BY rowid DESC').all()
      .map(row => this.decode(String(row.body)))
      .filter(record => record.seatId === seatId && record.taskSpaceId === taskId
        && (clientActionId === undefined || record.dedupKey === `page:${seatId}:${clientActionId}`))
      .map(record => this.public(record));
  }
  private summaryAccess(seatId: string, taskId: string) {
    const access = this.lab.access;
    if (!access?.identityForSeat(seatId)) throw new RequestError('FORBIDDEN', '当前身份不可读取执行资料。', 403);
    const task = access.get(taskId, seatId), context = this.lab.context, config = context?.config.simulation;
    if (!task.scenarioInstanceId || !context?.config.commands?.enabled || !config?.enabled) return { task };
    if (!context.config.scopes.some(scope => scope.seatIds.includes(seatId) && scope.systemIds.includes('situation'))) {
      throw new RequestError('CONTEXT_FORBIDDEN', '当前身份无权访问本次业务资料范围。', 403);
    }
    if (!this.lab.scenario || !context.config.systems.some(system => system.id === 'situation' && system.scenarioClock === true)) throw unavailable();
    return { task, context, config };
  }
  /** Shared source facts only. Unlike reconcile(), this read never changes a send or execution record. */
  async summary(seatId: string, taskId: string, signal?: AbortSignal): Promise<TaskExecutionSummary> {
    const { task, context, config } = this.summaryAccess(seatId, taskId);
    const readOnly = task.state !== 'active' || task.scenarioInstanceId !== undefined && !this.lab.scenario?.isWritable(task.scenarioInstanceId);
    const result: TaskExecutionSummary = { available: Boolean(context && config), readOnly, queriedAt: new Date().toISOString(), complete: false, groups: [] };
    if (!context || !config) return result;
    const token = this.env[config.tokenEnv];
    if (!token) throw unavailable();
    const records = this.db.prepare("SELECT body FROM commands WHERE json_extract(body,'$.taskSpaceId')=? AND json_extract(body,'$.scenarioInstanceId')=? AND json_extract(body,'$.status')='received' ORDER BY rowid").all(task.id, task.scenarioInstanceId!)
      .map(row => this.decode(String(row.body))).filter(record => (record.command.action ?? 'dispatch') === 'dispatch');
    if (records.length > 100) throw new RequestError('COMMAND_SUMMARY_LIMIT', '执行记录过多，请进入原记录分组核对。', 503);
    const sameAccess = () => {
      const current = this.summaryAccess(seatId, taskId);
      if (!current.context || current.context !== context || current.config !== config || current.task.scenarioInstanceId !== task.scenarioInstanceId) throw unavailable();
      return current.task;
    };
    const refKey = (ref: ContextRef) => JSON.stringify([ref.systemId, ref.objectType, ref.objectId]);
    const objects = new Map<string, SituationObject>();
    const refs = [...new Map(records.flatMap(record => [...record.command.vehicles, record.command.destination]).map(ref => [refKey(ref), ref])).values()];
    if (refs.length > 500) throw new RequestError('COMMAND_SUMMARY_LIMIT', '执行对象过多，请进入原记录分组核对。', 503);
    let namesAvailable = true;
    let objectBusinessNow: string | undefined;
    const readId = randomUUID();
    try {
      for (let offset = 0; offset < refs.length; offset += 20) {
        let cursor: string | undefined;
        const cursors = new Set<string>();
        do {
          const response = await context.query('situation_query', { systemId: 'situation', mode: 'current', objectRefs: refs.slice(offset, offset + 20), limit: 100, ...(cursor ? { cursor } : {}) },
            { kind: 'seat', seatId, scenarioInstanceId: task.scenarioInstanceId, readId }, signal, true);
          sameAccess();
          if (!('unknownRefs' in response.data) || !('changeCursor' in response.data)) throw unavailable();
          objectBusinessNow = response.data.snapshotClock?.businessNow;
          for (const object of response.data.items) objects.set(refKey(object.ref), object);
          if (response.data.unknownRefs.length) namesAvailable = false;
          if (!response.data.hasMore) break;
          cursor = response.data.nextCursor ?? undefined;
          if (!cursor || cursors.has(cursor) || cursors.size >= 25) throw unavailable();
          cursors.add(cursor);
        } while (cursor);
      }
    } catch (error) {
      signal?.throwIfAborted(); sameAccess();
      if (error instanceof RequestError && error.statusCode === 403) throw error;
      namesAvailable = false;
    }
    for (const record of records) {
      const destination = objects.get(refKey(record.command.destination));
      const group: TaskExecutionSummaryGroup = { id: record.id, destination: { ref: record.command.destination, name: destination?.name ?? '目的地（名称待核实）' }, status: 'unavailable', vehicles: [] };
      if (record.seatId === seatId && this.allowed(seatId)) group.commandId = record.id;
      let execution = record.execution;
      const expected = new Set(record.command.vehicles.map(refKey));
      const validExecution = (value: NonNullable<CommandRecord['execution']>) => value.commandId === record.id && value.rootCommandId === record.id
        && value.vehicles.every(vehicle => expected.has(refKey(vehicle.vehicle))) && (value.status === 'refused' || value.vehicles.length === expected.size);
      if (execution && !validExecution(execution)) throw stateError();
      try {
        const raw = await readContextJson(new URL(`${config.baseUrl}/control/commands/${encodeURIComponent(record.id)}/execution`), token, signal, { maxBytes: 4 * 1024 * 1024 });
        sameAccess();
        const current = commandExecution(raw);
        if (!validExecution(current)) throw unavailable();
        execution = current;
        group.status = readOnly ? 'saved' : current.status === 'refused' ? 'refused' : 'current';
        if (readOnly) group.reason = '已结束资料，显示保留的执行事实。';
      } catch (error) {
        signal?.throwIfAborted(); sameAccess();
        if (error instanceof RequestError && error.statusCode === 403) throw error;
        group.status = execution ? 'saved' : error instanceof RequestError && error.code === 'CONTEXT_NOT_FOUND' ? 'unsupported' : 'unavailable';
        group.reason = execution ? '来源暂不可读，显示已保存记录。' : group.status === 'unsupported' ? '此记录没有可读取的车辆执行资料。' : '执行资料暂不可读。';
      }
      if (execution) {
        group.businessNow = execution.businessNow; group.revision = execution.revision;
        group.vehicles = execution.vehicles.map(vehicle => ({ ref: vehicle.vehicle, name: objects.get(refKey(vehicle.vehicle))?.name ?? '车辆（名称待核实）', state: vehicle.state,
          ...(vehicle.state === 'blocked' && vehicle.blockedReason ? { blockedReason: vehicle.blockedReason } : {}) }));
        if (group.status === 'refused') group.reason = execution.reason ?? '外部系统未受理本次行动。';
      }
      // A later dispatch can reuse a vehicle released before departure. Its original action is history, not a second current vehicle.
      if (group.status === 'current' && group.businessNow === objectBusinessNow && group.vehicles.some(vehicle => {
        const properties = objects.get(refKey(vehicle.ref))?.properties;
        return properties && 'executionCommandId' in properties && properties.executionCommandId !== record.id;
      })) { group.status = 'saved'; group.reason = '车辆另有后续行动，保留原行动记录。'; }
      if (!namesAvailable || !destination || group.vehicles.some(vehicle => !objects.has(refKey(vehicle.ref)))) {
        if (group.status === 'current') { group.status = 'saved'; group.reason = '来源对象未查全，保留本组执行记录。'; }
      }
      result.groups.push(group);
    }
    const latestTask = sameAccess();
    if (!this.allowed(seatId)) for (const group of result.groups) delete group.commandId;
    result.readOnly = latestTask.state !== 'active' || !this.lab.scenario!.isWritable(task.scenarioInstanceId!);
    if (result.readOnly) for (const group of result.groups) if (group.status === 'current') { group.status = 'saved'; group.reason = '已结束资料，显示保留的执行事实。'; }
    result.complete = namesAvailable && result.groups.every(group => group.status === 'refused' || group.status === 'current' && group.businessNow === objectBusinessNow);
    const groups = result.groups.filter(group => group.status === 'current'), times = new Set(groups.map(group => group.businessNow));
    const vehicles = groups.flatMap(group => group.vehicles);
    if (times.size > 1 || new Set(vehicles.map(vehicle => refKey(vehicle.ref))).size !== vehicles.length) result.complete = false;
    if (result.complete && groups.length && times.size === 1) {
      result.businessNow = groups[0].businessNow;
      result.counts = { waiting: 0, en_route: 0, blocked: 0, arrived: 0, cancelled: 0 };
      for (const vehicle of vehicles) result.counts[vehicle.state]++;
    }
    result.queriedAt = new Date().toISOString();
    return result;
  }
  async prepare(seatId: string, workspaceId: string, input: unknown, source: 'page' | 'agent', actionKey: string, signal?: AbortSignal) {
    const workspace = this.lab.workspaces.get(workspaceId, seatId);
    if (!workspace.taskSpaceId) throw unavailable();
    const { task, actor } = this.authorize(seatId, workspace.taskSpaceId);
    const command = commandInput(input);
    const dedupKey = `${source}:${seatId}:${actionKey}`;
    const previous = this.db.prepare('SELECT body FROM commands WHERE dedup_key=?').get(dedupKey);
    if (previous) {
      const stored = this.decode(String(previous.body));
      if (stored.workspaceId !== workspaceId || stableCommand(stored.command) !== stableCommand(command)) throw new RequestError('COMMAND_CONFLICT', '操作编号已用于其他内容。', 409);
      return this.public(stored);
    }
    if (command.action === 'reroute' || command.action === 'cancel') {
      const target = this.owned(seatId, command.targetCommandId!, true);
      if (target.taskSpaceId !== task.id || (target.command.action ?? 'dispatch') !== 'dispatch' || target.status !== 'received') {
        throw new RequestError('COMMAND_NOT_FOUND', '原指令不属于当前任务或尚未确认接收。', 404);
      }
      const original = new Set(target.command.vehicles.map(vehicle => vehicle.objectId));
      if (command.vehicles.some(vehicle => !original.has(vehicle.objectId))
        || stableCommand(command.destination) !== stableCommand(target.command.destination)) {
        throw new RequestError('INVALID_INPUT', '请保留原目的地，并选择原指令中的车辆。');
      }
      const current = await this.refreshExecution(seatId, target.id, signal);
      if (!current.execution || current.executionError) throw new RequestError('COMMAND_EXECUTION_UNAVAILABLE', '原指令执行进展尚未确认，请先查询。', 409);
      if (current.execution.revision !== command.expectedExecutionRevision) throw new RequestError('COMMAND_EXECUTION_CONFLICT', '执行进展已变化，请重新核对后准备。', 409);
    }
    const refs = [...command.vehicles, command.destination, ...command.route];
    const objects: SituationObject[] = [];
    for (let offset = 0; offset < refs.length; offset += 20) {
      const result = await this.lab.context!.query('situation_query', { systemId: 'situation', mode: 'current', objectRefs: refs.slice(offset, offset + 20), limit: 100 },
        { kind: 'seat', seatId, scenarioInstanceId: task.scenarioInstanceId }, signal);
      if ('items' in result.data) objects.push(...result.data.items as SituationObject[]);
    }
    assertCommandObjects(command, objects);
    const attachment = command.attachmentFileId ? await this.lab.collaboration!.referenceFile({ seatId }, command.attachmentFileId, task.id) : undefined;
    signal?.throwIfAborted();
    this.authorize(seatId, task.id);
    const record: StoredCommand = { id: randomUUID(), taskSpaceId: task.id, workspaceId, seatId, seatName: actor.seatName, source,
      command, ...(attachment ? { attachment } : {}), contentHash: commandHash(this.externalInput(command)), createdAt: new Date().toISOString(),
      status: 'prepared', scenarioInstanceId: task.scenarioInstanceId!, dedupKey, preparedByUserId: actor.userId };
    // The asynchronous source/file checks may race a repeated preparation.
    const raced = this.db.prepare('SELECT body FROM commands WHERE dedup_key=?').get(dedupKey);
    if (raced) {
      const existing = this.decode(String(raced.body));
      if (existing.workspaceId !== workspaceId || stableCommand(existing.command) !== stableCommand(command)) throw new RequestError('COMMAND_CONFLICT', '操作编号已用于其他内容。', 409);
      return this.public(existing);
    }
    this.save(record);
    return this.public(record);
  }
  expire(seatId: string, id: string) {
    const record = this.raw(id);
    if (record.seatId === seatId && record.source === 'agent' && record.status === 'prepared') this.save({ ...record, status: 'cancelled' });
  }
  cancel(seatId: string, id: string) {
    const record = this.owned(seatId, id);
    if (record.source !== 'page' || record.status !== 'prepared') throw new RequestError('COMMAND_CONFLICT', '该指令不能取消。', 409);
    this.save({ ...record, status: 'cancelled' });
    return this.read(seatId, id);
  }
  private async call(record: StoredCommand, send: boolean, signal?: AbortSignal) {
    const { config } = this.authorize(record.seatId, record.taskSpaceId, send);
    const token = this.env[config.tokenEnv];
    if (!token) throw unavailable();
    const body: ExternalCommand = { commandId: record.id, scenarioInstanceId: record.scenarioInstanceId, taskId: record.taskSpaceId,
      issuedBy: { seatId: record.seatId, seatName: record.seatName }, command: this.externalInput(record.command), contentHash: record.contentHash };
    const url = new URL(`${config.baseUrl}/control/commands${send ? '' : `/${encodeURIComponent(record.id)}`}`);
    const raw = await readContextJson(url, token, signal, { method: send ? 'POST' : 'GET', ...(send ? { body } : {}) });
    if (!this.validReceipt(raw, record)) throw unavailable();
    const receipt = raw;
    this.save({ ...record, status: 'received', receipt, error: undefined });
    return this.public(this.raw(record.id));
  }
  async commit(seatId: string, id: string, source: 'page' | 'agent', signal?: AbortSignal) {
    const record = this.owned(seatId, id, true);
    if (record.source !== source) throw new RequestError('COMMAND_CONFLICT', '确认入口与指令准备不一致。', 409);
    if (record.status === 'received' || record.status === 'unknown') return this.public(record);
    if (record.status !== 'prepared') throw new RequestError('COMMAND_CONFLICT', '指令已取消或结束，请核查原记录。', 409);
    signal?.throwIfAborted();
    const sending: StoredCommand = { ...record, status: 'unknown', issuedByUserId: this.authorize(seatId, record.taskSpaceId).actor.userId };
    this.save(sending);
    try { await this.call(sending, true, signal); }
    catch (error) {
      const current = this.raw(id);
      if (current.status === 'received') return this.public(current);
      const rejected = error instanceof RequestError && ['CONTEXT_SCENARIO_FROZEN', 'CONTEXT_ACTION_CONFLICT', 'CONTEXT_INVALID_ARGUMENT', 'CONTEXT_FORBIDDEN'].includes(error.code);
      const message = error instanceof RequestError && error.code === 'CONTEXT_SCENARIO_FROZEN'
        ? '当前资料已只读，本次指令未接收。' : rejected ? error.message : '接收结果尚未确认，请查询原指令回执。';
      this.save({ ...current, status: rejected ? 'rejected' : 'unknown', error: message });
      return this.public(this.raw(id));
    }
    return this.refreshExecution(seatId, id, signal);
  }
  private async refreshExecution(seatId: string, id: string, signal?: AbortSignal) {
    const record = this.owned(seatId, id);
    if (record.status !== 'received') return this.public(record);
    const { config } = this.authorize(seatId, record.taskSpaceId, false);
    const token = this.env[config.tokenEnv];
    if (!token) throw unavailable();
    try {
      const value = await readContextJson(new URL(`${config.baseUrl}/control/commands/${encodeURIComponent(id)}/execution`), token, signal, { maxBytes: 4 * 1024 * 1024 });
      const execution = commandExecution(value);
      if (execution.commandId !== id || execution.rootCommandId !== (record.command.targetCommandId ?? id)) {
        throw new RequestError('COMMAND_EXECUTION_INVALID', '执行进展与原指令不匹配。', 502);
      }
      const root = this.owned(seatId, execution.rootCommandId);
      if (root.taskSpaceId !== record.taskSpaceId || root.scenarioInstanceId !== record.scenarioInstanceId) throw stateError();
      const vehicles = new Set(root.command.vehicles.map(vehicle => vehicle.objectId));
      if (execution.vehicles.some(vehicle => !vehicles.has(vehicle.vehicle.objectId))
        || execution.status !== 'refused' && execution.vehicles.length !== vehicles.size) {
        throw new RequestError('COMMAND_EXECUTION_INVALID', '执行进展包含原指令之外的车辆。', 502);
      }
      signal?.throwIfAborted();
      const current = this.owned(seatId, id);
      if (!current.execution || current.execution.revision <= execution.revision) this.save({ ...current, execution, executionError: undefined });
    } catch (error) {
      signal?.throwIfAborted();
      const current = this.owned(seatId, id);
      if (error instanceof RequestError && error.code === 'CONTEXT_NOT_FOUND' && !current.execution) {
        this.save({ ...current, executionError: undefined });
      } else {
        this.save({ ...current, executionError: '执行进展暂不可用，请重新查询。' });
      }
    }
    return this.public(this.owned(seatId, id));
  }
  async reconcile(seatId: string, id: string, signal?: AbortSignal) {
    const record = this.owned(seatId, id);
    if (record.status === 'received') return this.refreshExecution(seatId, id, signal);
    if (record.status !== 'unknown') return this.public(record);
    try { await this.call(record, false, signal); }
    catch {
      signal?.throwIfAborted();
      return this.public(this.owned(seatId, id));
    }
    return this.refreshExecution(seatId, id, signal);
  }
}
