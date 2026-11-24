import { randomUUID } from 'node:crypto';
import { createServer, request } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import type { AnnotationRef } from '../../src/contracts/annotations';
import { resourceUiInstructions } from '../../src/presentation/resource-ui';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';
import { basemapFixture } from './basemap-fixtures';

function resourceFence(resultRef: string, id = 'resources') {
  const lines = resourceUiInstructions.split('\n').slice(-7);
  lines[1] = JSON.stringify({ ...JSON.parse(lines[1]), id, resultRef });
  return lines;
}

const prompts = {
  original: '查询固定资源并用图表展示。',
  cancel: '查询资源后停止回复。',
  malformed: '查询资源并验证损坏的展示描述。',
  unavailable: '验证外会话和缺失的原始结果。',
};

test('streams real resource results, handles interrupted and invalid replies, and restores history with generation disabled', async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const dir = await mkdtemp(join(tmpdir(), 'berserk-result-ui-'));
  const db = await openDatabase(dir);
  const access = new AccessStore(db);
  const userId = await access.saveAccount({
    username: 'alpha', displayName: '资源验证', seatId: 'alpha', seatName: '资源席',
    password: 'test-password-123', createPublicTask: true, manageModelSettings: true,
  });
  const actor = access.identity(userId)!;
  const task = access.create(actor, { title: '资源展示验证', goal: '查看固定结果', visibility: 'public', clientActionId: randomUUID() });
  db.close();

  const config = testConfig(dir, {
    seatId: 'alpha', resultUiEnabled: true,
    auth: { secret: 'result-ui-browser-secret-at-least-thirty-two-characters', sessionMs: 28_800_000 },
  });
  let resourceRef: AnnotationRef;
  let originalResultRef: string;
  let sendBar!: () => void;
  let finishReply!: () => void;
  const barGate = new Promise<void>(resolve => { sendBar = resolve; });
  const replyGate = new Promise<void>(resolve => { finishReply = resolve; });
  const runtime = await fakeRuntime(config, context => {
    const user = context.messages.findLast(message => message.role === 'user');
    const prompt = user?.role === 'user' && (typeof user.content === 'string' ? user.content : user.content.find(part => part.type === 'text')?.text);
    if (prompt === prompts.unavailable) return { text: [
      '本会话没有原始查询。',
      resourceFence(originalResultRef, 'foreign').join('\n'),
      resourceFence('resource:missing-request:missing-call', 'missing').join('\n'),
    ].join('\n\n') };
    const result = context.messages.at(-1);
    if (result?.role !== 'toolResult') return { tools: [{ name: 'task_resource_query', arguments: { operation: 'query', purpose: 'task', annotations: [{ ref: resourceRef }] } }] };
    const part = result.content.find(content => content.type === 'text');
    if (!part) throw new Error('Missing resource result data');
    const { resultRef, parameters } = JSON.parse(part.text).data;
    if (prompt === prompts.original && parameters.operation === 'query') return { tools: [{ name: 'task_resource_query', arguments: { operation: 'summarize', resultRef, relation: 'assigned' } }] };
    if (prompt === prompts.cancel) return { text: '停止前已查询资源。\n\n' + resourceFence(resultRef, 'cancelled').slice(0, -1).join('\n') + '\n', waitForAbort: true };
    if (prompt === prompts.malformed) return { text: [
      '有效图表应保留。\n',
      ...resourceFence(resultRef, 'malformed').slice(0, -1),
      '{invalid-result-patch',
      '```\n',
      '普通正文仍可阅读。',
    ].join('\n') };
    originalResultRef = resultRef;
    const example = resourceFence(resultRef);
    return { textChunks: (async function* () {
      yield '以下是本轮获准读取的资源。\n\n```berserk-ui';
      yield '-v1\n' + example.slice(1, 5).join('\n') + '\n';
      await barGate;
      yield example[5] + '\n';
      await replyGate;
      yield example[6] + '\n\n统计结束，详细依据可在工具结果查看。\n\n```json\n{"example":true}\n```';
    })() };
  });
  let lab = await PiLab.create(config, runtime.runtime);
  let app = await createApp(lab);
  let api = new URL(await app.listen({ host: '127.0.0.1', port: 0 }));
  const web = new URL(baseURL!);
  let disconnectReply: (() => void) | undefined;
  let sentMessages = 0;
  // Keep requests same-origin for the browser and pipe real Fastify SSE without buffering.
  const proxy = createServer((incoming, outgoing) => {
    const isApi = incoming.url?.startsWith('/api/');
    const target = isApi ? api : web;
    const headers = { ...incoming.headers, host: target.host };
    if (isApi && incoming.headers.origin) headers.origin = `http://127.0.0.1:${config.port}`;
    const forward = request(new URL(incoming.url!, target), { method: incoming.method, headers }, upstream => {
      outgoing.writeHead(upstream.statusCode!, upstream.headers);
      upstream.pipe(outgoing);
      if (incoming.method === 'POST' && incoming.url?.endsWith('/messages')) {
        sentMessages++;
        disconnectReply = () => outgoing.destroy();
      }
    });
    forward.on('error', () => { outgoing.destroy(); });
    outgoing.on('close', () => { forward.destroy(); });
    incoming.pipe(forward);
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  try {
    const workspace = await lab.workspaces.ensureWorkspace(task.id, 'alpha', task.title);
    const session = await lab.createSession(workspace.id, 'alpha');
    const second = await lab.createSession(workspace.id, 'alpha');
    const receipt = lab.annotations!.action(actor, session.id, {
      action: 'create_draft', clientActionId: randomUUID(), baseRef: null,
      operations: [{ op: 'add_layer', layer: {
        layerId: 'resources', name: '资源', order: 0, defaultVisible: true,
        features: (['vehicle', 'vehicle', 'facility', 'vehicle'] as const).map((category, index) => ({
          objectId: `sample-${index}`, name: `资源 ${index + 1}`, kind: 'point',
          geometry: { type: 'Point', coordinates: [120 + index, 30] },
          resource: {
            category, meaning: 'actual_resource', granularity: 'individual',
            ...(index < 3 ? { taskRelations: [{ taskId: task.id, relation: 'assigned', evidence: [{ kind: 'declaration', note: '已分配本次演练任务' }] }] } : {}),
          },
        })),
      } }],
    });
    resourceRef = receipt.ref!;

    const raster = await readFile(new URL('../fixtures/basemap-raster.png', import.meta.url));
    await page.route('**/api/context/map-config', route => route.fulfill({ json: basemapFixture(origin) }));
    await page.route('**/test-tiles/**', route => route.fulfill({ contentType: 'image/png', body: raster }));
    await page.goto(origin);
    await page.getByLabel('席位', { exact: true }).selectOption('alpha');
    await page.getByLabel('密码', { exact: true }).fill('test-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('button', { name: '进入项目：资源展示验证' })).toBeVisible();
    const openSession = async (id: string) => {
      const loaded = page.waitForResponse(response => new URL(response.url()).pathname === `/api/sessions/${id}`
        && response.request().method() === 'GET' && response.ok());
      await page.goto(`${origin}/?session=${id}`);
      await loaded;
      await expect(page.getByRole('combobox', { name: '选择模型', exact: true })).toBeEnabled();
    };
    await openSession(session.id);
    const send = async (text: string) => {
      const input = page.getByRole('textbox', { name: '发送消息', exact: true });
      const submit = page.getByRole('button', { name: '发送消息', exact: true });
      await input.fill(text);
      await expect(input).toHaveValue(text);
      await expect(submit).toBeEnabled();
      await submit.click();
    };
    await send(prompts.original);

    const block = page.locator('[data-result-ui-block="resources"]');
    const chart = block.locator('[data-result-ui-chart] svg');
    await expect(block).toContainText('未知');
    await expect(chart).toHaveCount(0);
    expect(lab.get(session.id, 'alpha').active).toBeTruthy();
    sendBar();
    await expect(chart).toBeVisible();
    await expect(block).toContainText('按类别统计条目');
    await expect(block).toContainText('车辆');
    await expect(block).toContainText('设施');
    expect(lab.get(session.id, 'alpha').active).toBeTruthy();
    expect(runtime.calls.at(-1)?.context.systemPrompt).toContain('berserk-ui-v1');
    const messages = lab.get(session.id, 'alpha').messages;
    expect(messages.find(message => message.resourceResult)?.resourceResult?.items).toHaveLength(4);
    const result = messages.findLast(message => message.resourceResult)?.resourceResult;
    expect(result?.summary).toMatchObject({ itemCount: 3, recordCount: 3, entityCount: null });
    expect(result?.statisticsScope.relation).toBe('assigned');
    await expect(block).toContainText('3 项');
    await expect(block).toContainText('3 条');
    await block.getByText('查看各类条目数', { exact: true }).click();
    const values = block.locator('details');
    for (const [category, count] of [['车辆', '2 项'], ['设施', '1 项']]) {
      await expect(values.locator('dt').filter({ hasText: category }).locator('xpath=following-sibling::dd[1]')).toHaveText(count);
    }

    finishReply();
    await expect(page.getByText('统计结束，详细依据可在工具结果查看。')).toBeVisible();
    await expect(page.locator('pre code.language-json')).toHaveText('{"example":true}\n');
    await expect(block).toHaveCount(1);
    await expect.poll(() => lab.get(session.id, 'alpha').lastResult?.status).toBe('succeeded');
    const wide = (await chart.boundingBox())!.width;
    await page.getByRole('button', { name: '打开态势地图', exact: true }).click();
    const separator = page.getByRole('separator', { name: '调整对话与地图宽度' });
    await expect(separator).toBeVisible();
    await expect.poll(async () => (await chart.boundingBox())!.width).toBeLessThan(wide);
    const splitWidth = (await chart.boundingBox())!.width;
    const handle = (await separator.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 100, handle.y + handle.height / 2);
    await page.mouse.up();
    await expect.poll(async () => (await chart.boundingBox())!.width).toBeGreaterThan(splitWidth);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await block.screenshot({ path: test.info().outputPath('resource-ui-split.png') });

    const cancelled = page.locator('[data-result-ui-block="cancelled"]');
    const malformed = page.locator('[data-result-ui-block="malformed"]');
    await test.step('reconnect the interrupted message stream and stop the server-owned reply', async () => {
      const sentBefore = sentMessages;
      await send(prompts.cancel);
      await expect(cancelled.locator('[data-result-ui-chart] svg')).toBeVisible();
      const requestId = lab.get(session.id, 'alpha').active?.requestId;
      expect(requestId).toBeTruthy();
      const recovered = page.waitForResponse(response => new URL(response.url()).pathname === `/api/sessions/${session.id}`
        && response.request().method() === 'GET' && response.ok());
      expect(disconnectReply).toBeDefined();
      disconnectReply!();
      const connectionNotice = page.getByText('连接已断开，正在查询会话状态；消息不会重复发送。', { exact: true });
      await expect(connectionNotice).toBeVisible();
      const snapshot = await (await recovered).json();
      expect(snapshot.active?.requestId).toBe(requestId);
      await expect(cancelled).toHaveCount(1);
      await expect(cancelled.locator('[data-result-ui-chart] svg')).toBeVisible();
      await expect(page.getByText(prompts.cancel, { exact: true })).toHaveCount(1);
      const stop = page.getByRole('button', { name: '停止回复', exact: true });
      await expect(stop).toBeEnabled();
      await stop.click();
      await expect.poll(() => lab.get(session.id, 'alpha').lastResult?.status).toBe('cancelled');
      expect(runtime.calls.some(call => call.aborted)).toBe(true);
      await expect(cancelled.getByText('资源展示未完成。', { exact: true })).toBeVisible();
      await expect(cancelled.locator('[data-result-ui-chart] svg')).toBeVisible();
      await expect(page.getByText('停止前已查询资源。', { exact: true })).toBeVisible();
      await expect(connectionNotice).toHaveCount(0);
      expect(sentMessages).toBe(sentBefore + 1);
    });

    await test.step('keep valid results and prose when later patches fail or evidence is unavailable', async () => {
      await send(prompts.malformed);
      await expect(malformed.getByText('资源展示格式有误。', { exact: true })).toBeVisible();
      await expect(malformed.locator('[data-result-ui-chart] svg')).toBeVisible();
      await expect(page.getByText('有效图表应保留。', { exact: true })).toBeVisible();
      await expect(page.getByText('普通正文仍可阅读。', { exact: true })).toBeVisible();
      await expect(page.locator('pre code').filter({ hasText: 'invalid-result-patch' })).toHaveCount(0);

      await openSession(second.id);
      await send(prompts.unavailable);
      for (const id of ['foreign', 'missing']) {
        const unavailable = page.locator(`[data-result-ui-block="${id}"]`);
        await expect(unavailable.getByText('原资源结果不可用。', { exact: true })).toBeVisible();
        await expect(unavailable.locator('svg')).toHaveCount(0);
      }
      await expect(page.getByText('本会话没有原始查询。', { exact: true })).toBeVisible();
      await expect.poll(() => lab.get(second.id, 'alpha').lastResult?.status).toBe('succeeded');
      await openSession(session.id);
    });

    await app.close();
    const disabled = { ...config, resultUiEnabled: false };
    const disabledRuntime = await fakeRuntime(disabled, () => ({ text: '普通文字回复。' }));
    lab = await PiLab.create(disabled, disabledRuntime.runtime);
    app = await createApp(lab);
    api = new URL(await app.listen({ host: '127.0.0.1', port: 0 }));
    await page.reload();
    await expect(chart).toBeVisible();
    await expect(block).toHaveCount(1);
    await expect(cancelled.getByText('资源展示未完成。', { exact: true })).toBeVisible();
    await expect(cancelled.locator('[data-result-ui-chart] svg')).toBeVisible();
    await expect(malformed.getByText('资源展示格式有误。', { exact: true })).toBeVisible();
    await expect(malformed.locator('[data-result-ui-chart] svg')).toBeVisible();
    await openSession(second.id);
    await send('普通问候。');
    await expect(page.getByText('普通文字回复。')).toBeVisible();
    expect(disabledRuntime.calls[0].context.systemPrompt).not.toContain('berserk-ui-v1');
    expect(disabledRuntime.calls[0].context.systemPrompt).toContain('专用资源展示块仅供回看');
    await openSession(session.id);
    await expect(chart).toBeVisible();
    await expect(block).toContainText('未知');
  } finally {
    sendBar();
    finishReply();
    proxy.closeAllConnections();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
