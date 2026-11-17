import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { RemoteMcpSession } from '../src/connectors/remote.js';
import { startControlledMcp, type ControlledMcpOptions } from '../scripts/mcp-controlled-fixture.js';

describe('official SDK request-local MCP transport', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });
  async function fixture(options: ControlledMcpOptions = {}, headers?: Record<string, string>) {
    const endpoint = await startControlledMcp(options); cleanups.push(() => endpoint.close());
    const session = new RemoteMcpSession({...endpoint, headers}); cleanups.push(() => session.close());
    return {endpoint, session};
  }
  it.each(['modern', 'legacy'] as const)('negotiates only the admitted %s version and reads JSON/SSE with actual SDK', async (era) => {
    const {session, endpoint} = await fixture({era, sse: true, label: era});
    const catalog = await session.discover();
    expect(catalog.protocolEra).toBe(era); expect(catalog.protocolVersion).toBe(era === 'modern' ? '2026-07-28' : '2025-11-25');
    const result = await session.invoke({name: 'lookup', arguments: {query: 'hello'}, contractDigest: catalog.tools[0].contractDigest});
    expect(result).toMatchObject({status: 'success', sent: true, text: `${era}:hello`});
    expect(endpoint.records.filter((entry) => entry.method === 'tools/call')).toHaveLength(1);
    expect(endpoint.records.some((entry) => entry.method === 'initialize')).toBe(era === 'legacy');
  });
  it('isolates same remote name/serverInfo and organization/personal credentials across request-owned clients', async () => {
    const first = await fixture({label: 'first', token: 'org-secret'}, {Authorization: 'Bearer org-secret'});
    const second = await fixture({label: 'second', token: 'user-secret'}, {Authorization: 'Bearer user-secret'});
    for (const {session, endpoint} of [first, second]) {
      const catalog = await session.discover();
      expect(catalog.serverInfo).toEqual({name: 'same-server-family', version: '1.0.0'});
      const result = await session.invoke({name: 'lookup', arguments: {query: 'same-name'}, contractDigest: catalog.tools[0].contractDigest});
      expect(result.text).toBe(`${endpoint === first.endpoint ? 'first' : 'second'}:same-name`);
      expect(JSON.stringify(catalog)).not.toContain('secret');
    }
    expect(first.endpoint.records.every((entry) => entry.authorization === 'Bearer org-secret')).toBe(true);
    expect(second.endpoint.records.every((entry) => entry.authorization === 'Bearer user-secret')).toBe(true);
    const wrong = new RemoteMcpSession({...first.endpoint, headers: {Authorization: 'Bearer wrong-secret'}}); cleanups.push(() => wrong.close());
    const beforeRejected = first.endpoint.httpRecords.length;
    await expect(wrong.discover()).rejects.toThrow('发现失败');
    expect(first.endpoint.httpRecords.length - beforeRejected).toBe(1);
  });
  it('isolates organization/two personal credentials and rotation at the same address despite public cache hints', async () => {
    const endpoint = await startControlledMcp({identities: {'Bearer org-secret': 'organization', 'Bearer user-one-secret': 'user-one', 'Bearer user-two-secret': 'user-two', 'Bearer rotated-secret': 'rotated'}}); cleanups.push(() => endpoint.close());
    for (const [token, label] of [['org-secret', 'organization'], ['user-one-secret', 'user-one'], ['user-two-secret', 'user-two'], ['rotated-secret', 'rotated']]) {
      const session = new RemoteMcpSession({...endpoint, headers: {Authorization: `Bearer ${token}`}}); cleanups.push(() => session.close());
      const catalog = await session.discover(); const result = await session.invoke({name: 'lookup', arguments: {query: 'scoped'}, contractDigest: catalog.tools[0].contractDigest});
      expect(result.text).toBe(`${label}:scoped`); expect(JSON.stringify(catalog)).not.toContain(token);
    }
    expect(endpoint.records.filter((record) => record.method === 'tools/list')).toHaveLength(4);
  });
  it('retains unsupported schemas as unavailable and rejects changed digest/invalid final args before sending', async () => {
    const {session, endpoint} = await fixture({tools: [
      {name: 'good', inputSchema: {type: 'object', properties: {count: {type: 'integer'}}, required: ['count'], additionalProperties: false}},
      {name: 'unsupported', inputSchema: {type: 'object', properties: {x: {$ref: 'https://example.com/schema'}}}},
    ]});
    const catalog = await session.discover(); expect(catalog.tools.map((tool) => tool.available)).toEqual([true, false]);
    for (const input of [
      {name: 'good', arguments: {count: 1}, contractDigest: 'stale'},
      {name: 'good', arguments: {count: '1'}, contractDigest: catalog.tools[0].contractDigest},
      {name: 'unsupported', arguments: {}, contractDigest: catalog.tools[1].contractDigest},
    ]) expect(await session.invoke(input)).toMatchObject({status: 'not_sent', sent: false});
    expect(endpoint.records.filter((entry) => entry.method === 'tools/call')).toHaveLength(0);
    catalog.tools[0].inputSchema = {}; expect((await session.discover()).tools[0].inputSchema).not.toEqual({});
  });
  it.each([
    {tools: [{name: 'duplicate', inputSchema: {type: 'object'}}, {name: 'duplicate', inputSchema: {type: 'object'}}]},
    {nextCursor: 'cycle', tools: []},
    {era: 'legacy' as const, protocolVersion: '2024-11-05'},
  ])('rejects duplicate/cyclic/unsupported discovery: %j', async (options) => { const {session} = await fixture(options); await expect(session.discover()).rejects.toThrow(); });
  it('returns input_required without automatic fulfillment/resubmission', async () => {
    const {session, endpoint} = await fixture({callResult: {resultType: 'input_required', requestState: 'private-opaque-continuation'}});
    const catalog = await session.discover(); const result = await session.invoke({name: 'lookup', arguments: {query: 'x'}, contractDigest: catalog.tools[0].contractDigest});
    expect(result).toMatchObject({status: 'input_required', sent: true}); expect(result.text).not.toContain('private-opaque');
    expect(endpoint.records.filter((entry) => entry.method === 'tools/call')).toHaveLength(1);
  });
  it('never retries header mismatch, transport loss or output schema failure and preserves unknown effects', async () => {
    for (const options of [{callErrorCode: -32020}, {dropCallReply: true}, {tools: [{name: 'lookup', inputSchema: {type: 'object'}, outputSchema: {type: 'object', properties: {n: {type: 'number'}}, required: ['n']}}], callResult: {content: [{type: 'text', text: 'unverified'}], structuredContent: {n: 'wrong'}}}]) {
      const {session, endpoint} = await fixture(options); const catalog = await session.discover(); let sent = 0;
      const result = await session.invoke({name: 'lookup', arguments: {query: 'x'}, contractDigest: catalog.tools[0].contractDigest}, {onSent: () => { sent++; }});
      expect(result).toMatchObject({status: 'unknown', sent: true}); expect(sent).toBe(1); expect(endpoint.records.filter((entry) => entry.method === 'tools/call')).toHaveLength(1);
    }
  });
  it('cancels only the particular request, with sent outcome unknown and no replay', async () => {
    const a = await fixture({callDelayMs: 1000}); const b = await fixture({label: 'continues'});
    const [catalogA, catalogB] = await Promise.all([a.session.discover(), b.session.discover()]);
    const controller = new AbortController(); let dispatched!: () => void; const ready = new Promise<void>((resolve) => { dispatched = resolve; });
    const pending = a.session.invoke({name: 'lookup', arguments: {query: 'x'}, contractDigest: catalogA.tools[0].contractDigest}, {signal: controller.signal, onSent: () => dispatched()});
    await ready; controller.abort(); expect(await pending).toMatchObject({status: 'unknown', sent: true});
    expect(await b.session.invoke({name: 'lookup', arguments: {query: 'ok'}, contractDigest: catalogB.tools[0].contractDigest})).toMatchObject({status: 'success', text: 'continues:ok'});
  });
  it('preserves a verified actual result when cancellation arrives after SDK completion', async () => {
    const {session} = await fixture({label: 'known'}); const catalog = await session.discover(); const controller = new AbortController();
    const callTool = Client.prototype.callTool;
    const spy = vi.spyOn(Client.prototype, 'callTool').mockImplementation(async function (this: Client, ...args) {
      const result = await callTool.apply(this, args); controller.abort(); return result;
    });
    try {
      expect(await session.invoke({name: 'lookup', arguments: {query: 'completed'}, contractDigest: catalog.tools[0].contractDigest}, {signal: controller.signal})).toMatchObject({status: 'success', sent: true, text: 'known:completed'});
    } finally { spy.mockRestore(); }
  });
  it('redacts reflected credentials from inert tool text and rejects credential-bearing catalogs', async () => {
    const {session} = await fixture({token: 'reflect-me-secret', callResult: {content: [{type: 'text', text: 'Bearer reflect-me-secret'}]}}, {Authorization: 'Bearer reflect-me-secret'});
    const catalog = await session.discover(); expect((await session.invoke({name: 'lookup', arguments: {query: 'x'}, contractDigest: catalog.tools[0].contractDigest})).text).not.toContain('reflect-me-secret');
    const bad = await fixture({token: 'reflect-me-secret', tools: [{name: 'lookup', description: 'Bearer reflect-me-secret', inputSchema: {type: 'object'}}]}, {Authorization: 'Bearer reflect-me-secret'});
    await expect(bad.session.discover()).rejects.toThrow('目录');
    const quoted = 'quoted"slash\\credential';
    const escaped = await fixture({token: quoted, tools: [{name: 'lookup', description: quoted, inputSchema: {type: 'object'}}]}, {Authorization: `Bearer ${quoted}`});
    await expect(escaped.session.discover()).rejects.toThrow('目录');
  });
  it('bounds inert returned text while preserving a verified successful remote outcome', async () => {
    const {session} = await fixture({callResult: {content: [{type: 'text', text: '😀'.repeat(30_000)}]}});
    const catalog = await session.discover(); const result = await session.invoke({name: 'lookup', arguments: {query: 'x'}, contractDigest: catalog.tools[0].contractDigest});
    expect(result).toMatchObject({status: 'success', sent: true}); expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(64 * 1024); expect(result.text).toContain('已截断');
  });
});
