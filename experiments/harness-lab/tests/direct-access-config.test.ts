import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/server/config.js';

describe('explicit direct HTTP access', () => {
  const login = { LAB_SESSION_SECRET: 'test-secret-with-at-least-32-characters' };
  it('defaults to loopback and requires an origin and login for public listening', () => {
    expect(loadConfig(login).listenHost).toBe('127.0.0.1');
    expect(() => loadConfig({ ...login, LAB_LISTEN_HOST: '0.0.0.0' })).toThrow('LAB_PUBLIC_ORIGIN');
    expect(() => loadConfig({ LAB_AUTH_MODE: 'test', LAB_PUBLIC_ORIGIN: 'http://192.0.2.10:4315' })).toThrow('正式登录');
    expect(loadConfig({ ...login, LAB_LISTEN_HOST: '0.0.0.0', LAB_PUBLIC_ORIGIN: 'http://192.0.2.10:4315' })).toMatchObject({ listenHost: '0.0.0.0', publicOrigin: 'http://192.0.2.10:4315' });
  });
  it('rejects malformed origins, credentials, paths and unsupported listeners', () => {
    for (const value of ['', '*', 'null', 'http://0.0.0.0:4315', 'https://example.com', 'http://user:pass@example.com', 'http://example.com/', 'http://example.com/path', 'http://example.com?q=x', 'http://example.com#fragment']) {
      expect(() => loadConfig({ ...login, LAB_PUBLIC_ORIGIN: value })).toThrow('LAB_PUBLIC_ORIGIN');
    }
    expect(() => loadConfig({ ...login, LAB_LISTEN_HOST: 'invalid' })).toThrow('LAB_LISTEN_HOST');
  });
});
