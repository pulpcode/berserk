import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, request } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { DockerExecutionService, type DockerRunner } from '../../src/execution/docker';
import { PiLab } from '../../src/pi/lab';
import { datasetUiInstructions } from '../../src/presentation/dataset-ui';
import { createApp } from '../../src/server/app';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';
import { basemapFixture } from './basemap-fixtures';

const csv = Buffer.from('team\n' + '甲班\n'.repeat(12) + '乙班\n'.repeat(8), 'utf8');
const compute = `
import csv, json
from collections import Counter

with open('orders.csv', encoding='utf-8', newline='') as source:
    counts = Counter(row['team'] for row in csv.DictReader(source))
total = sum(counts.values())
def scale(maximum):
    return {'min': 0, 'max': maximum, 'direction': 'higher', 'source': '样例测试量程'}

print(json.dumps({
    'format': 'result-dataset.v1',
    'columns': [
        {'id': 'team', 'label': '班组', 'type': 'string'},
        {'id': 'orders', 'label': '工单数', 'type': 'number', 'unit': '件', 'radarScale': scale(20)},
        {'id': 'hours', 'label': '平均耗时', 'type': 'number', 'unit': '小时'},
        {'id': 'sequence', 'label': '排序', 'type': 'number', 'radarScale': scale(2)},
        {'id': 'share', 'label': '工单占比', 'type': 'number', 'unit': '%', 'radarScale': scale(100)}
    ],
    'rows': [
        {'id': f'team-{idx}', 'values': {
            'team': team, 'orders': count, 'hours': None, 'sequence': idx + 1, 'share': 100 * count / total
        }}
        for idx, (team, count) in enumerate(sorted(counts.items()))
    ],
    'provenance': {'source': 'orders.csv', 'scope': '本批工单', 'method': '按班组计数'}
}, ensure_ascii=False, separators=(',', ':')))
`;

test('renders five chart types from a real CSV calculation during streaming and restores the original result', async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const dir = await mkdtemp(join(tmpdir(), 'berserk-dataset-ui-'));
  const db = await openDatabase(dir);
  const access = new AccessStore(db);
  const userId = await access.saveAccount({
    username: 'alpha', displayName: '计算验证', seatId: 'alpha', seatName: '计算席',
    password: 'test-password-123', createPublicTask: true, manageModelSettings: true,
  });
  const task = access.create(access.identity(userId)!, {
    title: '计算展示验证', goal: '核对工单数量', visibility: 'public', clientActionId: randomUUID(),
  });
  db.close();

  const config = testConfig(dir, {
    seatId: 'alpha', resultUiEnabled: true,
    auth: { secret: 'dataset-ui-browser-secret-at-least-thirty-two-characters', sessionMs: 28_800_000 },
  });
  let workspaceDir: string;
  let calculationCount = 0;
  // Simulate Docker control only. The fixed test script actually reads the uploaded CSV.
  const runner: DockerRunner = async (args, options) => {
    const stdout = args[0] === 'info' ? 'linux' : '';
    if (args[0] === 'exec' && args.includes('/opt/berserk/command.py')) {
      expect(options?.input?.toString()).toBe('python3 orders.py');
      const calculated = await promisify(execFile)('python3', ['orders.py'], { cwd: workspaceDir });
      expect(calculated.stderr).toBe('');
      options?.onData?.(Buffer.from(calculated.stdout));
      calculationCount++;
    }
    return { code: 0, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) };
  };
  const makeExecution = () => new DockerExecutionService({ instanceId: dir }, runner);
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const fake = await fakeRuntime(config, (context, index) => {
    if (index === 0) return { tools: [{ name: 'bash', arguments: { command: 'python3 orders.py' } }] };
    expect(context.systemPrompt).toContain('dataset-v1');
    const result = context.messages.findLast(message => message.role === 'toolResult' && message.toolName === 'bash');
    const content = result?.role === 'toolResult' && result.content.find(part => part.type === 'text');
    if (!content) throw new Error('Missing Bash result');
    const receipt = JSON.parse(content.text);
    expect(receipt).toMatchObject({ format: 'result-dataset.receipt.v1', rowCount: 2 });
    expect(receipt).not.toHaveProperty('rows');
    const fence = datasetUiInstructions.split('\n').slice(-7);
    fence[1] = fence[1]!.replace('dataset:从工具结果复制', receipt.resultRef);
    const charts = [
      { kind: 'pie', x: 'team', y: ['orders'] },
      { kind: 'line', x: 'sequence', y: ['orders'] },
      { kind: 'radar', x: 'team', y: ['orders', 'sequence', 'share'] },
      { kind: 'scatter', x: 'sequence', y: ['orders'] },
    ];
    const root = JSON.parse(fence[3]!);
    root.value.children.push(...charts.map(chart => chart.kind));
    fence[3] = JSON.stringify(root);
    const more = charts.map(props => JSON.stringify({
      op: 'add', path: '/elements/' + props.kind, value: { type: 'ChartView', props, children: [] },
    }));
    return { textChunks: (async function* () {
      yield '已按班组汇总。\n\n' + [...fence.slice(0, -1), ...more].join('\n') + '\n';
      await gate;
      yield fence.at(-1) + '\n\n工单统计已完成。';
    })() };
  });
  let lab = await PiLab.create(config, fake.runtime, makeExecution());
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
    workspaceDir = lab.files.filesDirectory(workspace.id, 'alpha');
    await writeFile(join(workspaceDir, 'orders.py'), compute);
    const session = await lab.createSession(workspace.id, 'alpha');
    const raster = await readFile(new URL('../fixtures/basemap-raster.png', import.meta.url));
    await page.route('**/api/context/map-config', route => route.fulfill({ json: basemapFixture(origin) }));
    await page.route('**/test-tiles/**', route => route.fulfill({ contentType: 'image/png', body: raster }));
    await page.goto(origin);
    await page.getByLabel('席位', { exact: true }).selectOption('alpha');
    await page.getByLabel('密码', { exact: true }).fill('test-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('button', { name: '进入项目：计算展示验证' })).toBeVisible();
    await page.goto(`${origin}/?session=${session.id}`);
    await expect(page.getByRole('combobox', { name: '选择模型', exact: true })).toBeEnabled();
    await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('计算 orders.csv，每班工单数画柱状图并显示表格。');
    await page.getByLabel('选择附件', { exact: true }).setInputFiles({ name: 'orders.csv', mimeType: 'text/csv', buffer: csv });
    await expect(page.getByRole('listitem', { name: /已保存到工作区/ })).toBeVisible();
    await page.getByRole('button', { name: '发送消息', exact: true }).click();

    const block = page.locator('[data-result-ui-block="orders"]');
    const bar = block.locator('[data-result-ui-dataset-chart="bar"] svg');
    const table = block.locator('table[data-result-ui-dataset-table]');
    for (const kind of ['bar', 'pie', 'line', 'radar', 'scatter']) {
      await expect(block.locator(`[data-result-ui-dataset-chart="${kind}"] svg`)).toBeVisible();
    }
    await expect(block.getByText('构成比例的分母为 20 件')).toBeVisible();
    await expect(table.getByRole('row').filter({ hasText: '甲班' })).toContainText('12');
    await expect(table.getByRole('row').filter({ hasText: '乙班' })).toContainText('8');
    await expect(table.getByText('未知', { exact: true })).toHaveCount(2);
    await expect(page.getByText('工单统计已完成。')).toHaveCount(0);
    const during = lab.get(session.id, 'alpha');
    expect(during.active).toBeTruthy();
    expect(during.fileOutputs ?? []).toEqual([]);
    await expect(page.locator('[aria-label^="可下载文件"]')).toHaveCount(0);
    expect(calculationCount).toBe(1);
    finish();
    await expect(page.getByText('工单统计已完成。')).toBeVisible();
    await expect.poll(() => lab.get(session.id, 'alpha').lastResult?.status).toBe('succeeded');

    await writeFile(join(workspaceDir, 'orders.csv'), 'team\n乙班\n');
    await app.close();
    lab = await PiLab.create({ ...config, resultUiEnabled: false }, fake.runtime, makeExecution());
    app = await createApp(lab);
    api = new URL(await app.listen({ host: '127.0.0.1', port: 0 }));
    await page.reload();
    await expect(bar).toBeVisible();
    await expect(block.locator('[data-result-ui-dataset-chart] svg')).toHaveCount(5);
    await expect(table.getByRole('row').filter({ hasText: '甲班' })).toContainText('12');
    await expect(table.getByRole('row').filter({ hasText: '乙班' })).toContainText('8');
    expect(calculationCount).toBe(1);
    expect(lab.get(session.id, 'alpha').messages.filter(message => message.role === 'tool').map(message => message.toolName)).toEqual(['bash']);
    const width = (await bar.boundingBox())!.width;
    await page.getByRole('button', { name: '打开态势地图', exact: true }).click();
    await expect.poll(async () => (await bar.boundingBox())!.width).toBeLessThan(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    finish();
    proxy.closeAllConnections();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
