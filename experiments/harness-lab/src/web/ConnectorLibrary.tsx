import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, Link, Plus, RefreshCw } from 'lucide-react';
import type { ConnectorConfigInput, ConnectorCredentialStatus, ConnectorDetail, ConnectorDiscovery, ConnectorSummary, ConnectorTool } from '../contracts/connectors';
import type { Workspace } from '../contracts/index';
import { ApiFailure, checkResponse, useApi } from './api';
import { LoadingIndicator } from './LoadingIndicator';
import { Panel } from './Resources';
import { randomUUID } from './random-uuid';
import { sessionAction } from './session-action';
import './connectors.css';

const root = '/api/admin/connections';
const failure = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请核对当前状态。';
const slotNames = { information: '特情系统', situation: '态势系统', 'simulation-control': '演练控制', ingress: '业务入站' };
export const connectorReady = (item: ConnectorSummary) => item.kind === 'mcp' && item.state === 'enabled' && (item.auth.mode === 'none' || item.credential.configured);

export function ConnectorLibrary({ administrator, query, refresh, workspaces, fixedWorkspaceId, applyConnector }: {
  administrator: boolean; query: string; refresh: number; workspaces: Workspace[]; fixedWorkspaceId?: string;
  applyConnector?: (workspaceId: string, connector: ConnectorSummary) => Promise<void>;
}) {
  const { api } = useApi();
  const [items, setItems] = useState<ConnectorSummary[]>();
  const [eligible, setEligible] = useState<ConnectorSummary[]>([]);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<ConnectorSummary>();
  useEffect(() => {
    let live = true;
    void Promise.all([api<ConnectorSummary[]>(administrator ? root : '/api/capabilities/connectors'), administrator ? api<ConnectorSummary[]>('/api/capabilities/connectors') : undefined]).then(([value, allowed]) => {
      if (live) { setItems(value); setEligible(allowed || value); setError(''); }
    }).catch(error => { if (live) setError(failure(error)); });
    return () => { live = false; };
  }, [api, administrator, refresh, reload]);
  const search = query.trim().toLocaleLowerCase();
  const visible = items?.filter(item => `${item.name} ${item.description}`.toLocaleLowerCase().includes(search));
  const changed = () => setReload(value => value + 1);
  return <div className="connector-library">
    <div className="capability-section-label"><h2>连接器</h2>{visible && <span>{visible.length} 个连接器</span>}{administrator && <button type="button" className="primary-action" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" />添加 MCP</button>}</div>
    <div className="capability-grid connector-grid" aria-label="连接器列表">{visible?.map(item => <article className="expert-card connector-card" key={item.connectorId}>
      <div className="expert-card-heading"><span className="expert-card-icon"><Link size={23} aria-hidden="true" /></span><h3>{item.name}</h3><span className="expert-card-status">{item.state === 'enabled' ? '已启用' : '已停用'}</span></div>
      {item.description && <p>{item.description}</p>}<span className="connector-auth-state">{item.businessSlot ? `${slotNames[item.businessSlot]} · 固定接入` : item.auth.mode === 'none' ? '无需凭证' : item.auth.credentialSource === 'personal' ? item.credential.configured ? '本人凭证已配置' : '需要本人凭证' : item.credential.configured ? '组织凭证已配置' : '组织凭证未配置'}</span>
      <ConnectorTools tools={item.tools} /><div className="expert-card-footer"><span>{item.kind === 'mcp' ? '远程 MCP' : '内置业务'}</span>{administrator ? <><button type="button" aria-label={`配置连接器${item.name}`} onClick={() => setSelected(item.connectorId)}>配置<ArrowRight size={15} aria-hidden="true" /></button>{eligible.some(value => value.connectorId === item.connectorId) && item.kind === 'mcp' && <button type="button" onClick={() => setViewing(eligible.find(value => value.connectorId === item.connectorId)!)}>查看与使用</button>}</> : <button type="button" aria-label={`查看连接器${item.name}`} onClick={() => setViewing(item)}>查看详情<ArrowRight size={15} aria-hidden="true" /></button>}</div>
    </article>)}</div>
    {!items && !error && <LoadingIndicator label="正在读取连接器…" />}
    {visible?.length === 0 && <div className="capability-empty"><Link size={32} aria-hidden="true" /><h3>{search ? '没有找到相关连接器' : '暂无连接器'}</h3>{search && <p>试试其他关键词。</p>}</div>}
    {(creating || selected) && <ConnectorManagement key={selected || 'new'} connectorId={selected} close={() => { setCreating(false); setSelected(undefined); }} changed={changed} />}
    {error && <p className="resource-error" role="alert">{error}<button type="button" onClick={changed}>重新读取</button></p>}
    {viewing && <ConnectorUse key={viewing.connectorId} connector={viewing} workspaces={workspaces} fixedWorkspaceId={fixedWorkspaceId} applyConnector={applyConnector} close={() => setViewing(undefined)} changed={changed} />}
  </div>;
}

function ConnectorTools({ tools }: { tools: ConnectorTool[] }) {
  return <details className="connector-tools"><summary><span>工具（{tools.length}）</span><ChevronDown size={15} aria-hidden="true" /></summary>{tools.length ? <ul>{tools.map(tool => <li key={tool.name}><strong>{tool.name}</strong>{tool.description && <p>{tool.description}</p>}{!tool.available && <small>{tool.unavailableReason || '暂不可用'}</small>}</li>)}</ul> : <p>工具将在本次身份连接后核对。</p>}</details>;
}

function ConnectorUse({ connector, workspaces, fixedWorkspaceId, applyConnector, close, changed }: {
  connector: ConnectorSummary; workspaces: Workspace[]; fixedWorkspaceId?: string; applyConnector?: (id: string, item: ConnectorSummary) => Promise<void>; close: () => void; changed: () => void;
}) {
  const { api } = useApi();
  const [workspaceId, setWorkspaceId] = useState(workspaces.some(item => item.id === fixedWorkspaceId) ? fixedWorkspaceId! : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState(connector);
  async function stage() {
    if (busy || !workspaceId || !applyConnector) return; setBusy(true); setError('');
    try {
      const catalog = await api<ConnectorSummary[]>(`/api/capabilities/connectors?${new URLSearchParams({ workspaceId })}`);
      const item = catalog.find(item => item.connectorId === connector.connectorId);
      if (!item || !connectorReady(item)) throw new Error('连接器当前不可用，请核对开放工具和凭证。');
      await applyConnector(workspaceId, item); close();
    } catch (error) { setError(failure(error)); } finally { setBusy(false); }
  }
  return <Panel title={connector.name} close={() => { if (!busy) close(); }} className="connector-detail-panel"><p>{connector.description}</p><ConnectorTools tools={connector.tools} />
    {connector.auth.mode !== 'none' && connector.auth.credentialSource === 'personal' && <CredentialForm path={`/api/connectors/${encodeURIComponent(connector.connectorId)}/credential`} personal changed={status => { setCurrent(value => ({ ...value, credential: status })); changed(); }} />}
    {applyConnector && connector.kind === 'mcp' && <form className="workspace-form" onSubmit={event => { event.preventDefault(); void stage(); }}><label>使用空间<select aria-label="使用空间" value={workspaceId} disabled={busy} required onChange={event => setWorkspaceId(event.target.value)}><option value="">选择已有空间</option>{workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>{error && <p className="resource-error" role="alert">{error}</p>}<button type="submit" className="primary-action" disabled={busy || !workspaceId || !connectorReady(current)}>用于对话</button></form>}
  </Panel>;
}

function initialConfig(): ConnectorConfigInput { return { name: '', description: '', endpoint: '', auth: { mode: 'none', credentialSource: 'organization' }, approvedTargets: [], policy: { mode: 'none', seatIds: [], personal: false }, exposedTools: [] }; }
function ConnectorManagement({ connectorId, close, changed }: { connectorId?: string; close: () => void; changed: () => void }) {
  const { api, storageKey } = useApi();
  const [detail, setDetail] = useState<ConnectorDetail>();
  const [config, setConfig] = useState<ConnectorConfigInput>(initialConfig);
  const [base, setBase] = useState<string>();
  const [discovery, setDiscovery] = useState<ConnectorDiscovery>();
  const [latest, setLatest] = useState<ConnectorDetail>();
  const [seats, setSeats] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'configuration' | 'tools' | 'policy'>('configuration');
  function adopt(value: ConnectorDetail) {
    setDetail(value); setBase(value.revision.revisionId); setConfig({ name: value.revision.name, description: value.revision.description, endpoint: value.revision.endpoint, auth: value.revision.auth, approvedTargets: value.revision.approvedTargets, policy: value.revision.policy, exposedTools: value.revision.exposedTools }); setDiscovery(value.discovery); setLatest(undefined);
  }
  useEffect(() => { let live = true; if (connectorId) void api<ConnectorDetail>(`${root}/${encodeURIComponent(connectorId)}`).then(value => { if (live) adopt(value); }).catch(error => { if (live) setError(failure(error)); }); void api<{ seats: Array<{ id: string; name: string }> }>('/api/admin/capabilities/catalog').then(value => { if (live) setSeats(value.seats); }).catch(() => {}); return () => { live = false; }; }, [api, connectorId]);
  const id = connectorId || detail?.connection.connectorId;
  const endpoint = id ? `${root}/${encodeURIComponent(id)}` : root;
  const baselineConfig = detail && { name: detail.revision.name, description: detail.revision.description, endpoint: detail.revision.endpoint, auth: detail.revision.auth, approvedTargets: detail.revision.approvedTargets, policy: detail.revision.policy, exposedTools: detail.revision.exposedTools };
  const dirty = detail ? JSON.stringify(config) !== JSON.stringify(baselineConfig) : Boolean(config.name || config.endpoint || config.description);
  async function run(action: () => Promise<void>) { if (pending.current) return; pending.current = true; setBusy(true); setError(''); setNotice(''); try { await action(); } catch (error) { setError(failure(error)); } finally { pending.current = false; setBusy(false); } }
  function setTransport(next: ConnectorConfigInput) {
    setConfig({ ...next, exposedTools: [] }); setDiscovery(undefined);
    if (id) setNotice('地址或认证已修改，保存后请重新发现并开放工具。');
  }
  async function save() {
    await run(async () => {
      const address = new URL(config.endpoint);
      if (!['https:', 'http:'].includes(address.protocol) || address.username || address.password || address.search || address.hash) throw new Error('请填写不含账号、密码、查询参数和片段的 HTTP 服务地址。');
      const normalized = { ...config, name: config.name.trim(), endpoint: address.href, approvedTargets: [...new Set(config.approvedTargets.map(value => value.trim()).filter(Boolean))] };
      const input = id ? { ...normalized, expectedRevisionId: base } : normalized;
      const action = sessionAction(storageKey(`connector-config:${id || 'new'}`), input);
      const value = await api<ConnectorDetail>(endpoint, { ...input, clientActionId: action.id }, id ? 'PUT' : 'POST');
      action.complete(); adopt(value); setNotice(id ? '连接配置已保存。' : '连接已添加，尚未启用。请主动发现工具并设置开放范围。'); changed();
    });
  }
  async function discover() { if (!id) return; await run(async () => { const value = await api<ConnectorDiscovery>(`${endpoint}/discover`, { expectedRevisionId: base, clientActionId: randomUUID() }); setDiscovery(value); setNotice('工具发现完成。勾选并保存后才会开放。'); }); }
  async function lifecycle() { if (!id || !detail) return; await run(async () => { const value = await api<ConnectorDetail>(`${endpoint}/lifecycle`, { action: detail.connection.state === 'enabled' ? 'disable' : 'restore', expectedStateRevision: detail.connection.stateRevision, clientActionId: randomUUID() }); setDetail(value); setNotice(value.connection.state === 'enabled' ? '连接已启用。' : '连接已停用。'); changed(); }); }
  async function readLatest() { if (!id) return; await run(async () => { setLatest(await api<ConnectorDetail>(endpoint)); }); }
  const leave = () => { if (!busy && (!dirty || confirm('有未保存的连接配置，放弃修改并关闭？'))) close(); };
  const legacy = detail?.revision.kind === 'legacy';
  return <Panel title={id ? detail?.connection.name || '连接管理' : '添加 MCP'} close={leave} className="connector-management-panel">
    {error && <div className="resource-error" role="alert"><p>{error}</p>{id && <button type="button" disabled={busy} onClick={() => void readLatest()}>查看最新配置</button>}</div>}
    {notice && <p role="status">{notice}</p>}
    {connectorId && !detail ? !error && <LoadingIndicator label="正在读取连接配置…" /> : <>
      {detail && <div className="connector-management-state"><span>{detail.connection.state === 'enabled' ? '已启用' : '已停用'}{legacy ? ' · 原业务固定单实例' : ''}</span><button type="button" disabled={busy || dirty} onClick={() => void lifecycle()}>{detail.connection.state === 'enabled' ? '停用连接' : '启用连接'}</button></div>}
      <nav className="connector-editor-tabs" aria-label="连接管理内容">{(['configuration', 'tools', 'policy'] as const).map(value => <button type="button" key={value} disabled={!id && value !== 'configuration'} aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}>{{ configuration: '连接配置', tools: '工具', policy: '使用范围' }[value]}</button>)}</nav>
      <form className="workspace-form connector-form" onSubmit={event => { event.preventDefault(); void save(); }}>
        {tab === 'configuration' && <fieldset disabled={busy}>
          <label>连接名称<input aria-label="连接名称" required maxLength={120} value={config.name} onChange={event => setConfig({ ...config, name: event.target.value })} /></label>
          <label>简介<textarea aria-label="连接简介" rows={2} maxLength={2000} value={config.description} onChange={event => setConfig({ ...config, description: event.target.value })} /></label>
          <label>服务地址<input disabled={detail?.revision.businessSlot === 'ingress'} aria-label="服务地址" type="url" required value={config.endpoint} onChange={event => setTransport({ ...config, endpoint: event.target.value })} /></label>
          <label>认证方式<select disabled={legacy} aria-label="认证方式" value={config.auth.mode} onChange={event => setTransport({ ...config, auth: event.target.value === 'none' ? { mode: 'none', credentialSource: 'organization' } : event.target.value === 'api-key' ? { mode: 'api-key', credentialSource: config.auth.credentialSource, headerName: config.auth.headerName || 'X-API-Key' } : { mode: 'bearer', credentialSource: config.auth.credentialSource } })}><option value="none">无认证</option><option value="bearer">Bearer Token</option><option value="api-key">API Key</option></select></label>
          {config.auth.mode !== 'none' && <><label>凭证来源<select disabled={legacy} aria-label="凭证来源" value={config.auth.credentialSource} onChange={event => setTransport({ ...config, auth: { ...config.auth, credentialSource: event.target.value as 'organization' | 'personal' } })}><option value="organization">组织统一凭证</option>{!legacy && <option value="personal">使用者本人凭证</option>}</select></label>{config.auth.mode === 'api-key' && <label>API Key 请求头<input disabled={legacy} aria-label="API Key 请求头" required value={config.auth.headerName || ''} placeholder="X-API-Key" onChange={event => setTransport({ ...config, auth: { ...config.auth, headerName: event.target.value } })} /></label>}</>}
          <details className="connector-network"><summary>额外网络许可</summary><label>获准的目标源站 / IP（每行一项）<textarea aria-label="获准的目标源站或 IP" rows={3} value={config.approvedTargets.join('\n')} onChange={event => setTransport({ ...config, approvedTargets: event.target.value.split('\n') })} /></label><p>私网需显式填写源站和 IP。公共 HTTPS 使用默认网络校验。</p></details>
        </fieldset>}
        {tab === 'tools' && <section className="connector-discovery"><div className="connector-tool-heading"><h3>开放工具</h3><button type="button" disabled={busy || !id || dirty || legacy} onClick={() => void discover()}><RefreshCw size={15} aria-hidden="true" />发现工具</button></div>{!id && <p>先保存连接，再主动发现工具。</p>}{id && !discovery && <p>尚未发现工具。</p>}{discovery && <><p>{discovery.tools.length} 个已发现工具 · 协议 {discovery.protocolVersion}</p><fieldset disabled={busy}>{discovery.tools.map(tool => <label className="connector-tool-choice" key={tool.name}><input type="checkbox" checked={config.exposedTools.some(item => item.name === tool.name && item.contractDigest === tool.contractDigest)} disabled={!tool.available} onChange={event => setConfig({ ...config, exposedTools: event.target.checked ? [...config.exposedTools.filter(item => item.name !== tool.name), { name: tool.name, contractDigest: tool.contractDigest }] : config.exposedTools.filter(item => item.name !== tool.name) })} /><span><strong>{tool.name}</strong>{tool.description && <small>{tool.description}</small>}{!tool.available && <small>{tool.unavailableReason || '工具不可用'}</small>}<details><summary>参数格式</summary><pre tabIndex={0}>{JSON.stringify(tool.inputSchema, null, 2)}</pre></details></span></label>)}</fieldset></>}</section>}
        {tab === 'policy' && <fieldset disabled={busy || legacy}><label>业务席位范围<select aria-label="业务席位范围" value={config.policy.mode} onChange={event => setConfig({ ...config, policy: { ...config.policy, mode: event.target.value as ConnectorConfigInput['policy']['mode'], seatIds: event.target.value === 'seats' ? config.policy.seatIds : [] } })}><option value="none">不开放业务席位</option><option value="all">所有业务席位</option><option value="seats">指定业务席位</option></select></label>{config.policy.mode === 'seats' && <div className="connector-seat-choices">{seats.map(seat => <label key={seat.id}><input type="checkbox" checked={config.policy.seatIds.includes(seat.id)} onChange={event => setConfig({ ...config, policy: { ...config.policy, seatIds: event.target.checked ? [...config.policy.seatIds, seat.id] : config.policy.seatIds.filter(id => id !== seat.id) } })} />{seat.name}</label>)}</div>}<label className="connector-checkbox"><input type="checkbox" checked={config.policy.personal} onChange={event => setConfig({ ...config, policy: { ...config.policy, personal: event.target.checked } })} />允许个人空间使用（含独立管理员）</label></fieldset>}
        <div className="dialog-actions"><button type="button" onClick={leave} disabled={busy}>关闭</button><button type="submit" className="primary-action" disabled={busy || Boolean(id && !dirty) || !config.name.trim() || !config.endpoint.trim()}>{busy ? '处理中…' : id ? '保存配置' : '添加连接'}</button></div>
      </form>
      {detail && detail.revision.businessSlot !== 'ingress' && detail.revision.auth.mode !== 'none' && detail.revision.auth.credentialSource === 'organization' && <CredentialForm key={`${id}:${detail.connection.credential.version}`} path={`${endpoint}/credential`} personal={false} changed={() => { setDiscovery(undefined); changed(); }} />}
      {detail?.revision.businessSlot === 'ingress' && detail.sourceIds?.map(sourceId => <section key={sourceId} className="connector-source-channel"><h3>入站通道 · {sourceId}</h3><CredentialForm path={`${endpoint}/credential?${new URLSearchParams({ sourceId })}`} personal={false} changed={() => changed()} /></section>)}
      {detail && detail.revision.auth.mode !== 'none' && detail.revision.auth.credentialSource === 'personal' && <CredentialForm key={`${id}:personal`} path={`${endpoint}/credential`} personal management changed={() => { setDiscovery(undefined); changed(); }} />}
      {latest && <section className="connector-latest"><h3>最新配置（只读）</h3><p>{latest.revision.name} · 修订 {latest.revision.revision}</p><p>{latest.revision.endpoint}</p><button type="button" disabled={busy} onClick={() => { adopt(latest); setNotice('已采用最新配置。'); }}>放弃本地修改，使用最新配置</button></section>}
    </>}
  </Panel>;
}

function CredentialForm({ path, personal, management = false, changed }: { path: string; personal: boolean; management?: boolean; changed: (status: ConnectorCredentialStatus) => void }) {
  const { api, request, url } = useApi();
  const [status, setStatus] = useState<ConnectorCredentialStatus>();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { let live = true; void api<ConnectorCredentialStatus>(path).then(value => { if (live) setStatus(value); }).catch(error => { if (live) setError(failure(error)); }); return () => { live = false; }; }, [api, path]);
  async function reconcile() { if (pending.current) return; pending.current = true; setBusy(true); try { const result = await api<ConnectorCredentialStatus>(path); setStatus(result); setUncertain(false); setError(''); setNotice('已读取当前凭证状态，请核对后继续。'); changed(result); } catch (error) { setError(failure(error)); } finally { pending.current = false; setBusy(false); } }
  async function mutate(revoke = false) {
    if (pending.current || uncertain || !status || !revoke && !value.trim()) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      // Secret-bearing input must never be passed to sessionAction or browser storage.
      const input = { expectedVersion: status.version, clientActionId: randomUUID(), ...(revoke ? {} : { value }) };
      const result = revoke ? await checkResponse(await request(url(path), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).then(response => response.json() as Promise<ConnectorCredentialStatus>) : await api<ConnectorCredentialStatus>(path, input, 'PUT');
      setStatus(result); setNotice(revoke ? '凭证已撤销。' : '凭证已保存，不显示密钥。'); changed(result);
    } catch (error) { setError(failure(error)); if (!(error instanceof ApiFailure)) setUncertain(true); }
    finally { setValue(''); pending.current = false; setBusy(false); }
  }
  return <section className="connector-credential"><h3>{personal ? management ? '本人凭证（用于管理发现）' : '本人凭证' : '组织凭证'}</h3><p>{status ? status.configured ? '已配置，不显示密钥。' : '尚未配置凭证。' : '正在读取凭证状态…'}</p>{personal && management && <p>发现工具使用当前管理员本人的凭证。用于对话仍须满足启用状态和使用范围。</p>}{personal && <p>仅当前账号使用，可用于个人空间及本人有权参与的公共任务。撤销不会删除已进入对话的结果。</p>}<form className="workspace-form" onSubmit={event => { event.preventDefault(); void mutate(); }}><label>{personal ? '新的本人凭证' : '新的组织凭证'}<input type="password" aria-label={personal ? '新的本人凭证' : '新的组织凭证'} autoComplete="off" value={value} disabled={busy || uncertain || !status} onChange={event => setValue(event.target.value)} /></label>{error && <p className="resource-error" role="alert">{error}</p>}{uncertain && <p role="status">保存结果尚未确认，请先读取当前凭证状态。</p>}{notice && <p role="status">{notice}</p>}<div className="dialog-actions"><button type="button" disabled={busy} onClick={() => void reconcile()}>读取当前凭证状态</button>{status?.configured && <button type="button" disabled={busy || uncertain} onClick={() => void mutate(true)}>撤销凭证</button>}<button type="submit" className="primary-action" disabled={busy || uncertain || !status || !value.trim()}>保存凭证</button></div></form></section>;
}
