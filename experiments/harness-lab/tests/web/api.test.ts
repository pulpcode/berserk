import { afterEach, expect, it, vi } from 'vitest';
import type { AuthSession } from '../../src/contracts/access';
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

function login(userId: string, viewId: string): AuthSession {
  return {mode:'login',viewId,csrf:'csrf',identity:{userId,username:userId,displayName:userId,seatId:'seat-a',seatName:'席位 A',createPublicTask:false,manageModelSettings:false}};
}

it('retains opted-in visual preferences across logins for the same user while isolating other users',()=>{
  const first=createApiClient(undefined,login('user-a','view-1'));
  const relogin=createApiClient(undefined,login('user-a','view-2'));
  const other=createApiClient(undefined,login('user-b','view-3'));
  const key='berserk.basemap-view';
  expect(first.storageKey(key,'user-preference')).toBe(`${key}:user:user-a`);
  expect(relogin.storageKey(key,'user-preference')).toBe(first.storageKey(key,'user-preference'));
  expect(other.storageKey(key,'user-preference')).not.toBe(first.storageKey(key,'user-preference'));
});

it('keeps default cache and draft keys scoped to the current login view',()=>{
  const first=createApiClient(undefined,login('user-a','view-1'));
  const relogin=createApiClient(undefined,login('user-a','view-2'));
  expect(first.storageKey('berserk.drafts')).toBe('berserk.drafts:login:view-1');
  expect(first.storageKey('berserk.drafts','login')).toBe(first.storageKey('berserk.drafts'));
  expect(relogin.storageKey('berserk.drafts')).toBe('berserk.drafts:login:view-2');
  expect(createApiClient(undefined,{mode:'login',viewId:'anonymous'}).storageKey('preference','user-preference')).toBe('preference:login:anonymous');
});

it('keeps test-seat visual preferences partitioned by seat and leaves unscoped clients unchanged',()=>{
  const first=createApiClient('seat-a'),other=createApiClient('seat-b');
  expect(first.storageKey('preference','user-preference')).toBe('preference:seat:seat-a');
  expect(first.storageKey('preference','user-preference')).toBe(first.storageKey('preference'));
  expect(other.storageKey('preference','user-preference')).not.toBe(first.storageKey('preference','user-preference'));
  expect(createApiClient().storageKey('preference','user-preference')).toBe('preference');
});
