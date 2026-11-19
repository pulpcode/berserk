import { useEffect, useRef, useState } from 'react';
import type { DiscoveredModel, ModelCatalog, ModelPlatform } from '../contracts/index';
import { builtinModel } from '../contracts/model-presets';
import { ApiFailure, checkResponse, useApi } from './api';

export function PlatformModelDiscovery({ platform, version, existing, imported, busy, blocked, editing, manual, refresh }: {
  platform: ModelPlatform;
  version: string;
  existing: ReadonlySet<string>;
  imported: (catalog: ModelCatalog) => void;
  busy: (value: boolean) => void;
  blocked: boolean;
  editing: boolean;
  manual: () => void;
  refresh: () => Promise<void>;
}) {
  const client = useApi();
  const path = '/api/settings/platforms/' + encodeURIComponent(platform.id) + '/models';
  const preset = builtinModel(platform);
  const active = useRef<AbortController | null>(null);
  const [source, setSource] = useState<'preset' | 'directory'>();
  const [listing, setListing] = useState<{ version: string; models: DiscoveredModel[] }>();
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const presetButton = useRef<HTMLButtonElement>(null);
  const directoryButton = useRef<HTMLButtonElement>(null);
  useEffect(() => () => active.current?.abort(), []);

  function open(next: typeof source) {
    setSource(next); setSelected([]); setQuery(''); setError('');
  }
  async function read() {
    if (active.current || blocked) return;
    const controller = new AbortController();
    active.current = controller;
    open('directory'); setLoading(true); setListing(undefined);
    try {
      const response = await checkResponse(await client.request(client.url(path), { signal: controller.signal, cache: 'no-store' }));
      const next: { version: string; models: DiscoveredModel[] } = await response.json();
      if (!controller.signal.aborted) setListing(next);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法获取模型，可以手动填写模型 ID。');
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  function close() {
    open(undefined);
    (source === 'preset' ? presetButton : directoryButton).current?.focus();
  }

  const candidates = selected.filter(id => !existing.has(id));
  const listingVersion = source === 'preset' ? version : listing?.version;
  async function save() {
    if (!listingVersion || blocked || saving || editing || active.current || !candidates.length || candidates.length > 100) return;
    setSaving(true); busy(true); setError('');
    try {
      const result = await client.api<ModelCatalog>(path, { expectedVersion: listingVersion, modelIds: candidates });
      if (source === 'directory') setListing(previous => previous && { ...previous, version: result.version });
      imported(result); open(undefined);
    } catch (reason) {
      if (reason instanceof ApiFailure && reason.code === 'MODEL_SETTINGS_CONFLICT') {
        setListing(undefined); setSelected([]);
        setError('平台或模型配置已更新，请重新核对候选后添加。');
        await refresh().catch(() => setError('配置已更新，暂时无法刷新平台列表。请返回平台列表后重试。'));
      } else {
        setError(reason instanceof Error ? reason.message : '保存结果未确认，请核对当前平台的模型列表。');
      }
    } finally { setSaving(false); busy(false); }
  }
  const models = source === 'preset' && preset ? [{ id: preset.model, name: preset.displayName }] : listing?.models ?? [];
  const filter = query.trim().toLowerCase();
  const matches = models.filter(({ id, name }) => id.toLowerCase().includes(filter) || name?.toLowerCase().includes(filter));
  return <>
    <div className="model-pane-heading">
      <h4>模型</h4>
      <div className="model-pane-actions">
        <button type="button" className="text-action" disabled={blocked} onClick={manual}>手动添加</button>
        {preset && <button ref={presetButton} type="button" className={platform.modelsPath ? 'text-action' : 'primary-action'} disabled={blocked || loading}
          aria-expanded={source === 'preset'} aria-controls="platform-model-candidates" onClick={() => source === 'preset' ? close() : open('preset')}>{platform.modelsPath ? '选择内置模型' : '选择模型'}</button>}
        {platform.modelsPath && <button ref={directoryButton} type="button" className="primary-action" disabled={blocked || loading || !platform.configured}
          aria-expanded={source === 'directory'} aria-controls="platform-model-candidates" onClick={() => listing?.version === version ? open('directory') : void read()}>
          {loading ? '正在获取…' : listing?.version === version ? '选择目录模型' : '获取模型'}
        </button>}
      </div>
    </div>
    {platform.modelsPath && !platform.configured && <p className="resource-help">保存平台的 API Key 后可获取模型。</p>}
    <div id="platform-model-candidates" className="model-candidates" hidden={!source}>
      {source && <>
        <div className="model-pane-heading">
          <h5>{source === 'preset' ? '内置候选' : '平台目录'}</h5>
          {source === 'directory' && <button type="button" className="text-action" disabled={blocked || loading || !platform.configured} onClick={() => void read()}>重新获取</button>}
        </div>
        {loading && <p className="resource-help" role="status">正在读取平台目录…</p>}
        {source === 'directory' && listing && !models.length && <p role="status">目录未返回模型，可以手动填写模型 ID。</p>}
        {models.length > 6 && <div className="settings-field model-candidate-search"><label htmlFor="platform-model-search">搜索模型</label><input id="platform-model-search" type="search" value={query} onChange={event => setQuery(event.target.value)} /></div>}
        {!!models.length && (matches.length ? <div className="model-discovery-list" role="group" aria-label="模型候选">
          {matches.map(({ id, name }) => <label key={id} className="model-check">
            <input type="checkbox" checked={existing.has(id) || selected.includes(id)} disabled={blocked || existing.has(id)}
              onChange={event => setSelected(previous => event.target.checked ? [...previous, id] : previous.filter(value => value !== id))} />
            <span>{name && name !== id ? name : id}{existing.has(id) ? '（已添加）' : ''}{name && name !== id && <code>{id}</code>}</span>
            {source === 'preset' && preset?.defaultThinkingLevel && <span className="model-detail-muted">默认思考档位 {preset.defaultThinkingLevel}</span>}
          </label>)}
        </div> : <p role="status">没有匹配的模型。</p>)}
        {error && <p className="resource-error" role="alert">{error}</p>}
        {editing && candidates.length > 0 && <p className="resource-help">完成当前编辑后可添加所选模型。</p>}
        {candidates.length > 100 && <p role="status">每次最多添加 100 个模型。</p>}
        <div className="model-pane-actions model-candidate-footer">
          <button type="button" className="text-action" disabled={blocked || loading} onClick={close}>取消选择</button>
          <button type="button" className="primary-action" disabled={blocked || editing || loading || !candidates.length || candidates.length > 100}
            onClick={() => void save()}>{saving ? '添加中…' : '添加所选模型'}</button>
        </div>
      </>}
    </div>
  </>;
}
