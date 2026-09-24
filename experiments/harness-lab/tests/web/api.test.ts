import { afterEach, expect, it, vi } from 'vitest';
import { ApiFailure, NetworkFailure, createApiClient, isConnectionFailure } from '../../src/web/api';

afterEach(() => vi.unstubAllGlobals());

it('normalizes fetch transport failures without retrying mutations', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  vi.stubGlobal('fetch', fetch);
  await expect(createApiClient().api('/api/sessions', {})).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: '暂时无法连接服务，请稍后重试。' });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(new NetworkFailure()).not.toBeInstanceOf(ApiFailure);
  expect(isConnectionFailure(new NetworkFailure())).toBe(true);
});

it('does not misclassify an intentional abort or API permission failure as disconnection', async () => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
    controller.abort();
    throw new TypeError('Failed to fetch');
  }));
  await expect(createApiClient().request('/api/tasks', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(isConnectionFailure(new ApiFailure('无权访问', 'FORBIDDEN', 403))).toBe(false);
  expect(isConnectionFailure(new ApiFailure('内部错误', 'HTTP_ERROR', 500))).toBe(false);
  expect(isConnectionFailure(new ApiFailure('代理不可用', 'HTTP_ERROR', 502))).toBe(true);
});
