import { useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import type { TaskSpace } from '../contracts/access';
import type { BackgroundPage, InformationCapabilities, InformationRule, InformationRuleInput } from '../contracts/background';
import { useApi } from './api';
import { informationError, informationTime, InformationPagination, useInformationQuery } from './information-ui';

type Editor = { key: string; base?: InformationRule; draft: InformationRuleInput; latest?: InformationRule; clientActionId: string; conflict: boolean };
export function InformationRules({ visible, capabilities, tasks, selectedId, select }: { visible: boolean; capabilities: InformationCapabilities; tasks: TaskSpace[]; selectedId: string; select: (id: string) => void }) {
  const { api } = useApi(); const [offset, setOffset] = useState(0); const [sourceId, setSourceId] = useState('');
  const query = new URLSearchParams({ offset: String(offset), limit: '25', ...(sourceId ? { sourceId } : {}) });
  const rules = useInformationQuery<BackgroundPage<InformationRule>>(`/api/information/rules?${query}`, visible);
  const [editor, setEditor] = useState<Editor>(); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const lock = useRef(false); const generation = useRef(0);
  const managed = capabilities.sources.filter(source => source.permission === 'manage');
  const source = capabilities.sources.find(source => source.sourceId === editor?.draft.sourceId);
  const canEdit = source?.permission === 'manage';
  useEffect(() => {
    if (!visible || !selectedId || selectedId === editor?.key) return;
    let current = true;
    api<InformationRule>(`/api/information/rules/${encodeURIComponent(selectedId)}`).then(rule => {
      if (current) setEditor({ key: rule.id, base: rule, draft: inputOf(rule), clientActionId: crypto.randomUUID(), conflict: false });
    }).catch(reason => { if (current) setError(informationError(reason)); });
    return () => { current = false; };
  }, [api, visible, selectedId, editor?.key]);
  function open(rule?: InformationRule) {
    if (editor && JSON.stringify(editor.draft) !== JSON.stringify(editor.base ? inputOf(editor.base) : emptyInput(managed[0]?.sourceId || '', managed[0]?.allowedProfileIds[0] || '')) && !window.confirm('切换规则会放弃当前未保存的编辑，是否继续？')) return;
    generation.current++; setError(''); setNotice(''); select(rule?.id || '');
    setEditor({ key: rule?.id || 'new', base: rule, draft: rule ? inputOf(rule) : emptyInput(managed[0]?.sourceId || '', managed[0]?.allowedProfileIds[0] || ''), clientActionId: crypto.randomUUID(), conflict: false });
  }
  function change(value: Partial<InformationRuleInput>) { generation.current++; setEditor(current => current && ({ ...current, draft: { ...current.draft, ...value } })); }
  async function save() {
    if (!editor || !canEdit || lock.current || editor.conflict) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    const captured = editor; const editVersion = generation.current;
    try {
      const saved = captured.base ? await api<InformationRule>(`/api/information/rules/${encodeURIComponent(captured.base.id)}`, { ...captured.draft, revision: captured.base.revision }, 'PUT') : await api<InformationRule>('/api/information/rules', { ...captured.draft, clientActionId: captured.clientActionId });
      setEditor(current => current?.clientActionId === captured.clientActionId ? { ...current, key: saved.id, base: saved, latest: undefined, conflict: false, draft: editVersion === generation.current ? inputOf(saved) : current.draft } : current);
      setNotice('规则已保存。新消息使用此版本，历史信息保持原有处理和投递记录。'); select(saved.id); rules.refresh();
    } catch (reason) { setError(informationError(reason)); setEditor(current => current?.clientActionId === captured.clientActionId ? { ...current, conflict: true, latest: undefined } : current); }
    finally { lock.current = false; setBusy(false); }
  }
  async function latest() {
    if (!editor || lock.current) return; lock.current = true; setBusy(true);
    const captured = editor;
    try {
      if (captured.base) {
        const value = await api<InformationRule>(`/api/information/rules/${encodeURIComponent(captured.base.id)}`);
        setEditor(current => current?.clientActionId === captured.clientActionId ? { ...current, latest: value } : current);
      } else {
        const result = await api<BackgroundPage<InformationRule>>(`/api/information/rules?clientActionId=${encodeURIComponent(captured.clientActionId)}`);
        const value = result.items[0];
        setEditor(current => current?.clientActionId === captured.clientActionId ? { ...current, ...(value ? { key: value.id, base: value, latest: value } : {}), conflict: Boolean(value) } : current);
        setNotice(value ? '已找到保存记录，请核对最新规则。你的编辑仍保留。' : '未找到保存记录，可用原操作再次保存。');
      }
    } catch (reason) { setError(informationError(reason)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="information-rules" hidden={!visible} aria-label="处理与投递规则">
    <div className="information-toolbar"><label>规则来源<select value={sourceId} onChange={event => { setSourceId(event.target.value); setOffset(0); }}><option value="">全部来源</option>{capabilities.sources.map(item => <option value={item.sourceId} key={item.sourceId}>{item.name}</option>)}</select></label><button onClick={rules.refresh}><RefreshCw size={15} aria-hidden="true" />刷新规则</button>{managed.length > 0 && <button className="primary-action" onClick={() => open()}><Plus size={16} aria-hidden="true" />新建规则</button>}</div>
    {rules.error && <p className="resource-error" role="alert">{rules.error}</p>}
    <div className="information-split"><div className="information-list"><ul>{rules.data?.items.map(rule => <li key={rule.id}><button aria-current={editor?.key === rule.id ? 'true' : undefined} onClick={() => open(rule)}><strong>{rule.name}</strong><span>{rule.enabled ? '已启用' : '已停用'} · {capabilities.sources.find(item => item.sourceId === rule.sourceId)?.name || rule.sourceId}</span><small>版本 {rule.revision} · {informationTime(rule.updatedAt)}</small></button></li>)}</ul>{rules.data && !rules.data.items.length && <p className="information-empty">尚无处理规则。</p>}<InformationPagination page={rules.data} change={setOffset} /></div>
      <div className="information-detail">{!editor ? <p className="information-empty">选择规则查看详情{managed.length ? '，或新建一条处理与投递规则' : ''}。</p> : <form className="information-form" onSubmit={event => { event.preventDefault(); void save(); }}>
        <header><h2>{editor.base ? '规则详情' : '新建规则'}</h2>{!canEdit && <span className="information-tag">只读</span>}</header>
        <label>规则名称<input required maxLength={100} value={editor.draft.name} disabled={!canEdit} onChange={event => change({ name: event.target.value })} /></label>
        <label>接入来源<select value={editor.draft.sourceId} disabled={Boolean(editor.base) || !canEdit} onChange={event => { const selected = capabilities.sources.find(item => item.sourceId === event.target.value)!; change({ sourceId: selected.sourceId, profileId: selected.allowedProfileIds[0] || '', recipientSeatIds: [] }); }}><option value="" disabled>选择来源</option>{capabilities.sources.filter(item => item.permission === 'manage' || item.sourceId === editor.draft.sourceId).map(item => <option key={item.sourceId} value={item.sourceId}>{item.name}</option>)}</select></label>
        <label>预处理方案<select required value={editor.draft.profileId} disabled={!canEdit} onChange={event => change({ profileId: event.target.value })}><option value="" disabled>选择方案</option>{capabilities.profiles.filter(item => source?.allowedProfileIds.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><p className="resource-help">{capabilities.profiles.find(item => item.id === editor.draft.profileId)?.goal}</p>
        <fieldset><legend>接收席位</legend>{capabilities.seats.filter(item => source?.allowedRecipientSeatIds.includes(item.id)).map(seat => <label className="information-check" key={seat.id}><input type="checkbox" disabled={!canEdit} checked={editor.draft.recipientSeatIds.includes(seat.id)} onChange={event => change({ recipientSeatIds: event.target.checked ? [...editor.draft.recipientSeatIds, seat.id] : editor.draft.recipientSeatIds.filter(id => id !== seat.id) })} />{seat.name}</label>)}</fieldset>
        <label>公共任务展示归属（可选）<select value={editor.draft.publicTaskId || ''} disabled={!canEdit} onChange={event => change({ publicTaskId: event.target.value || undefined })}><option value="">不关联</option>{tasks.filter(task => task.visibility === 'public').map(task => <option key={task.id} value={task.id}>{task.title}{task.state === 'archived' ? '（已归档）' : ''}</option>)}</select></label>
        <label className="information-check"><input type="checkbox" checked={editor.draft.enabled} disabled={!canEdit} onChange={event => change({ enabled: event.target.checked })} />启用规则</label>
        <p className="resource-help">预处理完成后投递所选席位，等待席位人员发起分析。停用规则后仍接收信息，但不自动处理。</p>
        {error && <p className="resource-error" role="alert">{error} 你的编辑已保留。</p>}{notice && <p className="resource-success" role="status">{notice}</p>}
        {editor.conflict && <button type="button" disabled={busy} onClick={() => void latest()}>{editor.base ? '查看最新规则' : '核对保存结果'}</button>}
        {editor.latest && <aside className="task-comparison"><strong>最新规则（你的编辑仍保留）</strong><p>{editor.latest.name} · {editor.latest.enabled ? '启用' : '停用'} · 版本 {editor.latest.revision}</p><p>处理方案：{capabilities.profiles.find(item => item.id === editor.latest!.profileId)?.name || editor.latest.profileId}</p><p>接收席位：{editor.latest.recipientSeatIds.map(id => capabilities.seats.find(seat => seat.id === id)?.name || id).join('、')}</p><button type="button" onClick={() => { setEditor(current => current?.latest ? { ...current, base: current.latest, latest: undefined, conflict: false } : current); setError(''); }}>已核对，继续合并编辑</button></aside>}
        {canEdit && <button className="primary-action" type="submit" disabled={busy || editor.conflict || !editor.draft.name.trim() || !editor.draft.profileId || !editor.draft.recipientSeatIds.length}>{busy ? '保存中…' : '保存规则'}</button>}
      </form>}</div></div>
  </section>;
}
function inputOf(rule: InformationRule): InformationRuleInput { const { name, sourceId, profileId, recipientSeatIds, publicTaskId, enabled } = rule; return { name, sourceId, profileId, recipientSeatIds, publicTaskId, enabled }; }
function emptyInput(sourceId: string, profileId: string): InformationRuleInput { return { name: '', sourceId, profileId, recipientSeatIds: [], enabled: true }; }
