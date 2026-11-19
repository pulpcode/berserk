import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import type { ModelApi, ModelCatalog, ModelCompatibility, ModelPlatform, ModelPlatformUpdate } from '../contracts/index';
import { modelPlatformPresets } from '../contracts/model-presets';
import { ApiFailure, useApi } from './api';

type Draft = { name: string; provider: string; baseUrl: string; api: ModelApi; modelsPath: string; apiKey: string; enabled: boolean; compat: string };
const empty = (): Draft => ({ name: '', provider: '', baseUrl: '', api: 'openai-completions', modelsPath: '', apiKey: '', enabled: true, compat: '{}' });
const fromPlatform = (platform: ModelPlatform): Draft => ({ ...empty(), ...platform, modelsPath: platform.modelsPath ?? '', apiKey: '', compat: JSON.stringify(platform.compat ?? {}, null, 2) });

export function PlatformSettings({ catalog, reload, edited, busy, addModel }: {
  catalog: ModelCatalog; reload: () => Promise<void>; edited: (value: boolean) => void; busy: (value: boolean) => void;
  addModel: (platformId: string) => void;
}) {
  const { api } = useApi();
  const [selected, setSelected] = useState(catalog.platforms?.[0]?.id ?? 'new');
  const [returnTo, setReturnTo] = useState(selected);
  const [presetId, setPresetId] = useState('custom');
  const [draft, setDraft] = useState<Draft>(() => catalog.platforms?.[0] ? fromPlatform(catalog.platforms[0]) : empty());
  const [version, setVersion] = useState(catalog.version);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [keyError, setKeyError] = useState('');
  const [success, setSuccess] = useState('');
  const [conflict, setConflict] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [latest, setLatest] = useState<ModelPlatform>();
  const platform = catalog.platforms?.find(item => item.id === selected);
  function change(field: keyof Draft, value: string | boolean) {
    setDraft(previous => ({ ...previous, [field]: value })); setDirty(true); edited(true); setSuccess(''); setKeyError('');
  }
  function select(id: string) {
    if (saving || id === selected) return;
    if (dirty && !window.confirm('当前平台有未保存的修改，切换将放弃这些内容。是否继续？')) return;
    if (id === 'new') { setReturnTo(selected); setPresetId('custom'); }
    const next = catalog.platforms?.find(item => item.id === id);
    setSelected(id); setDraft(next ? fromPlatform(next) : empty()); setVersion(catalog.version); setDirty(false); edited(false); setError(''); setKeyError(''); setSuccess(''); setConflict(false); setReviewed(false); setLatest(undefined);
  }
  function choosePreset(id: string) {
    if (id === presetId || dirty && !window.confirm('切换平台类型将放弃当前未保存的内容。是否继续？')) return;
    const preset = modelPlatformPresets.find(item => item.provider === id);
    setDraft(preset ? { ...empty(), name: preset.name, provider: preset.provider, baseUrl: preset.baseUrl, api: preset.api, enabled: false, modelsPath: 'modelsPath' in preset ? preset.modelsPath : '' } : empty());
    setPresetId(id); setDirty(Boolean(preset)); edited(Boolean(preset)); setError(''); setKeyError('');
  }
  async function readLatest() {
    try {
      const result = await api<ModelCatalog>('/api/settings/models');
      setVersion(result.version); setLatest(result.platforms?.find(item => item.id === selected)); setReviewed(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '平台配置读取失败。'); }
  }
  async function save() {
    if (!draft || saving || conflict && !reviewed) return;
    let compat: ModelCompatibility;
    try {
      const value: unknown = JSON.parse(draft.compat);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      compat = value as ModelCompatibility;
    } catch { setError('兼容参数须为 JSON 对象。'); return; }
    const payload: ModelPlatformUpdate = { name: draft.name.trim(), provider: draft.provider.trim(), baseUrl: draft.baseUrl.trim(), api: draft.api,
      modelsPath: draft.modelsPath.trim(), enabled: draft.enabled, compat, expectedVersion: version,
      ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}) };
    setSaving(true); busy(true); setError(''); setKeyError(''); setSuccess('');
    try {
      const result = await api<ModelPlatform>(selected === 'new' ? '/api/settings/platforms' : `/api/settings/platforms/${encodeURIComponent(selected)}`, payload, selected === 'new' ? 'POST' : 'PUT');
      setSelected(result.id); setDraft(fromPlatform(result)); setVersion(result.version); setConflict(false); setReviewed(false); setDirty(false); edited(false);
      setSuccess('平台已保存，下次请求使用新配置。');
      await reload().catch(() => setSuccess('平台已保存，重新打开页面即可刷新列表。'));
    } catch (reason) {
      if (!(reason instanceof ApiFailure) || ['MODEL_SETTINGS_CONFLICT', 'MODEL_SETTINGS_SAVE_FAILED'].includes(reason.code)) { setConflict(true); setReviewed(false); }
      if (reason instanceof ApiFailure && ['MODEL_API_KEY_REQUIRED', 'MODEL_API_KEY_INVALID'].includes(reason.code)) setKeyError(reason.message);
      else setError(reason instanceof Error ? reason.message : '保存结果未确认，请查看最新配置。');
    } finally { setSaving(false); busy(false); }
  }
  return <section className="settings-content" aria-labelledby="platform-settings-title">
    <div className="settings-heading"><h3 id="platform-settings-title">平台配置</h3><p>同一平台的模型共用服务地址、协议和凭证。密钥只显示配置状态。</p></div>
    <div className="model-catalog-controls"><label htmlFor="managed-platform">管理平台</label><div className="model-catalog-actions">
      <select id="managed-platform" value={selected} disabled={saving} onChange={event => select(event.target.value)}>{catalog.platforms?.map(item => <option key={item.id} value={item.id}>{item.name}{!item.enabled ? '（已停用）' : ''}</option>)}{selected === 'new' && <option value="new">新平台</option>}</select>
      <button type="button" disabled={saving || selected === 'new'} onClick={() => select('new')}><Plus size={16} aria-hidden="true" />添加平台</button>
    </div></div>
    {draft && <form className="model-settings-form" onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={saving}>
      {selected === 'new' && <div className="settings-field"><label htmlFor="platform-kind">平台来源</label><select id="platform-kind" value={presetId} onChange={event => choosePreset(event.target.value)}><option value="custom">自定义 API</option><optgroup label="内置平台">{modelPlatformPresets.map(preset => <option key={preset.provider} value={preset.provider}>{preset.name}</option>)}</optgroup></select></div>}
      <div className="settings-field-grid"><div className="settings-field"><label htmlFor="platform-name">平台名称</label><input id="platform-name" required maxLength={100} value={draft.name} onChange={event => change('name', event.target.value)} /></div>
        <div className="settings-field"><label htmlFor="platform-provider">服务商标识</label><input id="platform-provider" required maxLength={80} value={draft.provider} onChange={event => change('provider', event.target.value)} autoComplete="off" spellCheck={false} /></div></div>
      <div className="settings-field"><label htmlFor="platform-url">API 地址</label><input id="platform-url" type="url" required maxLength={2048} value={draft.baseUrl} onChange={event => change('baseUrl', event.target.value)} autoComplete="off" spellCheck={false} /></div>
      <div className="settings-field"><label htmlFor="platform-api">API 协议</label><select id="platform-api" value={draft.api} onChange={event => change('api', event.target.value)}><option value="openai-completions">OpenAI Chat Completions</option><option value="anthropic-messages">Anthropic Messages</option></select></div>
      <div className="settings-field"><label htmlFor="platform-key">API Key</label><input id="platform-key" type="password" value={draft.apiKey} onChange={event => change('apiKey', event.target.value)} maxLength={4096} autoComplete="new-password" spellCheck={false} aria-invalid={Boolean(keyError)} aria-describedby={keyError ? 'platform-key-error' : 'platform-key-status'} placeholder={platform?.configured ? '留空保留当前密钥' : '输入平台提供的密钥'} />
        <p id="platform-key-status">{platform?.configured ? '已保存。填写新值可更新密钥。' : '未配置。可先保存平台，稍后填写密钥。'}</p>{keyError && <p id="platform-key-error" className="resource-error" role="alert">{keyError}</p>}</div>
      <label className="model-check"><input type="checkbox" checked={draft.enabled} onChange={event => change('enabled', event.target.checked)} />启用平台</label>
      <details className="model-advanced"><summary>平台高级设置</summary><div className="settings-field"><label htmlFor="platform-models-path">模型目录路径</label><input id="platform-models-path" value={draft.modelsPath} onChange={event => change('modelsPath', event.target.value)} maxLength={301} placeholder="例如 /v1/models" spellCheck={false} /><p>仅填写平台已确认支持的同站点目录路径。留空时可手动添加模型。</p></div><div className="settings-field"><label htmlFor="platform-compat">平台默认兼容参数（JSON）</label><textarea id="platform-compat" rows={6} value={draft.compat} onChange={event => change('compat', event.target.value)} spellCheck={false} /><p>仅填写该端点已经核实的协议差异；模型可覆盖对应字段。</p></div></details>
    </fieldset>
      {error && <p className="resource-error" role="alert">{error}</p>}
      {conflict && <div className="settings-review"><p>填写内容已保留。读取最新配置并核对后再保存。</p><button type="button" disabled={saving} onClick={() => void readLatest()}>查看最新配置</button>{reviewed && <p role="status">最新平台：{latest ? `${latest.name} · ${latest.baseUrl}` : '当前尚无对应平台'}。再次保存将使用最新版本。</p>}</div>}
      {success && <p className="settings-success" role="status"><Check size={16} aria-hidden="true" />{success}</p>}
      <div className="settings-form-footer">
        {selected === 'new' && returnTo !== 'new' && <button type="button" className="secondary-action" disabled={saving} onClick={() => select(returnTo)}>取消新增</button>}
        {platform && <button type="button" className="secondary-action" disabled={saving || dirty} onClick={() => addModel(platform.id)}>添加模型</button>}
        <button type="submit" className="primary-action" disabled={saving || conflict && !reviewed}>{saving ? '保存中…' : '保存平台'}</button>
      </div>
    </form>}
  </section>;
}
