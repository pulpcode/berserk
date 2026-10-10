import { useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { BackgroundDeliveryReview, BackgroundPage, DeliveryReviewDecisionInput, DeliveryReviewDetail, DeliveryReviewSummary, InformationCapabilities, InformationJobDetail } from '../contracts/background';
import { useApi } from './api';
import { ContextEvidence } from './ContextEvidence';
import { InformationDrawer } from './InformationJobs';
import { deliveryLabels, informationError, InformationFiles, InformationPagination, InformationText, informationTime, useInformationQuery } from './information-ui';

export const reviewLabels = { pending: '待批准', approved: '已批准', declined: '不予补充' };
export function DeliveryReviewStatus({ job, open }: { job: InformationJobDetail; open: (id: string) => void }) {
  if (!job.deliveryReview && !job.recipientSuggestion && !job.recipientSuggestionError) return null;
  return <section><h3>补充投递</h3>{job.deliveryReview ? <p><span className="information-tag">{reviewLabels[job.deliveryReview.status]}</span> <button onClick={() => open(job.deliveryReview!.id)}>查看补充投递</button></p> : <p className="resource-help">{job.recipientSuggestionError || job.recipientSuggestion?.noAdditionalReason || '建议尚未形成待批准事项。'}</p>}</section>;
}

export function DeliveryReviews({ visible, selectedId, status, offset, capabilities, select, filter, page, changed }: {
  visible: boolean; selectedId: string; status: string; offset: number; capabilities: InformationCapabilities;
  select: (id: string) => void; filter: (status: string) => void; page: (offset: number) => void; changed: () => void;
}) {
  const query = new URLSearchParams({ offset: String(offset), limit: '25', ...(status ? {status} : {}) });
  const list = useInformationQuery<BackgroundPage<DeliveryReviewSummary>>(`/api/information/delivery-reviews?${query}`, visible);
  const detail = useInformationQuery<DeliveryReviewDetail>(selectedId ? `/api/information/delivery-reviews/${encodeURIComponent(selectedId)}` : undefined, visible);
  const seatName = (id: string) => capabilities.seats.find(seat => seat.id === id)?.name || id;
  function refresh() { list.refresh(); detail.refresh(); changed(); }
  return <section className="information-center-body" hidden={!visible} aria-label="补充投递审批">
    <div inert={Boolean(selectedId) || undefined}>
      <div className="information-toolbar"><label>审批状态<select value={status} onChange={event => filter(event.target.value)}><option value="pending">待批准</option><option value="approved">已批准</option><option value="declined">不予补充</option><option value="">全部</option></select></label><button onClick={refresh}><RefreshCw size={16} aria-hidden="true" />刷新审批</button></div>
      {list.error && <p className="resource-error" role="alert">{list.error}</p>}
      <div className="information-table-scroll"><table className="information-table"><thead><tr><th scope="col">信息</th><th scope="col">固定接收席位</th><th scope="col">建议补充席位</th><th scope="col">审批状态</th><th scope="col">时间</th></tr></thead><tbody>{list.data?.items.map(item => <tr key={item.id}><td><button className="information-row-link" data-information-id={item.id} onClick={() => select(item.id)}>{item.title}</button><small>{item.sourceName}</small></td><td>{item.fixedRecipientSeatIds.map(seatName).join('、')}</td><td>{item.suggestion.recipients.map(seat => seatName(seat.seatId)).join('、')}</td><td>{reviewLabels[item.status]}</td><td>{informationTime(item.createdAt)}</td></tr>)}</tbody></table></div>
      {list.data && !list.data.items.length && <p className="information-empty">没有符合条件的审批记录。</p>}
      <InformationPagination page={list.data} change={page} />
    </div>
    {visible && selectedId && <InformationDrawer key={selectedId} title="补充投递审批" selectedId={selectedId} close={() => select('')}>
      {detail.error && <p className="resource-error" role="alert">{detail.error}<button onClick={detail.refresh}>重新读取详情</button></p>}
      {detail.data ? <DeliveryReviewForm key={selectedId} value={detail.data} seatName={seatName} refresh={refresh} /> : !detail.error && <p role="status">正在读取审批…</p>}
    </InformationDrawer>}
  </section>;
}

function DeliveryReviewForm({ value, seatName, refresh }: { value: DeliveryReviewDetail; seatName: (id: string) => string; refresh: () => void }) {
  const { api } = useApi();
  const [selected, setSelected] = useState(() => value.suggestion.recipients.map(item => item.seatId));
  const [reasons, setReasons] = useState<Record<string, string>>(() => Object.fromEntries(value.suggestion.recipients.map(item => [item.seatId, item.reason])));
  const [declineReason, setDeclineReason] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const lock = useRef(false); const actions = useRef(new Map<string, string>());
  const [submitted, setSubmitted] = useState<DeliveryReviewDecisionInput | undefined>(undefined);
  const matchesDecision = submitted?.decision === 'decline' ? value.status === 'declined' && value.reason === submitted.reason : submitted?.decision === 'approve' && value.status === 'approved' && JSON.stringify(value.recipients) === JSON.stringify(submitted.recipients);
  const mayEdit = value.canDecide && value.status === 'pending';
  const unavailable = selected.some(id => !value.candidates.find(candidate => candidate.id === id)?.available);
  async function decide(decision: 'approve' | 'decline') {
    if (lock.current || !mayEdit) return;
    if (decision === 'approve' && (!selected.length || unavailable || selected.some(id => !reasons[id]?.trim()))) { setError('请选择可投递的席位，并填写各席位的接收理由。'); return; }
    if (decision === 'decline' && !declineReason.trim()) { setError('请填写不予补充的原因。'); return; }
    const body = decision === 'approve' ? { decision, revision: value.revision, recipients: selected.map(seatId => ({seatId,reason:reasons[seatId].trim()})) } : { decision, revision: value.revision, reason: declineReason.trim() };
    const key = JSON.stringify(body); const clientActionId = actions.current.get(key) || crypto.randomUUID(); actions.current.set(key, clientActionId);
    setSubmitted({...body,clientActionId} as DeliveryReviewDecisionInput);
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await api<BackgroundDeliveryReview>(`/api/information/delivery-reviews/${encodeURIComponent(value.id)}/decision`, {...body,clientActionId} as DeliveryReviewDecisionInput);
      setNotice(decision === 'approve' ? '批准已保存，送达情况见下方记录。' : '已记录不予补充，固定投递保持原有结果。');
    } catch (reason) { setError(`${informationError(reason)} 你的编辑已保留，请核对最新决定后重试。`); }
    finally { lock.current = false; setBusy(false); refresh(); }
  }
  const job = value.jobDetail;
  return <>
    <header><h2>{value.title}</h2><p>{value.sourceName} · {informationTime(job.endedAt)} · 分析 {value.jobId.slice(0,8)}</p><span className="information-tag">{reviewLabels[value.status]}</span></header>
    <section><h3>固定接收席位</h3><p>{value.fixedRecipientSeatIds.map(seatName).join('、')}</p><p className="resource-help">固定投递不等待本次批准。</p></section>
    {job.text !== undefined && <section><h3>分析结果</h3><InformationText>{job.text || '此次处理没有文字答复。'}</InformationText><InformationFiles files={job.files || []} base={`/api/information/events/${encodeURIComponent(value.eventId)}/files`} /><ContextEvidence messages={job.snapshot?.messages} /></section>}
    {job.input && <details className="information-original"><summary>原信息与附件</summary><InformationText>{job.input.text}</InformationText><InformationFiles files={job.input.files} base={`/api/information/events/${encodeURIComponent(value.eventId)}/files`} /></details>}
    <section><h3>Agent 建议</h3><ul className="delivery-suggestions">{value.suggestion.recipients.map(item => <li key={item.seatId}><strong>{seatName(item.seatId)}</strong><p>{item.reason}</p></li>)}</ul></section>
    {value.status !== 'pending' && <section aria-label="最新审批决定"><h3>审批决定</h3><p>{seatName(value.reviewerSeatId)} · {reviewLabels[value.status]} · {informationTime(value.decidedAt)}</p>{value.recipients?.map(item => <p key={item.seatId}><strong>{seatName(item.seatId)}</strong>：{item.reason}</p>)}{value.reason && <p>{value.reason}</p>}</section>}
    {error && !matchesDecision && <p className="resource-error" role="alert">{error}<button onClick={refresh}>核对最新决定</button></p>}{notice && <p className="resource-success" role="status">{notice}</p>}{error && matchesDecision && <p className="resource-success" role="status">已核对：决定已保存，无需再次提交。</p>}
    {(mayEdit || (error && !matchesDecision)) && <section className="information-form delivery-review-form"><h3>{mayEdit ? '总体席决定' : '你的编辑（未提交）'}</h3><p className="resource-help">选择补充接收席位；批准只决定投递范围。</p>
      <fieldset disabled={busy || !mayEdit}><legend>补充接收席位</legend>{value.candidates.map(candidate => <div className="delivery-candidate" key={candidate.id}>
        <label className="information-check"><input type="checkbox" checked={selected.includes(candidate.id)} disabled={!candidate.available && !selected.includes(candidate.id)} onChange={event => setSelected(current => event.target.checked ? [...current,candidate.id] : current.filter(id => id !== candidate.id))} />{candidate.name}</label>
        <p className="resource-help">{candidate.responsibility}</p>{!candidate.available && <p className="resource-error">{candidate.unavailableReason || '当前不可投递，请取消选择。'}</p>}
        {selected.includes(candidate.id) && <label>{candidate.name}接收理由<textarea maxLength={1500} value={reasons[candidate.id] || ''} onChange={event => setReasons(current => ({...current,[candidate.id]:event.target.value}))} /></label>}
      </div>)}</fieldset>
      {mayEdit && <button className="primary-action" disabled={busy || !selected.length || unavailable || selected.some(id => !reasons[id]?.trim())} onClick={() => void decide('approve')}>{busy ? '提交中…' : '批准补充投递'}</button>}
      <details className="information-original"><summary>不予补充</summary><label>不予补充的原因<textarea maxLength={1500} value={declineReason} disabled={busy || !mayEdit} onChange={event => setDeclineReason(event.target.value)} /></label>{mayEdit && <button disabled={busy || !declineReason.trim()} onClick={() => void decide('decline')}>确认不予补充</button>}</details>
    </section>}
    {value.status === 'pending' && !value.canDecide && <p className="resource-help">待指定的总体席审批；当前账号无审批权限。</p>}
    <section><h3>送达情况</h3>{job.deliveries?.map(delivery => <div className="information-step" key={delivery.id}><strong>{seatName(delivery.recipientSeatId)}</strong><span>{delivery.reviewId ? '补充投递' : '固定投递'}</span><span>{deliveryLabels[delivery.status]}</span>{delivery.error && <p className="resource-error">{delivery.error.message}</p>}</div>)}{!job.deliveries?.length && <p className="resource-help">尚无投递记录。</p>}</section>
  </>;
}
