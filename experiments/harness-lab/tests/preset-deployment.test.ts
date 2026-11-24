import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { expect, test, vi } from 'vitest';
import { AccessStore } from '../src/access/store.js';
import { loadBackgroundConfig } from '../src/background/config.js';
import { loadContextConfig } from '../src/context/config.js';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';

const app = fileURLToPath(new URL('../', import.meta.url));

test('scenario bootstrap enables exactly the preset, preserves existing sessions, and reports conflicts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'axon-preset-'));
  const data = join(root, 'data');
  const config = join(root, 'config');
  await mkdir(config);
  const env = {
    ...process.env,
    LAB_CONTEXT_CONFIG: join(app, 'fixtures/scenario-demo/context.example.json'),
    LAB_BACKGROUND_CONFIG: join(app, 'fixtures/scenario-demo/background.example.json'),
    MOCK_CONTEXT_API_TOKEN: 'test-only-context-query-token',
    MOCK_CONTEXT_CONTROL_TOKEN: 'test-only-context-control-token',
    MOCK_INTEL_SOURCE_TOKEN: 'test-only-intelligence-source-token',
    MOCK_SITUATION_SOURCE_TOKEN: 'test-only-situation-source-token',
  };
  const run = (overrides: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [
    '--import', 'tsx', 'scripts/deploy-init.ts', '--preset', 'scenario', '--data-dir', data,
    '--config-dir', config, '--service-stopped',
  ], { cwd: app, env: { ...env, ...overrides }, encoding: 'utf8' });

  try {
    expect(run({ MOCK_CONTEXT_API_TOKEN: '' }).status).toBe(1);
    await expect(stat(data)).rejects.toMatchObject({ code: 'ENOENT' });

    const first = run();
    expect(first.status, first.stderr).toBe(0);
    const credentialsPath = join(config, 'initial-credentials.json');
    const authPath = join(config, 'auth.env');
    const credentials = await readFile(credentialsPath, 'utf8');
    const auth = await readFile(authPath, 'utf8');
    for (const path of [credentialsPath, authPath]) expect((await stat(path)).mode & 0o777).toBe(0o600);
    for (const password of Object.values(JSON.parse(credentials))) expect(first.stdout).not.toContain(password);

    const db = new DatabaseSync(join(data, 'collaboration', 'collaboration.sqlite'));
    try {
      const access = new AccessStore(db);
      expect(access.seats().map(seat => seat.id).sort()).toEqual([
        'seat-control', 'seat-director', 'seat-intelligence', 'seat-overall', 'seat-planning', 'seat-situation',
      ]);
      expect(access.loginUsers()).toMatchObject([{ name: '管理员席' }]);
      expect(access.identityForSeat('seat-director')).toMatchObject({ controlScenarios: true, canCollaborate: false });
      expect(access.identityForSeat('seat-overall')).toMatchObject({ viewWorkOverview: true, createPublicTask: true });
      const snapshot = () => db.prepare('SELECT username, seat_id, salt, password_hash FROM accounts ORDER BY username').all();
      const accounts = snapshot();
      db.prepare('INSERT INTO auth_sessions(id,user_id,expires,data) VALUES(?,?,?,?)')
        .run('retained-session', access.loginUsers()[0].id, Date.now() + 60_000, '{}');
      db.prepare("UPDATE seats SET responsibility='' WHERE id='seat-planning'").run();

      const retry = run();
      expect(retry.status, retry.stderr).toBe(0);
      expect(snapshot()).toEqual(accounts);
      expect(db.prepare('SELECT id FROM auth_sessions').all()).toEqual([{ id: 'retained-session' }]);
      expect(access.seats().find(seat => seat.id === 'seat-planning')?.responsibility).toBeTruthy();
      expect(await readFile(authPath, 'utf8')).toBe(auth);
      expect(await readFile(credentialsPath, 'utf8')).toBe(credentials);

      const context = (await loadContextConfig(env))!;
      const background = (await loadBackgroundConfig(env))!;
      const serverConfig = testConfig(data, { auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28_800_000 } });
      const { runtime } = await fakeRuntime(serverConfig, () => ({ text: '不应调用模型' }));
      const lab = await PiLab.create(serverConfig, runtime);
      vi.stubGlobal('fetch', async (input: URL) => {
        expect(input.pathname).toBe('/control/instances');
        return Response.json({ items: [], activeInstanceId: null, activeRevision: 0, hasMore: false, nextCursor: null });
      });
      const server = await createApp(lab, false, { config: background, env }, { config: context, env });
      try {
        expect((await server.inject('/api/health')).json()).toEqual({ ok: true });
        const bootstrap = await server.inject('/api/auth/session');
        const login = bootstrap.json();
        expect(login.loginSeats).toHaveLength(6);
        expect(login.loginUsers).toEqual(access.loginUsers());
        expect(lab.access!.identityForSeat('seat-control')).toMatchObject({ canIssueCommands: true });
        const result = await server.inject({ url: '/api/auth/login', method: 'POST',
          headers: { cookie: bootstrap.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
            origin: 'http://localhost:4310', 'x-csrf-token': login.csrf },
          payload: { username: 'system-admin', password: JSON.parse(credentials)['system-admin'] },
        });
        expect(result.statusCode, result.body).toBe(200);
        expect(result.json().identity.role).toBe('administrator');
      } finally { vi.unstubAllGlobals(); await server.close(); }

      db.prepare("UPDATE seats SET name='手工改名' WHERE id='seat-planning'").run();
      const conflict = run();
      expect(conflict.status).toBe(1);
      expect(conflict.stderr).toContain('席位 seat-planning 与 scenario 预设冲突');
      expect(access.seatName('seat-planning')).toBe('手工改名');
      expect(snapshot()).toEqual(accounts);
    } finally { db.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);

test('deployment pulls the release digest and reuses an exact cached image', async () => {
  const root = await mkdtemp(join(tmpdir(), 'axon-docker-preflight-'));
  const log = join(root, 'docker.log');
  const binding = join(root, 'sandbox-image.json');
  const image = `ghcr.io/pulpcode/berserk-file-runtime@sha256:${'a'.repeat(64)}`;
  await writeFile(binding, JSON.stringify({ image, platform: 'linux/amd64' }));
  await writeFile(join(root, 'docker'), [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$DOCKER_TEST_LOG"',
    'case "$1" in',
    '  version) printf "26.1\\n"; exit "$DOCKER_TEST_STATUS";;',
    '  image) exit "$DOCKER_TEST_CACHE";;',
    '  pull) exit "$DOCKER_TEST_PULL";;',
    'esac',
  ].join('\n'), { mode: 0o700 });
  const run = (overrides: NodeJS.ProcessEnv = {}, path = binding) => spawnSync(process.execPath, [
    '--import', 'tsx', '--input-type=module', '--eval',
    `import { pathToFileURL } from 'node:url';
     import { deployPreflight } from './scripts/deploy-preflight.ts';
     Object.defineProperties(process, { platform: { value: 'linux' }, arch: { value: 'x64' } });
     const binding = pathToFileURL(process.argv[1]);
     const { managedSandboxReleaseEnv } = await import('./src/server/sandbox-release.ts');
     const startup = managedSandboxReleaseEnv(process.env, binding);
     const port = deployPreflight(process.env, binding);
     if (process.env.EXPECT_MANAGED_IMAGE && startup.LAB_EXECUTION_IMAGE !== process.env.EXPECT_MANAGED_IMAGE)
       throw new Error('服务启动未绑定已验证摘要');
     console.log(port);`, path,
  ], { cwd: app, encoding: 'utf8', env: { ...process.env, PATH: `${root}:${process.env.PATH}`, PORT: '4316',
    DOCKER_TEST_LOG: log, DOCKER_TEST_STATUS: '0', DOCKER_TEST_CACHE: '1', DOCKER_TEST_PULL: '0', ...overrides } });
  try {
    const missing = join(root, 'missing.json');
    expect(run({}, missing).stderr).toContain('缺少 release/sandbox-image.json');
    const disabled = run({ LAB_EXECUTION_ENABLED: 'false' }, missing);
    expect(disabled.status, disabled.stderr).toBe(0);
    expect(run({ LAB_EXECUTION_IMAGE: 'berserk-file-runtime:w01-5' }).stderr).toContain('镜像摘要冲突');
    await expect(stat(log)).rejects.toMatchObject({ code: 'ENOENT' });

    const unavailable = run({ DOCKER_TEST_STATUS: '1' });
    expect(unavailable.status).toBe(1);
    expect(unavailable.stderr).toContain('沙盒已启用');

    await writeFile(log, '');
    const available = run();
    expect(available.status, available.stderr).toBe(0);
    expect(available.stdout.trim()).toBe('4316');
    expect(await readFile(log, 'utf8')).toContain(`pull --platform=linux/amd64 ${image}\n`);
    expect(await readFile(log, 'utf8')).toContain('run --rm --pull=never');

    await writeFile(log, '');
    await writeFile(join(root, '.managed-deployment'), '');
    const cached = run({ DOCKER_TEST_CACHE: '0', EXPECT_MANAGED_IMAGE: image });
    expect(cached.status, cached.stderr).toBe(0);
    expect(await readFile(log, 'utf8')).not.toMatch(/^pull /m);

    await writeFile(log, '');
    const failed = run({ DOCKER_TEST_PULL: '1' });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain(`无法从 GHCR 拉取沙盒镜像 ${image}`);
    expect(await readFile(log, 'utf8')).not.toMatch(/^run /m);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);
