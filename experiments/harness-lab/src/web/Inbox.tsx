import { useEffect, useState } from 'react';
import { ArrowLeft, Inbox as InboxIcon, RefreshCw } from 'lucide-react';
import type { Identity, TaskSpace } from '../contracts/access';
import type { BackgroundAction, BackgroundPage, InboxDetail, InboxItem } from '../contracts/background';
import type { Workspace } from '../contracts/index';
import { useApi } from './api';
import { ContextEvidence } from './ContextEvidence';
import { InformationContinuation } from './InformationContinuation';
import { TaskAssociations } from './TaskAssociations';
import { AnalysisHistory, InformationFiles, InformationPagination, InformationText, informationTime, useInformationQuery } from './information-ui';

export function Inbox({ visible, identity, tasks, workspaces, seats, prepared, openSession, savedTask, openTask }: { visible: boolean; identity: Identity; tasks: TaskSpace[]; workspaces: Workspace[]; seats: Array<{ id: string; name: string }>; prepared: (action: BackgroundAction, current: () => boolean) => Promise<void>; openSession: (id: string) => void; savedTask: (task: TaskSpace) => void; openTask: (id: string) => void }) {
  const { domId } = useApi();
  const [selected, setSelected] = useState(() => location.pathname === '/inbox' ? new URLSearchParams(location.search).get('id') || '' : '');
  const [search, setSearch] = useState(''); const [offset, setOffset] = useState(0);
  const query = new URLSearchParams({ offset: String(offset), limit: '25', search });
  const list = useInformationQuery<BackgroundPage<InboxItem>>(`/api/inbox?${query}`, visible);
  const detail = useInformationQuery<InboxDetail>(selected ? `/api/inbox/${encodeURIComponent(selected)}` : undefined, visible);
  const value = detail.data;
  useEffect(() => {
    if (!visible) return;
    const url = `/inbox${selected ? `?id=${encodeURIComponent(selected)}` : ''}`;
    if (location.pathname + location.search !== url) history.replaceState(null, '', url);
    const pop = () => { if (location.pathname === '/inbox') setSelected(new URLSearchParams(location.search).get('id') || ''); };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, [visible, selected]);
  function select(id: string) { setSelected(id); history.pushState(null, '', `/inbox${id ? `?id=${encodeURIComponent(id)}` : ''}`); }
  return <section id={domId('information-inbox')} tabIndex={-1} className="information-inbox" hidden={!visible} aria-label="收到的信息">
    <header className="information-heading"><div><h1>收到的信息</h1><p>查看处理结果，围绕结论提问、核实或开展后续工作。</p></div><button onClick={() => { list.refresh(); detail.refresh(); }}><RefreshCw size={16} aria-hidden="true" />刷新收件</button></header>
    <div className="information-toolbar"><label>搜索信息<input type="search" placeholder="标题或来源" value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} /></label></div>
    {(list.error || detail.error) && <p className="resource-error" role="alert">{list.error || detail.error}</p>}
    <div className="information-split"><div className="information-list"><ul>{list.data?.items.map(item => <li key={item.delivery.id}><button aria-current={selected === item.delivery.id ? 'true' : undefined} onClick={() => select(item.delivery.id)}><strong>{item.event.title}</strong><span>{item.sourceName || item.event.sourceId} · 已送达</span><small>{informationTime(item.delivery.deliveredAt)}</small></button></li>)}</ul>{list.data && !list.data.items.length && <p className="information-empty"><InboxIcon size={24} aria-hidden="true" />暂时没有收到的信息。</p>}<InformationPagination page={list.data} change={setOffset} /></div>
      <div className="information-detail">{!selected ? <p className="information-empty">选择一条信息查看原文与结果。</p> : !value ? !detail.error && <p role="status">正在读取信息…</p> : <>
        <button className="information-back" onClick={() => select('')}><ArrowLeft size={15} aria-hidden="true" />返回列表</button><header><h2>{value.event.title}</h2><p>{value.sourceName || value.event.sourceId} · {informationTime(value.delivery.deliveredAt)}</p></header>
        <section><h3>处理结果</h3>{value.profileName && <p className="resource-help">处理方案：{value.profileName}</p>}<InformationText>{value.resultText || '此次处理没有文字答复。'}</InformationText><InformationFiles files={value.resultFiles} base={`/api/inbox/${encodeURIComponent(selected)}/files`} /><ContextEvidence messages={value.queryMessages}/></section>
        <details className="information-original"><summary>查看原文与附件</summary><InformationText>{value.text}</InformationText><InformationFiles files={value.event.files} base={`/api/inbox/${encodeURIComponent(selected)}/files`} /></details>
        <TaskAssociations key={`links:${selected}`} eventId={value.event.id} jobId={value.job.id} visible={visible} identity={identity} tasks={tasks} savedTask={savedTask} openTask={openTask} changed={detail.refresh} />
        <InformationContinuation key={selected} scope={`inbox:${selected}`} visible={visible} base={`/api/inbox/${encodeURIComponent(selected)}`} tasks={tasks} workspaces={workspaces} files={value.event.files} resultFiles={value.resultFiles} preferredTaskIds={value.taskLinks?.links.filter(link => link.mode !== 'exclude').map(link => link.task.id)} prepared={prepared} openSession={openSession} changed={() => { detail.refresh(); list.refresh(); }} />
        <AnalysisHistory items={value.analyses} seats={seats} openSession={openSession} />
      </>}</div></div>
  </section>;
}
