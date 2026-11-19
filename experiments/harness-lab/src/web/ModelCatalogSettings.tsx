import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Plus } from 'lucide-react';
import type { ModelCatalog, ModelPlatform, ModelProfile } from '../contracts/index';
import { ApiFailure, useApi } from './api';
import { ModelSettings } from './ModelSettings';
import { PlatformModelDiscovery } from './PlatformModelDiscovery';
import { PlatformSettings } from './PlatformSettings';
import './model-settings.css';

type Editor = { kind: 'connection' } | { kind: 'model'; id: string } | null;

function modelStatus(model: ModelProfile, platform: ModelPlatform) {
  if (model.available) return '可供席位选择';
  if (model.enabled === false) return '待启用';
  if (!platform.enabled) return '平台已停用';
  if (!platform.configured) return '缺 API Key';
  if (!model.contextReady) return '待补容量';
  if (!model.usageConfirmed) return '待确认用途';
  return '暂不可用';
}

export function ModelCatalogSettings({ saved }: { saved: () => Promise<void> }) {
  const { api } = useApi();
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [platformId, setPlatformId] = useState<string>();
  const [editor, setEditor] = useState<Editor>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const nextFocus = useRef<'view' | 'editor' | null>(null);

  useEffect(() => {
    let current = true;
    api<ModelCatalog>('/api/settings/models').then(result => {
      if (current) { setCatalog(result); setLoadError(''); }
    }).catch((reason: unknown) => {
      if (current) setLoadError(reason instanceof Error ? reason.message : '平台列表读取失败。');
    });
    return () => { current = false; };
  }, [api, reload]);

  useEffect(() => {
    if (!nextFocus.current) return;
    (nextFocus.current === 'view' ? heading : editorHeading).current?.focus();
    nextFocus.current = null;
  }, [platformId, editor]);

  function navigate(target?: string, nextEditor: Editor = null) {
    if (busy) return;
    if (dirty && !window.confirm('当前有未保存的配置，离开将放弃这些修改。是否继续？')) return;
    nextFocus.current = nextEditor ? 'editor' : 'view';
    setDirty(false);
    setNotice('');
    setDeleteError('');
    setPlatformId(target);
    setEditor(nextEditor);
  }
  function edited(value: boolean) {
    setDirty(value);
    if (value) setNotice('');
  }

  async function refresh() {
    setCatalog(await api<ModelCatalog>('/api/settings/models'));
  }
  async function refreshAfterSave(message: string) {
    const results = await Promise.allSettled([refresh(), saved()]);
    setNotice(results.some(result => result.status === 'rejected') ? '配置已保存。重新打开设置可刷新列表。' : message);
  }
  async function savedPlatform(result: ModelPlatform) {
    setCatalog(previous => previous && {
      ...previous, version: result.version,
      platforms: previous.platforms?.some(item => item.id === result.id)
        ? previous.platforms.map(item => item.id === result.id ? result : item)
        : [...(previous.platforms ?? []), result],
    });
    nextFocus.current = 'view';
    setPlatformId(result.id);
    setEditor(null);
    await refreshAfterSave('连接已保存，下次请求使用新配置。');
  }
  async function savedProfile(profile: ModelProfile) {
    setCatalog(previous => previous && {
      ...previous, version: profile.version,
      models: previous.models.some(item => item.id === profile.id)
        ? previous.models.map(item => item.id === profile.id ? profile : item)
        : [...previous.models, profile],
    });
    const moved = profile.platformId && profile.platformId !== platformId;
    if (editor?.kind === 'model' && (editor.id === 'new' || moved)) {
      nextFocus.current = 'view';
      setEditor(null);
      if (moved) setPlatformId(profile.platformId);
    }
    await refreshAfterSave('已保存，下次发送消息时使用新配置。');
  }
  function imported(result: ModelCatalog) {
    setCatalog(result);
    setNotice('模型已添加，请在下方核对配置后启用。');
    heading.current?.focus();
    void saved().catch(() => setNotice('模型已添加。重新打开设置可刷新对话模型列表。'));
  }

  const platforms = catalog?.platforms ?? [];
  const platform = platforms.find(item => item.id === platformId);
  const models = catalog?.models.filter(item => item.platformId === platformId) ?? [];
  const includesDefault = models.some(model => model.id === 'default');
  function finishDeletion(result: ModelCatalog) {
    setCatalog(result);
    nextFocus.current = 'view';
    setPlatformId(undefined);
    setEditor(null);
    setDirty(false);
    setDeleteError('');
    setNotice('平台配置已删除。');
    void saved().catch(() => setNotice('平台配置已删除。重新打开设置可刷新对话模型列表。'));
  }
  async function deletePlatform() {
    if (!platform || !catalog || busy || includesDefault) return;
    const related = models.length ? `及其下的 ${models.length} 个模型` : '';
    const history = models.length ? ' 已有对话会保留，使用这些模型的对话需要改选。' : '';
    const changes = dirty ? ' 当前未保存的编辑也会丢弃。' : '';
    if (!window.confirm(`删除「${platform.name}」的配置${related}？已保存的 API Key 也会删除。${history}${changes}`)) return;
    setBusy(true);
    setDeleteError('');
    setNotice('');
    try {
      const result = await api<ModelCatalog>('/api/settings/platforms/' + encodeURIComponent(platform.id), { expectedVersion: catalog.version }, 'DELETE');
      finishDeletion(result);
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : '删除结果未确认，请核对平台列表。');
      if (!(reason instanceof ApiFailure) || ['MODEL_SETTINGS_CONFLICT', 'MODEL_SETTINGS_SAVE_FAILED', 'MODEL_PLATFORM_NOT_FOUND', 'DEFAULT_MODEL_PLATFORM'].includes(reason.code)) {
        try {
          const latest = await api<ModelCatalog>('/api/settings/models');
          if (latest.platforms?.some(item => item.id === platform.id)) setCatalog(latest);
          else finishDeletion(latest);
        } catch { setDeleteError('暂时无法确认删除结果，请重新打开设置核对平台列表。'); }
      }
    } finally { setBusy(false); }
  }
  const creating = platformId === 'new';
  const title = creating ? '添加平台' : platform?.name ?? '模型管理';
  const connectionEditor = catalog && (creating || editor?.kind === 'connection') && <PlatformSettings
    key={platformId} platform={platform} catalogVersion={catalog.version} saved={savedPlatform} edited={edited} busy={setBusy}
    cancel={() => navigate(platform?.id)} />;

  return <section className="settings-content model-management" aria-labelledby="model-management-title">
    {platformId && <button type="button" className="text-action model-pane-back" disabled={busy} onClick={() => navigate()}>
      <ArrowLeft size={15} aria-hidden="true" />平台列表
    </button>}
    <div className="model-pane-heading model-management-heading">
      <div className="model-pane-title">
        <h3 ref={heading} tabIndex={-1} id="model-management-title">{title}</h3>
        {platform && <span className={platform.enabled ? 'model-status model-status-ready' : 'model-status'}>{platform.enabled ? '平台已启用' : '平台已停用'}</span>}
      </div>
      {!platformId && catalog && <button type="button" className="primary-action" onClick={() => navigate('new')}>
        <Plus size={16} aria-hidden="true" />添加平台
      </button>}
    </div>
    {notice && <p className="settings-success model-pane-notice" role="status">{notice}</p>}
    {deleteError && <p className="resource-error" role="alert">{deleteError}</p>}
    {!catalog ? loadError ? <div className="model-pane-heading">
      <p className="resource-error" role="alert">{loadError}</p>
      <button type="button" className="text-action" onClick={() => { setLoadError(''); setReload(value => value + 1); }}>重试</button>
    </div> : <p role="status">正在读取平台列表…</p>
      : !platformId ? <>
        <h4 className="model-platform-list-title">平台列表</h4>
        {platforms.length ? <ul className="model-platform-list" aria-label="平台列表">
          {platforms.map(item => {
            const related = catalog.models.filter(model => model.platformId === item.id);
            const defaultModel = related.find(model => model.id === 'default');
            return <li key={item.id}><button type="button" className="model-platform-row" onClick={() => navigate(item.id)}>
              <span className="model-platform-row-label"><strong>{item.name}</strong><span className="model-detail-muted">
                {related.length} 个模型{defaultModel ? ' · 含系统默认' : ''}
              </span></span>
              <span className={item.enabled ? 'model-status model-status-ready' : 'model-status'}>{item.enabled ? item.configured ? '已启用' : '缺 API Key' : '已停用'}</span>
              <ChevronRight size={16} aria-hidden="true" />
            </button></li>;
          })}
        </ul> : <p className="resource-help">添加平台后即可配置模型。</p>}
      </> : creating ? connectionEditor : platform ? <>
        <section className="model-platform-connection" aria-labelledby="platform-connection-title">
          <div className="model-pane-heading">
            <h4 ref={editor?.kind === 'connection' ? editorHeading : undefined} tabIndex={-1} id="platform-connection-title">连接配置</h4>
            {editor?.kind !== 'connection' && <div className="model-pane-actions">
              <button type="button" className="text-action" disabled={busy} onClick={() => navigate(platform.id, { kind: 'connection' })}>编辑连接</button>
              <button type="button" className="text-action danger-action" disabled={busy || includesDefault} aria-describedby={includesDefault ? 'model-platform-delete-help' : undefined}
                onClick={() => void deletePlatform()}>删除平台</button>
            </div>}
          </div>
          {connectionEditor || <>
            {includesDefault && <p id="model-platform-delete-help" className="resource-help">此平台包含系统默认模型，迁移默认模型后可删除。</p>}
            <dl className="model-connection-facts">
              <div><dt>API 地址</dt><dd><code>{platform.baseUrl}</code></dd></div>
              <div><dt>API Key</dt><dd>{platform.configured ? '已保存' : '未配置'}</dd></div>
            </dl>
            <details className="model-connection-details"><summary>协议与高级设置</summary>
              <dl className="model-connection-facts">
                <div><dt>API 协议</dt><dd>{platform.api === 'anthropic-messages' ? 'Anthropic Messages' : 'OpenAI Chat Completions'}</dd></div>
                {platform.modelsPath && <div><dt>模型目录路径</dt><dd><code>{platform.modelsPath}</code></dd></div>}
              </dl>
            </details>
          </>}
        </section>
        <section className="model-platform-models" aria-label="平台模型">
          <PlatformModelDiscovery key={platform.id} platform={platform} version={catalog.version} existing={new Set(models.map(item => item.model))}
            imported={imported} busy={setBusy} blocked={busy} editing={editor !== null} refresh={refresh}
            manual={() => navigate(platform.id, { kind: 'model', id: 'new' })} />
          {models.length > 0 ? <ul className="model-platform-list" aria-label="已添加模型">
            {models.map(model => <li key={model.id} className="model-profile-row">
              <span className="model-platform-row-label">
                <strong>{model.displayName || model.model || '未配置模型'}</strong><code>{model.model}</code>
              </span>
              <span className="model-profile-status">
                {model.id === 'default' && <span className="model-default-label">系统默认</span>}
                <span className={model.available ? 'model-status model-status-ready' : 'model-status'}>{modelStatus(model, platform)}</span>
              </span>
              <button type="button" className="text-action" aria-label={'编辑模型 ' + (model.displayName || model.model || '系统默认')}
                disabled={busy || editor?.kind === 'model' && editor.id === model.id} onClick={() => navigate(platform.id, { kind: 'model', id: model.id })}>编辑</button>
            </li>)}
          </ul> : <p className="resource-help">此平台还没有模型。</p>}
          {editor?.kind === 'model' && <section className="model-profile-editor" aria-labelledby="model-editor-title">
            <div className="model-pane-heading">
              <h4 ref={editorHeading} id="model-editor-title" tabIndex={-1}>{editor.id === 'new' ? '手动添加模型' : '编辑模型'}</h4>
              <button type="button" className="text-action" disabled={busy} onClick={() => navigate(platform.id)}>取消编辑</button>
            </div>
            <ModelSettings key={editor.id} profileId={editor.id} creating={editor.id === 'new'} platforms={platforms}
              initialPlatformId={platform.id} saved={savedProfile} edited={edited} busy={setBusy} />
          </section>}
        </section>
      </> : <p className="resource-error" role="alert">该平台已不在列表中。请返回平台列表。</p>}
  </section>;
}
