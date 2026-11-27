import { randomUUID } from 'node:crypto';
import { createServer, request } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Response } from '@playwright/test';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import type { AnnotationRef } from '../../src/contracts/annotations';
import { resourceUiCatalog, resourceUiFence } from '../../src/presentation/resource-ui';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';
import { basemapFixture } from './basemap-fixtures';

function block(id: string, resultRef: string, section: 'sources' | 'details') {
  const node = (id: string, type: string, props: object = {}, children: string[] = []) =>
    JSON.stringify({ op: 'add', path: '/elements/' + id, value: { type, props, children } });
  return [
    '```' + resourceUiFence,
    JSON.stringify({ id, catalog: resourceUiCatalog, resultRef }),
    JSON.stringify({ op: 'add', path: '/root', value: 'root' }),
    node('root', 'Stack', {}, section === 'sources' ? ['metrics', 'chart', 'evidence'] : ['metrics', 'evidence']),
    node('metrics', 'ResourceMetrics'),
    ...(section === 'sources' ? [node('chart', 'ResourceBar')] : []),
    node('evidence', 'ResourceResultView', { section }),
    '```',
  ].join('\n');
}

test('streams concise resource views with one fixed result, rechecks details and restores the original evidence', async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const dir = await mkdtemp(join(tmpdir(), 'berserk-resource-details-'));
  const db = await openDatabase(dir);
  const access = new AccessStore(db);
  const userId = await access.saveAccount({
    username: 'alpha', displayName: '资源详情验证', seatId: 'alpha', seatName: '资源席',
    password: 'test-password-123', createPublicTask: true, manageModelSettings: true,
  });
  const actor = access.identity(userId)!;
  const task = access.create(actor, { title: '资源详情验收', goal: '核对资源明细', visibility: 'public', clientActionId: randomUUID() });
  db.close();

  const config = testConfig(dir, {
    seatId: 'alpha', resultUiEnabled: true,
    auth: { secret: 'resource-detail-browser-secret-at-least-thirty-two-characters', sessionMs: 28_800_000 },
  });
  let annotation: AnnotationRef;
  const annotationActionId = randomUUID();
  let finishReply!: () => void;
  const gate = new Promise<void>(resolve => { finishReply = resolve; });
  const runtime = await fakeRuntime(config, (context, index) => {
    if (index === 0) return { tools: [{
      name: 'task_resource_query', arguments: { operation: 'query', purpose: 'task', annotations: [{ ref: annotation }] },
    }] };
    if (index === 1) return { tools: [{
      name: 'annotation_read', arguments: { mode: 'receipt', clientActionId: annotationActionId },
    }] };
    const result = context.messages.findLast(message => message.role === 'toolResult' && message.toolName === 'task_resource_query');
    const output = result?.role === 'toolResult' && result.content.find(part => part.type === 'text');
    if (!output) throw new Error('Missing fixed resource result');
    const ref = JSON.parse(output.text).data.resultRef;
    return { textChunks: (async function* () {
      yield '已整理资源。\n\n' + block('overview', ref, 'sources') + '\n\n' + block('items', ref, 'details') + '\n';
      await gate;
      yield '\n核对完成。';
    })() };
  });

  let lab = await PiLab.create(config, runtime.runtime);
  let app = await createApp(lab);
  let api = new URL(await app.listen({ host: '127.0.0.1', port: 0 }));
  const web = new URL(baseURL!);
  const proxy = createServer((incoming, outgoing) => {
    const isApi = incoming.url?.startsWith('/api/');
    const target = isApi ? api : web;
    const headers = { ...incoming.headers, host: target.host };
    if (isApi && incoming.headers.origin) headers.origin = `http://127.0.0.1:${config.port}`;
    const forward = request(new URL(incoming.url!, target), { method: incoming.method, headers }, upstream => {
      outgoing.writeHead(upstream.statusCode!, upstream.headers);
      upstream.pipe(outgoing);
    });
    forward.on('error', () => outgoing.destroy());
    outgoing.on('close', () => forward.destroy());
    incoming.pipe(forward);
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  try {
    const workspace = await lab.workspaces.ensureWorkspace(task.id, 'alpha', task.title);
    const session = await lab.createSession(workspace.id, 'alpha');
    const receipt = lab.annotations!.action(actor, session.id, {
      action: 'create_draft', clientActionId: annotationActionId, baseRef: null,
      operations: [{ op: 'add_layer', layer: {
        layerId: 'resources', name: '资源台账', order: 0, defaultVisible: true,
        features: Array.from({ length: 12 }, (_, index) => ({
          objectId: `sample-${String(index + 1).padStart(2, '0')}`, name: `台账条目 ${String(index + 1).padStart(2, '0')}`, kind: 'point' as const,
          geometry: { type: 'Point' as const, coordinates: [120 + index / 10, 30] },
          resource: {
            category: index < 6 ? 'vehicle' : 'facility', meaning: 'actual_resource', granularity: 'individual',
            ...(index < 10 ? { taskRelations: [{
              taskId: task.id, relation: 'assigned' as const, evidence: [{ kind: 'declaration' as const, note: '已分配本次任务' }],
            }] } : {}),
          },
        })),
      } }],
    });
    annotation = receipt.ref!;

    const raster = await readFile(new URL('../fixtures/basemap-raster.png', import.meta.url));
    await page.route('**/api/context/map-config', route => route.fulfill({ json: basemapFixture(origin) }));
    await page.route('**/test-tiles/**', route => route.fulfill({ contentType: 'image/png', body: raster }));
    await page.goto(origin);
    await page.getByLabel('席位', { exact: true }).selectOption('alpha');
    await page.getByLabel('密码', { exact: true }).fill('test-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('button', { name: '进入项目：资源详情验收' })).toBeVisible();
    await page.goto(`${origin}/?session=${session.id}`);
    await expect(page.getByRole('button', { name: '选择模型', exact: true })).toBeEnabled();
    await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('统计资源并给我查看明细的入口。');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();

    const overview = page.locator('[data-result-ui-block="overview"]');
    const detailBlock = page.locator('[data-result-ui-block="items"]');
    const chart = overview.locator('[data-result-ui-chart] svg');
    const sources = overview.locator('details[data-resource-section="sources"]');
    const details = detailBlock.locator('details[data-resource-section="details"]');
    await expect(chart).toBeVisible();
    await expect(details.locator(':scope > summary')).toBeVisible();
    await expect(details).not.toHaveAttribute('open', '');
    await expect(sources).not.toHaveAttribute('open', '');
    await expect(overview).toContainText('12 项');
    await expect(detailBlock).toContainText('12 项');
    await expect(overview.getByRole('heading', { name: '资源统计', exact: true })).toHaveCount(0);
    await expect(details.getByText('台账条目 01', { exact: true })).not.toBeVisible();
    expect(lab.get(session.id, 'alpha').active).toBeTruthy();
    const original = lab.get(session.id, 'alpha').messages.find(message => message.resourceResult)?.resourceResult;
    expect(original?.items).toHaveLength(12);
    expect(original?.summary).toMatchObject({ itemCount: 12, entityCount: null });
    expect(runtime.calls.at(-1)?.context.systemPrompt).toContain('ResourceResultView');
    finishReply();
    await expect(page.getByText('核对完成。')).toBeVisible();
    await expect.poll(() => lab.get(session.id, 'alpha').lastResult?.status).toBe('succeeded');

    const isSnapshot = (response: Response) =>
      new URL(response.url()).pathname === `/api/sessions/${session.id}` && response.request().method() === 'GET';
    const sourceRead = page.waitForResponse(response => isSnapshot(response) && response.ok());
    await sources.locator(':scope > summary').click();
    await sourceRead;
    await expect(sources.getByText(/固定标注/).first()).toBeVisible();

    const openRead = page.waitForResponse(response => isSnapshot(response) && response.ok());
    await details.locator(':scope > summary').press('Enter');
    await openRead;
    await expect(details.getByText('台账条目 01', { exact: true })).toBeVisible();
    await detailBlock.screenshot({ path: test.info().outputPath('resource-details-expanded.png') });
    await expect(details.getByText('台账条目 11', { exact: true })).not.toBeVisible();
    const nextPage = details.getByRole('button', { name: '下一页', exact: true });
    await nextPage.focus();
    await nextPage.press('Enter');
    await expect(details.getByText('台账条目 12', { exact: true })).toBeVisible();
    await expect(nextPage).toBeFocused();
    const lastItem = details.locator('.resource-result-items > li').filter({ hasText: '台账条目 12' });
    await lastItem.getByText('查看依据与限制', { exact: true }).click();
    await expect(lastItem.getByText(/固定标注.*sample-12/)).toBeVisible();

    const mapLink = page.getByRole('article', { name: 'Axon 的回复' })
      .getByRole('button', { name: /查看原动作结果/ }).last();
    await expect(mapLink).toBeVisible();
    const width = (await chart.boundingBox())!.width;
    await mapLink.click();
    await expect(page.getByRole('complementary', { name: '地图工作区' })).toBeVisible();
    await expect.poll(async () => (await chart.boundingBox())!.width).toBeLessThan(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await app.close();
    const disabled = { ...config, resultUiEnabled: false };
    const disabledRuntime = await fakeRuntime(disabled, () => ({ text: '普通文字。' }));
    lab = await PiLab.create(disabled, disabledRuntime.runtime);
    app = await createApp(lab);
    api = new URL(await app.listen({ host: '127.0.0.1', port: 0 }));
    await page.reload();
    await expect(chart).toBeVisible();
    await expect(detailBlock).toContainText('12 项');
    expect(lab.get(session.id, 'alpha').messages.find(message => message.resourceResult)?.resourceResult).toEqual(original);
    await details.locator(':scope > summary').click();
    await expect(details.getByText('台账条目 01', { exact: true })).toBeVisible();
    await details.locator(':scope > summary').click();
    const snapshotRoute = `**/api/sessions/${session.id}`;
    await page.route(snapshotRoute, route => route.fulfill({
      status: 403, json: { error: { code: 'FORBIDDEN', message: '此结果已不可读取。' } },
    }));
    await details.locator(':scope > summary').click();
    await expect(details.getByRole('alert')).toBeVisible();
    await expect(detailBlock.getByText('台账条目 01', { exact: true })).toHaveCount(0);
    await expect(detailBlock).not.toContainText('12 项');
    await page.unroute(snapshotRoute);
    await details.getByRole('button', { name: '重新读取', exact: true }).click();
    await expect(details.getByText('台账条目 01', { exact: true })).toBeVisible();
    await expect(detailBlock).toContainText('12 项');
  } finally {
    finishReply();
    proxy.closeAllConnections();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
