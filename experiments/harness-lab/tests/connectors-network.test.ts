import { afterEach, describe, expect, it } from 'vitest';
import { createPinnedLookup, createPinnedMcpFetch, isMcpCredentialHeader, isPublicMcpAddress } from '../src/connectors/network.js';
import { startControlledMcp } from '../scripts/mcp-controlled-fixture.js';
import type { lookup as dnsLookup } from 'node:dns/promises';

describe('MCP fixed-target network policy', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });
  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.20.1.2', '192.168.1.2', '100.100.100.200', '0.0.0.0', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::', 'ff02::1'])('denies private/local/metadata/transition address %s', (address) => expect(isPublicMcpAddress(address)).toBe(false));
  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '2001:4860:4860::8888'])('admits public unicast address %s', (address) => expect(isPublicMcpAddress(address)).toBe(true));
  it('admits explicit vendor API-key headers and rejects routing/session/proxy header authority', () => {
    for (const name of ['Authorization', 'Ocp-Apim-Subscription-Key', 'X-Api-Key', 'ApiKey']) expect(isMcpCredentialHeader(name)).toBe(true);
    for (const name of ['Host', 'Cookie', 'Mcp-Session-Id', 'Content-Type', 'Proxy-Authorization', 'X-Forwarded-Host', 'Accept-Encoding']) expect(isMcpCredentialHeader(name)).toBe(false);
  });
  it('pins the validated DNS answer into the actual native lookup result, rejecting mixed and changing answers', async () => {
    let resolutions = 0;
    const resolver = (async () => { resolutions++; return resolutions === 1 ? [{address: '1.1.1.1', family: 4}] : [{address: '169.254.169.254', family: 4}]; }) as unknown as typeof dnsLookup;
    const lookup = createPinnedLookup([], resolver);
    const dial = () => new Promise((resolve, reject) => lookup('same-host.example', {family: 4, hints: 0}, (error, address) => error ? reject(error) : resolve(address)));
    expect(await dial()).toBe('1.1.1.1'); expect(resolutions).toBe(1);
    await expect(dial()).rejects.toThrow('网络地址'); expect(resolutions).toBe(2);
    const mixed = createPinnedLookup([], (async () => [{address: '1.1.1.1', family: 4}, {address: '127.0.0.1', family: 4}]) as unknown as typeof dnsLookup);
    await expect(new Promise((resolve, reject) => mixed('mixed.example', {family: 4, hints: 0}, (error, address) => error ? reject(error) : resolve(address)))).rejects.toThrow('网络地址');
  });
  it('requires separate exact HTTP origin and private IP approvals and rejects endpoint mutation before any request', async () => {
    const endpoint = await startControlledMcp(); cleanups.push(() => endpoint.close());
    expect(() => createPinnedMcpFetch({url: endpoint.url})).toThrow('端点');
    expect(() => createPinnedMcpFetch({url: endpoint.url, networkPolicy: {approvedTargets: [endpoint.origin]}})).toThrow('网络地址');
    const send = createPinnedMcpFetch({...endpoint, headers: {Authorization: 'Bearer private-secret'}});
    await expect(send(`${endpoint.url}/other`)).rejects.toThrow('端点');
    await expect(send(new URL('/elsewhere', endpoint.origin))).rejects.toThrow('端点');
    expect(endpoint.records).toHaveLength(0);
  });
  it.each(['GET', 'POST', 'DELETE'].flatMap(method => [301, 302, 303, 307, 308].map(status => ({method, status}))))('blocks redirect$status for$method without forwarding credentials', async ({method, status}) => {
    const target = await startControlledMcp(); cleanups.push(() => target.close());
    const endpoint = await startControlledMcp({rawReply: (_method, response) => { response.writeHead(status, {Location: target.url}); response.end('private-error-body'); return true; }}); cleanups.push(() => endpoint.close());
    const send = createPinnedMcpFetch({...endpoint, headers: {Authorization: 'Bearer private-secret'}});
    const response = method === 'POST' ? send(endpoint.url, {method, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'server/discover'})}) : send(endpoint.url, {method});
    await expect(response).rejects.toThrow('重定向');
    expect(target.httpRecords).toHaveLength(0);
  });
  it('bounds unknown-length JSON, error bodies and SSE comments/events before SDK parsing', async () => {
    for (const [status, type, body] of [[200, 'application/json', 'x'.repeat(2048)], [500, 'application/json', 'private-secret'.repeat(200)], [200, 'text/event-stream', `:${'x'.repeat(2048)}\n\n`], [200, 'text/event-stream', ':x\n\n'.repeat(400)]] as const) {
      const endpoint = await startControlledMcp({rawReply: (_method, response) => { response.writeHead(status, {'content-type': type}); response.write(body); response.end(); return true; }}); cleanups.push(() => endpoint.close());
      const send = createPinnedMcpFetch({...endpoint, networkPolicy: {...endpoint.networkPolicy, maxResponseBytes: 1024, maxSseEventBytes: 512}});
      const consume = async () => (await send(endpoint.url, {method: 'POST', body: JSON.stringify({id: 1, method: 'server/discover'})})).text();
      await expect(consume()).rejects.toThrow('上限');
    }
  });
  it('bounds deadlines, request bodies and cancellation without exposing headers/body/URL errors', async () => {
    const endpoint = await startControlledMcp({rawReply: () => true}); cleanups.push(() => endpoint.close());
    const send = createPinnedMcpFetch({...endpoint, headers: {Authorization: 'Bearer private-secret'}, networkPolicy: {...endpoint.networkPolicy, timeoutMs: 40, idleTimeoutMs: 40, maxRequestBytes: 64}});
    await expect(send(endpoint.url, {method: 'POST', body: JSON.stringify({id: 1, method: 'server/discover'})})).rejects.toThrow('超时');
    await expect(send(endpoint.url, {method: 'POST', body: 'x'.repeat(65)})).rejects.toThrow('上限');
    const controller = new AbortController(); controller.abort();
    await expect(send(endpoint.url, {signal: controller.signal})).rejects.toThrow();
    expect(() => createPinnedMcpFetch({url: 'https://user:private-secret@example.com/mcp'})).toThrow('端点');
  });
});
