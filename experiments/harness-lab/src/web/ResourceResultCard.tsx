import { useLayoutEffect, useRef, useState } from 'react';
import type { PublicMessage, SessionSnapshot } from '../contracts/index';
import { resourceResultValid, type ResourceResult } from '../contracts/resource-results';
import { useApi } from './api';
import { availabilityLabels, resourceRelationLabels } from './annotations/ResourceFields';
import { ResourceResultDetails, resourceResultPageSize } from './ResourceResultDetails';
import './resource-result.css';

export function resourceResultCandidate(messages: readonly PublicMessage[], resultRef: string, sessionId: string, requestId?: string) {
  const matches = messages.filter(message => message.role === 'tool' && !message.isError && !message.resultMissing
    && message.toolName === 'task_resource_query' && message.resourceResult?.resultRef === resultRef
    && message.resourceResult.owner?.sessionId === sessionId);
  return (matches.find(message => message.requestId === requestId) ?? matches[0])?.resourceResult;
}

type ReadView = { result?: ResourceResult; page: number; busy: boolean; error?: string };

export function useAuthorizedResourceResult(origin?: ResourceResult) {
  const { api } = useApi();
  const request = useRef(0);
  const key = origin && JSON.stringify([origin.owner.sessionId, origin.resultRef]);
  const [view, setView] = useState<(ReadView & { key: string; api: typeof api })>();
  const shown: ReadView = view && view.key === key && view.api === api
    ? view : { result: origin, page: 0, busy: false };

  useLayoutEffect(() => () => { request.current++; }, [api, key]);

  async function readPage(page: number) {
    if (!origin || !key) return;
    const generation = ++request.current;
    const sessionId = origin.owner.sessionId;
    // Recheck the exact fixed result on every explicit read.
    setView({ key, api, result: shown.result, page: shown.page, busy: true });
    try {
      const snapshot = await api<SessionSnapshot>(`/api/sessions/${encodeURIComponent(sessionId)}`);
      if (generation !== request.current) return;
      const current = snapshot.id === sessionId ? resourceResultCandidate(snapshot.messages, origin.resultRef, sessionId) : undefined;
      if (!resourceResultValid(current)) throw new Error('此结果已不可读取或不再获准展示。');
      const lastPage = Math.max(0, Math.ceil(current.items.length / resourceResultPageSize) - 1);
      setView({ key, api, result: current, page: Math.max(0, Math.min(page, lastPage)), busy: false });
    } catch (error) {
      if (generation !== request.current) return;
      setView({ key, api, page: 0, busy: false, error: error instanceof Error ? error.message : '无法读取结果。' });
    }
  }

  return { result: shown.result, page: shown.page, busy: shown.busy, error: shown.error, readPage };
}

export function ResourceResultCard({ result }: { result: ResourceResult }) {
  const view = useAuthorizedResourceResult(result);
  const data = view.busy ? undefined : view.result;
  const title = result.delivery ? '读取已有资源结果' : result.parameters.operation === 'summarize' ? '资源统计结果' : '资源查询结果';

  return <section className="resource-result-card" aria-label="资源查询结果">
    <header>
      <strong>{title}</strong>
      <button type="button" disabled={view.busy} onClick={() => void view.readPage(view.page)}>重新读取此结果</button>
    </header>
    {view.busy && <p role="status">正在核对结果访问权限…</p>}
    {view.error && <p role="alert">{view.error}</p>}
    {data && <>
      <p className="resource-help">
        固定结果 · {data.schemaVersion === 4 ? '场景判断时间' : '统计时间'} {data.statisticsScope.at}。
        {data.schemaVersion === 4 && `实例 ${data.snapshotClock?.instanceId} · 实际生成时间 ${data.createdAt}。`}
        重新读取不会刷新来源或生成新结果。
      </p>
      <dl className="resource-statistics">
        <dt>统计范围内记录</dt><dd>{data.summary.recordCount} 条</dd>
        <dt>统计范围内条目</dt><dd>{data.summary.itemCount} 项</dd>
        <dt>实体数量</dt><dd>{data.summary.entityCount === null
          ? `未知（已识别 ${data.summary.knownEntityCount} 个实体）` : `${data.summary.entityCount} 个`}</dd>
        <dt>统计范围</dt><dd>
          {resourceRelationLabels[data.statisticsScope.relation]} · {availabilityLabels[data.statisticsScope.availability]}
          {data.parameters.operation === 'summarize' && data.parameters.spatialResultRef && ` · 空间位置：${data.parameters.position
            ? { interior: '范围内部', boundary: '范围边界', exterior: '范围外部' }[data.parameters.position] : '按所选空间结果集合统计'}`}
        </dd>
      </dl>
      <ResourceResultDetails result={data} page={view.page} busy={view.busy} onPage={view.readPage} />
    </>}
  </section>;
}
