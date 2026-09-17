import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import type { ActivityOverview, SessionSnapshot, StreamEvent } from '../src/contracts/index.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup(reply: Parameters<typeof fakeRuntime>[1] = () => ({ text: '实际 Pi 回复' }), configured = true) {
  const dir = await mkdtemp(join(tmpdir(), 'berserk-api-test-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const config = testConfig(dir, configured ? {} : { apiKey: '' });
  const fake = await fakeRuntime(config, reply);
  const lab = await PiLab.create(config, fake.runtime);
  const app = await createApp(lab); cleanup.push(() => app.close());
  return { app, lab, config, calls: fake.calls };
}
function events(payload: string): StreamEvent[] {
  return payload.split('\n\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)) as StreamEvent);
}

describe('local API with real Pi sessions', () => {
  it('returns cross-workspace navigation metadata without history, resources, errors or native paths', async () => {
    const { app, lab, config } = await setup(() => ({ text: 'PRIVATE_ASSISTANT_BODY' }));
    const a = await lab.createSession();
    const workspace = await lab.workspaces.create('另一工作区');
    const b = await lab.createSession(workspace.id);
    const instruction = await lab.resources.readInstruction(workspace.id, 'workspace');
    await lab.resources.updateInstruction(workspace.id, 'workspace', 'PRIVATE_INSTRUCTION_BODY', instruction.hash);
    const request = lab.start(b.id, '标题'.repeat(30) + 'PRIVATE_USER_BODY_TAIL');
    await request.run(() => {});
    const response = await app.inject('/api/activity');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const overview = response.json<ActivityOverview>();
    expect(overview.workspaces).toHaveLength(2);
    expect(overview.sessions).toEqual(expect.arrayContaining([
      { id: a.id, workspaceId: a.workspaceId, title: '新会话', updatedAt: a.updatedAt, active: null, lastResult: null, statusUpdatedAt: a.updatedAt },
      { id: b.id, workspaceId: b.workspaceId, title: '标题'.repeat(20), updatedAt: expect.any(String), active: null,
        lastResult: { requestId: request.requestId, status: 'succeeded' }, statusUpdatedAt: expect.any(String) },
    ]));
    for (const privateText of ['PRIVATE_ASSISTANT_BODY', 'PRIVATE_INSTRUCTION_BODY', 'PRIVATE_USER_BODY_TAIL', config.apiKey, config.dataDir, 'messages', 'instructions', '.jsonl']) {
      expect(response.payload).not.toContain(privateText);
    }
    // The old list remains scoped and retains its exact public shape.
    expect((await app.inject('/api/sessions')).json()).toEqual([{ id: a.id, workspaceId: a.workspaceId, title: a.title, updatedAt: a.updatedAt }]);
    expect((await app.inject(`/api/activity?workspaceId=${a.workspaceId}`)).statusCode).toBe(400);
  });

  it('creates, lists and reads isolated sessions, and streams a request with an authoritative final snapshot', async () => {
    const { app, config, calls } = await setup();
    const a = (await app.inject({ method: 'POST', url: '/api/sessions' })).json<SessionSnapshot>();
    const b = (await app.inject({ method: 'POST', url: '/api/sessions' })).json<SessionSnapshot>();
    expect(a.id).not.toBe(b.id);
    const reply = await app.inject({ method: 'POST', url: `/api/sessions/${a.id}/messages`, payload: { text: '记住请求标记' } });
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['content-type']).toContain('text/event-stream');
    const stream = events(reply.payload);
    expect(stream.map(event => event.type)).toEqual(['response.started', 'resources.loaded', 'text.delta', 'response.completed']);
    expect(stream.every(event => event.sessionId === a.id && event.requestId === stream[0].requestId)).toBe(true);
    const history = (await app.inject(`/api/sessions/${a.id}`)).json<SessionSnapshot>();
    expect(history.messages.map(message => message.text)).toEqual(['记住请求标记', '实际 Pi 回复']);
    expect((await app.inject(`/api/sessions/${b.id}`)).json<SessionSnapshot>().messages).toEqual([]);
    const list = (await app.inject('/api/sessions')).json<Array<{ id: string }>>();
    expect(list.map(item => item.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    await app.inject(`/api/sessions/${a.id}`);
    expect(calls).toHaveLength(1); // Snapshot queries and page refresh never resend commands.
    const info = await app.inject('/api/info');
    expect(info.json()).toMatchObject({ configured: true, model: config.model });
    expect(info.payload).not.toContain(config.apiKey);
    expect(info.payload).not.toContain(config.dataDir);
    expect(reply.payload).not.toContain(config.apiKey);
  });

  it('enforces busy and precise cancellation while a stream is active', async () => {
    const { app, calls } = await setup(() => ({ waitForAbort: true }));
    const session = (await app.inject({ method: 'POST', url: '/api/sessions' })).json<SessionSnapshot>();
    const work = app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, payload: { text: '等待停止' } }).then(result => result);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const active = (await app.inject(`/api/sessions/${session.id}`)).json<SessionSnapshot>();
    expect(active.active?.status).toBe('responding');
    const conflict = await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, payload: { text: '不能排队' } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('SESSION_BUSY');
    const stop = await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/cancel`, payload: { requestId: active.active!.requestId } });
    expect(stop.statusCode).toBe(200);
    expect(events((await work).payload).at(-1)?.type).toBe('response.cancelled');
    const stale = await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/cancel`, payload: { requestId: active.active!.requestId } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('STALE_REQUEST');
    expect(calls).toHaveLength(1);
  });

  it('rejects malformed bodies, unknown sessions and unsafe origins before any model request', async () => {
    const { app, calls } = await setup();
    const session = (await app.inject({ method: 'POST', url: '/api/sessions' })).json<SessionSnapshot>();
    for (const payload of [{}, { text: '' }, { text: '   ' }, { text: 'x'.repeat(16001) }]) {
      expect((await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, payload })).statusCode).toBe(400);
    }
    expect((await app.inject('/api/sessions/not-a-session-id')).statusCode).toBe(400);
    expect((await app.inject('/api/sessions/11111111-1111-4111-8111-111111111111')).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/info', headers: { host: 'attacker.example' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/sessions', headers: { origin: 'https://attacker.example' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/info', headers: { host: '127.0.0.1:4310', origin: 'http://127.0.0.1:5173' } })).statusCode).toBe(200);
    expect(calls).toHaveLength(0);
  });

  it('reports missing model configuration before occupying the session', async () => {
    const { app, calls } = await setup(undefined, false);
    const session = (await app.inject({ method: 'POST', url: '/api/sessions' })).json<SessionSnapshot>();
    const reply = await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, payload: { text: '你好' } });
    expect(reply.statusCode).toBe(503);
    expect(reply.json().error.code).toBe('MODEL_NOT_CONFIGURED');
    expect((await app.inject(`/api/sessions/${session.id}`)).json<SessionSnapshot>().active).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('server-only configuration', () => {
  it('defaults to the explicitly selected model and rejects credentials in endpoint URLs', () => {
    expect(loadConfig({})).toMatchObject({ provider: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', apiKey: '' });
    for (const endpoint of ['http://api.deepseek.com', 'https://user:password@api.deepseek.com', 'https://api.deepseek.com?key=secret']) {
      expect(() => loadConfig({ LLM_BASE_URL: endpoint })).toThrow(/HTTPS/);
    }
    expect(() => loadConfig({ REQUEST_TIMEOUT_MS: '-1' })).toThrow(/REQUEST_TIMEOUT_MS/);
    expect(() => loadConfig({ MAX_TOOL_CALLS: '0' })).toThrow(/MAX_TOOL_CALLS/);
    expect(() => loadConfig({ MAX_OUTPUT_TOKENS: 'NaN' })).toThrow(/MAX_OUTPUT_TOKENS/);
  });
});

describe('workspace resource API', () => {
  it('persists workspace ownership, exposes exact current/loaded resources and returns CAS conflicts without writing', async () => {
    const { app, calls } = await setup();
    const list = (await app.inject('/api/workspaces')).json<{ defaultWorkspaceId: string; workspaces: Array<{ id: string }> }>();
    const created = await app.inject({ method: 'POST', url: '/api/workspaces', payload: { name: '第二工作区' } });
    expect(created.statusCode).toBe(201); const id = created.json<{ id: string }>().id;
    const session = (await app.inject({ method: 'POST', url: '/api/sessions', payload: { workspaceId: id } })).json<SessionSnapshot>();
    expect(session.workspaceId).toBe(id);
    expect((await app.inject('/api/sessions')).json()).toEqual([]);
    expect((await app.inject(`/api/sessions?workspaceId=${id}`)).json()).toMatchObject([{ id: session.id, workspaceId: id }]);
    const info = (await app.inject(`/api/workspaces/${id}/resources`)).json();
    expect(info).toMatchObject({ workspaceId: id, sources: [{ id: 'meeting-notes' }, { id: 'resource-brief' }], skills: [{ id: 'synthesis' }, { id: 'review' }] });
    expect((await app.inject('/api/info')).json()).not.toHaveProperty('sources');
    const path = `/api/workspaces/${id}/instructions/workspace`;
    const original = (await app.inject(path)).json();
    const saved = await app.inject({ method: 'PUT', url: path, payload: { content: 'API_RULE', expectedHash: original.hash } });
    expect(saved.statusCode).toBe(200); expect(saved.json()).toMatchObject({ status: 'updated', effectiveFrom: 'next_request' });
    const stale = await app.inject({ method: 'PUT', url: path, payload: { content: '过期覆盖', expectedHash: original.hash } });
    expect(stale.statusCode).toBe(409); expect(stale.json().error.code).toBe('INSTRUCTION_CONFLICT');
    expect((await app.inject(path)).json().content).toBe('API_RULE');
    expect((await app.inject(`/api/workspaces/${list.defaultWorkspaceId}/instructions/workspace`)).json().content).toBe('');
    const response = await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, payload: { text: '测试规则' } });
    const requestId = events(response.payload)[0].requestId;
    expect((await app.inject(`/api/sessions/${session.id}/requests/${requestId}/resources`)).json()).toMatchObject({ status: 'available', workspaceId: id, instructions: [{ fileId: 'common' }, { fileId: 'workspace', content: 'API_RULE' }] });
    expect(calls[0].context.systemPrompt).toContain('API_RULE');
    expect((await app.inject(`/api/workspaces/${id}/skills/review`)).json()).toMatchObject({ id: 'review', content: expect.stringContaining('修订建议') });
  });
  it('rejects unknown workspace, read-only writes, oversized content and extra authority parameters', async () => {
    const { app, calls } = await setup();
    const id = (await app.inject('/api/workspaces')).json().defaultWorkspaceId;
    const session = (await app.inject({ method: 'POST', url: '/api/sessions' })).json<SessionSnapshot>();
    for (const payload of [{ name: ' ' }, { name: 'x'.repeat(61) }, { name: '范围', path: '/tmp' }]) expect((await app.inject({ method: 'POST', url: '/api/workspaces', payload })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/sessions', payload: { workspaceId: '11111111-1111-4111-8111-111111111111' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, payload: { text: '提升权限', editable: true } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: `/api/workspaces/${id}/instructions/common`, payload: { content: '', expectedHash: null } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: `/api/workspaces/${id}/instructions/workspace`, payload: { content: '字'.repeat(6000), expectedHash: null } })).statusCode).toBe(413);
    expect((await app.inject(`/api/workspaces/${id}/skills/unknown`)).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/api/workspaces/${id}/instructions/workspace`, payload: { content: '', expectedHash: null, force: true } })).statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
