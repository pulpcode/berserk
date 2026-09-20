import { useEffect, useRef, useState } from 'react';
import { Check, Cpu, KeyRound } from 'lucide-react';
import type { ModelSettings as Settings, ModelSettingsUpdate } from '../contracts/index';
import { useApi, ApiFailure } from './api';
import { Panel } from './Resources';

const parameterFields = ['contextWindow', 'maxOutputTokens', 'compactionReserveTokens', 'compactionKeepRecentTokens'] as const;
type ParameterField = typeof parameterFields[number];
type Draft = Pick<Settings, 'provider' | 'model' | 'baseUrl'> & { apiKey: string } & Record<ParameterField, string>;
function toDraft(result: Settings): Draft {
  return { provider: result.provider, model: result.model, baseUrl: result.baseUrl, apiKey: '',
    contextWindow: result.contextWindow?.toString() ?? '', maxOutputTokens: result.maxOutputTokens?.toString() ?? '',
    compactionReserveTokens: result.compactionReserveTokens?.toString() ?? '', compactionKeepRecentTokens: result.compactionKeepRecentTokens?.toString() ?? '' };
}
const sourceLabel = (source?: Settings['contextSource']) => source === 'preset' ? '已核对的模型规格' : source === 'explicit' ? '手动配置' : '未知，请填写';

export function ModelSettings({ close, saved }: { close: () => void; saved: () => Promise<void> }) {
  const { api } = useApi();
  const [settings, setSettings] = useState<Settings>();
  const [draft, setDraft] = useState<Draft>();
  const [latest, setLatest] = useState<Settings>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [needsReview, setNeedsReview] = useState(false);
  const [reload, setReload] = useState(0);
  const pending = useRef(false);
  const changedParameters = useRef(new Set<ParameterField>());
  const [identityEdited, setIdentityEdited] = useState(false);
  useEffect(() => {
    let current = true;
    api<Settings>('/api/settings/model').then(result => {
      if (!current) return;
      setSettings(previous => previous || result);
      setDraft(previous => previous || toDraft(result));
      setLatest(result);
      setError('');
    }).catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : '模型配置读取失败，请重试。'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, reload]);
  function loadLatest() { if (pending.current) return; setLoading(true); setLatest(undefined); setSuccess(''); setReload(value => value + 1); }
  function edit(field: keyof Draft, value: string) {
    if (parameterFields.includes(field as ParameterField)) changedParameters.current.add(field as ParameterField);
    const identity = field === 'provider' || field === 'model' || field === 'baseUrl';
    if (identity) { changedParameters.current.clear(); setIdentityEdited(true); }
    setDraft(previous => previous && { ...previous,
      ...(identity ? { contextWindow: '', maxOutputTokens: '', compactionReserveTokens: '', compactionKeepRecentTokens: '' } : {}), [field]: value });
    setSuccess('');
  }
  async function save() {
    const base = needsReview ? latest : settings;
    if (pending.current || loading || !draft || !base) return;
    const parameters: Partial<Record<ParameterField, number>> = {};
    for (const field of changedParameters.current) {
      if (!draft[field].trim()) continue;
      const value = Number(draft[field]);
      if (!Number.isSafeInteger(value) || value <= 0) { setError('容量和压缩参数须为正整数。'); return; }
      parameters[field] = value;
    }
    pending.current = true; setSaving(true); setError(''); setSuccess('');
    const payload: ModelSettingsUpdate = { ...parameters, provider: draft.provider.trim(), model: draft.model.trim(), baseUrl: draft.baseUrl.trim(), expectedVersion: base.version, ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}) };
    try {
      const result = await api<Settings>('/api/settings/model', payload, 'PUT');
      setSettings(result); setLatest(result); setNeedsReview(false);
      setDraft(toDraft(result)); changedParameters.current.clear(); setIdentityEdited(false);
      setSuccess('已保存，下次发送消息时使用新配置。');
      await saved().catch(() => { setSuccess('配置已保存，页面模型名称暂未刷新，重新打开页面即可更新。'); });
    } catch (reason) {
      const uncertain = !(reason instanceof ApiFailure) || reason.code === 'MODEL_SETTINGS_CONFLICT' || reason.code === 'MODEL_SETTINGS_SAVE_FAILED';
      if (uncertain) { setNeedsReview(true); setLatest(undefined); }
      setError(reason instanceof ApiFailure && reason.code === 'MODEL_SETTINGS_CONFLICT' ? '配置已被修改，本次未保存。你填写的内容仍保留，请查看最新配置后再决定如何保存。' : reason instanceof Error ? reason.message : '保存结果未确认，请查看最新配置后再操作。');
    } finally { pending.current = false; setSaving(false); }
  }
  return <Panel title="设置" className="settings-panel" close={close}>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分类"><button type="button" aria-current="page"><Cpu size={17} aria-hidden="true" />模型</button></nav>
      <section className="settings-content" aria-labelledby="model-settings-title">
        <div className="settings-heading"><h3 id="model-settings-title">模型配置</h3><p>连接用于对话和任务处理的模型。</p></div>
        {!draft ? <div className="settings-loading">{loading ? <p role="status">正在读取配置…</p> : <><p className="resource-error" role="alert">{error}</p><button type="button" className="secondary-action" onClick={loadLatest}>重试</button></>}</div> : <form className="model-settings-form" onSubmit={event => { event.preventDefault(); void save(); }}>
          <fieldset disabled={saving}><div className="settings-field-grid">
            <div className="settings-field"><label htmlFor="model-provider">服务商标识</label><input id="model-provider" value={draft.provider} onChange={event => edit('provider', event.target.value)} maxLength={80} required placeholder="deepseek" autoComplete="off" spellCheck={false} /></div>
            <div className="settings-field"><label htmlFor="model-id">模型 ID</label><input id="model-id" value={draft.model} onChange={event => edit('model', event.target.value)} maxLength={200} required placeholder="deepseek-flash" autoComplete="off" spellCheck={false} /></div>
          </div>
          <div className="settings-field"><label htmlFor="model-url">API 地址</label><input id="model-url" type="url" value={draft.baseUrl} onChange={event => edit('baseUrl', event.target.value)} maxLength={2048} required placeholder="https://api.deepseek.com" aria-describedby="model-url-help" autoComplete="off" spellCheck={false} /><p id="model-url-help">使用兼容 OpenAI 的 HTTPS 服务地址。</p></div>
          <div className="settings-field"><label htmlFor="model-key">API Key <span className="key-state"><KeyRound size={12} aria-hidden="true" />{settings?.configured ? '已配置' : '未配置'}</span></label><input id="model-key" type="password" value={draft.apiKey} onChange={event => edit('apiKey', event.target.value)} maxLength={4096} placeholder={settings?.configured ? '留空保留已有密钥' : '输入 API Key'} autoComplete="new-password" aria-describedby="model-key-help" spellCheck={false} /><p id="model-key-help">更换服务商或 API 地址时，请填写对应的新密钥。</p></div>
          <div className="settings-field-grid model-capacity-fields">
            <div className="settings-field"><label htmlFor="model-context">上下文容量（token）</label><input id="model-context" type="number" min={8192} max={2000000} step={1} value={draft.contextWindow} onChange={event => edit('contextWindow', event.target.value)} placeholder="由模型规格解析，未知时填写" aria-describedby="model-context-help" /><p id="model-context-help">输入与输出合计容量。来源：{identityEdited ? '保存时重新解析' : sourceLabel(settings?.contextSource)}。</p></div>
            <div className="settings-field"><label htmlFor="model-output">最大输出能力（token）</label><input id="model-output" type="number" min={1} max={2000000} step={1} value={draft.maxOutputTokens} onChange={event => edit('maxOutputTokens', event.target.value)} placeholder="填写模型部署支持的上限" aria-describedby="model-output-help" /><p id="model-output-help">来源：{identityEdited ? '保存时重新解析' : sourceLabel(settings?.outputSource)}。不能超过上下文容量。</p></div>
          </div>
          {identityEdited && <p className="resource-help">模型身份已编辑，保存时重新解析规格；未填写的参数不沿用其他模型。仍为原模型时，留空保留已有配置。</p>}
          {!identityEdited && !settings?.contextReady && <p className="resource-error" role="status">模型容量或输出能力尚未完整配置，补齐后才能发送消息。已有历史和草稿会保留。</p>}
          <details className="model-advanced"><summary>高级压缩参数</summary><p className="resource-help">通常无需修改。留空使用服务端解析值；同一模型保留已有设置。</p><div className="settings-field-grid">
            <div className="settings-field"><label htmlFor="model-reserve">压缩预留量（token）</label><input id="model-reserve" type="number" min={1} step={1} max={2000000} value={draft.compactionReserveTokens} onChange={event => edit('compactionReserveTokens', event.target.value)} aria-describedby="model-compaction-help" /></div>
            <div className="settings-field"><label htmlFor="model-keep">近期原文保留量（token）</label><input id="model-keep" type="number" min={1} step={1} max={2000000} value={draft.compactionKeepRecentTokens} onChange={event => edit('compactionKeepRecentTokens', event.target.value)} aria-describedby="model-compaction-help" /></div>
          </div><p id="model-compaction-help" className="resource-help">预留量与保留量之和须小于上下文容量。近期消息按内容量保留原文，不按固定轮数。</p></details>
          </fieldset>
          {error && <p className="resource-error" role="alert">{error}</p>}
          {needsReview && <div className="settings-review"><p>你的填写内容不会被替换。查看最新配置后，调整上方内容，再手动保存。</p><button type="button" className="secondary-action" onClick={loadLatest} disabled={loading || saving}>{loading ? '读取中…' : '查看最新配置'}</button>{latest && <dl aria-label="最新模型配置"><dt>服务商</dt><dd>{latest.provider}</dd><dt>模型</dt><dd>{latest.model}</dd><dt>API 地址</dt><dd>{latest.baseUrl}</dd><dt>上下文容量</dt><dd>{latest.contextWindow ?? '未知'}</dd><dt>输出能力</dt><dd>{latest.maxOutputTokens ?? '未知'}</dd><dt>压缩预留量</dt><dd>{latest.compactionReserveTokens ?? '未知'}</dd><dt>近期原文</dt><dd>{latest.compactionKeepRecentTokens ?? '未知'}</dd><dt>API Key</dt><dd>{latest.configured ? '已配置，不显示密钥' : '未配置'}</dd></dl>}</div>}
          {success && <p className="settings-success" role="status"><Check size={16} aria-hidden="true" />{success}</p>}
          <div className="settings-form-footer"><span>{settings?.source === 'local' ? '当前使用已保存的配置' : '当前使用环境配置'}</span><button type="submit" className="primary-action" disabled={saving || loading || (needsReview && !latest)}>{saving ? '保存中…' : needsReview ? '按最新版本保存' : '保存配置'}</button></div>
        </form>}
      </section>
    </div>
  </Panel>;
}
