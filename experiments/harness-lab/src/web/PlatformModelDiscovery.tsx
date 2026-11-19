import { useEffect, useRef, useState } from 'react';
import type { DiscoveredModel, ModelCatalog, ModelPlatform } from '../contracts/index';
import { ApiFailure, checkResponse, useApi } from './api';

export function PlatformModelDiscovery({ platform, existing, imported, busy }: {
  platform: ModelPlatform;
  existing: ReadonlySet<string>;
  imported: (catalog: ModelCatalog) => void;
  busy?: (value: boolean) => void;
}) {
  const client = useApi();
  const path = `/api/settings/platforms/${encodeURIComponent(platform.id)}/models`;
  const active = useRef<AbortController | null>(null);
  const [listing, setListing] = useState<{ version: string; models: DiscoveredModel[] }>();
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => () => active.current?.abort(), []);
  async function read() {
    if (active.current || saving) return;
    const controller = new AbortController();
    active.current = controller;
    setLoading(true); setError(''); setStatus(''); setListing(undefined); setSelected([]);
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
  const candidates = selected.filter(id => !existing.has(id));
  async function save() {
    if (!listing || saving || active.current || !candidates.length || candidates.length > 100) return;
    setSaving(true); busy?.(true); setError(''); setStatus('');
    try {
      const result = await client.api<ModelCatalog>(path, { expectedVersion: listing.version, modelIds: candidates });
      setListing({ ...listing, version: result.version }); setSelected([]); imported(result);
      setStatus('已保存所选模型。请在模型目录中核对配置后启用。');
    } catch (reason) {
      if (reason instanceof ApiFailure && reason.code === 'MODEL_SETTINGS_CONFLICT') {
        setListing(undefined); setSelected([]); setError('平台或模型配置已更新，请重新获取模型。');
      } else setError(reason instanceof Error ? reason.message : '保存结果未确认，请查看模型目录。');
    } finally { setSaving(false); busy?.(false); }
  }
  if (!platform.modelsPath) return null;
  return <div className="model-discovery">
    <button type="button" className="secondary-action" onClick={() => void read()} disabled={saving || loading || !platform.configured}>{loading ? '正在获取…' : '获取模型'}</button>
    {!platform.configured && <p className="resource-help">保存平台的 API Key 后可获取模型。</p>}
    {listing && (listing.models.length === 0 ? <p role="status">目录未返回型号，可以手动填写模型 ID。</p> : <>
      <div className="model-discovery-list" role="group" aria-label="平台目录候选">
        {listing.models.map(({ id, name }) => <label key={id} className="model-check">
          <input type="checkbox" checked={existing.has(id) || selected.includes(id)} disabled={saving || existing.has(id)}
            onChange={event => setSelected(previous => event.target.checked ? [...previous, id] : previous.filter(value => value !== id))} />
          <span>{name && name !== id ? `${name} · ${id}` : id}{existing.has(id) ? '（已添加）' : ''}</span>
        </label>)}
      </div>
      <button type="button" className="secondary-action" disabled={saving || !candidates.length || candidates.length > 100} onClick={() => void save()}>{saving ? '保存中…' : '保存所选模型'}</button>
      {candidates.length > 100 && <p role="status">每次最多保存 100 个模型。</p>}
    </>)}
    {error && <p className="resource-error" role="alert">{error}</p>}
    {status && <p className="settings-success" role="status">{status}</p>}
  </div>;
}
