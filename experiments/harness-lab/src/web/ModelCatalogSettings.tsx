import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { ModelCatalog, ModelProfile } from '../contracts/index';
import { useApi } from './api';
import { ModelSettings } from './ModelSettings';
import { PlatformSettings } from './PlatformSettings';
import './model-settings.css';

export function ModelCatalogSettings({ saved }: { saved: () => Promise<void> }) {
  const { api } = useApi();
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [section, setSection] = useState<'models' | 'platforms'>('models');
  const [selected, setSelected] = useState('default');
  const [initialPlatformId, setInitialPlatformId] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    api<ModelCatalog>('/api/settings/models').then(result => {
      if (!current) return;
      setCatalog(result); setError('');
    }).catch((reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message : '模型列表读取失败。');
    });
    return () => { current = false; };
  }, [api, reload]);
  function select(id: string) {
    if (busy || id === selected) return;
    if (dirty && !window.confirm('当前模型有未保存的修改，切换将放弃这些内容。是否继续？')) return;
    setDirty(false); setInitialPlatformId(undefined); setSelected(id);
  }
  const savedProfile = useCallback(async (profile: ModelProfile) => {
    setCatalog(previous => ({ ...previous, version: profile.version, models: previous?.models.some(model => model.id === profile.id)
      ? previous.models.map(model => model.id === profile.id ? profile : model)
      : [...(previous?.models ?? []), profile] }));
    setReload(value => value + 1);
    try { await saved(); } finally { setDirty(false); setSelected(profile.id); }
  }, [saved]);
  const models = catalog?.models ?? [];
  const selection = <div className="model-catalog-controls">
    <div className="model-catalog-selector">
      <label htmlFor="managed-model">管理模型</label>
      <div className="model-catalog-actions">
        <select id="managed-model" value={selected} disabled={busy} onChange={event => select(event.target.value)}>
          {!models.some(model => model.id === 'default') && <option value="default">默认模型</option>}
          {models.map(model => <option key={model.id} value={model.id}>{model.platformName ?? model.provider}－{model.displayName ?? (model.model || '未配置模型')}{model.id === 'default' ? '（默认）' : ''}</option>)}
          {selected === 'new' && <option value="new">新模型</option>}
        </select>
        <button type="button" className="model-catalog-add" disabled={busy || selected === 'new' || !catalog} onClick={() => select('new')}><Plus size={16} aria-hidden="true" />添加模型</button>
      </div>
    </div>
    {error && <div className="model-catalog-error"><p className="resource-error" role="status">模型列表读取失败：{error}</p><button type="button" onClick={() => setReload(value => value + 1)}>重试列表</button></div>}
  </div>;
  const changeSection = (value: 'models' | 'platforms') => {
    if (busy || section === value) return;
    if (dirty && !window.confirm('当前有未保存的修改，切换将放弃这些内容。是否继续？')) return;
    setDirty(false); setSection(value);
  };
  const refresh = async () => { setCatalog(await api<ModelCatalog>('/api/settings/models')); await saved(); };
  const addPlatformModel = (platformId: string) => {
    setDirty(false); setInitialPlatformId(platformId); setSelected('new'); setSection('models');
  };
  const imported = (result: ModelCatalog) => { setCatalog(result); void saved().catch(() => {}); };
  return <div className="model-management">
    <div className="model-management-tabs" role="group" aria-label="模型管理分类"><button type="button" aria-pressed={section === 'models'} disabled={busy} onClick={() => changeSection('models')}>模型目录</button><button type="button" aria-pressed={section === 'platforms'} disabled={busy} onClick={() => changeSection('platforms')}>平台配置</button></div>
    {section === 'models' ? <ModelSettings key={selected} profileId={selected} platforms={catalog?.platforms ?? []} models={models} initialPlatformId={initialPlatformId} creating={selected === 'new'} selection={selection} saved={savedProfile} imported={imported} edited={setDirty} busy={setBusy} />
      : catalog ? <PlatformSettings catalog={catalog} reload={refresh} edited={setDirty} busy={setBusy} addModel={addPlatformModel} /> : <section className="settings-content"><p role="status">{error || '正在读取平台…'}</p></section>}
  </div>;
}
