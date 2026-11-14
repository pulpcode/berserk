import { useCallback, useEffect, useRef, useState } from 'react';
import type { Interaction, InteractionResponse } from '../contracts/index';
import type { ExpertDraft, ExpertTrialRecord, ExpertValidation } from '../contracts/capability-management';
import { useApi } from './api';
import type { ExpertTrialRunView as TrialRunView } from '../contracts/capability-trials';
import { ChatPresentation, type ProcessChoices } from './ChatPresentation';
import type { InteractionSubmission } from './InteractionCard';
import { sessionAction } from './session-action';


const statusLabel: Record<ExpertTrialRecord['status'], string> = { prepared: '准备中', running: '试用中', succeeded: '执行成功，待管理员核对', failed: '执行失败', cancelled: '已取消', interrupted: '已中断' };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '试用操作未完成，请查询当前状态。';

export function ExpertTrial({ expertId, draft, validation, disabled, trials, changed }: { expertId: string; draft: ExpertDraft; validation?: ExpertValidation; disabled: boolean; trials: ExpertTrialRecord[]; changed: () => void }) {
  const { api, storageKey } = useApi();
  const [input, setInput] = useState('');
  const [fileName, setFileName] = useState('sample.csv');
  const [fileContent, setFileContent] = useState('');
  const [view, setView] = useState<TrialRunView>();
  const [selected, setSelected] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [conclusion, setConclusion] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submissions, setSubmissions] = useState<Record<string, InteractionSubmission>>({});
  const choices = useRef<ProcessChoices>(new Map());
  const root = `/api/admin/capabilities/experts/${encodeURIComponent(expertId)}/trials`;
  const url = `${root}/${encodeURIComponent(selected)}`;
  const current = view?.trial.trialId === selected ? view : undefined;
  const active = current?.trial.status === 'running' || current?.trial.status === 'prepared';
  const read = useCallback(async () => {
    if (!selected) return;
    try { const value = await api<TrialRunView>(url); setView(prior => !prior || prior.trial.trialId === selected ? value : prior); setError(''); }
    catch (error) { setError(errorMessage(error)); }
  }, [api, selected, url]);
  useEffect(() => {
    if (!selected) return;
    let valid = true;
    api<TrialRunView>(url).then(value => { if (valid) { setView(value); setError(''); } }).catch(error => { if (valid) setError(errorMessage(error)); });
    return () => { valid = false; };
  }, [api, selected, url]);
  useEffect(() => {
    if (!active) return;
    let live = true; let inFlight = false;
    const timer = setInterval(() => {
      if (!live || inFlight) return;
      inFlight = true;
      api<TrialRunView>(url).then(value => { if (live) { setView(value); setError(''); } }).catch(error => { if (live) setError(errorMessage(error)); }).finally(() => { inFlight = false; });
    }, 1400);
    return () => { live = false; clearInterval(timer); };
  }, [api, active, url]);
  async function start() {
    if (!validation || working || !input.trim()) return;
    const body = { expectedDraftRevision: draft.draftRevision, validationId: validation.validationId, input, ...(fileContent ? { files: [{ name: fileName, content: fileContent }] } : {}) };
    const action = sessionAction(storageKey(`expert-trial:${expertId}`), body);
    setWorking(true); setError('');
    try { const result = await api<TrialRunView>(root, { ...body, clientActionId: action.id }); action.complete(); setView(result); setSelected(result.trial.trialId); setConfirmed(false); setConclusion(''); changed(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setWorking(false); }
  }
  async function cancel() {
    setWorking(true); setError('');
    try { setView(await api<TrialRunView>(`${url}/cancel`, {})); changed(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setWorking(false); }
  }
  async function confirm(approved: boolean) {
    const body = { approved, reason: conclusion };
    const action = sessionAction(storageKey(`trial-confirm:${selected}`), body);
    setWorking(true); setError('');
    try { await api(`${url}/confirm`, { ...body, clientActionId: action.id }); action.complete(); await read(); changed(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setWorking(false); }
  }
  async function respond(item: Interaction, response: InteractionResponse) {
    const id = item.interactionId;
    setSubmissions(previous => ({ ...previous, [id]: { busy: true } }));
    try { await api(`${url}/interactions/${encodeURIComponent(id)}`, response); setSubmissions(previous => ({ ...previous, [id]: {} })); await read(); }
    catch (error) { setSubmissions(previous => ({ ...previous, [id]: { error: errorMessage(error), needsQuery: true } })); }
  }
  const snapshot = current?.snapshot;
  return <section className="expert-trial"><h4>隔离试用</h4><p>仅使用明确提供的合成或脱敏资料，不连接正式任务。点击“开始试用”后会产生模型调用。</p>
    <label>代表性试用任务<textarea aria-label="代表性试用任务" rows={4} value={input} disabled={working || active} onChange={event => setInput(event.target.value)} placeholder="描述试用目标、预期产物及应核对的条件" /></label>
    <details className="trial-synthetic-file"><summary>添加合成文本文件（可选）</summary><label>文件名<input aria-label="文件名" value={fileName} disabled={working || active} onChange={event => setFileName(event.target.value)} maxLength={120} /></label><label>合成文本内容<textarea aria-label="合成文本内容" rows={4} value={fileContent} maxLength={65536} disabled={working || active} onChange={event => setFileContent(event.target.value)} /></label></details>
    <button type="button" disabled={disabled || working || active || !input.trim() || Boolean(fileContent && !fileName.trim())} onClick={() => void start()}>{working && !selected ? '准备试用…' : '开始试用'}</button>
    {trials.length > 0 && <label>试用记录<select aria-label="试用记录" value={selected} onChange={event => { setSelected(event.target.value); setView(undefined); setConfirmed(false); }}><option value="">选择一条试用记录</option>{trials.map(trial => <option key={trial.trialId} value={trial.trialId}>{new Date(trial.createdAt).toLocaleString()} · {trial.confirmedAt ? '试用已确认' : statusLabel[trial.status]}</option>)}</select></label>}
    {error && <div className="resource-error" role="alert"><p>{error}</p>{selected && <button type="button" onClick={() => void read()}>查询试用状态</button>}</div>}
    {current && <div className="trial-report"><h4>{current.trial.confirmedAt ? '试用已确认' : statusLabel[current.trial.status]}</h4><p className="resource-help">来源：合成测试资料；正式业务写入关闭。</p>{current.trial.draftDigest !== draft.draftDigest && <p className="resource-error" role="status">此记录属于旧草稿，仅供查看，不能用于发布当前配置。</p>}{active && <button type="button" disabled={working} onClick={() => void cancel()}>停止试用</button>}
      {snapshot && <div className="trial-conversation"><ChatPresentation snapshot={{ ...snapshot, fileOutputs: [] }} active={snapshot.active} busy={Boolean(snapshot.active)} choices={choices.current} canAutoCollapse={() => false} submissions={submissions} respond={respond} query={async () => { await read(); }} /></div>}
      {!!snapshot?.fileOutputs?.length && <section><h5>试用交付文件</h5><ul>{snapshot.fileOutputs.map(file => <li key={file.downloadId}><a href={`${url}/downloads/${encodeURIComponent(file.downloadId)}`} download={file.name}>{file.name}</a></li>)}</ul></section>}
      {current.trial.evidence && <><h5>执行报告</h5><p>{current.trial.evidence.summary}</p><dl><dt>模型</dt><dd>{current.trial.evidence.model}</dd><dt>本次工具范围</dt><dd>{current.trial.evidence.tools.join('、') || '无工具调用'}</dd><dt>文件执行环境</dt><dd>{current.trial.evidence.fileEnvironmentVerified ? '已验证' : '未验证或不适用'}</dd></dl>{current.trial.evidence.unverified.length > 0 && <><h5>未验证项目</h5><ul>{current.trial.evidence.unverified.map(item => <li key={item}>{item}</li>)}</ul></>}</>}
      {current.trial.confirmedAt ? <p role="status">管理员已确认本次试用。发布时仍会核对当前草稿与依赖。</p> : current.trial.status === 'succeeded' && current.trial.draftDigest === draft.draftDigest && <div className="trial-confirmation"><label>核对结论<textarea aria-label="核对结论" value={conclusion} rows={3} onChange={event => setConclusion(event.target.value)} /></label><label className="management-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>我已检查代表性任务结果、实际工具和未验证项目。</span></label><div className="management-actions"><button type="button" disabled={working || !conclusion.trim()} onClick={() => void confirm(false)}>记录未通过</button><button type="button" disabled={working || !confirmed || !conclusion.trim()} onClick={() => void confirm(true)}>确认试用通过</button></div></div>}
    </div>}
  </section>;
}
