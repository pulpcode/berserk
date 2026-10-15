import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ROOT, PLAN, MODELS, prepare, verify, schedule, endpoint, parseSSE,
  readStream, classify, redact, runEntry, sha,
} from './replay.mjs';

const event = (value) => `data: ${JSON.stringify(value)}\n\n`;
const completed = event({ model: 'test-model-version', choices: [{ index: 0, delta: { content: '你好🌍' }, finish_reason: 'stop' }] })
  + event({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 3 } }) + 'data: [DONE]\n\n';

test('SSE preserves unicode byte splits, multiline data, tool fragments, usage and DONE', async () => {
  const raw = ': keepalive\r\n\r\ndata: {"choices":\r\ndata: [{"index":0,"delta":{"content":"甲🌍"}}]}\r\n\r\n'
    + event({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'annotation_read', arguments: '{"mode":' } }] } }] })
    + event({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"draft"}' } }] }, finish_reason: 'tool_calls' }] })
    + event({ choices: [], usage: { total_tokens: 77 } }) + 'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(raw);
  let decoded = '';
  await readStream((async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })(), (text) => { decoded += text; });
  assert.equal(decoded, raw);
  const { events, result } = parseSSE(decoded);
  assert.equal(events.length, 5);
  assert.equal(result.content, '甲🌍');
  assert.deepEqual(result.tool_calls, [{ index: 0, id: 'call-1', type: 'function', function: { name: 'annotation_read', arguments: '{"mode":"draft"}' } }]);
  assert.deepEqual(result.usage, { total_tokens: 77 });
  assert.equal(classify(result, null, 200), 'completed');
});

test('classifies truncations, errors and empty outputs without inventing success', () => {
  const result = parseSSE(completed).result;
  assert.equal(result.responseModel, 'test-model-version');
  for (const [patch, status] of [
    [{ done: false }, 'truncated_stream'], [{ finish_reason: null }, 'missing_finish'],
    [{ finish_reason: 'length' }, 'length_truncated'], [{ finish_reason: 'content_filter' }, 'content_filtered'],
    [{ providerError: true }, 'provider_error'], [{ content: '' }, 'missing_output'],
    [{ parseErrors: 1 }, 'invalid_response'], [{ multipleChoices: true }, 'invalid_response'],
  ]) assert.equal(classify({ ...result, ...patch }, null, 200), status);
  assert.equal(classify(result, 'timeout', 200), 'timeout');
  assert.equal(classify(result, 'transport_error', null), 'transport_error');
  assert.equal(classify(result, null, 429), 'http_error');
  assert.equal(parseSSE('data: {broken}\n\ndata: null\n\n').result.parseErrors, 2);
  assert.equal(parseSSE(event({ error: { message: 'sensitive' } })).result.providerError, true);
});

test('endpoint allowlist preserves explicit API paths and rejects other destinations', () => {
  for (const base of ['https://api.deepseek.com', 'https://api.deepseek.com/', 'https://api.deepseek.com/chat/completions']) {
    assert.equal(endpoint(base), 'https://api.deepseek.com/chat/completions');
  }
  for (const base of ['https://api.deepseek.com/v1', 'https://api.deepseek.com/v1/', 'https://api.deepseek.com/v1/chat/completions']) {
    assert.equal(endpoint(base), 'https://api.deepseek.com/v1/chat/completions');
  }
  for (const base of ['http://api.deepseek.com', 'https://evil.example', 'https://user:pass@api.deepseek.com', 'https://api.deepseek.com?key=x', 'https://api.deepseek.com/other', 'https://api.deepseek.com/#fragment']) {
    assert.throws(() => endpoint(base), /invalid_endpoint/);
  }
  assert.equal(redact('secret secret', 'secret'), '[REDACTED] [REDACTED]');
});

test('prepare extracts exact approved inputs, freezes 24 requests and rejects mutation/reuse', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'map-replay-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const output = join(temp, 'batch');
  const manifest = await prepare({ output });
  assert.equal(manifest.schedule.length, 24);
  assert.deepEqual(manifest.schedule.slice(0, 3).map(({ caseId, model }) => [caseId, model]), [['C1', MODELS[0]], ['C1', MODELS[1]], ['C2', MODELS[0]]]);
  assert.equal(manifest.schedule[8].model, MODELS[1]);
  assert.equal(manifest.schedule[16].model, MODELS[0]);
  assert.deepEqual(manifest.sources.map(({ caseId, line }) => [caseId, line]), [['C1', 9], ['C2', 2], ['C3', 1], ['C4', 3]]);
  for (const source of manifest.sources) {
    const original = JSON.parse((await readFile(join(ROOT, source.source), 'utf8')).split(/\r?\n/)[source.line - 1]).payload;
    const captured = JSON.parse(await readFile(join(output, `inputs/${source.caseId}.captured.json`), 'utf8'));
    assert.deepEqual(captured, original);
    for (const model of MODELS) {
      const request = JSON.parse(await readFile(join(output, `inputs/${source.caseId}.${model}.json`), 'utf8'));
      assert.deepEqual(request, { ...original, model });
      const rest = { ...request };
      delete rest.model;
      assert.equal(sha(JSON.stringify(rest)), source.sharedSha256);
    }
  }
  assert.equal(manifest.planSha256, sha(await readFile(join(ROOT, PLAN))));
  await verify({ output });
  await assert.rejects(prepare({ output }), { code: 'EEXIST' });
  const path = join(output, 'inputs/C1.deepseek-flash.json');
  await writeFile(path, '{}');
  await assert.rejects(verify({ output }), /input_changed/);
});

test('mock transport sends frozen bytes once, redacts evidence and continues after independent failures', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'map-replay-run-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const output = join(temp, 'batch');
  await prepare({ output });
  const env = { LLM_API_KEY: 'test-secret-never-persist', LLM_BASE_URL: 'https://api.deepseek.com/v1' };
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.deepseek.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, `Bearer ${env.LLM_API_KEY}`);
    assert.equal(options.redirect, 'error');
    assert.equal(options.body, await readFile(join(output, `inputs/C1.${schedule()[calls - 1].model}.json`), 'utf8'));
    if (calls === 1) return new Response(JSON.stringify({ error: env.LLM_API_KEY }), { status: 429 });
    return new Response(completed);
  };
  assert.deepEqual(await runEntry(1, { output, env, fetchImpl }), { index: 1, status: 'http_error' });
  assert.deepEqual(await runEntry(2, { output, env, fetchImpl }), { index: 2, status: 'completed' });
  await assert.rejects(runEntry(2, { output, env, fetchImpl }), { code: 'EEXIST' });
  await assert.rejects(runEntry(4, { output, env, fetchImpl }), /previous_entry_incomplete/);
  assert.equal(calls, 2);
  const raw = await readFile(join(output, 'runs/01/response.sse'), 'utf8');
  assert(!raw.includes(env.LLM_API_KEY));
  assert(raw.includes('[REDACTED]'));
  const record = JSON.parse(await readFile(join(output, 'runs/02/result.json'), 'utf8'));
  assert.equal(record.model, MODELS[1]);
  assert.equal(record.requestedModel, MODELS[1]);
  assert.equal(record.responseModel, 'test-model-version');
  assert.equal(record.content, '你好🌍');
  const failure = await runEntry(3, { output, env, fetchImpl: async () => { throw new Error(env.LLM_API_KEY); } });
  assert.equal(failure.status, 'transport_error');
  for (const file of ['response.sse', 'events.json', 'result.json']) {
    assert(!(await readFile(join(output, 'runs/03', file), 'utf8')).includes(env.LLM_API_KEY));
  }
});
