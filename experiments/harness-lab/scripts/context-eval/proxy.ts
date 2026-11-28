import http from 'node:http';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { inspectWirePayload, sanitizeUrl, type WirePayloadAudit } from './wire-capture.js';

export interface RedactedProxyOptions {
  upstreamBaseUrl: string;
  logPath?: string;
  fingerprints?: ReadonlyArray<string>;
  secretValues?: ReadonlyArray<string>;
  maxRequests?: number;
}

export interface RedactedProxyRecord {
  index: number;
  method: string;
  path: string;
  upstreamUrl: string;
  status: number;
  durationMs: number;
  requestHeaders: Record<string, string>;
  audit: WirePayloadAudit | null;
  fingerprintsInEntirePayload: string[];
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number } | null;
}

export interface RunningRedactedProxy {
  port: number;
  baseUrl: string;
  records: RedactedProxyRecord[];
  close: () => Promise<void>;
}

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'x-api-key',
  'api-key',
  'cookie',
  'set-cookie',
  'proxy-authorization',
]);

export function redactHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_HEADER_NAMES.has(lower) || lower.includes('token') || lower.includes('secret')) {
      clean[lower] = '[REDACTED]';
    } else if (value !== undefined) {
      clean[lower] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  return clean;
}

function parseUsageFromResponseText(text: string): RedactedProxyRecord['usage'] {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let found = false;

  const inspectObject = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    const record = obj as Record<string, unknown>;
    const usage = (record.usage && typeof record.usage === 'object' ? record.usage
      : record.message && typeof record.message === 'object' && (record.message as Record<string, unknown>).usage
        ? (record.message as Record<string, unknown>).usage
        : null) as Record<string, unknown> | null;
    if (!usage) return;
    if (typeof usage.prompt_tokens === 'number') { input = usage.prompt_tokens; found = true; }
    if (typeof usage.completion_tokens === 'number') { output = usage.completion_tokens; found = true; }
    if (typeof usage.input_tokens === 'number') { input = Math.max(input, usage.input_tokens); found = true; }
    if (typeof usage.output_tokens === 'number') { output = Math.max(output, usage.output_tokens); found = true; }
    if (typeof usage.cache_read_input_tokens === 'number') { cacheRead = Math.max(cacheRead, usage.cache_read_input_tokens); found = true; }
    if (typeof usage.cache_creation_input_tokens === 'number') { cacheWrite = Math.max(cacheWrite, usage.cache_creation_input_tokens); found = true; }
    const promptDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
    if (promptDetails && typeof promptDetails.cached_tokens === 'number') {
      cacheRead = Math.max(cacheRead, promptDetails.cached_tokens);
      found = true;
    }
    if (typeof usage.prompt_cache_hit_tokens === 'number') {
      cacheRead = Math.max(cacheRead, usage.prompt_cache_hit_tokens);
      found = true;
    }
  };

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    if (!payload || payload === '[DONE]') continue;
    try { inspectObject(JSON.parse(payload)); } catch { /* ignore non-json SSE lines */ }
  }
  return found ? { input, output, cacheRead, cacheWrite } : null;
}

function buildUpstreamUrl(upstreamBaseUrl: string, reqPath: string): string {
  const base = upstreamBaseUrl.replace(/\/+$/, '');
  const cleanPath = reqPath.startsWith('/') ? reqPath : `/${reqPath}`;
  if (base.endsWith('/v1') && cleanPath.startsWith('/v1/')) {
    return `${base}${cleanPath.slice(3)}`;
  }
  if (base.endsWith('/v3') && cleanPath.startsWith('/v3/')) {
    return `${base}${cleanPath.slice(3)}`;
  }
  return `${base}${cleanPath}`;
}

export async function startRedactedProxy(options: RedactedProxyOptions): Promise<RunningRedactedProxy> {
  if (options.logPath) await mkdir(dirname(options.logPath), { recursive: true });
  const records: RedactedProxyRecord[] = [];
  const fingerprints = options.fingerprints ?? [];
  const secretValues = options.secretValues ?? [];

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const index = records.length;
    if (options.maxRequests !== undefined && index >= options.maxRequests) {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Proxy hard request limit (${options.maxRequests}) reached.` } }));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const rawBody = Buffer.concat(chunks);
    const bodyText = rawBody.toString('utf8');

    const reqPath = req.url || '/';
    const upstreamUrl = buildUpstreamUrl(options.upstreamBaseUrl, reqPath);
    const forwardHeaders = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      if (lower === 'host' || lower === 'content-length' || lower === 'connection' || lower === 'accept-encoding') continue;
      if (value !== undefined) forwardHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
    }

    let parsedBody: Record<string, unknown> | null = null;
    if (bodyText.trim().startsWith('{')) {
      try { parsedBody = JSON.parse(bodyText) as Record<string, unknown>; } catch { parsedBody = null; }
    }
    const audit = parsedBody
      ? inspectWirePayload(index, upstreamUrl, parsedBody, fingerprints, secretValues)
      : null;
    const fingerprintsInEntirePayload = fingerprints.filter(fp => fp && bodyText.includes(fp));

    try {
      const upstream = await fetch(upstreamUrl, {
        method: req.method ?? 'POST',
        headers: forwardHeaders,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : rawBody,
      });

      const responseHeaders: Record<string, string> = {};
      upstream.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (lower === 'transfer-encoding' || lower === 'content-encoding' || lower === 'content-length') return;
        responseHeaders[key] = value;
      });
      res.writeHead(upstream.status, responseHeaders);

      let collectedResponse = '';
      if (upstream.body) {
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
          collectedResponse += decoder.decode(value, { stream: true });
        }
        collectedResponse += decoder.decode();
      }
      res.end();

      const record: RedactedProxyRecord = {
        index,
        method: req.method ?? 'POST',
        path: reqPath,
        upstreamUrl: sanitizeUrl(upstreamUrl),
        status: upstream.status,
        durationMs: Date.now() - started,
        requestHeaders: redactHeaders(req.headers),
        audit,
        fingerprintsInEntirePayload,
        usage: parseUsageFromResponseText(collectedResponse),
      };
      records.push(record);
      if (options.logPath) {
        await appendFile(options.logPath, `${JSON.stringify(record)}\n`, 'utf8');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
      }
      res.end(JSON.stringify({ error: { message: `Proxy upstream error: ${message}` } }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind local proxy port');

  return {
    port: address.port,
    baseUrl: `http://127.0.0.1:${address.port}`,
    records,
    close: () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
  };
}
