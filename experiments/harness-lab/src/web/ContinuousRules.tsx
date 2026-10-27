import { useRef, useState } from 'react';
import type { InformationCapabilities } from '../contracts/background';
import type { ContinuousStream, ContinuousStreamInput } from '../contracts/continuous';
import { useApi } from './api';
import { informationError, informationTime, useInformationQuery } from './information-ui';
import { randomUUID } from './random-uuid';

type Editor = { base?: ContinuousStream; draft: ContinuousStreamInput; actionId: string; conflict: boolean; latest?: ContinuousStream };
function inputOf(stream: ContinuousStream): ContinuousStreamInput { const { name, sourceIds, profileId, recipientSeatIds, enabled, quietMs, maxWaitMs } = stream; return { name, sourceIds, profileId, recipientSeatIds, enabled, quietMs, maxWaitMs }; }
export function ContinuousRules({ visible, capabilities }: { visible: boolean; capabilities: InformationCapabilities }) {
  const { api } = useApi();
  const streams = useInformationQuery<{ items: ContinuousStream[] }>('/api/continuous/streams', visible);
  const [editor, setEditor] = useState<Editor>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const lock = useRef(false); const controls = useRef(new Map<string, string>());
  const managed = capabilities.sources.filter(source => source.permission === 'manage');
  const selected = managed.filter(source => editor?.draft.sourceIds.includes(source.sourceId));
  const profiles = capabilities.profiles.filter(profile => selected.length > 0 && selected.every(source => source.allowedProfileIds.includes(profile.id)));
  const recipients = capabilities.seats.filter(seat => selected.length > 0 && selected.every(source => source.allowedRecipientSeatIds.includes(seat.id)));
  const profile = profiles.find(item => item.id === editor?.draft.profileId);
  const readOnly = editor?.base?.isCurrent === false || editor?.base?.state === 'retired';
  const valid = editor && !readOnly && editor.draft.name.trim() && selected.length && selected.length === editor.draft.sourceIds.length && profile?.contextScope && !profile.configurationError && editor.draft.recipientSeatIds.length && editor.draft.recipientSeatIds.every(id => recipients.some(seat => seat.id === id));
  function open(stream?: ContinuousStream) {
    if (editor && !window.confirm('切换配置会放弃当前未保存的编辑，是否继续？')) return;
    setEditor({ base: stream, draft: stream ? inputOf(stream) : { name: '', sourceIds: [], profileId: '', recipientSeatIds: [], enabled: true }, actionId: randomUUID(), conflict: false }); setError(''); setNotice('');
  }
  function change(value: Partial<ContinuousStreamInput>) { setEditor(current => current && ({ ...current, draft: { ...current.draft, ...value } })); }
  async function save() {
    if (!editor || !valid || busy || lock.current || editor.conflict) return;
    lock.current = true; setBusy(true); setError(''); const captured = editor;
    try {
      const saved = await api<ContinuousStream>(`/api/continuous/streams${captured.base ? `/${encodeURIComponent(captured.base.id)}` : ''}`, { ...captured.draft, ...(captured.base ? { revision: captured.base.revision } : { clientActionId: captured.actionId }) }, captured.base ? 'PUT' : 'POST');
      setEditor({ base: saved, draft: inputOf(saved), actionId: randomUUID(), conflict: false }); setNotice('持续分析配置已保存，仅处理此后接收的信息。历史版本及已接收输入保留。'); streams.refresh();
    } catch (reason) { setError(informationError(reason)); setEditor(current => current && ({ ...current, conflict: true })); }
    finally { lock.current = false; setBusy(false); }
  }
  async function readLatest() {
    if (!editor || lock.current) return; lock.current = true; setBusy(true);
    try {
      const value = await api<{ items: ContinuousStream[] }>(`/api/continuous/streams${editor.base ? '' : `?clientActionId=${encodeURIComponent(editor.actionId)}`}`);
      const latest = editor.base ? value.items.find(item => item.id === editor.base?.id) : value.items[0];
      if (latest) setEditor(current => current && ({ ...current, base: latest, latest }));
      else if (!editor.base) { setEditor(current => current && ({ ...current, conflict: false })); setNotice('未找到本次保存记录，编辑已保留，可显式重试原操作。'); }
      else setNotice('配置暂不可读取，编辑已保留。');
      streams.refresh();
    } catch (reason) { setError(informationError(reason)); } finally { lock.current = false; setBusy(false); }
  }
  async function control(stream: ContinuousStream) {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    const action = stream.state === 'paused' ? 'resume' : 'pause'; const key = `${stream.epochId}:${stream.revision}:${action}`; const clientActionId = controls.current.get(key) || randomUUID(); controls.current.set(key, clientActionId);
    try { await api(`/api/continuous/streams/${encodeURIComponent(stream.epochId)}/control`, { revision: stream.revision, action, clientActionId }); controls.current.delete(key); streams.refresh(); }
    catch (reason) { setError(informationError(reason)); streams.refresh(); } finally { lock.current = false; setBusy(false); }
  }
  return <section className="continuous-rules" hidden={!visible} aria-label="持续分析配置"><header className="information-toolbar"><h2>持续后台研判</h2><button disabled={busy} onClick={() => open()}>新建持续分析配置</button><button onClick={streams.refresh}>刷新持续配置</button></header><p className="resource-help">一次选择共同来源、分析方案和固定接收席位。新信息自动合并接续；普通更新可在研判记录查看，重要变化形成独立待办。分析只读，办理仍由人员确认。</p>{streams.error && <p className="resource-error" role="alert">{streams.error}</p>}<div className="information-split"><div className="information-list"><ul>{streams.data?.items.map(stream => <li key={stream.epochId}><button onClick={() => open(stream)} aria-current={editor?.base?.epochId === stream.epochId ? 'true' : undefined}><strong>{stream.name}</strong><span>{stream.isCurrent === false && stream.state !== 'retired' ? '历史配置 · ' : ''}{stream.state === 'active' ? '运行中' : stream.state === 'paused' ? '已暂停' : '历史配置'} · {stream.pendingInputs} 条输入待处理</span><small>配置版本 {stream.revision} · {informationTime(stream.updatedAt)}</small></button>{(stream.state !== 'retired' || stream.pendingInputs > 0) && <button disabled={busy} onClick={() => void control(stream)}>{stream.state === 'paused' ? '恢复分析' : '暂停分析'}</button>}{stream.pauseReason && <p className="resource-help">{stream.pauseReason}</p>}</li>)}</ul></div><div className="information-detail">{editor && <form className="information-form" onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={busy || readOnly}><legend>{readOnly ? '历史配置（只读）' : editor.base ? '编辑持续配置' : '新建持续配置'}</legend><label>持续配置名称<input required maxLength={100} value={editor.draft.name} onChange={event => change({ name: event.target.value })} /></label><fieldset><legend>共同来源集合</legend>{managed.map(source => <label className="information-check" key={source.sourceId}><input type="checkbox" checked={editor.draft.sourceIds.includes(source.sourceId)} onChange={event => change({ sourceIds: event.target.checked ? [...editor.draft.sourceIds, source.sourceId] : editor.draft.sourceIds.filter(id => id !== source.sourceId), profileId: '', recipientSeatIds: [] })} />{source.name}</label>)}</fieldset><label>共同分析方案<select required value={editor.draft.profileId} onChange={event => change({ profileId: event.target.value })}><option value="">选择所有来源共同允许的方案</option>{profiles.map(item => <option key={item.id} value={item.id} disabled={Boolean(item.configurationError) || !item.contextScope}>{item.name}{!item.contextScope ? '（未配置资料范围）' : ''}</option>)}</select></label>{profile && <><p>{profile.goal}</p><p className="resource-help">资料范围：{profile.contextScope ? (profile.contextScope.systemNames || profile.contextScope.systemIds).join('、') : '方案允许的输入资料'}</p></>}{selected.length > 0 && !profiles.some(item => item.contextScope && !item.configurationError) && <p className="resource-help">共同方案尚未配置可用资料范围，请先配置获准范围后启用持续研判。</p>}<fieldset><legend>共同固定接收席位</legend>{recipients.map(seat => <label className="information-check" key={seat.id}><input type="checkbox" checked={editor.draft.recipientSeatIds.includes(seat.id)} onChange={event => change({ recipientSeatIds: event.target.checked ? [...editor.draft.recipientSeatIds, seat.id] : editor.draft.recipientSeatIds.filter(id => id !== seat.id) })} />{seat.name}</label>)}</fieldset><label className="information-check"><input type="checkbox" checked={editor.draft.enabled} onChange={event => change({ enabled: event.target.checked })} />接收新信息进行持续分析</label><p className="resource-help">启用不会重放旧消息。保存后所选来源切换为持续模式，原逐条规则停止处理新信息。修改来源、方案或接收席位会建立新配置版本，历史研判保留原访问范围。暂停分析保留待处理输入，停止来源接收仍在来源控制中操作。</p></fieldset>{editor.conflict && <button type="button" disabled={busy} onClick={() => void readLatest()}>核对最新配置</button>}{editor.latest && <aside className="task-comparison"><strong>最新配置版本 {editor.latest.revision}</strong><p>{editor.latest.name} · 来源 {editor.latest.sourceIds.join('、')} · 接收席位 {editor.latest.recipientSeatIds.join('、')}</p><button type="button" onClick={() => setEditor(current => current?.latest ? { ...current, base: current.latest, latest: undefined, conflict: false } : current)}>已核对，继续合并编辑</button></aside>}{!readOnly && <button type="submit" className="primary-action" disabled={busy || !valid || editor.conflict}>保存持续配置</button>}</form>}</div></div>{error && <p className="resource-error" role="alert">{error} 编辑已保留。</p>}{notice && <p role="status">{notice}</p>}</section>;
}
