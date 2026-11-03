/** Isolated HTTP fixture source; only the driver can change the source state. */
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { ContextFilters, ContextRef, InformationReport, SituationChange, SituationObject } from '../src/contracts/context.js';
import { normalizeContextQuery, decodeContextResponse, situationObject } from '../src/context/validation.js';
import { RequestError } from '../src/contracts/errors.js';

const key = (ref: ContextRef) => JSON.stringify([ref.systemId, ref.objectType, ref.objectId]);
export function createSpatialFixtureSource(token: string, initial: SituationObject[]) {
  let objects = structuredClone(initial), reports: InformationReport[] = [], changes: SituationChange[] = [];
  let generation = 0, asOf = '2026-11-10T08:00:00+08:00';
  const epoch = randomUUID(), requests: Array<{path: string; status: number}> = [];
  for (const item of objects) situationObject(item, 'situation');
  const cursor = () => `${epoch}:${generation}`;
  const changeHead = () => `${epoch}:change:${changes.length}`;
  const fail = (message: string, status = 400) => new RequestError('FIXTURE_SOURCE_ERROR', message, status);
  function apply(update: {objects?: SituationObject[]; report?: InformationReport; businessTime: string}) {
    const next = structuredClone(objects), nextChanges = structuredClone(changes);
    for (const item of update.objects ?? []) {
      situationObject(item, 'situation');
      const index = next.findIndex(o => key(o.ref) === key(item.ref));
      if (index < 0 || item.revision <= next[index].revision) throw fail('对象修订必须递增');
      nextChanges.push({cursor: `${epoch}:change:${nextChanges.length + 1}`, effectiveAt: item.effectiveAt, before: next[index], after: structuredClone(item)});
      next[index] = structuredClone(item);
    }
    if (update.report) {
      const report = update.report;
      decodeContextResponse('information_read', {systemId: 'intel', reportId: report.reportId}, {systemId: 'intel', asOf: update.businessTime, item: report});
      if (reports.some(r => r.reportId === report.reportId && r.revision >= report.revision)) throw fail('报告修订必须递增');
    }
    objects = next; changes = nextChanges;
    if (update.report) reports = [...reports, structuredClone(update.report)];
    if (update.objects?.length || update.report) { generation++; asOf = update.businessTime; }
  }
  function page<T>(items: T[], query: ContextFilters, systemId: string) {
    const {cursor: requested, ...conditions} = query;
    const signature = createHash('sha256').update(JSON.stringify(conditions)).digest('hex').slice(0, 16);
    let offset = 0;
    if (requested) {
      const [version, filter, value] = requested.split('/');
      if (version !== cursor() || filter !== signature || !/^\d+$/.test(value ?? '')) throw fail('分页快照已改变', 409);
      offset = Number(value);
    }
    const limit = query.limit ?? 20, selected = items.slice(offset, offset + limit), hasMore = offset + selected.length < items.length;
    return {systemId, asOf, items: selected, limit, hasMore, nextCursor: hasMore ? `${cursor()}/${signature}/${offset + selected.length}` : null, timeUnknownCount: 0};
  }
  const matches = (item: {objectRefs: ContextRef[]; areaIds: string[]}, query: ContextFilters, text: string) =>
    (!query.objectRefs || query.objectRefs.some(r => item.objectRefs.some(other => key(r) === key(other))))
    && (!query.areaIds || query.areaIds.some(id => item.areaIds.includes(id)))
    && (!query.query || text.toLowerCase().includes(query.query.toLowerCase()));
  const server = createServer((req, res) => {
    let status = 200, body: unknown;
    try {
      if (req.headers.authorization !== `Bearer ${token}`) throw fail('查询未授权', 401);
      if (req.method !== 'GET') throw fail('仅允许读取', 405);
      const url = new URL(req.url!, 'http://127.0.0.1'), detail = /^\/intel\/reports\/([^/]+)$/.exec(url.pathname);
      const information = url.pathname === '/intel/reports' || !!detail;
      if (!information && !['/situation/objects', '/situation/changes'].includes(url.pathname)) throw fail('接口不存在', 404);
      const raw: Record<string, unknown> = {systemId: information ? 'intel' : 'situation', ...(!information ? {mode: url.pathname.endsWith('changes') ? 'changes' : 'current'} : {}), ...(detail ? {reportId: decodeURIComponent(detail[1])} : {})};
      for (const [name, value] of url.searchParams) {
        if (url.searchParams.getAll(name).length !== 1) throw fail('参数重复');
        raw[name] = ['objectRefs', 'areaIds'].includes(name) ? JSON.parse(value) : ['limit', 'revision'].includes(name) ? Number(value) : value;
      }
      const tool = detail ? 'information_read' : information ? 'information_search' : 'situation_query';
      const query = normalizeContextQuery(tool, raw);
      if (detail && 'reportId' in query) {
        const item = reports.filter(r => r.reportId === query.reportId && (!('revision' in query) || r.revision === query.revision)).sort((a,b) => b.revision-a.revision)[0];
        if (!item) throw fail('报告不存在', 404);
        body = {systemId:'intel', asOf, item};
      } else if (information && !('mode' in query) && 'limit' in query) {
        const selected = reports.filter(r => (!query.reportId || r.reportId === query.reportId) && (!query.subjectId || r.subjectId === query.subjectId)
          && matches(r, query, `${r.title}\n${r.content}`) && (!query.from || !!r.observedAt && r.observedAt >= query.from) && (!query.to || !!r.observedAt && r.observedAt < query.to));
        body = page(selected.map(({content: _content, ...index}) => { void _content; return index; }), query, 'intel');
      } else if ('mode' in query) {
        const unknownRefs = (query.objectRefs ?? []).filter(r => !objects.some(o => key(o.ref) === key(r)));
        if (query.mode === 'current') body = {...page(objects.filter(o => matches({objectRefs:[o.ref],areaIds:o.areaIds},query,o.name)), query, 'situation'), unknownRefs, changeCursor: changeHead()};
        else {
          let offset = 0;
          if (query.after) {
            if (query.after === `${epoch}:change:0`) offset = 0;
            else if (query.after === changeHead()) offset = changes.length;
            else { const index = changes.findIndex(c => c.cursor === query.after); if(index < 0) throw fail('变化游标无效',409); offset=index+1; }
          }
          const selected = changes.slice(offset).filter(c => matches({objectRefs:[c.after.ref],areaIds:c.after.areaIds},query,c.after.name)
            && (!query.from || !!c.effectiveAt && c.effectiveAt >= query.from) && (!query.to || !!c.effectiveAt && c.effectiveAt < query.to));
          const result = page(selected,query,'situation'); body = {...result,unknownRefs,nextAfter:result.hasMore?null:changeHead()};
        }
      } else throw fail('参数无效');
      decodeContextResponse(tool, query, body);
    } catch (error) { status = error instanceof RequestError ? error.statusCode : 400; body = {error:{code:error instanceof RequestError ? error.code : 'INVALID_ARGUMENT',message:error instanceof Error ? error.message : '请求无效'}}; }
    requests.push({path:req.url ?? '/',status}); res.writeHead(status,{'content-type':'application/json'}); res.end(JSON.stringify(body));
  });
  return {apply, requests, snapshot: () => structuredClone({objects,reports,asOf,generation}),
    async listen() { await new Promise<void>((resolve,reject) => { server.once('error',reject);server.listen(0,'127.0.0.1',() => {server.removeListener('error',reject);resolve();}); });return `http://127.0.0.1:${(server.address() as AddressInfo).port}`; },
    async close() { if(server.listening) await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
