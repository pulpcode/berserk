import { useEffect, useState } from 'react';
import { ArrowLeft, FileText, RefreshCw } from 'lucide-react';
import type { Identity, TaskSpace } from '../contracts/access';
import type { BackgroundAction } from '../contracts/background';
import type { TaskInformationDetail, TaskInformationPage } from '../contracts/task-information';
import type { Workspace } from '../contracts/index';
import { useApi } from './api';
import { ContextEvidence } from './ContextEvidence';
import { InformationContinuation } from './InformationContinuation';
import { TaskAssociations } from './TaskAssociations';
import { AnalysisHistory, InformationFiles, InformationPagination, InformationText, informationTime, useInformationQuery } from './information-ui';

function readSelection() { const params = new URLSearchParams(location.search); return { eventId: params.get('eventId') || '', jobId: params.get('jobId') || '' }; }
export function TaskInformation({ taskId, visible, identity, tasks, workspaces, seats, prepared, openSession, savedTask, openTask }: { taskId: string; visible: boolean; identity: Identity; tasks: TaskSpace[]; workspaces: Workspace[]; seats: Array<{id:string;name:string}>; prepared: (action: BackgroundAction, current: () => boolean) => Promise<void>; openSession: (id: string) => void; savedTask: (task: TaskSpace) => void; openTask: (id: string) => void }) {
  const { domId } = useApi();
  const [selection, setSelection] = useState(readSelection); const [search, setSearch] = useState(''); const [sourceId, setSourceId] = useState(''); const [offset, setOffset] = useState(0);
  const base = `/api/tasks/${encodeURIComponent(taskId)}/information`;
  const query = new URLSearchParams({ offset: String(offset), limit: '25', ...(search ? { query: search } : {}), ...(sourceId ? { sourceId } : {}) });
  const list = useInformationQuery<TaskInformationPage>(`${base}?${query}`, visible);
  const detailBase = selection.eventId ? `${base}/${encodeURIComponent(selection.eventId)}` : '';
  const detail = useInformationQuery<TaskInformationDetail>(detailBase && selection.jobId ? `${detailBase}?jobId=${encodeURIComponent(selection.jobId)}` : undefined, visible);
  const task = tasks.find(item => item.id === taskId); const value = detail.error ? undefined : detail.data;
  function select(eventId: string, jobId = '') {
    setSelection({ eventId, jobId });
    history.pushState(null, '', `/tasks/${encodeURIComponent(taskId)}/information${eventId ? `?${new URLSearchParams({ eventId, jobId })}` : ''}`);
  }
  useEffect(() => {
    const pop = () => { if (location.pathname === `/tasks/${encodeURIComponent(taskId)}/information`) setSelection(readSelection()); };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, [taskId]);
  const sourceChoices = new Map(list.data?.sources?.map(source => [source.id, source.name]) ?? list.data?.items.map(item => [item.sourceId, item.sourceName || item.sourceId]));
  if (sourceId && !sourceChoices.has(sourceId)) sourceChoices.set(sourceId, sourceId);
  return <section id={domId('task-information')} className="information-inbox task-information" hidden={!visible} tabIndex={-1} aria-label="任务相关信息">
    <header className="information-heading"><div><h1>{task?.title || '任务'} · 相关信息</h1><p>查看关联依据，结合本任务继续提问或开展工作。{task?.state === 'archived' ? '此任务已归档。' : ''}</p></div><button onClick={() => { list.refresh(); detail.refresh(); }}><RefreshCw size={16} aria-hidden="true" />刷新相关信息</button></header>
    <div className="information-toolbar"><label>搜索信息<input type="search" placeholder="标题或关联理由" value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} /></label><label>来源<select value={sourceId} onChange={event => { setSourceId(event.target.value); setOffset(0); }}><option value="">全部来源</option>{[...sourceChoices].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
    {list.error && <p className="resource-error" role="alert">{list.error}<button onClick={list.refresh}>重新读取列表</button></p>}
    <div className="information-split"><div className="information-list"><ul>{list.data?.items.map(item => <li key={item.eventId}><button aria-current={selection.eventId === item.eventId ? 'true' : undefined} onClick={() => select(item.eventId, item.jobId)}><strong>{item.title}</strong><span>{item.sourceName || item.sourceId} · {item.mode === 'include' ? '人工保留' : '自动关联'}</span><span>{item.reason}</span><small>接收：{informationTime(item.receivedAt)}</small>{item.occurredAt && <small>业务时间：{informationTime(item.occurredAt)}</small>}<small>分析：{informationTime(item.analysisAt)}</small>{item.taskChanged && <small>任务说明已更新，关联依据为旧版本</small>}</button></li>)}</ul>{!list.data && !list.error && <p role="status">正在读取相关信息…</p>}{list.data && !list.data.items.length && <p className="information-empty"><FileText size={24} aria-hidden="true" />当前没有符合条件的获准关联信息。</p>}<InformationPagination page={list.data} change={setOffset} /></div>
      <div className="information-detail">{!selection.eventId ? <p className="information-empty">选择一条信息查看原文、分析和关联依据。</p> : <>
        <button className="information-back" onClick={() => select('')}><ArrowLeft size={15} aria-hidden="true" />返回列表</button>
        {detail.error && <p className="resource-error" role="alert">{detail.error} 当前详情不能继续处理。<button onClick={() => { detail.refresh(); list.refresh(); }}>重新读取</button></p>}
        {!value ? !detail.error && <p role="status">正在读取信息…</p> : <>
          <header><h2>{value.title}</h2><p>{value.sourceName || value.sourceId} · 分析于 {informationTime(value.analysisAt)}</p><p>{value.reason}</p>{value.taskChanged && <p className="resource-help">任务说明已更新，关联依据为旧版本。</p>}</header>
          <section><h3>处理结果</h3><InformationText>{value.resultText || '此次处理没有文字答复。'}</InformationText><InformationFiles files={value.resultFiles} base={`${detailBase}/files`} query={new URLSearchParams({ jobId: value.jobId }).toString()} /><ContextEvidence messages={value.queryMessages} /></section>
          <details className="information-original"><summary>查看原文与附件</summary><InformationText>{value.text}</InformationText><InformationFiles files={value.event.files} base={`${detailBase}/files`} query={new URLSearchParams({ jobId: value.jobId }).toString()} /></details>
          <TaskAssociations key={`links:${value.eventId}:${value.jobId}`} eventId={value.eventId} jobId={value.jobId} visible={visible} identity={identity} tasks={tasks} savedTask={savedTask} openTask={openTask} changed={() => { list.refresh(); detail.refresh(); }} />
          <InformationContinuation key={`${taskId}:${value.eventId}:${value.jobId}`} scope={`task:${taskId}:${value.eventId}:${value.jobId}`} visible={visible} base={detailBase} jobId={value.jobId} fixedTaskId={taskId} tasks={tasks} workspaces={workspaces} files={value.event.files} resultFiles={value.resultFiles} prepared={prepared} openSession={openSession} changed={() => { list.refresh(); detail.refresh(); }} />
          {value.analyses && <AnalysisHistory items={value.analyses} seats={seats} openSession={openSession} />}
        </>}
      </>}</div>
    </div>
  </section>;
}
