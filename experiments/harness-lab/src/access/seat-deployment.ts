import { constants } from 'node:fs';
import { copyFile, lstat, mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadBackgroundConfig, parseBackgroundConfig, type BackgroundConfig } from '../background/config.js';
import { capabilityDigest } from '../capabilities/service.js';
import { planLegacyConnectors } from '../connectors/legacy-config.js';
import { ConnectorSecrets, type EncryptedSecret } from '../connectors/secrets.js';
import { loadContextConfig, parseContextConfig, type ContextConfig } from '../context/config.js';
import { RequestError } from '../contracts/errors.js';
import { checkDirectory, missing, parseJsonStrict, readControlled, stateError } from '../resources/files.js';
import { requireAdministratorSchema } from './administrator-schema.js';
import { personalScopeUserId } from './personal-scope.js';
import { baseSchemaVersion } from './schema.js';
import { SystemRoles } from './system-roles.js';

const seatTypes = ['business', 'control', 'director', 'administrator'] as const;
type SeatType = typeof seatTypes[number];
interface DeploymentSeat { id: string; name: string; type: SeatType; responsibility: string }
interface SeatManifest { seats: DeploymentSeat[] }
interface AccessSeat { id: string; name: string; enabled: boolean; scenarioControl: boolean; manageTasks: boolean; sources: string[] }
interface DeliveryReference { seatId: string; location: string; sourceId?: string }
interface DeploymentIssue { location: string; message: string }
interface ConnectorSnapshot {
  context?: ContextConfig;
  background?: BackgroundConfig;
  issues: DeploymentIssue[];
}
interface AccessSnapshot {
  version: number;
  seats: AccessSeat[];
  independentAdministrator: boolean;
  deliveries: DeliveryReference[];
}

function isSeatId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function seatText(value: unknown, length: number): value is string {
  return typeof value === 'string' && !!value.trim() && value.trim().length <= length;
}

export function parseSeatManifest(value: unknown): SeatManifest {
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'seats') || !Array.isArray(value.seats) || !value.seats.length) {
    throw new Error('席位清单须包含非空 seats 数组。');
  }
  const ids = new Set<string>();
  const seats = value.seats.map((seat: unknown, index): DeploymentSeat => {
    const location = `seats[${index}]`;
    if (!isRecord(seat) || Object.keys(seat).some(key => !['id', 'name', 'type', 'responsibility'].includes(key))) {
      throw new Error(`${location} 只接受 id、name、type 和 responsibility。`);
    }
    const { id, name, type, responsibility } = seat;
    if (!isSeatId(id) || personalScopeUserId(id)) throw new Error(`${location}.id 无效或占用保留的个人空间标识。`);
    if (ids.has(id)) throw new Error(`${location}.id 重复（${id}）。`);
    if (!seatText(name, 100)) throw new Error(`${location}.name 须为 1～100 字符。`);
    if (!seatText(responsibility, 1000)) throw new Error(`${location}.responsibility 须为 1～1000 字符。`);
    const seatType = seatTypes.find(item => item === type);
    if (!seatType) throw new Error(`${location}.type 须为 business、control、director 或 administrator。`);
    ids.add(id);
    return { id, name: name.trim(), type: seatType, responsibility: responsibility.trim() };
  });
  return { seats };
}

async function readDatabase<T>(path: string, inspect: (db: DatabaseSync) => T | Promise<T>): Promise<T> {
  const header = Buffer.alloc(2);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await file.read(header, 0, header.length, 18); } finally { await file.close(); }
  let temporary: string | undefined, db: DatabaseSync | undefined;
  try {
    let databasePath = path;
    if (header.includes(2)) {
      // SQLite may build a shared-memory file in WAL mode, even for a read-only
      // connection. Keep it inside a private copy of the stopped snapshot.
      temporary = await mkdtemp(join(tmpdir(), 'axon-seat-preflight-'));
      databasePath = join(temporary, basename(path));
      await copyFile(path, databasePath, constants.COPYFILE_EXCL);
      const wal = await lstat(path + '-wal').catch(error => { if (!missing(error)) throw error; });
      if (wal) {
        if (!wal.isFile() || wal.nlink !== 1) throw stateError();
        await copyFile(path + '-wal', databasePath + '-wal', constants.COPYFILE_EXCL);
      }
    }
    db = new DatabaseSync(databasePath, { readOnly: true });
    db.exec('PRAGMA temp_store=MEMORY; BEGIN');
    return await inspect(db);
  } finally {
    try { db?.close(); } finally {
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  }
}

async function readConnectorSnapshot(dataDir: string, env: NodeJS.ProcessEnv): Promise<ConnectorSnapshot | undefined> {
  const directory = join(dataDir, 'capabilities');
  const path = join(directory, 'capabilities.sqlite');
  const stat = await lstat(path).catch(error => { if (!missing(error)) throw error; });
  if (!stat) return undefined;
  await checkDirectory(directory);
  if (!stat.isFile() || stat.nlink !== 1) throw stateError();
  for (const marker of ['r4-migration.json', 'director-migration.json']) {
    const text = await readControlled(join(directory, marker), 32 * 1024 * 1024, true);
    if (text === null) continue;
    const migration = parseJsonStrict(text);
    if (!isRecord(migration) || migration.stage !== 'completed') {
      throw new RequestError('CONNECTOR_MIGRATION_INCOMPLETE', `连接器迁移尚未完成，请检查 ${marker}。`, 409);
    }
  }
  return readDatabase(path, async db => {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name)));
    if (!tables.has('r4_connection_legacy') && !tables.has('r4_connector_meta')) {
      throw new RequestError('CONNECTOR_MIGRATION_REQUIRED', '已有能力库尚未完成 R4 连接器迁移。', 409);
    }
    if (db.prepare('SELECT version FROM r4_connector_meta WHERE id=1').get()?.version !== 1) throw stateError();
    const bindings = db.prepare('SELECT data FROM r4_connection_bindings ORDER BY slot').all().map(row => parseJsonStrict(String(row.data)));
    const record = db.prepare('SELECT data FROM r4_connection_legacy WHERE id=1').get();
    if (!record) {
      if (bindings.length) throw stateError();
      return undefined;
    }
    const snapshot = parseJsonStrict(String(record.data)) as { context?: ContextConfig; background?: BackgroundConfig; planDigest: string };
    const plan = planLegacyConnectors(snapshot.context, snapshot.background);
    if (plan.conflicts.length || plan.digest !== snapshot.planDigest
      || capabilityDigest(bindings) !== capabilityDigest([...plan.bindings].sort((a, b) => a.slot.localeCompare(b.slot)))) throw stateError();
    const context = snapshot.context ? parseContextConfig(snapshot.context) : undefined;
    const background = snapshot.background ? parseBackgroundConfig(snapshot.background) : undefined;
    const issues: DeploymentIssue[] = [];
    const connection = db.prepare(`
      SELECT c.current_revision_id, json_extract(c.data, '$.state') AS state, r.digest, r.data
      FROM r4_connections c JOIN r4_connection_revisions r ON r.id=c.current_revision_id AND r.connection_id=c.id WHERE c.id=?
    `);
    const credential = db.prepare('SELECT version, data FROM r4_connection_credentials WHERE connection_id=? AND subject_id=?');
    let secrets: Promise<ConnectorSecrets> | undefined;
    for (const binding of plan.bindings) {
      if (binding.slot === 'simulation-control' && !context?.simulation?.enabled) continue;
      const { connectorId } = binding;
      const row = connection.get(connectorId);
      const revision = row && parseJsonStrict(String(row.data));
      if (!row || !isRecord(revision) || revision.kind !== 'legacy' || revision.businessSlot !== binding.slot
        || revision.connectorId !== connectorId || revision.revisionId !== row.current_revision_id
        || row.digest !== capabilityDigest(revision) || !['enabled', 'disabled'].includes(String(row.state))) throw stateError();
      if (row.state === 'disabled') issues.push({ location: connectorId, message: '已保存的连接绑定处于停用状态。' });
      for (const subject of Object.keys(binding.envRefs)) {
        const location = subject === 'organization' ? connectorId : `sources[${subject.slice('organization:'.length)}]`;
        const entry = credential.get(connectorId, subject);
        const value = entry && parseJsonStrict(String(entry.data));
        if (!entry || !isRecord(value) || value.revoked === true) {
          issues.push({ location, message: '已保存的连接凭证未配置或已撤销。' });
          continue;
        }
        if (value.revoked !== false || value.version !== entry.version || (value.envRef && value.secret)) throw stateError();
        let token: string | undefined;
        if (typeof value.envRef === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(value.envRef)) {
          token = env[value.envRef];
        } else if (isRecord(value.secret)) {
          try {
            secrets ??= ConnectorSecrets.open(dataDir, env.LAB_CONNECTOR_KEY_FILE);
            token = (await secrets).decrypt(value.secret as unknown as EncryptedSecret, `${connectorId}:${subject}:${value.version}`);
          } catch {
            issues.push({ location, message: '已保存的连接凭证无法解密，请核对外置密钥。' });
            continue;
          }
        } else throw stateError();
        if (!token?.trim() || /[\r\n\0]/.test(token) || (binding.slot === 'ingress' && token.length < 24)) {
          issues.push({ location, message: '已保存的连接绑定缺少可用凭证，请核对当前凭证配置。' });
        }
      }
    }
    return { context, background, issues };
  });
}

function receiptOnlySourceIds(background: BackgroundConfig): Set<string> {
  const activePolicies = new Set(background.sources.filter(source => !source.retired).flatMap(source => Object.values(source.operationPolicies ?? {})));
  return new Set(background.sources.filter(source => source.retired && !activePolicies.has(source.sourceId)).map(source => source.sourceId));
}

function deliveryReferences(db: DatabaseSync, tables: ReadonlySet<string>, background: BackgroundConfig): DeliveryReference[] {
  const result: DeliveryReference[] = [];
  const retired = new Set(background.sources.filter(source => source.retired).map(source => source.sourceId));
  const add = (location: string, values: unknown, sourceId?: string) => {
    if (!Array.isArray(values) || !values.every(isSeatId)) throw stateError();
    for (const seatId of values) result.push({ location, seatId, sourceId });
  };
  if (tables.has('information_rules')) {
    for (const row of db.prepare('SELECT id, source_id, data FROM information_rules WHERE enabled=1 ORDER BY id').all()) {
      const sourceId = String(row.source_id);
      if (retired.has(sourceId)) continue;
      const rule = parseJsonStrict(String(row.data));
      if (!isRecord(rule)) throw stateError();
      const location = `information_rules[${row.id}]`;
      add(`${location}.recipientSeatIds`, rule.recipientSeatIds, sourceId);
      if (rule.supplementaryDelivery !== undefined) {
        if (!isRecord(rule.supplementaryDelivery)) throw stateError();
        add(`${location}.supplementaryDelivery.candidateSeatIds`, rule.supplementaryDelivery.candidateSeatIds, sourceId);
      }
    }
  }
  if (tables.has('continuous_streams')) {
    for (const row of db.prepare("SELECT stream_id, data FROM continuous_streams WHERE current=1 AND json_extract(data, '$.enabled')=1 AND COALESCE(json_extract(data, '$.legacyScenarioHistory'), 0)=0 ORDER BY stream_id").all()) {
      const stream = parseJsonStrict(String(row.data));
      if (!isRecord(stream)) throw stateError();
      add(`continuous_streams[${row.stream_id}].recipientSeatIds`, stream.recipientSeatIds);
    }
  }
  return result;
}

async function readAccessSnapshot(dataDir: string, background?: BackgroundConfig): Promise<AccessSnapshot> {
  const directory = join(dataDir, 'collaboration');
  const path = join(directory, 'collaboration.sqlite');
  await checkDirectory(directory);
  const stat = await lstat(path).catch(error => { if (!missing(error)) throw error; return undefined; });
  const marker = await readControlled(join(directory, '.initialized'), 1024, true);
  if (!stat && marker === null) throw Object.assign(new Error(), { code: 'ENOENT' });
  if (!stat?.isFile() || stat.nlink !== 1 || marker !== 'collaboration-v1\n') throw stateError();
  const migrationText = await readControlled(join(directory, 'administrator-migration.json'), 32 * 1024 * 1024, true);
  if (migrationText !== null) {
    const migration = parseJsonStrict(migrationText);
    if (!isRecord(migration) || migration.schemaVersion !== 1 || !['completed', 'prepared'].includes(String(migration.stage))) throw stateError();
    if (migration.stage === 'prepared') throw new RequestError('ACCESS_MIGRATION_INCOMPLETE', '管理员账号迁移尚未完成。', 409);
  }

  return readDatabase(path, db => {
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
    const base = baseSchemaVersion(version);
    if (base === 1) throw Object.assign(new Error(), { code: 'ENOENT' });
    if (base < 2 || base > 12 || db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw stateError();
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name)));
    if (['seats', 'accounts', 'auth_sessions', 'task_spaces', 'task_actions'].some(table => !tables.has(table))) throw stateError();
    const hasScenarioControl = db.prepare('PRAGMA table_info(seats)').all().some(row => row.name === 'control_scenarios');
    if (version >= 13 && !hasScenarioControl) throw stateError();
    if (migrationText !== null || version >= 19) requireAdministratorSchema(db);
    const roles = new SystemRoles(db);
    const independentAdministrator = version >= 19 && db.prepare('SELECT id FROM accounts WHERE seat_id IS NULL AND enabled=1').all().some(row => roles.has(String(row.id)));
    const grants = background && tables.has('information_grants') ? db.prepare(`
      SELECT DISTINCT g.source_id FROM information_grants g
      WHERE g.permission IN ('view', 'manage') AND (
        (g.subject_kind='seat' AND g.subject_id=?) OR
        (g.subject_kind='account' AND g.subject_id IN (SELECT id FROM accounts WHERE seat_id=? AND enabled=1))
      ) ORDER BY g.source_id
    `) : undefined;
    const configuredSources = new Set(background?.sources.map(source => source.sourceId));
    const seats = db.prepare(`
      SELECT s.id, s.name, s.create_public,
             ${hasScenarioControl ? 's.control_scenarios' : '0'} AS control_scenarios,
             EXISTS(SELECT 1 FROM accounts a WHERE a.seat_id=s.id AND a.enabled=1) AS enabled
      FROM seats s ORDER BY s.id
    `).all().map(row => {
      if (!isSeatId(row.id) || !seatText(row.name, Infinity) || ![0, 1].some(value => row.control_scenarios === value)) throw stateError();
      return {
        id: row.id, name: row.name, enabled: row.enabled === 1, manageTasks: row.create_public === 1, scenarioControl: row.control_scenarios === 1,
        sources: row.enabled === 1 && grants ? grants.all(row.id, row.id).map(grant => String(grant.source_id)).filter(id => configuredSources.has(id)) : [],
      };
    });
    return { version, seats, independentAdministrator, deliveries: background ? deliveryReferences(db, tables, background) : [] };
  });
}

export async function checkSeatDeployment({ manifestPath, dataDir, env = process.env }: { manifestPath: string; dataDir: string; env?: NodeJS.ProcessEnv }) {
  if (!isAbsolute(manifestPath) || !isAbsolute(dataDir) || resolve(dataDir) === '/') {
    throw new Error('请使用 --manifest 和 --data-dir 指定清单文件及数据目录的绝对路径。');
  }
  let manifestText: unknown;
  try { manifestText = parseJsonStrict((await readControlled(manifestPath, 256 * 1024))!); }
  catch { throw new Error('无法读取 --manifest，请核对文件路径、大小和 JSON 格式。'); }
  const { seats } = parseSeatManifest(manifestText);
  const issues: DeploymentIssue[] = [];
  const issue = (location: string, message: string) => issues.push({ location, message });
  let context: ContextConfig | undefined, background: BackgroundConfig | undefined;
  let contextInvalid = false, backgroundInvalid = false;
  let configurationSource: 'connector-snapshot' | 'environment' | 'unknown' = 'unknown';
  try {
    const snapshot = await readConnectorSnapshot(dataDir, env);
    if (snapshot) {
      configurationSource = 'connector-snapshot';
      ({ context, background } = snapshot);
      issues.push(...snapshot.issues);
    } else {
      configurationSource = 'environment';
      const [loadedContext, loadedBackground] = await Promise.allSettled([loadContextConfig(env), loadBackgroundConfig(env)]);
      if (loadedContext.status === 'fulfilled') context = loadedContext.value;
      else {
        contextInvalid = true;
        issue('LAB_CONTEXT_CONFIG', (loadedContext.reason as Error).message);
      }
      if (loadedBackground.status === 'fulfilled') background = loadedBackground.value;
      else {
        backgroundInvalid = true;
        issue('LAB_BACKGROUND_CONFIG', (loadedBackground.reason as Error).message);
      }
      if (!contextInvalid && !backgroundInvalid && (context || background)) {
        for (const conflict of planLegacyConnectors(context, background).conflicts) issue('connection-bindings', conflict);
      }
    }
  } catch (error) {
    contextInvalid = backgroundInvalid = true;
    issue('capabilities.sqlite', error instanceof RequestError && ['CONNECTOR_MIGRATION_REQUIRED', 'CONNECTOR_MIGRATION_INCOMPLETE'].includes(error.code)
      ? error.message : '无法只读核对已保存的连接配置与绑定，请检查连接器数据库及备份。');
  }
  const access = await readAccessSnapshot(dataDir, background).catch(error => {
    issue('--data-dir', missing(error) ? '正式账号数据库尚未初始化，请先按部署步骤初始化。'
      : error instanceof RequestError && error.code.startsWith('ACCESS_') ? error.message
      : '无法只读核对业务数据库，请检查 collaboration.sqlite、初始化标记及备份完整性。');
    return undefined;
  });

  const manifestSeats = new Map(seats.map(seat => [seat.id, seat]));
  const actualSeats = new Map(access?.seats.map(seat => [seat.id, seat]));
  const simulation = context?.simulation;
  const directorSeatId = simulation?.directorSeatId;
  const commandSeats = new Set(context?.commands?.enabled ? context.commands.seatIds : []);
  const directors = seats.filter(seat => seat.type === 'director');
  const isBusinessSeat = (seatId: string) => {
    const actual = actualSeats.get(seatId);
    return !!actual?.enabled && !actual.scenarioControl && seatId !== directorSeatId;
  };
  const systemsForSeat = (seatId: string) => [...new Set(context?.scopes.filter(scope => scope.seatIds.includes(seatId)).flatMap(scope => scope.systemIds))];
  const businessReference = (seatId: string, location: string) => {
    const type = manifestSeats.get(seatId)?.type;
    if ((type !== 'business' && type !== 'control') || (access && !isBusinessSeat(seatId))) {
      issue(location, `引用的席位 ${seatId} 须为清单中已启用的业务席或控制席。`);
    }
  };

  const reportSeats = seats.map(seat => {
    const location = `seats[${seat.id}]`;
    const actual = actualSeats.get(seat.id);
    const administrator = seat.type === 'administrator';
    const businessWorkspace = administrator ? false : access ? isBusinessSeat(seat.id) : null;
    const login = !access ? 'unknown' : administrator ? (access.independentAdministrator ? 'enabled' : 'missing')
      : !actual ? 'missing' : actual.enabled ? 'enabled' : 'disabled';
    if (access && administrator && actual) issue(location, '管理员清单 ID 与业务库中的席位 ID 冲突。');
    if (access && !administrator && login !== 'enabled') issue(location, login === 'disabled' ? '没有启用的席位账号。' : '业务库中未登记此席位。');
    if (login === 'enabled' && !administrator && !contextInvalid && businessWorkspace !== (seat.type !== 'director')) {
      issue(location, '现有业务工作区及协作资格与清单类型不符，请核对场景绑定和控制授予。');
    }
    if (seat.type === 'control' && !contextInvalid && !commandSeats.has(seat.id)) {
      issue(`commands.seatIds[${seat.id}]`, context?.commands?.enabled ? '已启用的下达名单缺少此控制席。' : '清单声明了控制席，当前下达集成未启用。');
    }
    return {
      id: seat.id, name: seat.name, type: seat.type, login,
      ...(actual && !administrator ? { registeredName: actual.name } : {}),
      businessWorkspace, scenarioControl: !administrator && !!actual?.scenarioControl,
      commands: businessWorkspace && commandSeats.has(seat.id),
      contextSystemIds: systemsForSeat(seat.id), readableSourceIds: administrator ? [] : actual?.sources ?? [],
    };
  });

  const declaresAdministrator = seats.some(seat => seat.type === 'administrator');
  if (!declaresAdministrator) issue('seats', '席位清单缺少管理员席。');
  if (access && !access.independentAdministrator) issue('administrator', access.version < 19
    ? '旧业务库尚未完成独立管理员账号迁移，请按部署步骤完成迁移及账号开通。'
    : '没有启用且持有管理员角色的独立账号。');
  for (const seat of access?.seats ?? []) {
    if (seat.enabled && !manifestSeats.has(seat.id)) issue(`seats[${seat.id}]`, '已有启用席位未登记在清单中。');
    if (seat.enabled && seat.scenarioControl && simulation?.enabled && seat.id !== directorSeatId) {
      issue(`seats[${seat.id}].control_scenarios`, '场景控制授予须与启用演练的导演席匹配。');
    }
  }
  for (const scope of context?.scopes ?? []) {
    for (const seatId of scope.seatIds) {
      const seat = manifestSeats.get(seatId);
      if (!seat || seat.type === 'administrator' || (access && !actualSeats.get(seatId)?.enabled)) {
        issue(`scopes[${scope.id}].seatIds`, `业务查询范围引用了未启用或无业务查询入口的席位 ${seatId}。`);
      }
    }
  }
  for (const seatId of commandSeats) {
    if (manifestSeats.get(seatId)?.type !== 'control') issue(`commands.seatIds[${seatId}]`, '已启用的下达名单须引用清单中的控制席。');
    else businessReference(seatId, 'commands.seatIds');
  }

  if (simulation?.enabled) {
    if (directors.length !== 1) issue('simulation.directorSeatId', `启用演练需要恰好一个导演席，清单中有 ${directors.length} 个。`);
    if (!directorSeatId || manifestSeats.get(directorSeatId)?.type !== 'director') {
      issue('simulation.directorSeatId', directorSeatId ? `配置绑定的 ${directorSeatId} 不是清单中的导演席。` : '已启用演练，缺少导演席绑定。');
    }
    const director = directorSeatId ? actualSeats.get(directorSeatId) : undefined;
    if (directorSeatId && access) {
      if (!director?.enabled || !director.scenarioControl) issue(`seats[${directorSeatId}].control_scenarios`, '导演需要已启用的席位账号及场景控制授予。');
      if (director?.enabled && !director.manageTasks) issue(`seats[${directorSeatId}].create_public`, '演练任务准备和归档需要公共任务管理授予。');
    }
    if (!background && !backgroundInvalid) issue('LAB_BACKGROUND_CONFIG', '导演台需要与演练来源匹配的后台配置。');
    for (const {systemId, sourceId} of simulation.sources) {
      const location = `simulation.sources[${systemId}]`;
      if (!context?.systems.some(system => system.id === systemId && system.scenarioClock)) issue(location, '演练查询系统缺少 scenarioClock。');
      if (directorSeatId && !systemsForSeat(directorSeatId).includes(systemId)) issue(location, `导演席 ${directorSeatId} 缺少 ${systemId} 查询范围。`);
      const source = background?.sources.find(item => item.sourceId === sourceId);
      if (background && (!source || source.retired || source.systemId !== systemId)) {
        issue(location, `后台来源 ${sourceId} 须为对应系统的未退役来源。`);
      } else if (source && director?.enabled && !director.sources.includes(sourceId)) {
        issue(location, `导演席 ${director.id} 缺少 ${sourceId} 的来源读取授权。`);
      }
    }
  }

  if (background) {
    const receiptOnly = receiptOnlySourceIds(background);
    for (const source of background.sources) {
      if (receiptOnly.has(source.sourceId)) continue;
      for (const seatId of source.allowedRecipientSeatIds) businessReference(seatId, `sources[${source.sourceId}].allowedRecipientSeatIds`);
    }
    if (background.deliveryReviewSeatId) businessReference(background.deliveryReviewSeatId, 'deliveryReviewSeatId');
    for (const {location, seatId, sourceId} of access?.deliveries ?? []) {
      businessReference(seatId, location);
      if (sourceId === undefined) continue;
      const source = background.sources.find(item => item.sourceId === sourceId);
      if (!source) issue(location, `规则引用的来源 ${sourceId} 不在当前配置中。`);
      else if (!source.allowedRecipientSeatIds.includes(seatId)) issue(location, `席位 ${seatId} 不在来源 ${sourceId} 的允许接收名单中。`);
    }
  }

  return {
    ok: issues.length === 0, databaseVersion: access?.version ?? null,
    integrations: {
      configurationSource,
      runtimeVerified: false,
      context: contextInvalid ? 'invalid' : context ? 'configured' : 'absent',
      simulation: contextInvalid ? 'unknown' : simulation?.enabled ? 'enabled' : 'disabled',
      commands: contextInvalid ? 'unknown' : context?.commands?.enabled ? 'enabled' : 'disabled',
      background: backgroundInvalid ? 'invalid' : !background ? 'absent' : background.enabled ? 'enabled' : 'disabled',
    },
    seats: reportSeats, issues,
  };
}
