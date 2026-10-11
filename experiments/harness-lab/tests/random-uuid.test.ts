import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from '../src/web/random-uuid.js';

afterEach(() => vi.unstubAllGlobals());
it('generates UUID v4 with browser secure randomness when HTTP hides randomUUID', () => {
  const getRandomValues = crypto.getRandomValues.bind(crypto);
  vi.stubGlobal('crypto', { getRandomValues });
  const ids = Array.from({ length: 100 }, () => randomUUID());
  expect(new Set(ids).size).toBe(100);
  for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
it('uses native randomUUID when available', () => {
  const native = vi.fn(() => '6838d98c-6222-442c-9ff3-23a1a85674d5');
  vi.stubGlobal('crypto', { randomUUID: native });
  expect(randomUUID()).toBe('6838d98c-6222-442c-9ff3-23a1a85674d5');
  expect(native).toHaveBeenCalledOnce();
});
