import { expect, it, vi } from 'vitest';
import { discoverPlatformModels, validateModelsPath } from '../src/server/model-discovery.js';

it('requests exactly the configured directory using the platform protocol and returns safe unique IDs', async () => {
  const request = vi.fn<typeof fetch>(async () => Response.json({ data: [
    { id: 'vendor/model-a', display_name: 'Model A' }, { id: 'vendor/model-a' },
    { id: 'model-b', display_name: 'reflects-test-directory-key' }, { id: 'model-c', name: 'Model C' }, { id: 'test-directory-key' }, { id: 'bad model' },
  ] }));
  const transport = vi.fn(() => request);
  const platform = { baseUrl: 'https://provider.invalid/coding/v1', api: 'anthropic-messages', modelsPath: '/coding/v1/models' } as const;
  await expect(discoverPlatformModels(platform, 'test-directory-key', transport)).resolves.toEqual([
    { id: 'vendor/model-a', name: 'Model A' }, { id: 'model-b' }, { id: 'model-c', name: 'Model C' },
  ]);
  expect(transport).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://provider.invalid/coding/v1/models',
    headers: { 'x-api-key': 'test-directory-key', 'anthropic-version': '2023-06-01' } }));
  expect(request).toHaveBeenCalledWith('https://provider.invalid/coding/v1/models', expect.any(Object));
  await discoverPlatformModels({ ...platform, api: 'openai-completions', modelsPath: '/v1/models' }, 'other-directory-key', transport);
  expect(transport).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://provider.invalid/v1/models', headers: { Authorization: 'Bearer other-directory-key' } }));
});

it('skips absent directory or credentials and keeps failure responses safe', async () => {
  const request = vi.fn<typeof fetch>(); const transport = vi.fn(() => request);
  const platform = { baseUrl: 'https://provider.invalid/v1', api: 'openai-completions', modelsPath: '/v1/models' } as const;
  await expect(discoverPlatformModels({ ...platform, modelsPath: undefined }, 'test-key', transport)).rejects.toMatchObject({ code: 'MODEL_DISCOVERY_UNSUPPORTED' });
  await expect(discoverPlatformModels(platform, '', transport)).rejects.toMatchObject({ code: 'MODEL_NOT_CONFIGURED' });
  expect(transport).not.toHaveBeenCalled();
  request.mockResolvedValueOnce(new Response('provider echoed test-key', { status: 401 }));
  await expect(discoverPlatformModels(platform, 'test-key', transport)).rejects.toMatchObject({ code: 'MODEL_DISCOVERY_FAILED', message: expect.stringMatching(/^平台目录返回 HTTP 401/) });
  request.mockResolvedValueOnce(Response.json({ unexpected: [] }));
  await expect(discoverPlatformModels(platform, 'test-key', transport)).rejects.toMatchObject({ code: 'MODEL_DISCOVERY_FAILED', message: expect.stringContaining('格式不受支持') });
  request.mockResolvedValueOnce(Response.json({ data: [] }));
  await expect(discoverPlatformModels(platform, 'test-key', transport)).resolves.toEqual([]);
  for (const path of ['https://other.invalid/models', '//other.invalid/models', '/v1/../models', '/v1/models?key=secret']) expect(() => validateModelsPath(path)).toThrow();
});
