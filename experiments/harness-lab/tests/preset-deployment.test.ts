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

test('Docker preflight requires Docker by default and skips it only when disabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'axon-docker-preflight-'));
  const log = join(root, 'docker.log');
  await writeFile(join(root, 'docker'), [
    '#!/bin/sh',
    'printf "%s\\n" "$1" >> "$DOCKER_TEST_LOG"',
    'if [ "$1" = version ]; then printf "26.1\\n"; exit "$DOCKER_TEST_STATUS"; fi',
    'if [ "$1" = image ]; then exit 1; fi',
  ].join('\n'), { mode: 0o700 });
  const run = (enabled: string | undefined, status: string) => {
    const env = { ...process.env, PATH: `${root}:${process.env.PATH}`, PORT: '4316',
      DOCKER_TEST_LOG: log, DOCKER_TEST_STATUS: status, LAB_EXECUTION_ENABLED: enabled };
    return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/deploy-preflight.ts'], { cwd: app, env, encoding: 'utf8' });
  };
  try {
    const disabled = run('false', '1');
    expect(disabled.status, disabled.stderr).toBe(0);
    await expect(stat(log)).rejects.toMatchObject({ code: 'ENOENT' });

    const unavailable = run(undefined, '1');
    expect(unavailable.status).toBe(1);
    expect(unavailable.stderr).toContain('沙盒已启用');
    expect(await readFile(log, 'utf8')).toBe('version\n');

    const available = run(undefined, '0');
    expect(available.status, available.stderr).toBe(0);
    expect(available.stdout.trim()).toBe('4316');
    expect(await readFile(log, 'utf8')).toBe('version\nversion\nimage\nbuild\nrun\n');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);
