import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rmdir, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
export const ROOT = resolve(dirname(scriptPath), '../../../..');
export const PLAN = '.trellis/tasks/10-15-map-query-scope/model-comparison/plan.md';
export const OUTPUT = '.local/map-model-comparison';
export const MODELS = ['deepseek-flash', 'deepseek-v4-pro'];
export const sha = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const check = (condition, code) => { if (!condition) throw new Error(code); };
const exists = async (path) => access(path).then(() => true, () => false);

export function schedule() {
  const entries = [];
  for (let repeat = 1; repeat <= 3; repeat++) {
    for (const caseId of ['C1', 'C2', 'C3', 'C4']) {
      for (const model of repeat === 2 ? [...MODELS].reverse() : MODELS) {
        entries.push({ index: entries.length + 1, caseId, model, repeat });
      }
    }
  }
  return entries;
}

export function sourcesFromPlan(plan) {
  const sources = [...plan.matchAll(/^\| (C[1-4]) \| ([^|]+) \| (\d+) \|/gm)]
    .map(([, caseId, source, line]) => ({ caseId, source: source.trim(), line: Number(line) }));
  check(sources.map((s) => s.caseId).join(',') === 'C1,C2,C3,C4', 'invalid_plan_sources');
  for (const { source } of sources) {
    check(source.startsWith('.local/map-query-scope/') && !source.split('/').includes('..'), 'invalid_source_path');
  }
  return sources;
}

export function endpoint(base) {
  let url;
  try { url = new URL(base); } catch { throw new Error('invalid_endpoint'); }
  check(url.origin === 'https://api.deepseek.com' && !url.username && !url.password && !url.search && !url.hash, 'invalid_endpoint');
  const path = url.pathname.replace(/\/$/, '');
  check(['', '/v1', '/chat/completions', '/v1/chat/completions'].includes(path), 'invalid_endpoint');
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
  return url.href;
}

export async function prepare({ root = ROOT, output = join(root, OUTPUT) } = {}) {
  const plan = await readFile(join(root, PLAN), 'utf8');
  const files = {};
  const sources = [];
  for (const source of sourcesFromPlan(plan)) {
    const sourceBytes = await readFile(join(root, source.source), 'utf8');
    const line = sourceBytes.split(/\r?\n/)[source.line - 1];
    const payload = JSON.parse(line).payload;
    check(payload?.model === MODELS[0] && payload.stream === true && payload.thinking?.type === 'disabled', 'invalid_source_payload');
    const shared = { ...payload };
    delete shared.model;
    sources.push({ ...source, sourceSha256: sha(sourceBytes), lineSha256: sha(line), sharedSha256: sha(JSON.stringify(shared)) });
    files[`inputs/${source.caseId}.captured.json`] = JSON.stringify(payload);
    for (const model of MODELS) files[`inputs/${source.caseId}.${model}.json`] = JSON.stringify({ ...payload, model });
  }
  // Exclusive root creation deliberately leaves failed preparations for inspection.
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { mode: 0o700 });
  await mkdir(join(output, 'inputs'), { mode: 0o700 });
  for (const [name, bytes] of Object.entries(files)) await writeFile(join(output, name), bytes, { flag: 'wx', mode: 0o600 });
  const manifest = {
    version: 1, preparedAt: new Date().toISOString(), timeoutMs: 300000, retries: 0,
    scriptSha256: sha(await readFile(scriptPath)), planSha256: sha(plan),
    sources, schedule: schedule(), files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha(bytes)])),
  };
  const frozen = json(manifest);
  await writeFile(join(output, 'manifest.json'), frozen, { flag: 'wx', mode: 0o600 });
  await writeFile(join(output, 'manifest.sha256'), sha(frozen) + '\n', { flag: 'wx', mode: 0o600 });
  return manifest;
}

export async function verify({ root = ROOT, output = join(root, OUTPUT) } = {}) {
  const frozen = await readFile(join(output, 'manifest.json'));
  check(sha(frozen) === (await readFile(join(output, 'manifest.sha256'), 'utf8')).trim(), 'manifest_changed');
  const manifest = JSON.parse(frozen);
  check(manifest.scriptSha256 === sha(await readFile(scriptPath)), 'script_changed');
  check(manifest.planSha256 === sha(await readFile(join(root, PLAN))), 'plan_changed');
  check(JSON.stringify(manifest.schedule) === JSON.stringify(schedule()), 'schedule_changed');
  for (const [name, expected] of Object.entries(manifest.files)) check(sha(await readFile(join(output, name))) === expected, 'input_changed');
  for (const source of manifest.sources) check(sha(await readFile(join(root, source.source))) === source.sourceSha256, 'source_changed');
  return manifest;
}

// SSE data fields join with a newline; TextDecoder preserves code points split across transport chunks.
export function parseSSE(raw) {
  const events = [];
  for (const block of raw.split(/\r\n\r\n|\n\n|\r\r/)) {
    const data = block.split(/\r\n|\n|\r/).filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, '')).join('\n');
    if (data) events.push(data);
  }
  const result = { content: '', reasoning_content: '', tool_calls: [], finish_reason: null, usage: null, done: false, parseErrors: 0, providerError: false, multipleChoices: false };
  const calls = new Map();
  for (const data of events) {
    if (data.trim() === '[DONE]') { result.done = true; continue; }
    let event;
    try { event = JSON.parse(data); } catch { result.parseErrors++; continue; }
    if (!event || typeof event !== 'object') { result.parseErrors++; continue; }
    if (event.error) result.providerError = true;
    if (event.usage) result.usage = event.usage;
    if (event.id) result.id = event.id;
    if (event.model) result.responseModel = event.model;
    if (event.choices !== undefined && !Array.isArray(event.choices)) { result.parseErrors++; continue; }
    for (const choice of event.choices ?? []) {
      if (choice?.index !== 0) { result.multipleChoices = true; continue; }
      if (choice.finish_reason) result.finish_reason = choice.finish_reason;
      const delta = choice.delta ?? {};
      for (const field of ['content', 'reasoning_content']) if (typeof delta[field] === 'string') result[field] += delta[field];
      if (delta.tool_calls !== undefined && !Array.isArray(delta.tool_calls)) { result.parseErrors++; continue; }
      for (const part of delta.tool_calls ?? []) {
        if (!Number.isInteger(part?.index) || part.index < 0) { result.parseErrors++; continue; }
        const call = calls.get(part.index) ?? { index: part.index, id: '', type: '', function: { name: '', arguments: '' } };
        for (const field of ['id', 'type']) if (typeof part[field] === 'string') call[field] += part[field];
        for (const field of ['name', 'arguments']) if (typeof part.function?.[field] === 'string') call.function[field] += part.function[field];
        calls.set(part.index, call);
      }
    }
  }
  result.tool_calls = [...calls.values()].sort((a, b) => a.index - b.index);
  return { events, result };
}

export async function readStream(body, onText) {
  if (!body) return;
  const decoder = new TextDecoder();
  try {
    for await (const chunk of body) onText(decoder.decode(chunk, { stream: true }));
  } finally { onText(decoder.decode()); }
}

export function redact(text, apiKey) {
  if (!apiKey) return text;
  const variants = [apiKey, JSON.stringify(apiKey).slice(1, -1), encodeURIComponent(apiKey)];
  for (const value of new Set(variants)) text = text.split(value).join('[REDACTED]');
  return text;
}

export function classify(result, transport, httpStatus) {
  if (transport) return transport;
  if (httpStatus < 200 || httpStatus >= 300) return 'http_error';
  if (result.providerError) return 'provider_error';
  if (result.parseErrors || result.multipleChoices) return 'invalid_response';
  if (result.finish_reason === 'length') return 'length_truncated';
  if (result.finish_reason === 'content_filter') return 'content_filtered';
  if (!result.done) return 'truncated_stream';
  if (!result.finish_reason) return 'missing_finish';
  if (!['stop', 'tool_calls'].includes(result.finish_reason)) return 'unexpected_finish';
  if (!result.content && !result.tool_calls.length) return 'missing_output';
  return 'completed';
}

export async function runEntry(index, { root = ROOT, output = join(root, OUTPUT), env = process.env, fetchImpl = fetch } = {}) {
  const manifest = await verify({ root, output });
  const entry = manifest.schedule[index - 1];
  check(Number.isInteger(index) && entry?.index === index, 'invalid_index');
  const apiKey = env.LLM_API_KEY?.trim();
  check(typeof apiKey === 'string' && apiKey.length > 0, 'missing_api_key');
  const url = endpoint(env.LLM_BASE_URL ?? 'https://api.deepseek.com');
  const body = await readFile(join(output, `inputs/${entry.caseId}.${entry.model}.json`), 'utf8');
  check(redact(body, apiKey) === body, 'credential_in_input');
  const entryDir = (i) => join(output, 'runs', String(i).padStart(2, '0'));
  const lock = join(output, '.run-lock');
  await mkdir(lock);
  try {
    if (index > 1) check(await exists(join(entryDir(index - 1), 'result.json')), 'previous_entry_incomplete');
    await mkdir(join(output, 'runs'), { recursive: true, mode: 0o700 });
    await mkdir(entryDir(index), { mode: 0o700 });
    await writeFile(join(entryDir(index), 'request.json'), body, { flag: 'wx', mode: 0o600 });
    const startedAt = new Date().toISOString();
    const start = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), manifest.timeoutMs);
    let raw = '', httpStatus = null, transport = null;
    try {
      const response = await fetchImpl(url, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body, signal: controller.signal, redirect: 'error',
      });
      httpStatus = response.status;
      await readStream(response.body, (text) => { raw += text; });
    } catch {
      // Do not persist thrown objects: fetch/provider diagnostics may contain credentials.
      transport = controller.signal.aborted ? 'timeout' : 'transport_error';
    } finally { clearTimeout(timeout); }
    const { events, result } = parseSSE(raw);
    const record = { ...entry, requestedModel: entry.model, startedAt, elapsedMs: Math.round(performance.now() - start), httpStatus,
      status: classify(result, transport, httpStatus), endpoint: url, requestSha256: sha(body), ...result };
    for (const [name, bytes] of Object.entries({ 'response.sse': raw, 'events.json': json(events), 'result.json': json(record) })) {
      await writeFile(join(entryDir(index), name), redact(bytes, apiKey), { flag: 'wx', mode: 0o600 });
    }
    return { index, status: record.status };
  } finally { await rmdir(lock); }
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  if (command === 'prepare' && !argument) {
    const manifest = await prepare();
    console.log(JSON.stringify({ prepared: true, calls: manifest.schedule.length }));
  } else if (command === 'run' && (argument === 'all' || /^\d+$/.test(argument ?? ''))) {
    const indexes = argument === 'all' ? schedule().map((entry) => entry.index) : [Number(argument)];
    for (const index of indexes) console.log(JSON.stringify(await runEntry(index)));
  } else throw new Error('usage');
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch(() => {
    console.error('Replay stopped before completion; inspect frozen inputs and existing run artifacts. Usage: replay.mjs prepare | run <1..24|all>. No retry performed.');
    process.exitCode = 1;
  });
}
