import { createPinnedMcpFetch } from '../connectors/network.js';
import { RequestError } from '../contracts/errors.js';
import type { DiscoveredModel, ModelPlatform } from '../contracts/index.js';

export const remoteModelIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/;

export function validateModelsPath(path: unknown): string | undefined {
  if (path === undefined || path === '') return undefined;
  if (typeof path !== 'string' || !/^\/[a-zA-Z0-9_~.-][a-zA-Z0-9_~./-]{0,299}$/.test(path)
      || path.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new RequestError('INVALID_INPUT', '模型目录请填写同一站点的路径，例如 /v1/models。');
  }
  return path;
}

/** The API Key is sent only to the saved platform origin, through the existing pinned HTTPS transport. */
export async function discoverPlatformModels(
  platform: Pick<ModelPlatform, 'api' | 'baseUrl' | 'modelsPath'>, apiKey: string, transport = createPinnedMcpFetch,
): Promise<DiscoveredModel[]> {
  if (!platform.modelsPath) throw new RequestError('MODEL_DISCOVERY_UNSUPPORTED', '该平台没有配置模型目录，可以手动填写模型 ID。');
  if (!apiKey) throw new RequestError('MODEL_NOT_CONFIGURED', '请先在平台配置中保存 API Key。');
  const url = `${new URL(platform.baseUrl).origin}${platform.modelsPath}`;
  const headers: Record<string, string> = platform.api === 'anthropic-messages'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { Authorization: `Bearer ${apiKey}` };
  let body: unknown;
  try {
    const fetch = transport({ url, headers, networkPolicy: { timeoutMs: 10_000, maxResponseBytes: 512 * 1024 } });
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      await response.body?.cancel();
      throw new RequestError('MODEL_DISCOVERY_FAILED', `平台目录返回 HTTP ${response.status}，请检查目录地址和 API Key，或手动填写模型 ID。`, 502);
    }
    body = await response.json();
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError('MODEL_DISCOVERY_FAILED', '无法读取平台目录，请检查目录地址或手动填写模型 ID。', 502);
  }
  const listing = body as { data?: unknown } | null;
  if (!Array.isArray(listing?.data)) throw new RequestError('MODEL_DISCOVERY_FAILED', '平台目录格式不受支持，请手动填写模型 ID。', 502);
  const models = new Map<string, DiscoveredModel>();
  for (const entry of listing.data as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const { id } = row;
    const name = row.display_name ?? row.name;
    if (typeof id !== 'string' || !remoteModelIdPattern.test(id) || id.includes(apiKey) || models.has(id)) continue;
    models.set(id, { id, ...(typeof name === 'string' && name.trim() && name.length <= 200 && !name.includes(apiKey) ? { name: name.trim() } : {}) });
  }
  return [...models.values()];
}
