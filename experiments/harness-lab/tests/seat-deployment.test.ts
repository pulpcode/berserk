import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateAdministratorAccounts } from '../src/access/administrator-schema.js';
import { openDatabase } from '../src/access/database.js';
import { checkSeatDeployment, parseSeatManifest } from '../src/access/seat-deployment.js';
import { AccessStore } from '../src/access/store.js';
import { parseBackgroundConfig } from '../src/background/config.js';
import { BackgroundStore } from '../src/background/store.js';
import { directorSourceMapping } from '../src/connectors/director-migration.js';
import { applyLegacyConnectorPlan, planLegacyConnectors } from '../src/connectors/legacy-config.js';
import { ConnectorSecrets } from '../src/connectors/secrets.js';
import { initializeConnectorSchema } from '../src/connectors/store.js';
import { parseContextConfig } from '../src/context/config.js';

const fixture = (name: string) => new URL(`../fixtures/${name}.example.json`, import.meta.url);
const parseFixture = async (name: string) => JSON.parse(await readFile(fixture(name), 'utf8')) as unknown;
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

const tokens = {
  MOCK_CONTEXT_API_TOKEN: 'PRIVATE-test-query-token',
  MOCK_CONTEXT_CONTROL_TOKEN: 'PRIVATE-test-control-token',
  MOCK_INTEL_SOURCE_TOKEN: 'PRIVATE-test-intelligence-inbound-token',
  MOCK_SITUATION_SOURCE_TOKEN: 'PRIVATE-test-situation-inbound-token',
};
const privateName = 'private-admin-login';
const privateHash = 'private-example-password-hash';

async function writeJson(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
}

async function setup(scenario = false) {
  const root = await mkdtemp(join(tmpdir(), 'axon-seat-deployment-'));
  temporary.push(root);
  const dataDir = join(root, 'data');
  const databasePath = join(dataDir, 'collaboration', 'collaboration.sqlite');
  const capabilityPath = join(dataDir, 'capabilities', 'capabilities.sqlite');
  const manifestPath = join(root, 'seats.json');
  const manifest = parseSeatManifest(await parseFixture(scenario ? 'seat-deployment.scenario' : 'seat-deployment'));
  const context = scenario ? parseContextConfig(await parseFixture('scenario-demo/context')) : undefined;
  const background = scenario ? parseBackgroundConfig(await parseFixture('scenario-demo/background')) : undefined;
  const env: NodeJS.ProcessEnv = scenario ? {
    ...tokens, LAB_CONTEXT_CONFIG: join(root, 'context.json'), LAB_BACKGROUND_CONFIG: join(root, 'background.json'),
  } : {};
  const save = async () => {
    await writeJson(manifestPath, manifest);
    if (context && background) {
      await writeJson(env.LAB_CONTEXT_CONFIG!, context);
      await writeJson(env.LAB_BACKGROUND_CONFIG!, background);
    }
  };
  const check = () => checkSeatDeployment({ dataDir, manifestPath, env });
  const mutate = (change: (db: DatabaseSync) => void, path = databasePath) => {
    const db = new DatabaseSync(path);
    try { change(db); } finally { db.close(); }
  };
  const register = (db: DatabaseSync, seat: typeof manifest.seats[number], scenarioControl = seat.type === 'director') => {
    const userId = randomUUID();
    db.prepare('INSERT INTO seats(id,name,create_public,manage_model,control_scenarios) VALUES(?,?,?,1,?)').run(seat.id, seat.name, Number(scenarioControl), Number(scenarioControl));
    db.prepare("INSERT INTO accounts VALUES(?,?,?,?,'private-salt',?,1)").run(userId, `private-login-${seat.id}`, '私人账号名称', seat.id, privateHash);
    return userId;
  };
  const provision = async (independent = true) => {
    const db = await openDatabase(dataDir);
    try {
      new AccessStore(db);
      if (independent) migrateAdministratorAccounts(db);
      const store = background ? new BackgroundStore(db) : undefined;
      for (const seat of manifest.seats) {
        if (seat.type === 'administrator') continue;
        const userId = register(db, seat);
        if (seat.type === 'director' && store) {
          store.grant('seat', seat.id, 'mock-intel-source', 'view');
          store.grant('account', userId, 'mock-situation-source', 'view');
        }
      }
      if (independent) {
        const userId = randomUUID();
        db.prepare("INSERT INTO accounts VALUES(?,?,?,NULL,'private-salt',?,1)").run(userId, privateName, '私人管理员名称', privateHash);
        db.prepare("INSERT INTO account_roles VALUES(?,'administrator','now')").run(userId);
      }
    } finally { db.close(); }
  };
  await save();
  return {
    root, dataDir, manifestPath, databasePath, capabilityPath,
    manifest, context, background, env, save, check, mutate, provision, register,
  };
}

describe('seat deployment manifest', () => {
  it('loads both examples and identifies malformed entries or duplicate IDs', async () => {
    const minimal = parseSeatManifest(await parseFixture('seat-deployment'));
    expect(minimal.seats.map(seat => seat.type)).toEqual(['administrator', 'business']);
    const scenario = parseSeatManifest(await parseFixture('seat-deployment.scenario'));
    expect(new Set(scenario.seats.map(seat => seat.type)).size).toBe(4);
    const [entry] = minimal.seats;
    expect(() => parseSeatManifest({seats:[entry, entry]})).toThrow('seats[1].id');
    expect(() => parseSeatManifest({seats:[{...entry, id:`account-${randomUUID()}`}]})).toThrow('seats[0].id');
    expect(() => parseSeatManifest({seats:[{...entry, responsibility:' '}]})).toThrow('seats[0].responsibility');
    expect(() => parseSeatManifest({seats:[{...entry, type:'unknown'}]})).toThrow('seats[0].type');
  });
});

describe('seat deployment preflight', () => {
  it('requires R4 migration for an existing pre-R4 capability database', async () => {
    const setupData = await setup();
    await setupData.provision();
    await mkdir(join(setupData.dataDir, 'capabilities'));
    setupData.mutate(db => db.exec('CREATE TABLE r3_skill_meta(id INTEGER)'), setupData.capabilityPath);
    const report = await setupData.check();
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual({location:'capabilities.sqlite', message:expect.stringContaining('R4 连接器迁移')});
  });

  it('reads uncheckpointed WAL snapshots without changing the backed-up database or sidecar', async () => {
    const setupData = await setup();
    await setupData.provision();
    const {databasePath, root, manifestPath} = setupData;
    const backupRoot = join(root, 'backup');
    const backupDirectory = join(backupRoot, 'collaboration');
    const backupDatabase = join(backupDirectory, 'collaboration.sqlite');
    await mkdir(backupDirectory, {recursive:true});
    const db = new DatabaseSync(databasePath);
    try {
      db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE seats SET name='快照中的总体席'");
      await copyFile(databasePath, backupDatabase);
      await copyFile(databasePath + '-wal', backupDatabase + '-wal');
      await copyFile(join(setupData.dataDir, 'collaboration', '.initialized'), join(backupDirectory, '.initialized'));
    } finally { db.close(); }
    const before = await Promise.all([readFile(backupDatabase), readFile(backupDatabase + '-wal')]);
    const report = await checkSeatDeployment({dataDir:backupRoot, manifestPath, env:{}});
    expect(report.ok).toBe(true);
    expect(report.seats).toContainEqual(expect.objectContaining({registeredName:'快照中的总体席'}));
    expect(await Promise.all([readFile(backupDatabase), readFile(backupDatabase + '-wal')])).toEqual(before);
    expect((await readdir(backupDirectory)).sort()).toEqual(['.initialized', 'collaboration.sqlite', 'collaboration.sqlite-wal']);
    expect((await setupData.check()).ok).toBe(true);
  });

  it('reports enabled rules that name business seats outside their source recipient list', async () => {
    const setupData = await setup(true);
    await setupData.provision();
    const source = setupData.background!.sources[0];
    source.allowedRecipientSeatIds = ['seat-overall'];
    await setupData.save();
    const ruleId = randomUUID();
    setupData.mutate(db => db.prepare('INSERT INTO information_rules VALUES(?,?,1,?)').run(ruleId, source.sourceId,
      JSON.stringify({recipientSeatIds:['seat-intelligence'], supplementaryDelivery:{candidateSeatIds:['seat-planning']}})));
    const report = await setupData.check();
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      {location:'information_rules[' + ruleId + '].recipientSeatIds', message:expect.stringContaining('seat-intelligence 不在来源')},
      {location:'information_rules[' + ruleId + '].supplementaryDelivery.candidateSeatIds', message:expect.stringContaining('seat-planning 不在来源')},
    ]));
  });

  it('passes without integrations, redacts identity fields and preserves database bytes', async () => {
    const setupData = await setup();
    await setupData.provision();
    const before = await readFile(setupData.databasePath);
    const report = await setupData.check();
    expect(report.ok).toBe(true);
    expect(report.integrations).toMatchObject({
      configurationSource:'environment', runtimeVerified:false, context:'absent', simulation:'disabled', commands:'disabled', background:'absent',
    });
    expect(report.seats).toMatchObject([
      {id:'seat-admin', login:'enabled', businessWorkspace:false},
      {id:'seat-overall', login:'enabled', businessWorkspace:true},
    ]);
    expect(JSON.stringify(report)).not.toMatch(/private-admin-login|private-login-|private-example-password-hash|私人管理员名称/);
    expect(await readFile(setupData.databasePath)).toEqual(before);
    expect((await readdir(join(setupData.dataDir, 'collaboration'))).sort()).toEqual(['.initialized', 'collaboration.sqlite']);
  });

  it('reports an uninitialized root, unknown database data and a legacy independent-admin migration gap', async () => {
    const setupData = await setup();
    expect((await setupData.check()).issues).toContainEqual({location:'--data-dir', message:expect.stringContaining('尚未初始化')});
    expect(await readdir(setupData.root)).toEqual(['seats.json']);
    await setupData.provision(false);
    const before = await readFile(setupData.databasePath);
    let report = await setupData.check();
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual({location:'administrator', message:expect.stringContaining('独立管理员账号迁移')});
    expect(report.seats).toContainEqual(expect.objectContaining({id:'seat-overall', login:'enabled', businessWorkspace:true}));
    expect(await readFile(setupData.databasePath)).toEqual(before);
    await writeFile(setupData.databasePath, 'invalid database content');
    report = await setupData.check();
    expect(report.issues).toContainEqual({location:'--data-dir', message:expect.stringContaining('collaboration.sqlite')});
  });

  it('accepts multiple working control seats and read access through account and seat grants', async () => {
    const setupData = await setup(true);
    const {context, manifest} = setupData;
    const second = {id:'seat-control-two', name:'第二控制席', type:'control', responsibility:'确认下达指令。'} as const;
    manifest.seats.push(second);
    context!.commands!.seatIds.push(second.id);
    context!.scopes[0].seatIds.push(second.id);
    await setupData.save();
    await setupData.provision();
    const report = await setupData.check();
    expect(report.issues).toEqual([]);
    expect(report.seats).toContainEqual(expect.objectContaining({
      id:'seat-director', login:'enabled', businessWorkspace:false, scenarioControl:true, commands:false,
      readableSourceIds:['mock-intel-source','mock-situation-source'],
    }));
    expect(report.seats.filter(seat => seat.commands).map(seat => seat.id)).toEqual(['seat-control', second.id]);
    expect(JSON.stringify(report)).not.toContain(tokens.MOCK_INTEL_SOURCE_TOKEN);
  });

  it('points to mismatched director, missing grants, controls and non-business or unavailable delivery references', async () => {
    const setupData = await setup(true);
    await setupData.provision();
    const {manifest, context, background} = setupData;
    manifest.seats.push({id:'seat-director-extra', name:'另一个导演席', type:'director', responsibility:'测试重复配置。'});
    context!.commands!.seatIds = ['seat-overall'];
    context!.scopes[0].seatIds = context!.scopes[0].seatIds.filter(id => id !== 'seat-director');
    background!.sources[0].allowedRecipientSeatIds.push('seat-director', 'seat-admin');
    background!.deliveryReviewSeatId = 'seat-admin';
    await setupData.save();
    setupData.mutate(db => {
      db.exec("UPDATE seats SET control_scenarios=0 WHERE id='seat-director'");
      db.exec("UPDATE accounts SET enabled=0 WHERE seat_id='seat-planning'");
      db.exec("DELETE FROM information_grants WHERE source_id='mock-intel-source'");
      db.exec("UPDATE accounts SET enabled=0 WHERE seat_id IS NULL");
      const ruleId = randomUUID();
      const rule = {recipientSeatIds:['seat-admin'], supplementaryDelivery:{candidateSeatIds:['seat-planning']}};
      db.prepare('INSERT INTO information_rules VALUES(?,?,1,?)').run(ruleId, 'mock-intel-source', JSON.stringify(rule));
    });
    const report = await setupData.check();
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      {location:'simulation.directorSeatId', message:expect.stringContaining('2 个')},
      {location:'seats[seat-director].control_scenarios', message:expect.stringContaining('场景控制授予')},
      {location:'simulation.sources[intel]', message:expect.stringContaining('查询范围')},
      {location:'simulation.sources[intel]', message:expect.stringContaining('来源读取授权')},
      {location:'commands.seatIds[seat-control]', message:expect.stringContaining('缺少')},
      {location:'commands.seatIds[seat-overall]', message:expect.stringContaining('控制席')},
      {location:'seats[seat-planning]', message:expect.stringContaining('启用')},
      {location:'sources[mock-intel-source].allowedRecipientSeatIds', message:expect.stringContaining('seat-director')},
      {location:'deliveryReviewSeatId', message:expect.stringContaining('seat-admin')},
      {location:expect.stringMatching(/information_rules.*\.supplementaryDelivery\.candidateSeatIds/), message:expect.stringContaining('seat-planning')},
      {location:expect.stringMatching(/information_rules.*\.recipientSeatIds/), message:expect.stringContaining('seat-admin')},
      {location:'administrator', message:expect.stringContaining('没有启用')},
    ]));
  });

  it('reports a missing director, incorrect mapping, and invalid integration or credential configuration', async () => {
    const setupData = await setup(true);
    await setupData.provision();
    const {manifest, background, env} = setupData;
    manifest.seats = manifest.seats.filter(seat => seat.type !== 'director');
    background!.sources[0].systemId = 'situation';
    await setupData.save();
    let report = await setupData.check();
    expect(report.issues).toEqual(expect.arrayContaining([
      {location:'simulation.directorSeatId', message:expect.stringContaining('0 个')},
      {location:'simulation.directorSeatId', message:expect.stringContaining('seat-director')},
      {location:'simulation.sources[intel]', message:expect.stringContaining('对应系统')},
    ]));
    delete env.MOCK_INTEL_SOURCE_TOKEN;
    await writeFile(env.LAB_CONTEXT_CONFIG!, 'invalid json');
    report = await setupData.check();
    expect(report.issues).toEqual(expect.arrayContaining([
      {location:'LAB_CONTEXT_CONFIG', message:expect.stringContaining('配置无效')},
      {location:'LAB_BACKGROUND_CONFIG', message:expect.stringContaining('凭证')},
    ]));
    expect(report.integrations).toMatchObject({context:'invalid', background:'invalid'});
  });

  it('prefers the persisted R4 configuration and credentials and ignores a receipt-only retired source', async () => {
    const setupData = await setup(true);
    const {root, dataDir, context, background, env, capabilityPath} = setupData;
    await setupData.provision();
    const retired = {...background!.sources[0], sourceId:'history-only', credentialRef:'HISTORICAL_TOKEN', allowedRecipientSeatIds:['former-seat'], retired:true as const};
    background!.sources.push(retired);
    for (const {canonicalSourceId, freeDebugPolicySourceId} of directorSourceMapping) {
      const old = background!.sources.find(source => source.sourceId === freeDebugPolicySourceId)!;
      const credentialRef = `CANONICAL_${old.credentialRef}`;
      env[credentialRef] = env[old.credentialRef];
      delete env[old.credentialRef];
      background!.sources.push({...old, sourceId:canonicalSourceId, credentialRef, operationPolicies:{scenario:canonicalSourceId, free_debug:freeDebugPolicySourceId}});
      old.retired = true;
      context!.simulation!.sources.find(source => source.systemId === old.systemId)!.sourceId = canonicalSourceId;
    }
    setupData.mutate(db => {
      db.prepare('INSERT INTO information_rules VALUES(?,?,1,?)').run(randomUUID(), retired.sourceId, JSON.stringify({recipientSeatIds:['former-seat']}));
      for (const {canonicalSourceId} of directorSourceMapping) {
        db.prepare("INSERT INTO information_grants VALUES('seat','seat-director',?,'view')").run(canonicalSourceId);
      }
    });
    await mkdir(join(dataDir, 'capabilities'));
    setupData.mutate(db => {
      initializeConnectorSchema(db);
      applyLegacyConnectorPlan(db, planLegacyConnectors(context, background));
      db.prepare('INSERT INTO r4_connection_intents VALUES(?,?,?,?)').run('test-intent', 'test-actor', 'test-digest', '{"state":"sent"}');
    }, capabilityPath);
    const keyFile = join(root, 'connector-key.json');
    await writeJson(keyFile, {activeKeyId:'test', keys:{test:Buffer.alloc(32, 1).toString('base64')}});
    env.LAB_CONNECTOR_KEY_FILE = keyFile;
    const secret = await ConnectorSecrets.open(dataDir, keyFile);
    const subject = 'organization:scenario-intel-source';
    const connectorId = 'legacy-ingress';
    const encrypted = secret.encrypt(tokens.MOCK_INTEL_SOURCE_TOKEN, `${connectorId}:${subject}:2`);
    setupData.mutate(db => db.prepare('UPDATE r4_connection_credentials SET version=2,data=? WHERE connection_id=? AND subject_id=?')
      .run(JSON.stringify({version:2, revoked:false, secret:encrypted}), connectorId, subject), capabilityPath);
    delete env.CANONICAL_MOCK_INTEL_SOURCE_TOKEN;
    env.LAB_CONTEXT_CONFIG = 'stale-context-file';
    env.LAB_BACKGROUND_CONFIG = 'stale-background-file';
    const before = await readFile(capabilityPath);
    const report = await setupData.check();
    expect(report.issues).toEqual([]);
    expect(report.integrations).toMatchObject({configurationSource:'connector-snapshot', runtimeVerified:false, simulation:'enabled'});
    expect(report.seats.find(seat => seat.type === 'director')?.readableSourceIds).toEqual(
      ['mock-intel-source', 'mock-situation-source', 'scenario-intel-source', 'scenario-situation-source'],
    );
    expect(JSON.stringify(report)).not.toMatch(/HISTORICAL_TOKEN|former-seat|PRIVATE-test-|stale-context-file/);
    expect(await readFile(capabilityPath)).toEqual(before);

    delete env.LAB_CONNECTOR_KEY_FILE;
    delete env.MOCK_CONTEXT_CONTROL_TOKEN;
    expect((await setupData.check()).issues).toEqual(expect.arrayContaining([
      {location:'sources[scenario-intel-source]', message:expect.stringContaining('无法解密')},
      {location:'legacy-simulation-control', message:expect.stringContaining('凭证')},
    ]));
    setupData.mutate(db => db.prepare("UPDATE r4_connection_credentials SET version=3,data=? WHERE connection_id=? AND subject_id=?")
      .run(JSON.stringify({version:3, revoked:true}), connectorId, subject), capabilityPath);
    expect((await setupData.check()).issues).toContainEqual({location:'sources[scenario-intel-source]', message:expect.stringContaining('已撤销')});
  });

  it('uses an empty stored configuration and returns a nonzero CLI status on failure', async () => {
    const setupData = await setup();
    await setupData.provision();
    await mkdir(join(setupData.dataDir, 'capabilities'));
    setupData.mutate(db => {
      initializeConnectorSchema(db);
      applyLegacyConnectorPlan(db, planLegacyConnectors());
    }, setupData.capabilityPath);
    const run = (dataDir: string) => spawnSync(process.execPath, [
      '--import', 'tsx', 'scripts/check-seat-deployment.ts', '--data-dir', dataDir, '--manifest', setupData.manifestPath,
    ], {
      encoding:'utf8', cwd:fileURLToPath(new URL('..', import.meta.url)),
      env:{...process.env, LAB_CONTEXT_CONFIG:'stale-context-file', LAB_BACKGROUND_CONFIG:'stale-background-file'},
    });
    const success = run(setupData.dataDir);
    expect(success.status, success.stderr).toBe(0);
    expect(JSON.parse(success.stdout)).toMatchObject({ok:true, integrations:{configurationSource:'connector-snapshot'}});
    const failure = run(join(setupData.root, 'missing'));
    expect(failure.status).toBe(1);
    expect(JSON.parse(failure.stdout)).toMatchObject({ok:false, issues:expect.arrayContaining([expect.objectContaining({location:'--data-dir'})])});
  });
});
