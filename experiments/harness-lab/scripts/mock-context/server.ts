import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RequestError } from '../../src/contracts/errors.js';
import type { ContextFilters, ContextRef, InformationReport, SituationChange, SituationQueryParams } from '../../src/contracts/context.js';
import { normalizeContextQuery } from '../../src/context/validation.js';
import { at, objects, reports, recoveryReport, updatedReport, unknownReport, vehicleRef } from './fixtures.js';

export type MockStage = 'intel' | 'situation' | 'unknown' | 'contract' | 'recovery';
export type MockEventName = 'E1' | 'E2' | 'E3' | 'E4';
export interface MockNotification {sourceMessageId: string; title: string; text: string; subjectId: string; occurredAt: string}
const sameRef = (a: ContextRef, b: ContextRef) => a.systemId === b.systemId && a.objectType === b.objectType && a.objectId === b.objectId;
const fail = (code: string, message: string, status = 400) => new RequestError(code, message, status);
function matches(item: {objectRefs: ContextRef[]; areaIds: string[]}, filters: ContextFilters, text: string) {
  return (!filters.objectRefs || filters.objectRefs.some(ref => item.objectRefs.some(other => sameRef(ref, other))))
    && (!filters.areaIds || filters.areaIds.some(id => item.areaIds.includes(id)))
    && (!filters.query || text.toLowerCase().includes(filters.query.toLowerCase()));
}
function byTime<T>(items: T[], time: (item: T) => string | null, from?: string, to?: string) {
  if (!from && !to) return {items, timeUnknownCount: 0};
  return {items: items.filter(item => { const stamp = time(item); return stamp !== null && (!from || Date.parse(stamp) >= Date.parse(from)) && (!to || Date.parse(stamp) < Date.parse(to)); }),
    timeUnknownCount: items.filter(item => time(item) === null).length};
}

/** Independent HTTP source. Control methods exist only in this process/test driver. */
export function createMockContextServer(options: {token: string}) {
  if (!options.token.trim()) throw new Error('MOCK_CONTEXT_API_TOKEN is required');
  let epoch = randomUUID(), intelGeneration = 0, situationGeneration = 0;
  let reportData = reports(), objectData = objects(), changes: SituationChange[] = [];
  let intelAsOf = at('09:00'), situationAsOf = at('09:00');
  const unavailable = new Set<string>();
  const requests: Array<{method: string; path: string; status: number}> = [];
  const cursors = new Map<string, {epoch: string; generation: number; key: string; offset: number}>();
  const changeCursor = (seq: number) => `situation-${epoch}-seq-${seq}`;
  const head = () => changeCursor(100 + changes.length);
  function reset() {
    epoch = randomUUID(); intelGeneration = situationGeneration = 0;
    reportData = reports(); objectData = objects(); changes = []; intelAsOf = situationAsOf = at('09:00'); unavailable.clear();
  }
  function updateVehicles(count: number, time: string) {
    const index = objectData.findIndex(item => sameRef(item.ref, vehicleRef)), before = structuredClone(objectData[index]);
    const after = {...structuredClone(before), revision: before.revision + 1, effectiveAt: at(time), validTime: {from: at(time), to: at('11:00')}, properties: {availableCount: count, unit: '辆' as const}};
    changes.push({cursor: changeCursor(101 + changes.length), effectiveAt: at(time), before, after}); objectData[index] = after;
    situationGeneration++; situationAsOf = at(time);
  }
  function advance(stage: MockStage) {
    if (stage === 'intel') {
      if (!reportData.some(r => r.reportId === 'report-west-01' && r.revision === 2)) { reportData.push(updatedReport()); intelGeneration++; if (intelAsOf < at('09:20')) intelAsOf = at('09:20'); }
    } else if (stage === 'recovery') {
      if (reportData.some(r => r.reportId === 'report-west-01' && r.revision === 3)) return;
      const vehicles = objectData.find(item => sameRef(item.ref, vehicleRef));
      if (!reportData.some(r => r.reportId === 'report-west-01' && r.revision === 2)
        || vehicles?.revision !== 2 || !('availableCount' in vehicles.properties) || vehicles.properties.availableCount !== 2) {
        throw fail('INVALID_STAGE', '恢复阶段要求先推进 intel 和 situation，且车辆仍为修订 2（2 辆）；不能用于 contract 阶段。');
      }
      reportData.push(recoveryReport()); intelGeneration++; intelAsOf = at('09:35');
    } else if (stage === 'unknown') {
      if (!reportData.some(r => r.reportId === 'report-unknown-01')) { reportData.push(unknownReport()); intelGeneration++; intelAsOf = at('09:35'); }
    } else if (stage === 'situation') {
      if (!changes.length) updateVehicles(2, '09:30');
    } else if (stage === 'contract') {
      // Extra boundary fixtures are deliberately absent from the core reasoning scenario.
      advance('situation'); if (changes.length === 1) updateVehicles(3, '09:40');
      if (!reportData.some(r => r.reportId === 'report-time-unknown')) {
        reportData.push({...reports()[0], reportId: 'report-time-unknown', subjectId: 'report-time-unknown', title: '观测时间待核实',
          summary: '观测时间未提供。', content: '西区通道的这份记录没有提供观测时间或有效时段，尚需核实。', observedAt: null, validTime: null}); intelGeneration++;
      }
    } else throw fail('INVALID_ARGUMENT', '未知模拟阶段。');
  }
  function event(name: MockEventName): MockNotification {
    if (name === 'E1') return {sourceMessageId: 'intel-msg-0001', title: '西区通道限制信息更新',
      text: '报告 report-west-01 更新至修订 2。关联对象 situation/road/road-west-01；限制时段为 2026-10-01T09:20:00+08:00 至 2026-10-01T10:10:00+08:00。请查询报告正文及历史。', subjectId: 'report-west-01', occurredAt: at('09:20')};
    if (name === 'E2') return {sourceMessageId: 'situation-msg-0001', title: '西区可用车辆更新',
      text: `对象 situation/resource/vehicles-west-01 的修订由 1 更新为 2，可用车辆由 4 辆变为 2 辆。变化游标从 ${changeCursor(100)} 推进至 ${changeCursor(101)}；请查询变化详情。`, subjectId: 'vehicles-west-01', occurredAt: at('09:30')};
    if (name === 'E3') return {sourceMessageId: 'intel-msg-0002', title: '待核实通道信息',
      text: '报告 report-unknown-01 修订 1 引用 situation/road/road-unknown-99，区域 zone-west，有效时间为 2026-10-01T09:35:00+08:00 至 2026-10-01T10:10:00+08:00。请查询报告正文。', subjectId: 'report-unknown-01', occurredAt: at('09:35')};
    if (name === 'E4') return {sourceMessageId: 'intel-msg-0003', title: '西区通道报告再次更新',
      text: '报告 report-west-01 更新至修订 3，观测及发布时间为 2026-10-01T09:35:00+08:00。关联对象 situation/road/road-west-01；请查询报告正文并比较历史修订。', subjectId: 'report-west-01', occurredAt: at('09:35')};
    throw fail('INVALID_ARGUMENT', '未知模拟通知。');
  }
  function page<T>(items: T[], params: ContextFilters, systemId: 'intel' | 'situation', path: string, timeUnknownCount = 0) {
    const limit = params.limit ?? 20, generation = systemId === 'intel' ? intelGeneration : situationGeneration;
    const key = JSON.stringify([path, Object.entries(params).filter(([key]) => key !== 'cursor').sort(([a], [b]) => a.localeCompare(b))]);
    let offset = 0;
    if (params.cursor) {
      const cursor = cursors.get(params.cursor);
      if (!cursor || cursor.key !== key) throw fail('INVALID_CURSOR', '分页游标无效或查询条件已改变。');
      if (cursor.epoch !== epoch || cursor.generation !== generation) throw fail('CURSOR_STALE', '资料已更新，请重新查询第一页。', 409);
      offset = cursor.offset;
    }
    const slice = items.slice(offset, offset + limit), hasMore = offset + limit < items.length;
    let nextCursor: string | null = null;
    if (hasMore) {
      nextCursor = randomUUID(); cursors.set(nextCursor, {epoch, generation, key, offset: offset + limit});
      if (cursors.size > 2048) cursors.delete(cursors.keys().next().value!);
    }
    return {systemId, asOf: systemId === 'intel' ? intelAsOf : situationAsOf, items: slice, limit, nextCursor, hasMore, timeUnknownCount};
  }
  function query(url: URL): unknown {
    const detail = /^\/intel\/reports\/([^/]+)$/.exec(url.pathname);
    const isReports = url.pathname === '/intel/reports', current = url.pathname === '/situation/objects', isChanges = url.pathname === '/situation/changes';
    if (!detail && !isReports && !current && !isChanges) throw fail('NOT_FOUND', '查询接口不存在。', 404);
    const systemId = detail || isReports ? 'intel' : 'situation';
    const allowed = detail ? ['revision'] : isReports ? ['reportId', 'subjectId', 'objectRefs', 'areaIds', 'from', 'to', 'query', 'limit', 'cursor']
      : ['objectRefs', 'areaIds', 'query', 'limit', 'cursor', ...(isChanges ? ['after', 'from', 'to'] : [])];
    const raw: Record<string, unknown> = {systemId, ...(!detail && !isReports ? {mode: current ? 'current' : 'changes'} : {})};
    if (detail) raw.reportId = decodeURIComponent(detail[1]);
    for (const [key, value] of url.searchParams) {
      if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw fail('INVALID_ARGUMENT', '未知或重复查询参数。');
      if (key === 'objectRefs' || key === 'areaIds') { try { raw[key] = JSON.parse(value); } catch { throw fail('INVALID_ARGUMENT', '数组编码无效。'); } }
      else if (key === 'revision' || key === 'limit') {
        if (!/^[0-9]+$/.test(value)) throw fail('INVALID_ARGUMENT', '需要十进制整数。'); raw[key] = Number(value);
      } else raw[key] = value;
    }
    let params;
    try { params = normalizeContextQuery(detail ? 'information_read' : isReports ? 'information_search' : 'situation_query', raw); }
    catch { throw fail('INVALID_ARGUMENT', '查询参数无效。'); }
    if (unavailable.has(systemId)) throw fail('UNAVAILABLE', '来源暂不可用。', 503);
    if (detail && 'reportId' in params) {
      const matches = reportData.filter(r => r.reportId === params.reportId && (!('revision' in params) || r.revision === params.revision));
      const item = matches.sort((a, b) => b.revision - a.revision)[0];
      if (!item) throw fail('NOT_FOUND', '报告或修订不存在。', 404); return {systemId, asOf: intelAsOf, item};
    }
    if (isReports && !('mode' in params) && 'limit' in params) {
      const selected = reportData.filter(r => (!params.reportId || r.reportId === params.reportId) && (!params.subjectId || r.subjectId === params.subjectId)
        && matches(r, params, `${r.title}\n${r.content}`));
      const timed = byTime(selected, r => r.observedAt, params.from, params.to);
      return page(timed.items.sort((a, b) => a.reportId.localeCompare(b.reportId) || a.revision - b.revision).map(r => {
        const index: Partial<InformationReport> = {...r}; delete index.content; return index;
      }), params, 'intel', url.pathname, timed.timeUnknownCount);
    }
    const filters = params as SituationQueryParams;
    if (filters.objectRefs?.some(ref => ref.systemId !== 'situation' || !['road', 'resource', 'area'].includes(ref.objectType))) throw fail('UNSUPPORTED_FILTER', '不支持该系统或对象类型。');
    const unknownRefs = filters.objectRefs?.filter(ref => !objectData.some(o => sameRef(o.ref, ref))) ?? [];
    if (current) {
      const selected = objectData.filter(o => matches({objectRefs: [o.ref], areaIds: o.areaIds}, filters, o.name))
        .sort((a, b) => a.ref.objectType.localeCompare(b.ref.objectType) || a.ref.objectId.localeCompare(b.ref.objectId));
      return {...page(selected, filters, 'situation', url.pathname), unknownRefs, changeCursor: head()};
    }
    let start = 0;
    if (filters.after !== undefined) {
      const positions = [changeCursor(100), ...changes.map(c => c.cursor)], index = positions.indexOf(filters.after);
      if (index < 0) throw fail('INVALID_CHANGE_CURSOR', '变化游标无效，请重新查询当前状态。'); start = index;
    }
    const selected = changes.slice(start).filter(c => matches({objectRefs: [c.after.ref], areaIds: c.after.areaIds}, filters, c.after.name));
    const timed = byTime(selected, c => c.effectiveAt, filters.from, filters.to);
    const result = page(timed.items, filters, 'situation', url.pathname, timed.timeUnknownCount);
    return {...result, unknownRefs, nextAfter: result.hasMore ? null : head()};
  }
  const server = createServer((req, res) => {
    const path = req.url ?? '/', method = req.method ?? 'GET';
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    let status = 200, body: unknown;
    try {
      const supplied = Buffer.from(req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''), expected = Buffer.from(options.token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw fail('UNAUTHORIZED', '查询凭证无效。', 401);
      if (method !== 'GET') throw fail('INVALID_ARGUMENT', '只支持只读 GET。');
      body = query(new URL(path, 'http://127.0.0.1'));
    } catch (error) {
      status = error instanceof RequestError ? error.statusCode : 400;
      body = {error: {code: error instanceof RequestError ? error.code : 'INVALID_ARGUMENT', message: error instanceof RequestError ? error.message : '查询参数无效。'}};
    }
    requests.push({method, path, status}); if (requests.length > 2048) requests.shift();
    res.statusCode = status; res.end(JSON.stringify(body));
  });
  return {
    requests, advance, reset, event,
    setUnavailable(systemId: 'intel' | 'situation', value: boolean) { if (value) unavailable.add(systemId); else unavailable.delete(systemId); },
    snapshot() { return structuredClone({reports: reportData, objects: objectData, changes, changeCursor: head(), intelAsOf, situationAsOf}); },
    async listen(port = 0, host = '127.0.0.1') {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => {server.removeListener('error', reject); resolve(); }); });
      return `http://${host}:${(server.address() as AddressInfo).port}`;
    },
    async close() { if (!server.listening) return; await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
