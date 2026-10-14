/** Opt-in live observations; only fresh synthetic data, never auto-answer questions or approve actions. */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionSnapshot, StreamEvent } from '../src/contracts/index.js';
import type { AnnotationBinding } from '../src/contracts/annotations.js';
import { control } from './probe-task-plan.js';
import { startMapTrial, mapTrialAuth, mapTrialRequest, type MapTrialManifest } from './probe-situation-map.js';

async function observe(manifest: MapTrialManifest, sessionId: string, prompt: string, evidence: string) {
  const startedAt = Date.now();
  const before = await mapTrialRequest<AnnotationBinding>(manifest, `/api/sessions/${sessionId}/annotation`, 'planning');
  const headers = await mapTrialAuth(manifest, 'planning');
  let stream = '', buffer = '', cancelledForInteraction = false;
  try {
    const response = await fetch(`${manifest.url}/api/sessions/${sessionId}/messages`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ text: prompt }), signal: AbortSignal.timeout(600_000),
    });
    if (!response.ok || !response.body) throw new Error(`Message HTTP ${response.status}`);
    const reader = response.body.getReader(), decoder = new TextDecoder();
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      const text = decoder.decode(part.value, { stream: true }); stream += text; buffer += text;
      const lines = buffer.split('\n'); buffer = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const event = JSON.parse(line.slice(6)) as StreamEvent;
        if (!cancelledForInteraction && event.type === 'interaction.updated' && event.interaction.status === 'pending') {
          cancelledForInteraction = true;
          await mapTrialRequest(manifest, `/api/sessions/${sessionId}/cancel`, 'planning', 'POST', { requestId: event.requestId });
        }
      }
    }
    const snapshot = await mapTrialRequest<SessionSnapshot>(manifest, `/api/sessions/${sessionId}`, 'planning');
    const after = await mapTrialRequest<AnnotationBinding>(manifest, `/api/sessions/${sessionId}/annotation`, 'planning');
    const tools = snapshot.messages.filter(message => message.role === 'tool' && message.requestId === snapshot.lastResult?.requestId);
    const result = {
      sessionId, prompt, startedAt: new Date(startedAt).toISOString(), elapsedMs: Date.now() - startedAt,
      stream, snapshot, before, after, cancelledForInteraction,
      checks: { draftUnchanged: JSON.stringify(before) === JSON.stringify(after) },
      toolResults: tools.map(message => ({ name: message.toolName, error: message.isError, bytes: Buffer.byteLength(message.text) })),
      semanticReview: 'pending: inspect actual text, questions and tool evidence; no keyword-based semantic pass',
    };
    await writeFile(evidence, JSON.stringify(result, null, 2), { mode: 0o600 });
    return result;
  } catch (error) {
    await writeFile(evidence, JSON.stringify({ sessionId, prompt, stream, before, elapsedMs: Date.now() - startedAt, error: String(error) }, null, 2), { mode: 0o600 });
    throw error;
  }
}

const port = Number(process.env.AGENT_OBSERVATIONS_PORT ?? '4338');
const trial = await startMapTrial(port, { ...process.env, LAB_LISTEN_HOST: '127.0.0.1', LAB_PUBLIC_ORIGIN: undefined }, false);
const evidence = join(trial.manifest.dataDir, 'agent-observations');
await mkdir(evidence, { recursive: true, mode: 0o700 });
console.info(JSON.stringify({ evidence, trialId: trial.manifest.trialId }));
try {
  const m = trial.manifest;
  const workspace = await mapTrialRequest<{ id: string }>(m, `/api/tasks/${m.tasks.supply}/workspace`, 'planning', 'POST', {});
  const ambiguous = await mapTrialRequest<{ id: string }>(m, '/api/sessions', 'planning', 'POST', { workspaceId: workspace.id });
  await mapTrialRequest(m, `/api/sessions/${ambiguous.id}/annotation/actions`, 'planning', 'POST', {
    action: 'create_draft', clientActionId: randomUUID(), baseRef: null, title: '集合点讨论',
    operations: [{ op: 'add_layer', layer: { layerId: 'points', name: '集合点', order: 0, defaultVisible: true,
      features: [
        { objectId: 'a', kind: 'point', name: '集合点 A', geometry: { type: 'Point', coordinates: [103.82, 1.28] } },
        { objectId: 'b', kind: 'point', name: '集合点 B', geometry: { type: 'Point', coordinates: [103.83, 1.29] } },
      ],
    } }],
  });
  const first = await observe(m, ambiguous.id, '把那个点往东挪一点。', join(evidence, 'E04-ambiguous.json'));
  console.info(JSON.stringify({ case: 'E04', status: first.snapshot.lastResult?.status, ...first.checks, cancelledForInteraction: first.cancelledForInteraction }));
  await control(m.socket, ['unavailable', 'intel', 'on']);
  await control(m.socket, ['unavailable', 'situation', 'on']);
  const unavailable = await mapTrialRequest<{ id: string }>(m, '/api/sessions', 'planning', 'POST', { workspaceId: workspace.id });
  const second = await observe(m, unavailable.id, '请查一下本任务所涉及道路的最新通行情况，并把需要关注的位置标在本会话地图上。', join(evidence, 'E05-unavailable.json'));
  console.info(JSON.stringify({ case: 'E05', status: second.snapshot.lastResult?.status, ...second.checks, tools: second.toolResults }));
  await writeFile(join(evidence, 'source-requests.json'), JSON.stringify(await control(m.socket, ['requests']), null, 2), { mode: 0o600 });
  // A no-op is only a mechanism observation; semantic success is reviewed separately.
  if (!first.checks.draftUnchanged || !second.checks.draftUnchanged) process.exitCode = 1;
} finally { await trial.stop(); }
