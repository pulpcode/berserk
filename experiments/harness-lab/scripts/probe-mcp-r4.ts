import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { RemoteMcpSession } from '../src/connectors/remote.js';
import { validateMcpArguments } from '../src/connectors/schema.js';
import { startControlledMcp } from './mcp-controlled-fixture.js';

const summary: Record<string, unknown> = {node: process.version, sdk: '@modelcontextprotocol/client@2.4.0', ranAt: new Date().toISOString()};
const cleanup: Array<() => Promise<void>> = [];
try {
  const controlled: Array<Record<string, unknown>> = [];
  for (const [era, label, token] of [['modern', 'alpha', 'fixture-alpha-token'], ['modern', 'beta', 'fixture-beta-token'], ['legacy', 'legacy', 'fixture-legacy-token']] as const) {
    const endpoint = await startControlledMcp({era, label, token, sse: true}); cleanup.push(() => endpoint.close());
    const session = new RemoteMcpSession({...endpoint, headers: {Authorization: `Bearer ${token}`}}); cleanup.push(() => session.close());
    const discoveryStarted=performance.now();
    const catalog = await session.discover();
    const coldDiscoveryMs=performance.now()-discoveryStarted;
    const cachedStarted=performance.now();await session.discover();const cachedDiscoveryMs=performance.now()-cachedStarted;
    assert.equal(catalog.protocolEra, era); assert.equal(catalog.tools[0].name, 'lookup'); assert.equal(catalog.tools[0].available, true);
    const callStarted=performance.now();
    const result = await session.invoke({name: 'lookup', arguments: {query: 'probe'}, contractDigest: catalog.tools[0].contractDigest});
    assert.equal(result.status, 'success'); assert.equal(result.text, `${label}:probe`);
    assert.equal(endpoint.records.filter((record) => record.method === 'tools/call').length, 1);
    controlled.push({label, protocolVersion: catalog.protocolVersion, protocolEra: catalog.protocolEra, serverInfo: catalog.serverInfo, toolNames: catalog.tools.map((tool) => tool.name), digest: catalog.digest, outcome: result.status, callCount: 1,coldDiscoveryMs,cachedDiscoveryMs,firstCallMs:performance.now()-callStarted,catalogBytes:Buffer.byteLength(JSON.stringify(catalog))});
  }
  summary.controlled = controlled;
  let receivedResolve!:()=>void;const received=new Promise<void>(resolve=>{receivedResolve=resolve;});
  const cancellable=await startControlledMcp({callDelayMs:2000,rawReply:method=>{if(method==='tools/call')receivedResolve();return false;}});cleanup.push(()=>cancellable.close());
  const session=new RemoteMcpSession({...cancellable});cleanup.push(()=>session.close());
  const catalog=await session.discover(),controller=new AbortController();
  const pending=session.invoke({name:'lookup',arguments:{query:'cancel-sample'},contractDigest:catalog.tools[0].contractDigest},{signal:controller.signal});
  await received;const cancelStarted=performance.now();controller.abort();const cancelled=await pending;
  assert.equal(cancelled.status,'unknown');assert.equal(cancellable.records.filter(record=>record.method==='tools/call').length,1);
  summary.cancellation={sampleCount:1,afterServerReceived:true,status:cancelled.status,settledMs:performance.now()-cancelStarted,noReplay:true};
  if (process.argv.includes('--public')) {
    const approvedIndex = process.argv.indexOf('--approved-ip');
    const approvedIp = approvedIndex >= 0 ? process.argv[approvedIndex + 1] : undefined;
    assert.ok(approvedIp === undefined || isIP(approvedIp), '--approved-ip requires one exact IP literal.');
    const dnsAnswers = await lookup('docs.mcp.cloudflare.com', {all: true, verbatim: true});
    const session = new RemoteMcpSession({url: 'https://docs.mcp.cloudflare.com/mcp', networkPolicy: {approvedTargets: approvedIp ? [approvedIp] : []}}); cleanup.push(() => session.close());
    try {
      const catalog = await session.discover();
      const search = catalog.tools.find((tool) => tool.name === 'search_cloudflare_documentation' && tool.available);
      assert.ok(search, 'Runtime listing did not admit the public Cloudflare documentation search contract.');
      const args = validateMcpArguments(search, {query: 'MCP Streamable HTTP transport'});
      const result = await session.invoke({name: search.name, arguments: args, contractDigest: search.contractDigest});
      assert.equal(result.status, 'success'); assert.ok(result.text.length > 0);
      summary.publicCloudflareDocumentation = {status: 'passed', endpoint: 'https://docs.mcp.cloudflare.com/mcp', dnsAnswers, ...(approvedIp ? {temporaryApprovedIp: approvedIp} : {}), tlsHostnameVerification: 'Native HTTPS certificate and hostname verification enabled for docs.mcp.cloudflare.com', protocolVersion: catalog.protocolVersion, protocolEra: catalog.protocolEra, serverInfo: catalog.serverInfo,
        tools: catalog.tools.map((tool) => ({name: tool.name, available: tool.available, ...(tool.unavailableReason ? {unavailableReason: tool.unavailableReason} : {})})), action: search.name, catalogDigest: catalog.digest,
        resultBytes: Buffer.byteLength(result.text), resultDigest: createHash('sha256').update(result.text).digest('hex'), resultPreview: result.text.slice(0, 240)};
    } catch (error) {
      summary.publicCloudflareDocumentation = {status: 'failed', dnsAnswers, ...(approvedIp ? {temporaryApprovedIp: approvedIp} : {}), message: error instanceof Error ? error.message : 'Public MCP smoke failed'};
      process.exitCode = 1;
    }
  }
  console.info(JSON.stringify(summary, null, 2));
} finally { await Promise.all(cleanup.reverse().map((close) => close())); }
