import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockContextServer } from '../scripts/mock-context/server.js';
import { loadContextConfig, parseContextConfig } from '../src/context/config.js';
import { ContextService } from '../src/context/service.js';
import { readContextJson } from '../src/context/http.js';
import type { ContextQueryResult, InformationDetail, SituationChanges, SituationCurrent } from '../src/contracts/context.js';
const token = 'synthetic-query-token-not-a-real-secret';
const env = {MOCK_CONTEXT_API_TOKEN: token};
const seat = {kind: 'seat' as const, seatId: 'seat-a'};
const ref = (type: string, id: string) => ({systemId: 'situation', objectType: type, objectId: id});
const road = ref('road', 'road-west-01');
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {for (const close of cleanup.splice(0)) await close();});
const config = (baseUrl: string) => parseContextConfig({systems: [
  {id: 'intel', name: '特情', adapter: 'mock-information-http', baseUrl: `${baseUrl}/intel`, tokenEnv: 'MOCK_CONTEXT_API_TOKEN'},
  {id: 'situation', name: '态势', adapter: 'mock-situation-http', baseUrl: `${baseUrl}/situation`, tokenEnv: 'MOCK_CONTEXT_API_TOKEN'},
], scopes: [{id: 'demo', name: '验证资料', systemIds: ['intel', 'situation'], seatIds: ['seat-a', 'seat-b']}]});
async function setup() {
  const mock = createMockContextServer({token}); const url = await mock.listen(); cleanup.push(() => mock.close());
  const service = new ContextService(config(url), env);
  const get = async (path: string, auth = token) => {
    const response = await fetch(`${url}${path}`, {headers: {Authorization: `Bearer ${auth}`}});
    return {status: response.status, body: await response.json()};
  };
  return {mock, service, get, url};
}
const data = <T>(result: ContextQueryResult) => result.data as T;
async function rawServer(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', () => {server.removeListener('error', reject); resolve();});});
  cleanup.push(() => new Promise<void>(resolve => {server.closeAllConnections(); server.close(() => resolve());}));
  return new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
}

describe('fixed context configuration and authority', () => {
  it('is optional, validates catalogs and requires a controlled absolute file plus credentials', async () => {
    expect(await loadContextConfig({})).toBeUndefined();
    const directory = await mkdtemp(join(tmpdir(), 'axon-context-')); cleanup.push(() => rm(directory, {recursive: true, force: true}));
    const path = join(directory, 'context.json'); const valid = config('http://127.0.0.1:4401'); await writeFile(path, JSON.stringify(valid));
    expect(await loadContextConfig({...env, LAB_CONTEXT_CONFIG: path})).toEqual(valid);
    await expect(loadContextConfig({LAB_CONTEXT_CONFIG: path})).rejects.toThrow('凭证未配置');
    await expect(loadContextConfig({LAB_CONTEXT_CONFIG: 'relative.json'})).rejects.toThrow('绝对路径');
    for (const value of [{...valid, token}, {...valid, scopes: [{...valid.scopes[0], systemIds: ['other']}]}, {...valid, systems: [valid.systems[0], valid.systems[0]]}]) expect(() => parseContextConfig(value)).toThrow();
    for (const baseUrl of ['file:///tmp/data', 'http://user:pass@localhost', 'http://localhost?q=foo']) expect(() => parseContextConfig({...valid, systems: [{...valid.systems[0], baseUrl}]})).toThrow();
  });
  it('projects only allowed catalog data without HTTP and verifies exact service and seat scope', async () => {
    const {service, mock} = await setup();
    expect(service.catalog('seat-a').systems.map(s => s.id)).toEqual(['intel', 'situation']);
    expect(service.catalog('unknown')).toEqual({systems: []});
    expect(JSON.stringify(service.catalog('seat-a'))).not.toMatch(/baseUrl|token|seat-b/);
    const snapshot = service.scopeSnapshot('demo'); snapshot.systemIds.push('other');
    expect(() => service.assertServiceScope(snapshot)).toThrow('无权');
    expect(() => service.assertServiceScope({scopeId: 'demo', systemIds: ['intel', 'intel']})).toThrow('无权');
    expect(() => service.assertSeatScope('other', service.scopeSnapshot('demo'))).toThrow('无权');
    await expect(service.query('information_search', {systemId: 'intel'}, {kind: 'seat', seatId: 'other'})).rejects.toMatchObject({code: 'CONTEXT_FORBIDDEN'});
    expect(mock.requests).toEqual([]);
    const principal = {kind: 'service' as const, profileId: 'analysis', jobId: 'job-1', scope: service.scopeSnapshot('demo')};
    expect((await service.query('information_search', {systemId: 'intel'}, principal)).systemId).toBe('intel');
    const count = mock.requests.length;
    for (const params of [{systemId: 'intel', actor: 'seat-b'}, {systemId: 'intel', url: 'http://other'}, {systemId: 'intel', scopeId: 'other'}]) await expect(service.query('information_search', params, principal)).rejects.toMatchObject({code: 'CONTEXT_INVALID_ARGUMENT'});
    await expect(service.query('situation_query', {systemId: 'intel', mode: 'current'}, principal)).rejects.toMatchObject({code: 'CONTEXT_UNSUPPORTED_FILTER'});
    expect(mock.requests).toHaveLength(count);
  });
});

describe('independent mock HTTP contracts', () => {
  it('authenticates and rejects unsupported verbs, duplicate/unknown parameters, bad types and invalid dates', async () => {
    const {get, url} = await setup();
    expect((await get('/intel/reports', 'wrong')).status).toBe(401);
    expect((await fetch(`${url}/intel/reports`, {method: 'POST', headers: {Authorization: `Bearer ${token}`}})).status).toBe(400);
    for (const path of ['/intel/reports?limit=1&limit=2', '/intel/reports?limit=0', '/intel/reports?limit=1.5', '/intel/reports?limit=101', '/intel/reports?areaIds=[]', '/intel/reports?objectRefs=invalid', '/intel/reports?taskId=answer', '/situation/changes?afterCursor=old', '/situation/objects?from=2026-10-01T09:00:00Z', '/intel/reports?from=2026-02-30T09:00:00Z']) expect((await get(path)).status, path).toBe(400);
    expect((await get(`/situation/objects?objectRefs=${encodeURIComponent(JSON.stringify([{...road, systemId: 'other'}]))}`)).body.error.code).toBe('UNSUPPORTED_FILTER');
    expect((await get('/control')).status).toBe(404);
  });
  it('returns all report revisions, pages in stable order, preserves filters and exact-version semantics', async () => {
    const {service, mock, get} = await setup(); mock.advance('intel');
    const first = await service.query('information_search', {systemId: 'intel', reportId: 'report-west-01', limit: 1}, seat);
    expect(first.query).toEqual({systemId: 'intel', reportId: 'report-west-01', limit: 1});
    expect(Math.abs(Date.now() - Date.parse(first.queriedAt))).toBeLessThan(2000);
    expect(first.data).toMatchObject({asOf: '2026-10-01T09:20:00+08:00', items: [{revision: 1}], hasMore: true});
    const second = await service.query('information_search', {systemId: 'intel', reportId: 'report-west-01', limit: 1, cursor: (first.data as {nextCursor: string}).nextCursor}, seat);
    expect(second.data).toMatchObject({items: [{revision: 2}], nextCursor: null, hasMore: false});
    const latest = data<InformationDetail>(await service.query('information_read', {systemId: 'intel', reportId: 'report-west-01'}, seat));
    expect(latest.item.revision).toBe(2); expect(latest.item.content).toContain('09:20 至 10:10');
    expect(data<InformationDetail>(await service.query('information_read', {systemId: 'intel', reportId: 'report-west-01', revision: 1}, seat)).item.revision).toBe(1);
    await expect(service.query('information_read', {systemId: 'intel', reportId: 'report-west-01', revision: 99}, seat)).rejects.toMatchObject({code: 'CONTEXT_NOT_FOUND'});
    expect((await get('/intel/reports?reportId=unknown')).body.items).toEqual([]);
    expect((await get('/intel/reports/unknown')).status).toBe(404);
    expect((await service.query('information_search', {systemId: 'intel', objectRefs: [road], areaIds: ['zone-east']}, seat)).data).toMatchObject({items: []});
    expect((await service.query('information_search', {systemId: 'intel', objectRefs: [road, ref('road', 'other')], areaIds: ['zone-west'], query: '  临时受限  '}, seat)).data).toMatchObject({items: [{revision: 2}]});
    expect(mock.requests.some(r => /objectRefs=/.test(r.path))).toBe(true);
  });
  it('filters observed time using half-open endpoints and reports unknown times instead of treating them as matches', async () => {
    const {service, mock} = await setup(); mock.advance('intel'); mock.advance('contract');
    expect((await service.query('information_search', {systemId: 'intel', from: '2026-10-01T09:00:00+08:00', to: '2026-10-01T09:18:00+08:00'}, seat)).data).toMatchObject({items: [], timeUnknownCount: 1});
    expect((await service.query('information_search', {systemId: 'intel', from: '2026-10-01T09:18:00+08:00'}, seat)).data).toMatchObject({items: [{revision: 2}], timeUnknownCount: 1});
    expect((await service.query('information_search', {systemId: 'intel', reportId: 'report-time-unknown'}, seat)).data).toMatchObject({items: [{observedAt: null, validTime: null}], timeUnknownCount: 0});
  });
  it('separates pagination and changes, advances at the final page and retains immutable prior evidence', async () => {
    const {service, mock} = await setup();
    const baseline = data<SituationCurrent>(await service.query('situation_query', {systemId: 'situation', mode: 'current'}, seat));
    mock.advance('contract');
    const first = data<SituationChanges>(await service.query('situation_query', {systemId: 'situation', mode: 'changes', after: baseline.changeCursor, limit: 1}, seat));
    expect(first).toMatchObject({hasMore: true, nextAfter: null, items: [{before: {revision: 1, properties: {availableCount: 4}}, after: {revision: 2, properties: {availableCount: 2}}}]});
    const second = data<SituationChanges>(await service.query('situation_query', {systemId: 'situation', mode: 'changes', after: baseline.changeCursor, limit: 1, cursor: first.nextCursor}, seat));
    expect(second).toMatchObject({hasMore: false, nextCursor: null, items: [{before: {revision: 2}, after: {revision: 3}}]});
    expect(second.nextAfter).toBe(mock.snapshot().changeCursor);
    expect((await service.query('situation_query', {systemId: 'situation', mode: 'changes', after: second.nextAfter}, seat)).data).toMatchObject({items: [], nextAfter: second.nextAfter});
    expect((await service.query('situation_query', {systemId: 'situation', mode: 'changes', after: baseline.changeCursor, areaIds: ['zone-east']}, seat)).data).toMatchObject({items: [], nextAfter: second.nextAfter});
    for (const after of ['future', first.nextCursor]) await expect(service.query('situation_query', {systemId: 'situation', mode: 'changes', after}, seat)).rejects.toMatchObject({code: 'CONTEXT_INVALID_CHANGE_CURSOR'});
    await expect(service.query('situation_query', {systemId: 'situation', mode: 'changes', cursor: baseline.changeCursor}, seat)).rejects.toMatchObject({code: 'CONTEXT_INVALID_CURSOR'});
    await expect(service.query('situation_query', {systemId: 'situation', mode: 'changes', after: baseline.changeCursor, from: '2026-10-01T09:00:00Z'}, seat)).rejects.toMatchObject({code: 'CONTEXT_INVALID_ARGUMENT'});
    const before = JSON.stringify(first); mock.reset(); expect(JSON.stringify(first)).toBe(before);
    await expect(service.query('situation_query', {systemId: 'situation', mode: 'changes', after: second.nextAfter}, seat)).rejects.toMatchObject({code: 'CONTEXT_INVALID_CHANGE_CURSOR'});
  });
  it('rejects stale or condition-mismatched pages rather than mixing stages', async () => {
    const {service, mock} = await setup();
    const first = data<SituationCurrent>(await service.query('situation_query', {systemId: 'situation', mode: 'current', limit: 1}, seat));
    await expect(service.query('situation_query', {systemId: 'situation', mode: 'current', limit: 2, cursor: first.nextCursor}, seat)).rejects.toMatchObject({code: 'CONTEXT_INVALID_CURSOR'});
    mock.advance('situation');
    await expect(service.query('situation_query', {systemId: 'situation', mode: 'current', limit: 1, cursor: first.nextCursor}, seat)).rejects.toMatchObject({code: 'CONTEXT_CURSOR_STALE'});
    const second = data<SituationCurrent>(await service.query('situation_query', {systemId: 'situation', mode: 'current', limit: 1}, seat)); mock.reset();
    await expect(service.query('situation_query', {systemId: 'situation', mode: 'current', limit: 1, cursor: second.nextCursor}, seat)).rejects.toMatchObject({code: 'CONTEXT_CURSOR_STALE'});
  });
  it('separates unknown references, known nonmatches and unavailable sources', async () => {
    const {service, mock} = await setup(); mock.advance('unknown');
    const detail = data<InformationDetail>(await service.query('information_read', {systemId: 'intel', reportId: 'report-unknown-01'}, seat));
    expect(detail.item.content).toContain('尚未核实'); const unknown = detail.item.objectRefs[0];
    expect((await service.query('situation_query', {systemId: 'situation', mode: 'current', objectRefs: [road, unknown], areaIds: ['zone-east']}, seat)).data).toMatchObject({items: [], unknownRefs: [unknown]});
    mock.setUnavailable('situation', true);
    await expect(service.query('situation_query', {systemId: 'situation', mode: 'current'}, seat)).rejects.toMatchObject({code: 'CONTEXT_UNAVAILABLE'});
    expect((await service.query('information_read', {systemId: 'intel', reportId: 'report-unknown-01'}, seat)).data).toEqual(detail);
    mock.setUnavailable('situation', false);
    expect((await service.query('situation_query', {systemId: 'situation', mode: 'current'}, seat)).data).toHaveProperty('items');
  });
  it('supports E2 without E1; sources contain no Axon task data or impact answers', async () => {
    const {mock, get} = await setup(); mock.advance('situation');
    expect((await get('/intel/reports/report-west-01')).body.item.revision).toBe(1);
    expect((await get('/situation/objects')).body.items.find((o: {ref: {objectId: string}}) => o.ref.objectId === 'vehicles-west-01').properties.availableCount).toBe(2);
    mock.advance('intel'); mock.advance('unknown');
    const responses = await Promise.all(['/intel/reports', '/intel/reports/report-west-01?revision=1', '/intel/reports/report-west-01?revision=2', '/intel/reports/report-unknown-01', '/situation/objects', '/situation/changes'].map(path => get(path)));
    expect(JSON.stringify([responses, mock.event('E1'), mock.event('E2'), mock.event('E3')])).not.toMatch(/taskId|task-west|seat-a|seat-b|recommendedRecipient|expectedImpact|至少 3|补给方案|设备转移方案/);
    expect(JSON.stringify(mock.requests)).not.toContain(token);
  });
});

describe('host HTTP boundaries', () => {
  it('does not follow redirects or disclose source errors and credentials', async () => {
    let followed = 0;
    const destination = await rawServer((_req, res) => { followed++; res.end('{}'); });
    const redirect = await rawServer((_req, res) => {res.writeHead(302, {location: destination.href}); res.end();});
    await expect(readContextJson(redirect, token)).rejects.toMatchObject({code: 'CONTEXT_INVALID_RESPONSE'}); expect(followed).toBe(0);
    const error = await rawServer((_req, res) => {res.writeHead(401, {'content-type': 'application/json'}); res.end(JSON.stringify({error: {code: 'UNAUTHORIZED', message: `secret ${token}`}}));});
    await expect(readContextJson(error, token)).rejects.toMatchObject({code: 'CONTEXT_UNAUTHORIZED', message: '来源查询凭证无效，请联系维护人员。'});
  });
  it('enforces streamed byte limits and rejects malformed, foreign or answer-bearing source data', async () => {
    const large = await rawServer((_req, res) => {res.setHeader('content-type', 'application/json'); res.write('{"x":"'); res.end(`${'中'.repeat(100_000)}"}`);});
    await expect(readContextJson(large, token)).rejects.toMatchObject({code: 'CONTEXT_RESPONSE_TOO_LARGE'});
    const malformed = await rawServer((_req, res) => {res.setHeader('content-type', 'application/json'); res.end('{');});
    await expect(readContextJson(malformed, token)).rejects.toMatchObject({code: 'CONTEXT_INVALID_RESPONSE'});
    const {mock} = await setup(); const base = {systemId: 'intel', asOf: '2026-10-01T09:00:00+08:00', item: mock.snapshot().reports[0]};
    for (const body of [{...base, expectedImpact: ['task-a']}, {...base, systemId: 'other'}, {...base, item: {...base.item, taskId: 'task-a'}}, {...base, item: {...base.item, revision: 99}}]) {
      const url = await rawServer((_req, res) => {res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body));});
      await expect(new ContextService(config(url.origin), env).query('information_read', {systemId: 'intel', reportId: 'report-west-01', revision: 1}, seat)).rejects.toMatchObject({code: 'CONTEXT_INVALID_RESPONSE'});
    }
  });
  it('distinguishes timeout and explicit cancellation while aborting HTTP', async () => {
    const url = await rawServer(() => {});
    await expect(readContextJson(url, token, undefined, {timeoutMs: 30})).rejects.toMatchObject({code: 'CONTEXT_TIMEOUT'});
    const controller = new AbortController(); const call = readContextJson(url, token, controller.signal); controller.abort();
    await expect(call).rejects.toMatchObject({name: 'AbortError'});
    await expect(readContextJson(url, token, controller.signal)).rejects.toMatchObject({name: 'AbortError'});
  });
});
