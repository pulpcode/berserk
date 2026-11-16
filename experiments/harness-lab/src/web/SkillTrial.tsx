import { useEffect, useRef, useState } from 'react';
import type { ExpertTrialRunView } from '../contracts/capability-trials';
import type { Interaction, InteractionResponse } from '../contracts/index';
import { ChatPresentation, type ProcessChoices } from './ChatPresentation';
import type { InteractionSubmission } from './InteractionCard';
import { useApi } from './api';
import { sessionAction } from './session-action';

const label = { prepared: '准备中', running: '试用中', succeeded: '已完成', failed: '失败', cancelled: '已停止', interrupted: '已中断' };
const errorText = (error: unknown) => error instanceof Error ? error.message : '试用操作未完成，请查询当前记录。';

/** Optional skill trial; no successful trial or administrator approval feeds publish eligibility. */
export function SkillTrial({ skillId, draftRevision, packageDigest, revisions, disabled }: { skillId: string; draftRevision?: number; packageDigest?: string; revisions: Array<{ revisionId: string; releaseVersion: string }>; disabled: boolean }) {
  const { api, storageKey } = useApi();
  const [input, setInput] = useState('');
  const [target, setTarget] = useState(draftRevision ? 'draft' : revisions[0]?.revisionId || '');
  const [fileName, setFileName] = useState('sample.csv');
  const [fileContent, setFileContent] = useState('');
  const [records, setRecords] = useState<ExpertTrialRunView[]>([]);
  const [selected, setSelected] = useState('');
  const [view, setView] = useState<ExpertTrialRunView>();
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [submissions, setSubmissions] = useState<Record<string, InteractionSubmission>>({});
  const choices = useRef<ProcessChoices>(new Map());
  const root = `/api/admin/capabilities/skills/${encodeURIComponent(skillId)}/trials`;
  const current = view?.trial.trialId === selected ? view : undefined;
  const active = current?.trial.status === 'prepared' || current?.trial.status === 'running';
  const url = `${root}/${encodeURIComponent(selected)}`;
  useEffect(() => { let live = true; api<ExpertTrialRunView[]>(root).then(value => { if (live) setRecords(value); }).catch(error => { if (live) setError(errorText(error)); }); return () => { live = false; }; }, [api, root]);
  useEffect(() => { if (!selected) return; let live = true; api<ExpertTrialRunView>(url).then(value => { if (live) setView(value); }).catch(error => { if (live) setError(errorText(error)); }); return () => { live = false; }; }, [api, selected, url]);
  useEffect(() => { if (!active) return; let live = true; let pending = false; const timer = setInterval(() => { if (pending) return; pending = true; api<ExpertTrialRunView>(url).then(value => { if (live) { setView(value); setError(''); setRecords(old => [value, ...old.filter(item => item.trial.trialId !== value.trial.trialId)]); } }).catch(error => { if (live) setError(errorText(error)); }).finally(() => { pending = false; }); }, 1400); return () => { live = false; clearInterval(timer); }; }, [api, active, url]);
  async function start() {
    if (working || !input.trim()) return;
    const body = { ...(target === 'draft' ? { expectedDraftRevision: draftRevision } : { revisionId: target }), input, ...(fileContent ? { files: [{ name: fileName, content: fileContent }] } : {}) };
    const action = sessionAction(storageKey(`skill-trial:${skillId}`), { ...body, packageDigest: target === 'draft' ? packageDigest : target });
    setWorking(true); setError('');
    try { const value = await api<ExpertTrialRunView>(root, { ...body, clientActionId: action.id }); action.complete(); setView(value); setSelected(value.trial.trialId); setRecords(old => [value, ...old.filter(item => item.trial.trialId !== value.trial.trialId)]); }
    catch (error) { setError(errorText(error)); } finally { setWorking(false); }
  }
  async function read() { try { setView(await api<ExpertTrialRunView>(url)); setError(''); } catch (error) { setError(errorText(error)); } }
  async function cancel() { setWorking(true); try { setView(await api<ExpertTrialRunView>(`${url}/cancel`, {})); setError(''); } catch (error) { setError(errorText(error)); } finally { setWorking(false); } }
  async function respond(item: Interaction, response: InteractionResponse) { setSubmissions(old => ({ ...old, [item.interactionId]: { busy: true } })); try { await api(`${url}/interactions/${item.interactionId}`, response); setSubmissions(old => ({ ...old, [item.interactionId]: {} })); await read(); } catch (error) { setSubmissions(old => ({ ...old, [item.interactionId]: { error: errorText(error), needsQuery: true } })); } }
  async function upload(file?: File) { if (!file) return; try { if (file.size > 65536) throw new Error('试用文本附件不能超过64 KiB。'); const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); setFileName(file.name); setFileContent(content); setError(''); } catch (error) { setError(errorText(error)); } }
  return <section className="expert-trial"><h4>隔离试用（可选）</h4><p>仅在点击后调用模型。提供合成或脱敏资料；不主动探测正式业务环境。未试用不影响发布。</p><label>试用内容<select value={target} disabled={working || active} onChange={event => setTarget(event.target.value)}>{draftRevision && <option value="draft">当前已保存草稿</option>}{revisions.map(item => <option value={item.revisionId} key={item.revisionId}>已发布版本 {item.releaseVersion}</option>)}</select></label><label>试用目标<textarea aria-label="技能试用目标" rows={4} value={input} disabled={working || active} onChange={event => setInput(event.target.value)} /></label><details><summary>提供测试文本资料（可选）</summary><label>上传测试文本文件<input type="file" disabled={working || active} onChange={event => void upload(event.target.files?.[0])} /></label><label>文件名<input value={fileName} maxLength={255} disabled={working || active} onChange={event => setFileName(event.target.value)} /></label><label>文件内容<textarea rows={4} maxLength={65536} value={fileContent} disabled={working || active} onChange={event => setFileContent(event.target.value)} /></label></details><button type="button" disabled={working || active || disabled || !input.trim() || target === 'draft' && !draftRevision || Boolean(fileContent && !fileName.trim())} onClick={() => void start()}>开始技能试用</button>
    {records.length > 0 && <label>试用记录<select value={selected} onChange={event => { setSelected(event.target.value); setView(undefined); }}><option value="">选择历史记录</option>{records.map(item => <option key={item.trial.trialId} value={item.trial.trialId}>{new Date(item.trial.createdAt).toLocaleString()} · {label[item.trial.status]}</option>)}</select></label>}
    {error && <div className="resource-error" role="alert"><p>{error}</p>{selected && <button type="button" onClick={() => void read()}>查询试用状态</button>}</div>}
    {!current && <p>未选择试用记录。</p>}{current && <div className="trial-report"><h4>{label[current.trial.status]}</h4><p>来源：明确提供的测试资料；正式业务写入关闭。</p>{current.trial.draftDigest !== packageDigest && <p>此记录对应其他内容快照，仅表示该次实际执行。</p>}{active && <button type="button" disabled={working} onClick={() => void cancel()}>停止技能试用</button>}{current.snapshot && <ChatPresentation snapshot={{ ...current.snapshot, fileOutputs: [] }} active={current.snapshot.active} busy={Boolean(current.snapshot.active)} choices={choices.current} canAutoCollapse={() => false} submissions={submissions} respond={respond} query={read} />}{!!current.snapshot?.fileOutputs?.length && <section><h5>试用交付文件</h5><ul>{current.snapshot.fileOutputs.map(file => <li key={file.downloadId}><a href={`${url}/downloads/${file.downloadId}`} download={file.name}>{file.name}</a></li>)}</ul></section>}{current.trial.evidence && <><h5>实际执行报告</h5><p>{current.trial.evidence.summary}</p><p>本次工具：{current.trial.evidence.tools.join('、') || '未取得工具调用证据'}</p><ul>{current.trial.evidence.unverified.map(item => <li key={item}>{item}</li>)}</ul></>}</div>}
  </section>;
}
