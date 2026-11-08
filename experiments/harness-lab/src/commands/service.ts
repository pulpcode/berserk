import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmod, lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PiLab } from '../pi/lab.js';
import type { CommandInput, CommandRecord, CommandReceipt, ExternalCommand } from '../contracts/commands.js';
import type { SituationObject } from '../contracts/context.js';
import { RequestError } from '../contracts/errors.js';
import { readContextJson } from '../context/http.js';
import { atomicWrite, checkDirectory, readControlled, stateError } from '../resources/files.js';
import { assertCommandObjects, commandHash, commandInput, stableCommand } from './validation.js';

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
    try { return await this.call(sending, true, signal); }
    catch (error) {
      const current = this.raw(id);
      if (current.status === 'received') return this.public(current);
      const rejected = error instanceof RequestError && ['CONTEXT_SCENARIO_FROZEN', 'CONTEXT_ACTION_CONFLICT', 'CONTEXT_INVALID_ARGUMENT', 'CONTEXT_FORBIDDEN'].includes(error.code);
      const message = error instanceof RequestError && error.code === 'CONTEXT_SCENARIO_FROZEN'
        ? '当前资料已只读，本次指令未接收。' : rejected ? error.message : '接收结果尚未确认，请查询原指令回执。';
      this.save({ ...current, status: rejected ? 'rejected' : 'unknown', error: message });
      return this.public(this.raw(id));
    }
  }
  async reconcile(seatId: string, id: string, signal?: AbortSignal) {
    const record = this.owned(seatId, id);
    if (record.status !== 'unknown') return this.public(record);
    try { return await this.call(record, false, signal); }
    catch { return this.public(this.raw(id)); }
  }
}
