import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Identity, TaskInput, TaskSpace } from '../contracts/access.js';
import { UUID } from '../workspaces/store.js';
import { stateError } from '../resources/files.js';
import { RequestError } from '../contracts/errors.js';

const missing = () => new RequestError('TASK_NOT_FOUND', '任务不存在或无权访问。', 404);
const conflict = (message = '任务已变化，请查看最新说明后重试。') => new RequestError('TASK_CONFLICT', message, 409);
export function derivePassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}

function decodeTask(row: {id: unknown;data:unknown}): TaskSpace {
  const task=JSON.parse(String(row.data)) as TaskSpace;
  if(!task || typeof task!=='object' || task.id!==row.id || !UUID.test(task.id) || typeof task.title!=='string' || !task.title.trim() || task.title.length>60 || typeof task.goal!=='string' || task.goal.length>8000 || !['public','private'].includes(task.visibility) || !['active','archived'].includes(task.state) || !Number.isSafeInteger(task.revision) || task.revision<1 || !/^[a-zA-Z0-9_-]{1,64}$/.test(task.ownerSeatId) || !UUID.test(task.createdByUserId) || !UUID.test(task.updatedByUserId) || !Number.isFinite(Date.parse(task.createdAt)) || !Number.isFinite(Date.parse(task.updatedAt)))throw stateError();
  return task;
}

/** Owns task/account metadata; never copies or interprets Pi messages. */
export class AccessStore {
  private busy = new Map<string, number>();
  constructor(readonly db: DatabaseSync) {
    const version=Number(db.prepare('PRAGMA user_version').get()?.user_version);
    if([2,3].includes(version)) {
      const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>String(row.name)));
      if(['seats','accounts','auth_sessions','task_spaces','task_actions'].some(name=>!tables.has(name)))throw stateError();
      return;
    }
    if(version!==1)throw stateError();
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS seats(id TEXT PRIMARY KEY, name TEXT NOT NULL, create_public INTEGER NOT NULL, manage_model INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, seat_id TEXT NOT NULL REFERENCES seats(id), salt TEXT NOT NULL, password_hash TEXT NOT NULL, enabled INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_enabled_account_per_seat ON accounts(seat_id) WHERE enabled=1;
      CREATE TABLE IF NOT EXISTS auth_sessions(id TEXT PRIMARY KEY, user_id TEXT, expires INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task_spaces(id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE IF NOT EXISTS task_actions(user_id TEXT NOT NULL, action_id TEXT NOT NULL, input TEXT NOT NULL, task_id TEXT NOT NULL REFERENCES task_spaces(id), PRIMARY KEY(user_id,action_id));
      PRAGMA user_version=2; COMMIT;`);
  }
  allSeatIds() { return this.db.prepare('SELECT id FROM seats').all().map(row=>String(row.id)); }
  seats() { return this.db.prepare('SELECT s.id,s.name FROM seats s JOIN accounts a ON a.seat_id=s.id WHERE a.enabled=1').all() as unknown as Array<{id:string;name:string}>; }
  identity(id: string): Identity | undefined {
    const row = this.db.prepare(`SELECT a.id userId,a.username,a.display_name displayName,a.seat_id seatId,s.name seatName,s.create_public createPublicTask,s.manage_model manageModelSettings FROM accounts a JOIN seats s ON a.seat_id=s.id WHERE a.id=? AND a.enabled=1`).get(id);
    return row ? { ...row, createPublicTask: !!row.createPublicTask, manageModelSettings: !!row.manageModelSettings } as unknown as Identity : undefined;
  }
  async authenticate(username: string, password: string) {
    const row = this.db.prepare('SELECT id,salt,password_hash,enabled FROM accounts WHERE username=?').get(username);
    const key = await derivePassword(password, row ? String(row.salt) : 'axon-unknown-account');
    const hash = row ? Buffer.from(String(row.password_hash), 'hex') : Buffer.alloc(64);
    return row?.enabled && hash.length === key.length && timingSafeEqual(hash, key) ? this.identity(String(row.id)) : undefined;
  }
  async saveAccount(input: {username:string;displayName:string;seatId:string;seatName:string;password:string;createPublicTask:boolean;manageModelSettings:boolean}) {
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(input.username) || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.seatId) || !input.displayName.trim() || !input.seatName.trim() || input.password.length < 12 || input.password.length > 256) throw new Error('账号、席位或密码无效；密码须为 12～256 个字符。');
    const previous = this.db.prepare('SELECT id,seat_id FROM accounts WHERE username=?').get(input.username);
    if (previous && previous.seat_id !== input.seatId) throw new Error('本期不支持账号换岗。');
    const salt = randomBytes(32).toString('hex'); const hash = (await derivePassword(input.password, salt)).toString('hex');
    const id = previous ? String(previous.id) : randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO seats VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,create_public=excluded.create_public,manage_model=excluded.manage_model').run(input.seatId,input.seatName,Number(input.createPublicTask),Number(input.manageModelSettings));
      this.db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,salt=excluded.salt,password_hash=excluded.password_hash,enabled=1').run(id,input.username,input.displayName,input.seatId,salt,hash);
      this.db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(id); this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
    return id;
  }
  disable(username: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try { this.db.prepare('DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM accounts WHERE username=?)').run(username); this.db.prepare('UPDATE accounts SET enabled=0 WHERE username=?').run(username); this.db.exec('COMMIT'); }
    catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  list(seatId: string): TaskSpace[] {
    return this.db.prepare('SELECT id,data FROM task_spaces ORDER BY rowid DESC').all().map(row => decodeTask({id:row.id,data:row.data})).filter(task => task.visibility === 'public' || task.ownerSeatId === seatId);
  }
  get(id: string, seatId: string, write = false): TaskSpace {
    const row = this.db.prepare('SELECT id,data FROM task_spaces WHERE id=?').get(id);
    if (!row) throw missing();
    const task = decodeTask({id:row.id,data:row.data});
    if (task.visibility !== 'public' && task.ownerSeatId !== seatId) throw missing();
    if (write && task.state !== 'active') throw new RequestError('TASK_ARCHIVED', '任务已归档，请先重新开启。', 409);
    return task;
  }
  findCreation(actor: Identity, actionId: string): TaskSpace[] {
    const row=this.db.prepare('SELECT task_id FROM task_actions WHERE user_id=? AND action_id=?').get(actor.userId,actionId);
    return row ? [this.get(String(row.task_id),actor.seatId)] : [];
  }
  create(actor: Identity, input: TaskInput): TaskSpace {
    if (!input.title.trim() || input.title.trim().length > 60 || input.goal.length > 8000 || !['public','private'].includes(input.visibility) || (input.visibility === 'public' && !input.goal.trim())) throw new RequestError('INVALID_INPUT', '请填写任务名称，公共任务还需要目标说明。');
    if (input.visibility === 'public' && !actor.createPublicTask) throw new RequestError('FORBIDDEN', '当前席位无权创建公共任务。', 403);
    const digest = JSON.stringify([input.title.trim(),input.goal.trim(),input.visibility]);
    const old = this.db.prepare('SELECT input,task_id FROM task_actions WHERE user_id=? AND action_id=?').get(actor.userId,input.clientActionId);
    if (old) { if (old.input !== digest) throw conflict('同一次创建的内容已变化，请先核对任务列表。'); return this.get(String(old.task_id),actor.seatId); }
    const time = new Date().toISOString();
    const task: TaskSpace = {id:randomUUID(),title:input.title.trim(),goal:input.goal.trim(),visibility:input.visibility,ownerSeatId:actor.seatId,state:'active',revision:1,createdByUserId:actor.userId,updatedByUserId:actor.userId,createdAt:time,updatedAt:time};
    this.db.exec('BEGIN IMMEDIATE');
    try { this.db.prepare('INSERT INTO task_spaces VALUES(?,?)').run(task.id,JSON.stringify(task)); this.db.prepare('INSERT INTO task_actions VALUES(?,?,?,?)').run(actor.userId,input.clientActionId,digest,task.id); this.db.exec('COMMIT'); }
    catch(error) { this.db.exec('ROLLBACK'); throw error; }
    return task;
  }
  update(actor: Identity, id: string, revision: number, change: {title?:string;goal?:string;state?:TaskSpace['state']}, blocked: () => boolean = () => false): TaskSpace {
    const task = this.get(id,actor.seatId);
    if (task.ownerSeatId !== actor.seatId) throw new RequestError('FORBIDDEN','仅负责席位可管理任务。',403);
    if (task.revision !== revision) throw conflict();
    if (change.state === 'archived' && ((this.busy.get(id) || 0) > 0 || blocked())) throw conflict('任务仍有处理请求、写入或未完成工作，请结束后再归档。');
    const next = {...task,...change,revision:task.revision+1,updatedByUserId:actor.userId,updatedAt:new Date().toISOString()};
    if (!next.title.trim() || next.title.length > 60 || next.goal.length > 8000 || (next.visibility === 'public' && !next.goal.trim())) throw new RequestError('INVALID_INPUT','请填写有效的任务名称与目标。');
    next.title = next.title.trim(); next.goal = next.goal.trim();
    this.db.prepare('UPDATE task_spaces SET data=? WHERE id=?').run(JSON.stringify(next),id); return next;
  }
  /** Synchronous admission, held only for the actual write/request lifetime. No execution queue. */
  acquire(id: string, seatId: string): () => void {
    this.get(id,seatId,true); this.busy.set(id,(this.busy.get(id)||0)+1); let done=false;
    return () => { if (!done) { done=true; const count=(this.busy.get(id)||1)-1; if(count) this.busy.set(id,count); else this.busy.delete(id); } };
  }
}
