import { randomBytes } from 'node:crypto';
import { lstat, mkdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { migrateAdministratorAccounts } from '../src/access/administrator-schema.js';
import { openDatabase } from '../src/access/database.js';
import { checkSeatDeployment, parseSeatManifest } from '../src/access/seat-deployment.js';
import { AccessStore } from '../src/access/store.js';
import { SystemRoles } from '../src/access/system-roles.js';
import { loadBackgroundConfig } from '../src/background/config.js';
import { BackgroundStore } from '../src/background/store.js';
import { planLegacyConnectors } from '../src/connectors/legacy-config.js';
import { loadContextConfig } from '../src/context/config.js';
import { atomicWrite, checkDirectory, parseJsonStrict, readControlled } from '../src/resources/files.js';

const manifestPath = fileURLToPath(new URL('../fixtures/seat-deployment.scenario.example.json', import.meta.url));

async function privateFile(path: string, make: () => string) {
  const existing = await readControlled(path, 16 * 1024, true);
  if (existing !== null) {
    const stat = await lstat(path);
    if ((stat.mode & 0o077) !== 0 || stat.nlink !== 1) throw new Error(`请限制 ${path} 的访问权限为 0600。`);
    return existing;
  }
  const content = make();
  await atomicWrite(path, content);
  return content;
}

async function initialize(dataDir: string, configDir: string) {
  const [context, background] = await Promise.all([loadContextConfig(), loadBackgroundConfig()]);
  if (!context?.simulation?.enabled || context.simulation.directorSeatId !== 'seat-director'
    || !context.commands?.enabled || context.commands.seatIds.join(',') !== 'seat-control' || !background?.enabled) {
    throw new Error('scenario 需要演练、后台来源和正式下达配置，导演须为 seat-director，控制席须为 seat-control。');
  }
  const { seats } = parseSeatManifest(parseJsonStrict((await readControlled(manifestPath, 256 * 1024))!));
  const conflicts = planLegacyConnectors(context, background).conflicts;
  if (conflicts.length) throw new Error(conflicts.join('\n'));
  const before = await checkSeatDeployment({ manifestPath, dataDir });
  const hasConnectorSnapshot = before.integrations.configurationSource === 'connector-snapshot';
  if (hasConnectorSnapshot && !before.ok) {
    throw new Error(before.issues.map(({ location, message }) => `${location}: ${message}`).join('\n'));
  }
  const authPath = join(configDir, 'auth.env');
  const credentialsPath = join(configDir, 'initial-credentials.json');
  await checkDirectory(configDir);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await checkDirectory(dataDir);
  const auth = parseEnv(await privateFile(authPath, () =>
    `LAB_AUTH_MODE=login\nLAB_SESSION_SECRET=${randomBytes(48).toString('base64url')}\nLAB_DATA_DIR="${dataDir}"\n`));
  if (auth.LAB_DATA_DIR !== dataDir || auth.LAB_AUTH_MODE !== 'login' || (auth.LAB_SESSION_SECRET?.length ?? 0) < 32) {
    throw new Error('auth.env 的数据目录、登录模式或签名配置与实例不符。');
  }

  const definitions = seats.map(seat => ({ ...seat, username: seat.id === 'seat-admin' ? 'system-admin' : seat.id,
    manageTasks: seat.type === 'director' || seat.id === 'seat-overall',
    overview: seat.id === 'seat-overall', director: seat.type === 'director' }));
  // Read even on retries before writing any accounts, so a partial run reuses
  // the same initial credentials for the accounts it has yet to create.
  const db = await openDatabase(dataDir);
  try {
    const store = new AccessStore(db);
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
    if (version < 19 && db.prepare('SELECT 1 FROM accounts LIMIT 1').get()) {
      throw new Error('已有旧版账号，请先按现行规范执行管理员迁移。');
    }
    migrateAdministratorAccounts(db);
    const roles = new SystemRoles(db);
    const byUsername = new Map(definitions.map(seat => [seat.username, seat]));
    const accounts = db.prepare('SELECT id, username, seat_id, enabled FROM accounts').all();
    for (const account of accounts) {
      const expected = byUsername.get(String(account.username));
      if (!expected || account.seat_id !== (expected.type === 'administrator' ? null : expected.id)
        || account.enabled !== 1 || roles.has(String(account.id)) !== (expected.type === 'administrator')) {
        throw new Error(`账号 ${account.username} 与 scenario 预设冲突。`);
      }
    }
    const registered = db.prepare('SELECT * FROM seats').all();
    for (const row of registered) {
      const seat = definitions.find(item => item.id === row.id && item.type !== 'administrator');
      if (!seat || row.name !== seat.name || row.create_public !== Number(seat.manageTasks)
        || row.manage_model !== 0 || row.view_work_overview !== Number(seat.overview)
        || row.control_scenarios !== Number(seat.director)
        || (row.responsibility !== seat.responsibility && row.responsibility !== '')) {
        throw new Error(`席位 ${row.id} 与 scenario 预设冲突。`);
      }
    }
    const backgroundStore = new BackgroundStore(db);
    const grants = new Map(backgroundStore.listGrants().filter(row => row.subjectKind === 'seat')
      .map(row => [`${row.subjectId}/${row.sourceId}`, row.permission]));
    const expectedGrants = new Map<string, { seatId: string; sourceId: string; permission: 'view' | 'manage' }>();
    for (const source of background.sources.filter(source => !source.retired)) {
      for (const seatId of source.allowedRecipientSeatIds) {
        expectedGrants.set(`${seatId}/${source.sourceId}`, { seatId, sourceId: source.sourceId,
          permission: seatId === background.deliveryReviewSeatId ? 'manage' : 'view' });
      }
    }
    for (const { sourceId } of context.simulation.sources) {
      const seatId = context.simulation.directorSeatId;
      expectedGrants.set(`${seatId}/${sourceId}`, { seatId, sourceId, permission: 'view' });
    }
    for (const [key, grant] of expectedGrants) {
      if (!definitions.some(seat => seat.id === grant.seatId && seat.type !== 'administrator')
        || !background.sources.some(source => source.sourceId === grant.sourceId && !source.retired)
        || ((hasConnectorSnapshot || grants.has(key)) && grants.get(key) !== grant.permission)) throw new Error(`来源授权 ${key} 与 scenario 预设冲突。`);
    }

    const missing = definitions.filter(seat => !accounts.some(account => account.username === seat.username));
    if (missing.length) {
      const credentials = JSON.parse(await privateFile(credentialsPath, () =>
        JSON.stringify(Object.fromEntries(definitions.map(seat => [seat.username, randomBytes(24).toString('base64url')])), null, 2) + '\n')) as Record<string, unknown>;
      for (const seat of missing) {
        const password = credentials?.[seat.username];
        if (typeof password !== 'string' || password.length < 10 || password.length > 256) {
          throw new Error(`初始凭据文件缺少有效的 ${seat.username} 条目。`);
        }
      }
      for (const seat of missing) {
        const password = credentials[seat.username] as string;
        if (seat.type === 'administrator') await store.saveAdministratorAccount({ username: seat.username, displayName: seat.name, password });
        else await store.saveAccount({
          username: seat.username, displayName: seat.name, seatId: seat.id, seatName: seat.name, password,
          createPublicTask: seat.manageTasks, manageModelSettings: false, viewWorkOverview: seat.overview,
          controlScenarios: seat.director,
        });
      }
      console.info(`初始凭据文件：${credentialsPath}`);
    }
    for (const seat of definitions.filter(seat => seat.type !== 'administrator')) {
      if (registered.find(row => row.id === seat.id)?.responsibility !== seat.responsibility) {
        store.updateSeat(seat.id, { responsibility: seat.responsibility });
      }
    }
    for (const [key, grant] of expectedGrants) {
      if (!grants.has(key)) backgroundStore.grant('seat', grant.seatId, grant.sourceId, grant.permission);
    }
  } finally { db.close(); }
  const report = await checkSeatDeployment({ manifestPath, dataDir });
  if (!report.ok) throw new Error(report.issues.map(({ location, message }) => `${location}: ${message}`).join('\n'));
  console.info('演练预设席位预检通过。');
}

try {
  const { values } = parseArgs({ options: {
    preset: { type: 'string' }, 'data-dir': { type: 'string' }, 'config-dir': { type: 'string' },
    'service-stopped': { type: 'boolean' },
  } });
  const dataDir = values['data-dir'];
  const configDir = values['config-dir'];
  if (values.preset !== 'scenario' || !dataDir || !configDir || !values['service-stopped']
    || ![dataDir, configDir].every(path => isAbsolute(path) && /^(\/[\w.-]+)+$/.test(path) && resolve(path) !== '/')
    || resolve(dataDir) === resolve(configDir) || resolve(configDir).startsWith(resolve(dataDir) + '/')) {
    throw new Error('用法：deploy-init.ts --preset scenario --data-dir /abs/data --config-dir /abs/config --service-stopped');
  }
  await initialize(resolve(dataDir), resolve(configDir));
} catch (error) {
  console.error(error instanceof Error ? error.message : '预设初始化失败。');
  process.exitCode = 1;
}
