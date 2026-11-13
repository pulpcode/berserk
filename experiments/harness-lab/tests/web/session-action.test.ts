import { afterEach, expect, it, vi } from 'vitest';
import { sessionAction } from '../../src/web/session-action';

afterEach(() => vi.unstubAllGlobals());

it('reuses an uncertain creation ID and retires it only after an authoritative receipt', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value) });
  const first = sessionAction('test-create-action', { workspaceId: 'space-a' });
  expect(sessionAction('test-create-action', { workspaceId: 'space-a' }).id).toBe(first.id);
  // A separate login scope must never acquire another account's pending intent.
  expect(sessionAction('test-other-login', { workspaceId: 'space-a' }).id).not.toBe(first.id);
  const second = sessionAction('test-create-action', { workspaceId: 'space-b' });
  first.complete();
  expect(sessionAction('test-create-action', { workspaceId: 'space-b' }).id).toBe(second.id);
  expect(sessionAction('test-create-action', { workspaceId: 'space-a' }).id).not.toBe(first.id);
});

it('retains the action ID for explicit retries when browser storage is unavailable', () => {
  vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
  const first = sessionAction('storage-unavailable', { workspaceId: 'space-a' });
  expect(sessionAction('storage-unavailable', { workspaceId: 'space-a' }).id).toBe(first.id);
  first.complete();
  expect(sessionAction('storage-unavailable', { workspaceId: 'space-a' }).id).not.toBe(first.id);
});
