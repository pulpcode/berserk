import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { ModelSettings as Settings, ModelSettingsUpdate, ModelCatalog, ModelProfile, ModelPlatform, ModelThinkingMode, ModelCompatibility } from '../contracts/index';
import { builtinModel } from '../contracts/model-presets';
import { useApi, ApiFailure } from './api';
import { PlatformModelDiscovery } from './PlatformModelDiscovery';

const parameterFields = ['contextWindow', 'maxOutputTokens', 'compactionReserveTokens', 'compactionKeepRecentTokens'] as const;
type ParameterField = typeof parameterFields[number];
const thinkingLevels: ModelThinkingMode[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
type Draft = { model: string; platformId: string; displayName: string; enabled: boolean; usageConfirmed: boolean; input: Array<'text' | 'image'>; thinkingLevels: ModelThinkingMode[]; defaultThinkingLevel: 'legacy' | ModelThinkingMode; thinkingLevelMap: string; compat: string; thinkingMode: 'legacy' | ModelThinkingMode } & Record<ParameterField, string>;
function toDraft(result: Settings): Draft {
  return { platformId: result.platformId ?? '', displayName: result.displayName ?? '', enabled: result.enabled !== false, usageConfirmed: result.usageConfirmed !== false, input: result.input ?? ['text'], thinkingLevels: result.thinkingLevels ?? [], defaultThinkingLevel: result.defaultThinkingLevel ?? 'legacy', thinkingLevelMap: JSON.stringify(result.thinkingLevelMap ?? {}, null, 2), compat: JSON.stringify(result.compat ?? {}, null, 2), model: result.model, thinkingMode: result.thinkingExplicit === false || result.thinkingMode === undefined ? 'legacy' : result.thinkingMode,
    contextWindow: result.contextWindow?.toString() ?? '', maxOutputTokens: result.maxOutputTokens?.toString() ?? '',
    compactionReserveTokens: result.compactionReserveTokens?.toString() ?? '', compactionKeepRecentTokens: result.compactionKeepRecentTokens?.toString() ?? '' };
}
const sourceLabel = (source?: Settings['contextSource']) => source === 'preset' ? '已核对的模型规格' : source === 'explicit' ? '手动配置' : '未知，请填写';

function emptySettings(version: string): Settings {
  return { provider: '', model: '', baseUrl: '', configured: false, source: 'local', version,
    contextWindow: null, maxOutputTokens: null, compactionReserveTokens: null, compactionKeepRecentTokens: null,
    contextSource: 'unknown', outputSource: 'unknown', contextReady: false };
}

export function ModelSettings({ saved, profileId = 'default', creating = false, selection, edited, busy, platforms, models, initialPlatformId, imported }: {
  saved: (profile: ModelProfile) => Promise<void>; profileId?: string; creating?: boolean; selection?: ReactNode;
  edited?: (value: boolean) => void; busy?: (value: boolean) => void; platforms: ModelPlatform[]; models: ModelProfile[];
  initialPlatformId?: string; imported: (catalog: ModelCatalog) => void;
}) {
  const { api } = useApi();
  const [settings, setSettings] = useState<Settings>();
  const [draft, setDraft] = useState<Draft>();
  const [latest, setLatest] = useState<Settings>();
  const [latestCatalog, setLatestCatalog] = useState<ModelCatalog>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [needsReview, setNeedsReview] = useState(false);
  const [reload, setReload] = useState(0);
  const pending = useRef(false);
  const changedParameters = useRef(new Set<ParameterField>());
  const capabilitiesEdited = useRef(false);
  const compatEdited = useRef(false);
  const modeEdited = useRef(false);
  const [identityEdited, setIdentityEdited] = useState(false);
  useEffect(() => {
    let current = true;
    const read = profileId === 'default' && !creating
      ? api<Settings>('/api/settings/model')
      : api<ModelCatalog>('/api/settings/models').then(catalog => {
        if (creating) {
          if (current) setLatestCatalog(catalog);
          const platform = catalog.platforms?.find(item => item.id === initialPlatformId) ?? catalog.platforms?.[0];
          return { ...emptySettings(catalog.version), platformId: platform?.id, usageConfirmed: false };
        }
        const profile = catalog.models.find(model => model.id === profileId);
        if (!profile) throw new Error('该模型已不在可用列表中，请重新打开设置。');
        return profile;
      });
    read.then(result => {
      if (!current) return;
      setSettings(previous => previous || result);
      setDraft(previous => previous || toDraft(result));
      setLatest(result);
      setError('');
    }).catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : '模型配置读取失败，请重试。'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, reload, profileId, creating, initialPlatformId]);
  function loadLatest() { if (pending.current) return; setLoading(true); setLatest(undefined); setLatestCatalog(undefined); setSuccess(''); setReload(value => value + 1); }
  function edit(field: keyof Draft, value: Draft[keyof Draft]) {
    edited?.(true);
    if (['thinkingLevels', 'thinkingLevelMap', 'defaultThinkingLevel'].includes(field)) capabilitiesEdited.current = true;
    if (field === 'compat') compatEdited.current = true;
    if (field === 'thinkingMode') modeEdited.current = true;
    if (parameterFields.includes(field as ParameterField)) changedParameters.current.add(field as ParameterField);
    const identity = field === 'model' || field === 'platformId';
    const leaveCandidate = identity && candidate && draft?.model === candidate.model && value !== draft[field];
    if (identity) { changedParameters.current.clear(); setIdentityEdited(true); }
    if (leaveCandidate) { capabilitiesEdited.current = false; compatEdited.current = false; }
    setDraft(previous => previous && { ...previous,
      ...(identity ? { usageConfirmed: false, thinkingMode: 'legacy' as const, contextWindow: '', maxOutputTokens: '', compactionReserveTokens: '', compactionKeepRecentTokens: '' } : {}),
      ...(leaveCandidate ? { thinkingLevels: [], defaultThinkingLevel: 'legacy' as const, thinkingLevelMap: '{}', compat: '{}' } : {}), [field]: value });
    setSuccess('');
  }
  async function save() {
    const base = needsReview ? latest : settings;
    if (pending.current || importing || loading || !draft || !base) return;
    if (!draft.platformId) { setError('请先选择所属平台。'); return; }
    const parameters: Partial<Record<ParameterField, number>> = {};
    for (const field of changedParameters.current) {
      if (!draft[field].trim()) continue;
      const value = Number(draft[field]);
      if (!Number.isSafeInteger(value) || value <= 0) { setError('容量和压缩参数须为正整数。'); return; }
      parameters[field] = value;
    }
    let compat: ModelCompatibility, map: Settings['thinkingLevelMap'];
    try {
      const value: unknown = JSON.parse(draft.compat), mapping: unknown = JSON.parse(draft.thinkingLevelMap);
      if (!value || typeof value !== 'object' || Array.isArray(value) || !mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new Error();
      compat = value as ModelCompatibility; map = mapping as Settings['thinkingLevelMap'];
    } catch { setError('兼容参数和思考映射须为 JSON 对象。'); return; }
    pending.current = true; setSaving(true); busy?.(true); setError(''); setSuccess('');
    const payload: ModelSettingsUpdate = { ...parameters,
      ...(draft.thinkingMode === 'legacy' ? modeEdited.current ? { thinkingMode: null } : {} : { thinkingMode: draft.thinkingMode }),
      platformId: draft.platformId,
      model: draft.model.trim(), ...(draft.displayName.trim() ? { displayName: draft.displayName.trim() } : {}), enabled: draft.enabled, usageConfirmed: draft.usageConfirmed, input: draft.input,
      ...(capabilitiesEdited.current ? { thinkingLevels: draft.thinkingLevels, thinkingLevelMap: map, defaultThinkingLevel: draft.defaultThinkingLevel === 'legacy' ? null : draft.defaultThinkingLevel } : {}),
      ...(compatEdited.current ? { compat } : {}), expectedVersion: base.version };

    try {
      const path = creating ? '/api/settings/models' : profileId === 'default' ? '/api/settings/model' : `/api/settings/models/${encodeURIComponent(profileId)}`;
      const result = await api<Settings | ModelProfile>(path, payload, creating ? 'POST' : 'PUT');
      setSettings(result); setLatest(result); setNeedsReview(false);
      setDraft(toDraft(result)); changedParameters.current.clear(); capabilitiesEdited.current = false; compatEdited.current = false; modeEdited.current = false; setIdentityEdited(false); edited?.(false);
      setSuccess('已保存，下次发送消息时使用新配置。');
      await saved({ ...result, id: 'id' in result ? result.id : profileId }).catch(() => { setSuccess('配置已保存，模型列表暂未刷新，重新打开页面即可更新。'); });
    } catch (reason) {
      const uncertain = !(reason instanceof ApiFailure) || reason.code === 'MODEL_SETTINGS_CONFLICT' || reason.code === 'MODEL_SETTINGS_SAVE_FAILED';
      if (uncertain) { setNeedsReview(true); setLatest(undefined); }
      setError(reason instanceof ApiFailure && reason.code === 'MODEL_SETTINGS_CONFLICT' ? '配置已被修改，本次未保存。你填写的内容仍保留，请查看最新配置后再决定如何保存。' : reason instanceof Error ? reason.message : '保存结果未确认，请查看最新配置后再操作。');
    } finally { pending.current = false; setSaving(false); busy?.(false); }
  }
  let modes: ModelThinkingMode[] = [];
  const platform = creating ? platforms.find(item => item.id === draft?.platformId) : undefined;
  const candidate = platform && builtinModel(platform);
  const existing = new Set(models.filter(model => model.platformId === platform?.id).map(model => model.model));
  function chooseCandidate() {
    if (!candidate) return;
    edit('model', candidate.model);
    setDraft(previous => previous && { ...previous, displayName: candidate.displayName ?? candidate.model, enabled: false,
      thinkingLevels: candidate.thinkingLevels ?? [], defaultThinkingLevel: candidate.defaultThinkingLevel ?? 'legacy',
      thinkingLevelMap: '{}', compat: JSON.stringify(candidate.compat ?? {}, null, 2) });
    capabilitiesEdited.current = true;
    compatEdited.current = true;
  }
  if (draft) {
    try { const map = JSON.parse(draft.thinkingLevelMap) as Record<string, unknown>; modes = (draft.thinkingLevels.length ? draft.thinkingLevels : settings?.thinkingLevels !== undefined || map.off === null ? [] : ['off', 'high'] as ModelThinkingMode[]).filter(level => map[level] !== null); } catch { /* The form shows a validation error on save. */ }
  }
  return <section className="settings-content" aria-labelledby="model-settings-title">
        <div className="settings-heading"><h3 id="model-settings-title">模型配置</h3><p>配置可供所有席位在对话中选择的模型。</p></div>
        {selection}
        {!draft ? <div className="settings-loading">{loading ? <p role="status">正在读取配置…</p> : <><p className="resource-error" role="alert">{error}</p><button type="button" className="secondary-action" onClick={loadLatest}>重试</button></>}</div> : <form className="model-settings-form" onSubmit={event => { event.preventDefault(); void save(); }}>
          <fieldset disabled={saving || importing}>
          {platforms.length > 0 && <div className="settings-field"><label htmlFor="model-platform">所属平台</label><select id="model-platform" required value={draft.platformId} onChange={event => edit('platformId', event.target.value)}><option value="" disabled>请选择平台</option>{platforms.map(platform => <option key={platform.id} value={platform.id}>{platform.name}{platform.enabled ? '' : '（已停用）'}</option>)}</select><p>服务地址、协议和凭证在「平台配置」中维护。</p></div>}
          {candidate && <div className="settings-field"><span>内置候选</span><div><button type="button" className="secondary-action" disabled={existing.has(candidate.model)} onClick={chooseCandidate}>{candidate.displayName ?? candidate.model}{existing.has(candidate.model) ? '（已添加）' : ''}</button></div></div>}
          {platform?.modelsPath && <PlatformModelDiscovery key={`${platform.id}:${platform.modelsPath}:${platform.baseUrl}:${platform.api}`} platform={platform} existing={existing}
            busy={value => { setImporting(value); busy?.(value); }} imported={result => {
              setSettings(previous => previous && { ...previous, version: result.version });
              setLatest(previous => previous && { ...previous, version: result.version });
              imported(result);
            }} />}
          <div className="settings-field-grid"><div className="settings-field"><label htmlFor="model-name">显示名称</label><input id="model-name" value={draft.displayName} onChange={event => edit('displayName', event.target.value)} maxLength={200} placeholder="留空使用模型 ID" /></div>
            <div className="settings-field"><label htmlFor="model-id">模型 ID</label><input id="model-id" value={draft.model} onChange={event => edit('model', event.target.value)} maxLength={200} required placeholder={candidate?.model ?? '输入平台提供的模型 ID'} autoComplete="off" spellCheck={false} /></div></div>
          <div className="settings-field"><label htmlFor="model-thinking">推理模式</label><select id="model-thinking" value={draft.thinkingMode} onChange={event => edit('thinkingMode', event.target.value)}><option value="legacy">使用模型默认行为</option>{modes.map(level => <option key={level} value={level}>{level === 'off' ? '关闭' : level}</option>)}</select><p>可选档位由模型能力决定。未显式选择时保留服务端默认行为。</p></div>
          <label className="model-check"><input type="checkbox" checked={draft.enabled} onChange={event => edit('enabled', event.target.checked)} />启用模型</label>
          <label className="model-check"><input type="checkbox" checked={draft.usageConfirmed} onChange={event => edit('usageConfirmed', event.target.checked)} />已确认该凭证可用于本系统的使用方式</label>
          <div className="settings-field-grid model-capacity-fields">
            <div className="settings-field"><label htmlFor="model-context">上下文容量（token）</label><input id="model-context" type="number" min={8192} max={2000000} step={1} value={draft.contextWindow} onChange={event => edit('contextWindow', event.target.value)} placeholder="由模型规格解析，未知时填写" aria-describedby="model-context-help" /><p id="model-context-help">输入与输出合计容量。来源：{identityEdited ? '保存时重新解析' : sourceLabel(settings?.contextSource)}。</p></div>
            <div className="settings-field"><label htmlFor="model-output">最大输出能力（token）</label><input id="model-output" type="number" min={1} max={2000000} step={1} value={draft.maxOutputTokens} onChange={event => edit('maxOutputTokens', event.target.value)} placeholder="填写模型部署支持的上限" aria-describedby="model-output-help" /><p id="model-output-help">来源：{identityEdited ? '保存时重新解析' : sourceLabel(settings?.outputSource)}。不能超过上下文容量。</p></div>
          </div>
          {identityEdited && <p className="resource-help">模型身份已编辑，保存时重新解析规格；未填写的参数不沿用其他模型。仍为原模型时，留空保留已有配置。</p>}
          {!creating && !identityEdited && !settings?.contextReady && <p className="resource-error" role="status">模型容量或输出能力尚未完整配置，补齐后才能发送消息。已有历史和草稿会保留。</p>}
          <details className="model-advanced"><summary>模型能力与兼容参数</summary>
            <div className="settings-field"><label>输入能力</label><div className="model-capability-levels">{(['text', 'image'] as const).map(kind => <label className="model-check" key={kind}><input type="checkbox" checked={draft.input.includes(kind)} onChange={event => edit('input', event.target.checked ? [...draft.input, kind] : draft.input.filter(item => item !== kind))} />{kind === 'text' ? '文本' : '图片'}</label>)}</div></div>
            <div className="settings-field"><label>已核实的思考档位</label><div className="model-capability-levels">{thinkingLevels.map(level => <label className="model-check" key={level}><input type="checkbox" checked={draft.thinkingLevels.includes(level)} onChange={event => edit('thinkingLevels', event.target.checked ? [...draft.thinkingLevels, level] : draft.thinkingLevels.filter(item => item !== level))} />{level}</label>)}</div><p>始终思考的模型不勾选 off，并在下方映射中明确填写 "off": null。未核实的档位不要添加。</p></div>
            <div className="settings-field"><label htmlFor="model-default-thinking">默认思考档位</label><select id="model-default-thinking" value={draft.defaultThinkingLevel} onChange={event => edit('defaultThinkingLevel', event.target.value)}><option value="legacy">服务端默认</option>{draft.thinkingLevels.map(level => <option key={level} value={level}>{level}</option>)}</select></div>
            <div className="settings-field"><label htmlFor="model-thinking-map">思考档位映射（JSON）</label><textarea id="model-thinking-map" rows={4} value={draft.thinkingLevelMap} onChange={event => edit('thinkingLevelMap', event.target.value)} spellCheck={false} /></div>
            <div className="settings-field"><label htmlFor="model-compat">模型兼容参数覆盖（JSON）</label><textarea id="model-compat" rows={4} value={draft.compat} onChange={event => edit('compat', event.target.value)} spellCheck={false} /><p>按字段覆盖平台默认值；留空对象沿用平台配置。</p></div>
          </details>
          <details className="model-advanced"><summary>高级压缩参数</summary><p className="resource-help">通常无需修改。留空使用服务端解析值；同一模型保留已有设置。</p><div className="settings-field-grid">
            <div className="settings-field"><label htmlFor="model-reserve">压缩预留量（token）</label><input id="model-reserve" type="number" min={1} step={1} max={2000000} value={draft.compactionReserveTokens} onChange={event => edit('compactionReserveTokens', event.target.value)} aria-describedby="model-compaction-help" /></div>
            <div className="settings-field"><label htmlFor="model-keep">近期原文保留量（token）</label><input id="model-keep" type="number" min={1} step={1} max={2000000} value={draft.compactionKeepRecentTokens} onChange={event => edit('compactionKeepRecentTokens', event.target.value)} aria-describedby="model-compaction-help" /></div>
          </div><p id="model-compaction-help" className="resource-help">预留量与保留量之和须小于上下文容量。近期消息按内容量保留原文，不按固定轮数。</p></details>
          </fieldset>
          {error && <p className="resource-error" role="alert">{error}</p>}
          {needsReview && <div className="settings-review"><p>你的填写内容不会被替换。查看最新配置后，调整上方内容，再手动保存。</p><button type="button" className="secondary-action" onClick={loadLatest} disabled={loading || saving}>{loading ? '读取中…' : '查看最新配置'}</button>{latest && (creating ? <div aria-label="最新模型列表"><p role="status">已读取最新模型列表，请检查是否已有刚才添加的模型，再决定是否保存。</p><ul>{latestCatalog?.models.map(model => <li key={model.id}>{model.provider} / {model.model}</li>)}</ul></div> : <dl aria-label="最新模型配置"><dt>服务商</dt><dd>{latest.provider}</dd><dt>模型</dt><dd>{latest.model}</dd><dt>API 地址</dt><dd>{latest.baseUrl}</dd><dt>上下文容量</dt><dd>{latest.contextWindow ?? '未知'}</dd><dt>输出能力</dt><dd>{latest.maxOutputTokens ?? '未知'}</dd><dt>压缩预留量</dt><dd>{latest.compactionReserveTokens ?? '未知'}</dd><dt>近期原文</dt><dd>{latest.compactionKeepRecentTokens ?? '未知'}</dd><dt>推理模式</dt><dd>{!latest.thinkingExplicit ? '沿用旧请求（未指定开关）' : latest.thinkingMode === 'off' ? '关闭' : latest.thinkingMode}</dd><dt>API Key</dt><dd>{latest.configured ? '已配置，不显示密钥' : '未配置'}</dd></dl>)}</div>}
          {success && <p className="settings-success" role="status"><Check size={16} aria-hidden="true" />{success}</p>}
          <div className="settings-form-footer"><span>{creating ? '凭证、容量与使用方式确认后可供业务席位选择' : settings?.source === 'local' ? '当前使用已保存的配置' : '当前使用部署默认配置'}</span><button type="submit" className="primary-action" disabled={saving || importing || loading || (needsReview && !latest)}>{saving ? '保存中…' : needsReview ? '按最新版本保存' : '保存配置'}</button></div>
        </form>}
  </section>;
}
