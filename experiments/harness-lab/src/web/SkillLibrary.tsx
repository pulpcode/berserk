import { CreationMethodDialog } from './CreationMethodDialog';
import type { AuthoringIntent } from '../contracts/authoring';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Copy, FilePlus, Plus, Sparkles, Upload } from 'lucide-react';
import type { ManagedSkillDetail, SkillDraft, SkillFileInput, SkillImportPreview, SkillPackageRevision, SkillPublication, SkillPolicy, SkillScanReport, SkillSummary, SkillUseDetail, SkillValidation } from '../contracts/skills';
import type { SkillInfo, Workspace } from '../contracts/index';
import { useApi, checkResponse } from './api';
import { Panel } from './Resources';
import { LoadingIndicator } from './LoadingIndicator';
import { SkillTrial } from './SkillTrial';
import { sessionAction } from './session-action';
import './skill-management.css';
import { createSkillMethod, readSkillMethod, updateSkillMethod, type SkillMethodFields } from './skill-method';

type SkillTab = 'files' | 'policy' | 'checks' | 'history' | 'trial';

const root = '/api/admin/capabilities/skills';
const failure = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请核对当前内容后重试。';
const encode = (text: string) => { const bytes = new TextEncoder().encode(text); let binary = ''; for (const value of bytes) binary += String.fromCharCode(value); return btoa(binary); };
const decode = (content: string) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(content), c => c.charCodeAt(0))); } catch { return undefined; } };
const editableFiles = (files: readonly SkillFileInput[]) => files.map(({ path, contentBase64 }) => ({ path, contentBase64 }));
const scanLabel: Record<SkillScanReport['state'], string> = { pending: '待扫描', running: '扫描中', completed: '已完成', partial: '部分完成', failed: '失败', not_applicable: '不适用' };
const stateLabel = (skill: SkillSummary) => skill.system ? '内置技能' : skill.archived ? '已归档' : skill.state === 'disabled' ? '已停用' : skill.state === 'banned' ? '受限制' : skill.releaseVersion ? '已发布' : '草稿';

export function SkillLibrary({ administrator, query, refresh, workspaces, applySkill, authoring }: { authoring?: (intent: AuthoringIntent) => void; administrator: boolean; query: string; refresh: number; workspaces: Workspace[]; applySkill?: (workspaceId: string, skill: SkillInfo) => Promise<void> }) {
  const { api, request, url, storageKey } = useApi();
  const [skills, setSkills] = useState<SkillSummary[]>();
  const [selected, setSelected] = useState<{ id: string; initialTab: SkillTab; expectedDraftDigest?: string }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [preview, setPreview] = useState<SkillImportPreview>();
  const [creating, setCreating] = useState(false);
  const [createChoice, setCreateChoice] = useState(false);
  const [viewing, setViewing] = useState<SkillSummary>();
  const upload = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    api<SkillSummary[]>(administrator ? root : '/api/capabilities/skills').then(value => { if (live) { setSkills(value); setError(''); } }).catch(error => { if (live) setError(failure(error)); });
    return () => { live = false; };
  }, [api, administrator, refresh, reload]);
  async function create(sourceSkillId?: string) {
    if (busy) return; setBusy(true); setError('');
    const input = sourceSkillId ? { sourceSkillId } : {};
    const action = sessionAction(storageKey('skill-create'), input);
    try { const value = await api<ManagedSkillDetail>(root, { ...input, clientActionId: action.id }); action.complete(); setSelected({ id: value.skill.skillId, initialTab: 'files' }); setReload(n => n + 1); }
    catch (error) { setError(failure(error)); } finally { setBusy(false); }
  }
  async function importPreview(file?: File) {
    if (!file || busy) return;
    if (file.size > 20 * 1024 * 1024) { setError('上传文件不能超过20 MiB。'); return; }
    setBusy(true); setError('');
    try { const response = await checkResponse(await request(url(`${root}/import-preview?name=${encodeURIComponent(file.name)}`), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file })); setPreview(await response.json() as SkillImportPreview); }
    catch (error) { setError(failure(error)); } finally { setBusy(false); if (upload.current) upload.current.value = ''; }
  }
  async function commitImport() {
    if (!preview || busy) return; setBusy(true); setError('');
    const action = sessionAction(storageKey('skill-import'), { packageDigest: preview.packageDigest });
    try { const value = await api<ManagedSkillDetail>(`${root}/import`, { preview, clientActionId: action.id }); action.complete(); setPreview(undefined); setSelected({ id: value.skill.skillId, initialTab: 'files' }); setReload(n => n + 1); }
    catch (error) { setError(failure(error)); } finally { setBusy(false); }
  }
  const matching = skills?.filter(skill => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const visible = matching?.filter(skill => !skill.archived);
  const archived = matching?.filter(skill => skill.archived);
  const card = (skill: SkillSummary) => <article className="expert-card skill-card" key={skill.skillId}><div className="expert-card-heading"><span className="expert-card-icon"><Sparkles size={23} aria-hidden="true" /></span><h3>{skill.name || '未命名技能'}</h3></div><p>{skill.description || '编辑方法与文件后发布。'}</p><div className="expert-card-footer"><span>{stateLabel(skill)}</span>{administrator && applySkill && skill.available && !skill.archived && <button type="button" aria-label={`使用技能${skill.name}`} onClick={() => setViewing(skill)}>用于对话<ArrowRight size={15} aria-hidden="true" /></button>}<button type="button" aria-label={`查看技能${skill.name}`} onClick={() => administrator ? setSelected({ id: skill.skillId, initialTab: 'files' }) : setViewing(skill)}>查看详情<ArrowRight size={15} aria-hidden="true" /></button></div></article>;
  return <div className="skill-library">
    <header className="skill-library-heading"><h2>可用技能</h2>{administrator && <div className="skill-library-actions"><input ref={upload} hidden type="file" accept=".md,.zip" onChange={event => void importPreview(event.target.files?.[0])} /><button type="button" disabled={busy} onClick={() => upload.current?.click()}><Upload size={16} aria-hidden="true" />导入技能</button><button type="button" className="primary-action" disabled={busy} onClick={() => setCreateChoice(true)}><Plus size={16} aria-hidden="true" />创建技能</button></div>}</header>
    {error && <p className="resource-error" role="alert">{error}<button type="button" onClick={() => setReload(n => n + 1)}>重新读取</button></p>}
    {!skills && !error && <LoadingIndicator label="正在读取技能目录…" />}
    {visible?.length === 0 && <p className="capability-empty">{query ? '没有找到相关技能。' : '暂无可用技能。'}</p>}
    <div className="capability-grid capability-skill-list">{visible?.map(card)}</div>
    {administrator && !!archived?.length && <details className="skill-archive"><summary>已归档（{archived.length}）</summary><div className="capability-grid skill-archived-list">{archived.map(card)}</div></details>}
    {createChoice && <CreationMethodDialog kind="skill" close={() => setCreateChoice(false)} manual={() => { setCreateChoice(false); setCreating(true); }} assisted={authoring ? () => { setCreateChoice(false); authoring({ kind: 'skill' }); } : undefined} />}
    {creating && <SkillCreation close={() => setCreating(false)} created={value => { setCreating(false); setSelected({ id: value.skill.skillId, initialTab: 'policy', expectedDraftDigest: value.draft?.packageDigest }); setReload(n => n + 1); }} />}
    {selected && <SkillManagement authoring={authoring} key={selected.id} skillId={selected.id} initialTab={selected.initialTab} expectedDraftDigest={selected.expectedDraftDigest} close={() => setSelected(undefined)} changed={() => setReload(n => n + 1)} copy={id => { setSelected(undefined); void create(id); }} />}
    {viewing && <SkillUsePanel skill={viewing} workspaces={workspaces} applySkill={applySkill} close={() => setViewing(undefined)} />}
    {preview && <Panel title="确认导入技能" close={() => { if (!busy) setPreview(undefined); }} className="skill-import-panel"><h3>{preview.name || '待修正名称'}</h3><p>{preview.description}</p>{preview.wrapper && <p>已识别外包装目录：{preview.wrapper}</p>}<ul>{preview.files.map(file => <li key={file.path}>{file.path}</li>)}</ul>{preview.warnings.map((warning, index) => <p key={index}>{warning}</p>)}<Validation value={preview.validation} /><div className="dialog-actions"><button type="button" disabled={busy} onClick={() => setPreview(undefined)}>取消</button><button type="button" className="primary-action" disabled={busy} onClick={() => void commitImport()}>确认导入草稿</button></div></Panel>}
  </div>;
}

function SkillCreation({ close, created }: { close: () => void; created: (value: ManagedSkillDetail) => void }) {
  const { api, storageKey } = useApi();
  const [fields, setFields] = useState<SkillMethodFields>({ name: '', description: '', instructions: '' });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const name = useRef<HTMLInputElement>(null);
  useEffect(() => { const frame = requestAnimationFrame(() => name.current?.focus()); return () => cancelAnimationFrame(frame); }, []);
  async function submit() {
    if (pending.current) return;
    pending.current = true; setWorking(true); setError('');
    const files = [{ path: 'SKILL.md', contentBase64: encode(createSkillMethod(fields)) }];
    const action = sessionAction(storageKey('skill-create'), { files });
    try { const value = await api<ManagedSkillDetail>(root, { files, clientActionId: action.id }); action.complete(); created(value); }
    catch (error) { setError(failure(error).replace('name须', '技能名称须').replace('description须', '技能简介须')); }
    finally { pending.current = false; setWorking(false); }
  }
  return <Panel title="创建技能" close={() => { if (!pending.current) close(); }} className="skill-create-panel"><form className="skill-create-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <label>技能名称<input aria-label="技能名称" ref={name} required value={fields.name} disabled={working} onChange={event => setFields({ ...fields, name: event.target.value })} placeholder="例如：资料摘要" /></label>
    <label>技能简介<textarea aria-label="技能简介" required rows={2} value={fields.description} disabled={working} onChange={event => setFields({ ...fields, description: event.target.value })} placeholder="这个技能解决什么问题" /></label>
    <label>使用说明<textarea aria-label="使用说明" rows={8} value={fields.instructions} disabled={working} onChange={event => setFields({ ...fields, instructions: event.target.value })} placeholder="描述处理步骤、要求或示例，也可以稍后填写" /></label>
    {error && <p className="resource-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" disabled={working} onClick={close}>取消</button><button type="submit" className="primary-action" disabled={working || !fields.name.trim() || !fields.description.trim()}>{working ? '创建中…' : '创建草稿'}</button></div>
  </form></Panel>;
}

function Validation({ value }: { value?: SkillValidation }) { return value ? <section className="skill-validation"><h4>{value.valid ? '格式与完整性检查完成' : '格式与完整性需要修正'}</h4>{value.issues.length === 0 && <p>本次检查未发现格式或完整性问题。</p>}<ul>{value.issues.map((issue, index) => <li key={index} className={issue.severity === 'error' ? 'resource-error' : ''}>{issue.path && <strong>{issue.path}：</strong>}{issue.message}</li>)}</ul>{value.extensions.length > 0 && <p>保留的扩展：{value.extensions.join('、')}。未适配扩展不增加权限。</p>}</section> : null; }

const publicTrialLabel = { not_tried: '未试用', prepared: '准备中', running: '试用中', succeeded: '已完成', failed: '失败', cancelled: '已停止', interrupted: '已中断' };

function SkillUsePanel({ skill, workspaces, applySkill, close }: { skill: SkillSummary; workspaces: Workspace[]; applySkill?: (workspaceId: string, skill: SkillInfo) => Promise<void>; close: () => void }) {
  const { api } = useApi();
  const [value, setValue] = useState<SkillUseDetail>();
  const [workspaceId, setWorkspaceId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; api<typeof value>(`/api/capabilities/skills/${encodeURIComponent(skill.skillId)}?revisionId=${encodeURIComponent(skill.revisionId)}&packageDigest=${skill.packageDigest}`).then(value => { if (live) setValue(value); }).catch(error => { if (live) setError(failure(error)); }); return () => { live = false; }; }, [api, skill]);
  async function choose() { if (!workspaceId || !applySkill || busy) return; setBusy(true); setError(''); try { const resources = await api<{ skills: SkillInfo[] }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/resources`); const candidate = resources.skills.find(item => item.id === skill.skillId && (!item.packageDigest || item.packageDigest === skill.packageDigest)); if (!candidate) throw new Error('该技能已更新或不可用于所选空间，请重新读取目录。'); await applySkill(workspaceId, candidate); close(); } catch (error) { setError(failure(error)); } finally { setBusy(false); } }
  return <Panel title={skill.name} close={close} className="skill-detail-panel"><p>{skill.description}</p>{error && <p className="resource-error" role="alert">{error}</p>}{!value && !error && <LoadingIndicator label="正在读取技能…" />}{value && <><p>发布版本：{value.releaseVersion}</p><p>本修订试用状态：{publicTrialLabel[value.trialSummary.status]}。</p><details><summary>查看方法正文</summary><pre className="skill-method">{value.content}</pre></details><h4>包内文件</h4><ul>{value.files.map(file => <li key={file.path}>{file.path} <small>{file.size}字节</small></li>)}</ul>{Object.entries(value.requirements).map(([key, text]) => <p key={key}><strong>{key}：</strong>{text}</p>)}</>}{applySkill && <form className="workspace-form" onSubmit={event => { event.preventDefault(); void choose(); }}><label>使用空间<select aria-label="使用空间" value={workspaceId} disabled={busy} required onChange={event => setWorkspaceId(event.target.value)}><option value="">选择已有空间</option>{workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label><button className="primary-action" type="submit" disabled={!workspaceId || busy || !skill.available}>用于对话</button></form>}</Panel>;
}

export function SkillManagement({ skillId, initialTab = 'files', expectedDraftDigest, close, changed, copy, authoring }: { authoring?: (intent: AuthoringIntent) => void; skillId: string; initialTab?: SkillTab; expectedDraftDigest?: string; close: () => void; changed: () => void; copy: (id: string) => void }) {
  const { api } = useApi();
  const [detail, setDetail] = useState<ManagedSkillDetail>();
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [dirty, setDirty] = useState(false);
  const leave = () => { if (!dirty || confirm('有未保存的文件修改，确认放弃并关闭？')) close(); };
  useEffect(() => { let live = true; api<ManagedSkillDetail>(`${root}/${encodeURIComponent(skillId)}`).then(value => { if (live) { setDetail(value); setError(''); } }).catch(error => { if (live) setError(failure(error)); }); return () => { live = false; }; }, [api, skillId, reload]);
  const scanning = detail?.scans.some(scan => scan.state === 'pending' || scan.state === 'running');
  useEffect(() => { if (!scanning) return; let live = true; let pending = false; const timer = setInterval(() => { if (pending) return; pending = true; api<ManagedSkillDetail>(`${root}/${encodeURIComponent(skillId)}`).then(value => { if (live) setDetail(value); }).catch(error => { if (live) setError(failure(error)); }).finally(() => { pending = false; }); }, 1600); return () => { live = false; clearInterval(timer); }; }, [api, scanning, skillId]);
  return <Panel title={detail?.skill.name || '技能管理'} close={leave} className="skill-management-panel">{error && <p className="resource-error" role="alert">{error}</p>}{!detail && !error && <LoadingIndicator label="正在读取技能…" />}{detail && <><div className="skill-management-heading"><span>{stateLabel(detail.skill)}</span>{authoring && !detail.skill.system && !detail.skill.archived && <button type="button" onClick={() => { if (dirty && !confirm('有未保存的文件修改，放弃这些修改并进入对话？')) return; close(); authoring({ kind: 'skill', targetId: skillId, ...(detail.draft ? { baseline: { draftRevision: detail.draft.draftRevision, digest: detail.draft.packageDigest } } : {}) }); }}>对话修改当前草稿</button>}<button type="button" disabled={dirty || detail.skill.archived} onClick={() => copy(skillId)}><Copy size={16} aria-hidden="true" />复制为新技能</button></div>{detail.skill.system ? <BuiltinSkill detail={detail} /> : <SkillEditor key={skillId} detail={detail} initialTab={initialTab} expectedDraftDigest={expectedDraftDigest} done={leave} changed={() => { setReload(n => n + 1); changed(); }} dirtyChanged={setDirty} />}</>}</Panel>;
}

function BuiltinSkill({ detail }: { detail: ManagedSkillDetail }) { const { api } = useApi(); const [value, setValue] = useState<SkillPackageRevision>(); const [error, setError] = useState(''); useEffect(() => { let live = true; api<SkillPackageRevision>(`${root}/${detail.skill.skillId}/revisions/${detail.skill.revisionId}`).then(value => { if (live) setValue(value); }).catch(error => { if (live) setError(failure(error)); }); return () => { live = false; }; }, [api, detail.skill.skillId, detail.skill.revisionId]); return <>{error && <p role="alert" className="resource-error">{error}</p>}{value && <pre className="skill-method">{decode(value.files.find(file => file.path === 'SKILL.md')?.contentBase64 || '')}</pre>}<SkillTrial skillId={detail.skill.skillId} packageDigest={detail.skill.packageDigest} revisions={[{ revisionId: detail.skill.revisionId, releaseVersion: detail.skill.releaseVersion }]} disabled={false} /></>; }

function SkillEditor({ detail, initialTab, expectedDraftDigest, done, changed, dirtyChanged }: { detail: ManagedSkillDetail; initialTab: SkillTab; expectedDraftDigest?: string; done: () => void; changed: () => void; dirtyChanged: (value: boolean) => void }) {
  const { api, storageKey } = useApi();
  const draft = detail.draft;
  const changedSinceCreation = initialTab === 'policy' && expectedDraftDigest !== undefined && draft?.packageDigest !== expectedDraftDigest;
  const [base, setBase] = useState(draft);
  const [files, setFiles] = useState<SkillFileInput[]>(() => editableFiles(draft?.files || []));
  const [path, setPath] = useState('SKILL.md');
  const [sourceOpen, setSourceOpen] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [tab, setTab] = useState<SkillTab>(() => changedSinceCreation ? 'files' : initialTab);
  const panel = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const currentFiles = useRef(files);
  useEffect(() => { currentFiles.current = files; }, [files]);
  const publishNotes = useRef<HTMLTextAreaElement>(null);
  function goTo(next: SkillTab) {
    setTab(next);
    requestAnimationFrame(() => {
      const selector = next === 'files' ? '[aria-label="技能名称"]' : next === 'policy' ? '[aria-label="开放范围"]' : next === 'history' ? '.skill-complete' : '.skill-check';
      panel.current?.querySelector<HTMLElement>(selector)?.focus();
    });
  }
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(() => changedSinceCreation ? '技能内容已更新，请核对后继续。' : '');
  const [latest, setLatest] = useState<SkillDraft>();
  const [latestPublicationBase, setLatestPublicationBase] = useState<string | null>(null);
  const [publicationBase, setPublicationBase] = useState<string | null>(detail.skill.revisionId || null);
  const [policyBase, setPolicyBase] = useState(detail.policy);
  const [latestPolicy, setLatestPolicy] = useState<SkillPolicy>();
  const [checked, setChecked] = useState<SkillValidation>();
  const [notes, setNotes] = useState('');
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [policyMode, setPolicyMode] = useState(detail.policy.mode);
  const [seatIds, setSeatIds] = useState(detail.policy.seatIds.join(', '));
  const [seats, setSeats] = useState<Array<{ id: string; name: string }>>([]);
  const [history, setHistory] = useState<SkillPackageRevision>();
  const replace = useRef<HTMLInputElement>(null);
  const url = `${root}/${encodeURIComponent(detail.skill.skillId)}`;
  const dirty = JSON.stringify(files) !== JSON.stringify(editableFiles(base?.files || []));
  useEffect(() => { dirtyChanged(dirty); }, [dirty, dirtyChanged]);
  useEffect(() => { let live = true; api<{ seats: Array<{ id: string; name: string }> }>('/api/admin/capabilities/catalog').then(value => { if (live) setSeats(value.seats); }).catch(error => { if (live) setError(failure(error)); }); return () => { live = false; }; }, [api]);
  async function run(action: () => Promise<void>) { if (pending.current) return; pending.current = true; setWorking(true); setError(''); setNotice(''); try { await action(); } catch (error) { setError(failure(error)); } finally { pending.current = false; setWorking(false); } }
  async function save() { if (!base) return; const submitted = editableFiles(files); await run(async () => { const value = await api<SkillDraft>(`${url}/draft`, { expectedDraftRevision: base.draftRevision, files: submitted, requirements: base.requirements }, 'PUT'); setBase(value); setLatest(undefined); setNotice('草稿已保存。'); changed(); if (JSON.stringify(editableFiles(currentFiles.current)) === JSON.stringify(submitted)) goTo('policy'); }); }
  async function readLatest() { await run(async () => { const value = await api<ManagedSkillDetail>(url); setLatest(value.draft); setLatestPublicationBase(value.skill.revisionId || null); }); }
  async function validate() { if (!base) return; await run(async () => { setChecked(await api<SkillValidation>(`${url}/validate`, { expectedDraftRevision: base.draftRevision })); changed(); }); }
  async function publish() { if (!base) return; const input = { expectedDraftRevision: base.draftRevision, expectedCurrentRevisionId: publicationBase, releaseNotes: notes }; const action = sessionAction(storageKey(`skill-publish:${detail.skill.skillId}`), input); await run(async () => { const result = await api<SkillPublication>(`${url}/publish`, { ...input, clientActionId: action.id }); action.complete(); setPublicationBase(result.revisionId); setNotice(`版本 ${result.releaseVersion} 已发布。`); setNotes(''); setConfirmPublish(false); changed(); goTo('history'); }); }
  async function savePolicy() { if (!base || dirty) return; const input = { expectedRevision: policyBase.revision, mode: policyMode, seatIds: policyMode === 'seats' ? seatIds.split(/[,，\s]+/).filter(Boolean) : [] }; const action = sessionAction(storageKey(`skill-policy:${detail.skill.skillId}`), input); await run(async () => { const value = await api<SkillPolicy>(`${url}/policy`, { ...input, clientActionId: action.id }, 'PUT'); setPolicyBase(value); setLatestPolicy(undefined); action.complete(); setNotice('使用范围已保存。'); changed(); goTo('checks'); const report = await api<SkillValidation>(`${url}/validate`, { expectedDraftRevision: base.draftRevision }); setChecked(report); if (report.valid) requestAnimationFrame(() => publishNotes.current?.focus()); }); }
  async function lifecycle(action: 'disable' | 'restore' | 'archive') { if (action === 'archive' && !confirm('归档后不再提供新选择，历史引用仍保留。确认归档？')) return; const input = { action, expectedStateRevision: detail.skill.stateRevision }; const receipt = sessionAction(storageKey(`skill-state:${detail.skill.skillId}`), input); await run(async () => { await api(`${url}/lifecycle`, { ...input, clientActionId: receipt.id }); receipt.complete(); changed(); }); }
  const methodFile = files.find(file => file.path === 'SKILL.md');
  const methodSource = methodFile && decode(methodFile.contentBase64);
  const method = methodSource === undefined ? undefined : readSkillMethod(methodSource);
  function editMethod(patch: Partial<SkillMethodFields>) { if (methodSource === undefined) return; const contentBase64 = encode(updateSkillMethod(methodSource, patch)); setFiles(old => old.map(file => file.path === 'SKILL.md' ? { ...file, contentBase64 } : file)); }
  const current = files.find(file => file.path === path);
  const text = current && decode(current.contentBase64);
  const validation = checked?.packageDigest === base?.packageDigest ? checked : detail.validation?.packageDigest === base?.packageDigest ? detail.validation : undefined;
  const scan = detail.scans.find(item => item.packageDigest === base?.packageDigest);
  async function replaceFile(file?: File) { if (!file) return; if (file.size > 20 * 1024 * 1024) { setError('单资源不能超过20 MiB。'); return; } const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (const value of bytes) binary += String.fromCharCode(value); const contentBase64 = btoa(binary); setFiles(old => old.map(item => item.path === path ? { ...item, contentBase64 } : item)); if (replace.current) replace.current.value = ''; }
  return <div className="skill-editor" ref={panel}><nav className="management-tabs" aria-label="技能配置分类">{([['files', '技能内容'], ['policy', '使用范围'], ['checks', '检查与发布'], ['history', '发布历史'], ['trial', '隔离试用']] as const).map(([value, label]) => <button key={value} type="button" aria-current={tab === value ? 'page' : undefined} disabled={working} onClick={() => goTo(value)}>{label}</button>)}</nav>
    {error && <div className="resource-error" role="alert"><p>{error}</p>{tab !== 'policy' && <button type="button" disabled={working} onClick={() => void readLatest()}>查看最新草稿</button>}</div>}{notice && <p role="status" className="management-info">{notice}</p>}
    {tab === 'files' && <>{method ? <div className="skill-method-fields"><label>技能名称<input aria-label="技能名称" value={method.name} disabled={working || detail.skill.archived} onChange={event => editMethod({ name: event.target.value })} /></label><label>技能简介<textarea aria-label="技能简介" rows={2} value={method.description} disabled={working || detail.skill.archived} onChange={event => editMethod({ description: event.target.value })} /></label><label>使用说明<textarea aria-label="使用说明" rows={9} value={method.instructions} disabled={working || detail.skill.archived} onChange={event => editMethod({ instructions: event.target.value })} /></label></div> : <p className="resource-error">无法读取基本信息，请在源码中修正。</p>}<details className="skill-source-editor" open={sourceOpen || !method} onToggle={event => setSourceOpen(event.currentTarget.open)}><summary>文件与源码 <span>{files.length} 个文件</span></summary><div className="skill-file-layout"><nav aria-label="包内文件">{files.map(file => <button type="button" key={file.path} title={file.path} aria-current={path === file.path ? 'page' : undefined} onClick={() => setPath(file.path)}>{file.path}</button>)}</nav><section className="skill-file-editor">{current ? <><div className="skill-file-title"><strong>{path}</strong><input hidden type="file" ref={replace} onChange={event => void replaceFile(event.target.files?.[0])} /><button type="button" disabled={working || detail.skill.archived} onClick={() => replace.current?.click()}>替换文件</button>{path !== 'SKILL.md' && <button type="button" disabled={working || detail.skill.archived} onClick={() => { setFiles(old => old.filter(file => file.path !== path)); setPath('SKILL.md'); }}>移除</button>}</div>{text !== undefined ? <textarea aria-label={`编辑${path}`} className="skill-code-editor" value={text} spellCheck={false} disabled={working || detail.skill.archived} onChange={event => { const contentBase64 = encode(event.target.value); setFiles(old => old.map(file => file.path === path ? { ...file, contentBase64 } : file)); }} /> : <p>二进制文件，可替换。</p>}</> : <p>选择包内文件。</p>}</section></div><div className="skill-add-file"><label>新文件相对路径<input value={newPath} disabled={working || detail.skill.archived} onChange={event => setNewPath(event.target.value)} placeholder="例如 references/example.md" /></label><button type="button" disabled={working || detail.skill.archived || !newPath.trim() || files.some(file => file.path === newPath.trim())} onClick={() => { const next = newPath.trim(); setFiles(old => [...old, { path: next, contentBase64: '' }]); setPath(next); setNewPath(''); }}><FilePlus size={16} aria-hidden="true" />添加文件</button></div></details><div className="management-actions"><button type="button" className="primary-action" disabled={working || !base || detail.skill.archived} onClick={() => { if (dirty) void save(); else goTo('policy'); }}>{dirty ? '保存并继续' : '下一步：使用范围'}</button><span>{dirty ? '有未保存修改' : '草稿已保存'}</span></div>{latest && <section className="management-compare"><h4>最新草稿已读取</h4><p>本地修改仍保留。确认放弃本地文件修改后，采用最新草稿及其发布基线。</p><button type="button" onClick={() => { setBase(latest); setFiles(editableFiles(latest.files)); setPublicationBase(latestPublicationBase); setLatest(undefined); setError(''); }}>放弃本地修改，使用最新草稿与发布基线</button></section>}</>}
    {tab === 'checks' && <><div className="management-actions skill-step-actions"><button type="button" disabled={working} onClick={() => goTo('policy')}>上一步：使用范围</button><button type="button" className="skill-check" disabled={working || dirty || !base || detail.skill.archived} onClick={() => void validate()}>检查格式与完整性</button></div>{dirty && <p role="status">请先保存文件修改。</p>}<Validation value={validation} /><section><h4>静态扫描</h4><p>{scan ? `${scanLabel[scan.state]} · ${scan.findings.length}项发现` : '尚无当前内容的扫描记录'}</p>{base && <button type="button" disabled={working || dirty || detail.skill.archived} onClick={() => void run(async () => { const action = sessionAction(storageKey(`skill-rescan:${detail.skill.skillId}`), { expectedDraftRevision: base.draftRevision }); await api(`${url}/scans`, { expectedDraftRevision: base.draftRevision, clientActionId: action.id }); action.complete(); changed(); })}>重新扫描</button>}{scan?.errors[0] && <p className="resource-error">{scan.errors[0]}</p>}{scan && <details><summary>查看扫描报告</summary><ScanReport scan={scan} /></details>}</section><section className="expert-publish"><h4>发布技能</h4><div className="skill-publish-readiness">{dirty ? <><span>请先保存修改。</span><button type="button" onClick={() => goTo('files')}>返回编辑</button></> : detail.policy.revision === 0 || detail.policy.mode === 'seats' && !detail.policy.seatIds.length ? <><span>请先设置使用范围。</span><button type="button" onClick={() => goTo('policy')}>设置使用范围</button></> : !validation?.valid ? <span>发布前请完成格式检查。</span> : null}</div><label>发布说明<textarea ref={publishNotes} aria-label="技能发布说明" disabled={working || detail.skill.archived} rows={3} maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} /></label><label className="management-check"><input type="checkbox" disabled={working || detail.skill.archived} checked={confirmPublish} onChange={event => setConfirmPublish(event.target.checked)} /><span>确认发布当前内容及使用范围。</span></label><button type="button" className="primary-action" disabled={working || dirty || !validation?.valid || !notes.trim() || !confirmPublish || detail.policy.revision === 0 || detail.policy.mode === 'seats' && !detail.policy.seatIds.length || detail.skill.archived} onClick={() => void publish()}>发布技能</button></section></>}
    {tab === 'trial' && <SkillTrial skillId={detail.skill.skillId} draftRevision={base?.draftRevision} packageDigest={base?.packageDigest} revisions={detail.publications} disabled={dirty || detail.skill.archived} />}
    {tab === 'history' && <><div className="skill-completion-actions"><h4>发布历史</h4><button type="button" className="skill-complete" disabled={working} onClick={done}>完成</button></div>{detail.publications.length === 0 && <p>尚未发布。</p>}{detail.publications.map(item => <article className="skill-history-item" key={item.publicationId}><strong>版本 {item.releaseVersion}</strong><p>{item.releaseNotes}</p><small>{new Date(item.publishedAt).toLocaleString()} · 发布时扫描：{item.scanState ? scanLabel[item.scanState] : '未完成'}</small><button type="button" disabled={working} onClick={() => void run(async () => setHistory(await api<SkillPackageRevision>(`${url}/revisions/${item.revisionId}`)))}>查看版本文件</button></article>)}{history && <details open><summary>版本 {history.releaseVersion} · {history.files.length}个文件</summary>{history.files.map(file => <details key={file.path}><summary>{file.path} · {file.size}字节</summary><pre className="skill-method">{decode(file.contentBase64) ?? '二进制资源'}</pre></details>)}</details>}<h4>操作记录</h4><ul className="management-audit">{detail.audit.map(item => <li key={item.id}><strong>{item.action}</strong><span>{new Date(item.createdAt).toLocaleString()}</span></li>)}</ul><h4>历史扫描</h4>{detail.scans.map(item => <details key={item.scanId}><summary>{scanLabel[item.state]} · {new Date(item.createdAt).toLocaleString()}{item.packageDigest === base?.packageDigest ? ' · 当前内容' : ' · 旧快照'}</summary><ScanReport scan={item} /></details>)}</>}
    {tab === 'policy' && <><h4>使用范围</h4><label>开放范围<select aria-label="开放范围" value={policyMode} disabled={working || detail.skill.archived} onChange={event => setPolicyMode(event.target.value as typeof policyMode)}><option value="none">未向业务席位开放</option><option value="all">全部业务席位</option><option value="seats">指定业务席位</option></select></label>{policyMode === 'seats' && <fieldset><legend>业务席位</legend>{seats.map(seat => <label key={seat.id} className="management-check"><input type="checkbox" disabled={working || detail.skill.archived} checked={seatIds.split(/[,，\s]+/).includes(seat.id)} onChange={event => { const ids = seatIds.split(/[,，\s]+/).filter(Boolean); setSeatIds((event.target.checked ? [...ids, seat.id] : ids.filter(id => id !== seat.id)).join(', ')); }} /><span>{seat.name}</span></label>)}</fieldset>}<div className="management-actions skill-step-actions"><button type="button" disabled={working} onClick={() => goTo('files')}>上一步：技能内容</button><button type="button" className="primary-action" disabled={working || !base || dirty || detail.skill.archived || policyMode === 'seats' && !seatIds.split(/[,，\s]+/).filter(Boolean).length} onClick={() => void savePolicy()}>保存范围并继续</button></div>{dirty && <p role="status">请先保存技能内容。</p>}<button type="button" disabled={working} onClick={() => void run(async () => { const value = await api<ManagedSkillDetail>(url); setLatestPolicy(value.policy); })}>查看最新使用范围</button>{latestPolicy && <section className="management-compare"><h4>最新使用范围（只读）</h4><p>{latestPolicy.mode === 'none' ? '未开放' : latestPolicy.mode === 'all' ? '全部业务席位' : `指定业务席位：${latestPolicy.seatIds.map(id => seats.find(seat => seat.id === id)?.name || id).join('、')}`}</p><p>本地选择保持不变，明确采用后才更新保存基线。</p><button type="button" onClick={() => { setPolicyBase(latestPolicy); setPolicyMode(latestPolicy.mode); setSeatIds(latestPolicy.seatIds.join(', ')); setLatestPolicy(undefined); setError(''); }}>放弃本地范围修改，使用最新范围</button></section>}<details className="skill-state-actions"><summary>状态管理</summary><div className="management-actions"><button type="button" disabled={working || detail.skill.archived} onClick={() => void lifecycle(detail.skill.state === 'disabled' ? 'restore' : 'disable')}>{detail.skill.state === 'disabled' ? '恢复启用' : '普通停用'}</button><button type="button" disabled={working || detail.skill.archived} onClick={() => void lifecycle('archive')}>归档技能</button></div></details></>}
  </div>;
}

function ScanReport({ scan }: { scan: SkillScanReport }) { return <div className="skill-scan-report"><p>{scan.scanner} {scan.scannerVersion} · {new Date(scan.createdAt).toLocaleString()}</p>{scan.state === 'completed' && scan.findings.length === 0 && <p>本次规则范围内未发现问题；这不表示绝对安全。</p>}<ul>{scan.findings.map((item, index) => <li key={index}><strong>{item.path}:{item.line}</strong><p>{item.message}</p><small>{item.ruleId} · 工具原始严重性：{item.severity}</small></li>)}</ul><p>目标脚本 {scan.targets.length} · 已扫描 {scan.scanned.length}</p>{scan.skipped.map((item, index) => <p key={index}>未覆盖 {item.path}：{item.reason}</p>)}{scan.errors.map((error, index) => <p className="resource-error" key={index}>{error}</p>)}<details><summary>扫描证据</summary><p>包摘要：{scan.packageDigest}</p><p>规则摘要：{scan.rulesDigest}</p><ul>{scan.scanned.map(path => <li key={path}>{path}</li>)}</ul></details></div>; }
