import { useState } from 'react';
import { ArrowLeft, ArrowUpRight, ChevronDown } from 'lucide-react';
import type { Identity } from '../contracts/access';
import type { ScenarioInstance, ScenarioInstanceDetail, ScenarioInstances, ScenarioMode } from '../contracts/scenarios';
import { LoadingIndicator } from './LoadingIndicator';
import { useInformationQuery } from './information-ui';

export const directorModes: Record<ScenarioMode, string> = {main_story: '主线演示（5 个事件）', source_replay: '完整事件演示（12 个事件）'};
export const directorTimestamp = (value: string) => new Date(value).toLocaleString('zh-CN', {hour12: false});
const notificationStates = {unsent: '尚未发送', unconfirmed: '接收未确认', accepted: '接收已确认'};
const operationNames = {create: '创建本轮', activate: '激活本轮', step: '应用事件', pause: '暂停', resume: '继续'};

export function directorInstanceStatus(instance: ScenarioInstance) {
  return instance.status === 'active' ? instance.paused ? '当前演示 · 已锁定' : '当前演示' : instance.status === 'prepared' ? '准备中' : '已结束';
}

/** Human-readable identity; technical identifiers stay in the data disclosure. */
export function DirectorRunIdentity({instance}: {instance: ScenarioInstance}) {
  return <div className="director-run-identity"><strong>{instance.name}</strong><span>{directorModes[instance.mode]}</span><time dateTime={instance.createdAt} title={instance.createdAt}>{directorTimestamp(instance.createdAt)}</time><span className="director-status">{directorInstanceStatus(instance)}</span></div>;
}

/** This component only reads snapshots. Its selection never becomes a control target. */
export function DirectorRecords({initialId, page, pageError, retry, activeId, identity, hasPrevious, previous, next}: {
  initialId?: string; page?: ScenarioInstances; pageError: string; retry: () => void; activeId?: string | null; identity: Identity;
  hasPrevious: boolean; previous: () => void; next: () => void;
}) {
  const [selectedId, setSelectedId] = useState(initialId);
  const [tab, setTab] = useState<'events' | 'operations' | 'overview'>('events');
  const detail = useInformationQuery<ScenarioInstanceDetail>(selectedId ? `/api/simulation/instances/${encodeURIComponent(selectedId)}` : undefined, true, 10000);
  if (!selectedId) return <section aria-label="历次演示">
    {pageError && <p className="director-warning" role="alert">{pageError}<button onClick={retry}>重新读取</button></p>}
    {!page && !pageError && <LoadingIndicator label="正在读取演示记录…"/>}
    {page?.items.length ? <ul className="director-run-list">{page.items.map(item => <li key={item.instanceId}>
      <button aria-current={item.instanceId === activeId ? 'true' : undefined} onClick={() => {setSelectedId(item.instanceId); setTab('events');}}>
        <span><strong>{item.name}</strong><small>{directorModes[item.mode]} · <time dateTime={item.createdAt} title={item.createdAt}>{directorTimestamp(item.createdAt)}</time></small></span>
        <span className="director-status">{directorInstanceStatus(item)}</span>
      </button>
    </li>)}</ul> : page && <p className="director-scope">暂无演示记录</p>}
    {(hasPrevious || page?.hasMore) && <div className="director-buttons director-record-pagination">
      <button disabled={!hasPrevious} onClick={previous}>较新记录</button><button disabled={!page?.nextCursor} onClick={next}>更早记录</button>
    </div>}
  </section>;
  return <section aria-label="演示详情" className="director-record-detail">
    <div className="director-record-heading"><button className="director-record-back" onClick={() => setSelectedId(undefined)}><ArrowLeft size={14} aria-hidden="true"/>返回列表</button><span className="director-scope">只读</span></div>
    {detail.error && <p className="director-warning" role="alert">{detail.error}<button onClick={detail.refresh}>重新读取</button></p>}
    {!detail.data && !detail.error && <LoadingIndicator label="正在读取演示详情…"/>}
    {detail.data && <>
      <DirectorRunIdentity instance={detail.data.instance}/>
      <div className="director-record-tabs" aria-label="记录分类">
        <button aria-pressed={tab === 'events'} onClick={() => setTab('events')}>事件记录</button>
        <button aria-pressed={tab === 'operations'} onClick={() => setTab('operations')}>操作记录</button>
        <button aria-pressed={tab === 'overview'} onClick={() => setTab('overview')}>数据概况</button>
      </div>
      {tab === 'events' ? <RecordedEvents detail={detail.data}/> : tab === 'operations' ? <RecordedOperations detail={detail.data} identity={identity}/> : <RecordedOverview detail={detail.data}/>}
    </>}
  </section>;
}

function RecordedEvents({detail}: {detail: ScenarioInstanceDetail}) {
  const steps = detail.instance.mode === 'main_story' ? detail.steps.slice(0, 5) : detail.steps;
  return <section aria-label="事件记录"><p className="director-scope">场景时间 {detail.instance.businessNow.replace('T', ' ')} · {Math.min(detail.instance.stepIndex, steps.length)} / {steps.length} 事件已应用</p>
    <ol className="director-record-events">{steps.map((step, index) => {
      const actions = detail.actions.filter(action => action.stepId === step.id);
      const tasks = detail.taskDefinitions?.filter(task => step.taskCodes?.includes(task.code)) || [];
      const state = actions.length && actions.every(action => action.sendState === 'accepted') ? '已接收' : index < detail.instance.stepIndex ? '待接收' : '未发生';
      return <li key={step.id}><details><summary><time dateTime={step.businessTime}>{step.businessTime.slice(11, 16)}</time><strong>{step.title}</strong><span className="director-status">{state}</span><ChevronDown size={14} aria-hidden="true"/></summary>
        <div className="director-record-event-body"><p>{step.description}</p>
          {tasks.length > 0 && <p className="director-scope">场景任务 · {tasks.map(task => task.title).join('、')}</p>}
          {actions.length ? <ul className="director-notifications" aria-label="事件通知">{actions.map(action => <li key={action.id}>
            <div className="director-notification-heading"><strong>{action.notification.title}</strong><span className="director-status">{notificationStates[action.sendState]}</span></div>
            <p>{action.notification.text}</p>
            <small>观测 <time dateTime={action.notification.occurredAt}>{action.notification.occurredAt.replace('T', ' ')}</time> · 实际保存 <time dateTime={action.createdAt} title={action.createdAt}>{directorTimestamp(action.createdAt)}</time></small>
            {action.receipt && <a href={`/overview?tab=events&id=${encodeURIComponent(action.receipt.eventId)}`} target="_blank" rel="noreferrer">接收记录 <ArrowUpRight size={13} aria-hidden="true"/></a>}
          </li>)}</ul> : <span className="director-scope">{step.messageCount} 条通知 · 尚未生成</span>}
        </div>
      </details></li>;
    })}</ol>
  </section>;
}

function RecordedOperations({detail, identity}: {detail: ScenarioInstanceDetail; identity: Identity}) {
  return <section aria-label="操作记录"><p className="director-scope director-record-zone">{detail.operations.length >= 20 ? '最近20条 · ' : ''}实际时间 · {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>{detail.operations.length ? <table className="director-history"><thead><tr><th>操作</th><th>场景时间</th><th>实际时间</th><th>席位</th></tr></thead><tbody>{detail.operations.map(operation => <tr key={operation.id}><td>{operationNames[operation.kind]}</td><td><time dateTime={operation.businessNow}>{operation.businessNow.slice(11,16)}</time></td><td><time dateTime={operation.createdAt} title={operation.createdAt}>{directorTimestamp(operation.createdAt)}</time></td><td>{operation.actor.seatId === identity.seatId ? identity.seatName : operation.actor.seatId}</td></tr>)}</tbody></table> : <p className="director-scope">暂无操作</p>}</section>;
}

function RecordedOverview({detail}: {detail: ScenarioInstanceDetail}) {
  return <section aria-label="数据概况"><dl className="director-data-summary"><div><dt>来源对象</dt><dd>{detail.objects.length}</dd></div><div><dt>报告</dt><dd>{detail.reports.length}</dd></div></dl>
    <details className="director-instance-info"><summary>技术信息</summary><dl><dt>演示编号</dt><dd>{detail.instance.instanceId}</dd><dt>状态版本</dt><dd>{detail.instance.revision}</dd><dt>场景版本</dt><dd>{detail.instance.definitionVersion}</dd><dt>创建时间 · 本机时区</dt><dd><time dateTime={detail.instance.createdAt} title={detail.instance.createdAt}>{directorTimestamp(detail.instance.createdAt)}</time></dd></dl></details>
    <details className="director-instance-info"><summary>对象清单</summary><ul className="director-object-list">{detail.objects.map(object => <li key={`${object.ref.systemId}:${object.ref.objectType}:${object.ref.objectId}`}>{object.name}</li>)}</ul></details>
  </section>;
}
