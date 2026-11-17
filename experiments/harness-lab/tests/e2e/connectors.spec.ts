import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { migrateAdministratorAccounts } from '../../src/access/administrator-schema';
import { ConnectorService } from '../../src/connectors/service';
import type { ConnectorConfigInput } from '../../src/contracts/connectors';
import { mcpToolName } from '../../src/pi/mcp-history';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { startControlledMcp } from '../../scripts/mcp-controlled-fixture';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';

// Browser -> real auth/API/services/native Pi. MCP uses disposable HTTP wire servers;
// the model alone is deterministic. This does not claim third-party/live-model acceptance.
async function setup(streaming = false) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-connectors-web-'));
  const dataDir = join(dir, 'data'); await mkdir(dataDir);
  const keyFile = join(dir, 'keys.json'); await writeFile(keyFile, JSON.stringify({ activeKeyId: 'test', keys: { test: randomBytes(32).toString('base64') } }), { mode: 0o600 });
  const db = await openDatabase(dataDir); const access = new AccessStore(db);
  await access.saveAccount({ username: 'one', displayName: '用户甲', seatId: 'one', seatName: '席位甲', password: 'test-password-123', createPublicTask: false, manageModelSettings: false });
  await access.saveAccount({ username: 'two', displayName: '用户乙', seatId: 'two', seatName: '席位乙', password: 'test-password-123', createPublicTask: false, manageModelSettings: false });
  migrateAdministratorAccounts(db); const adminId = await access.saveAdministratorAccount({ username: 'admin', displayName: '系统管理员', password: 'test-password-123' }); db.close();
  const config = testConfig(dataDir, { publicOrigin: `http://127.0.0.1:${process.env.AXON_E2E_PORT || 5187}`, auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000 } });
  const controls = { hold: false, toolName: '', query: '' };
  const fake = await fakeRuntime(config, () => { if (controls.toolName) { const name = controls.toolName; controls.toolName = ''; return { tools: [{ name, arguments: { query: controls.query } }] }; } return controls.hold ? { waitForAbort: true } : { text: '合成回复已完成。' }; });
  const lab = await PiLab.create(config, fake.runtime);
  lab.connectors = await ConnectorService.open(dataDir, { createdNew: lab.capabilities.createdNew, keyFile });
  const a = await startControlledMcp({ label: 'A' }); const b = await startControlledMcp({ label: 'B' });
  const actor = { userId: adminId, assertActive: () => {}, assertAdministrator: () => {} };
  const base = (name: string, remote = a): ConnectorConfigInput => ({ name, description: `${name}的受控测试目录`, endpoint: remote.url, approvedTargets: remote.networkPolicy.approvedTargets, auth: { mode: 'none', credentialSource: 'organization' }, exposedTools: [], policy: { mode: 'none', seatIds: [], personal: false } });
  async function seed(name: string, remote = a, personal = false) {
    let value = await lab.connectors!.create(actor, { ...base(name, remote), ...(personal ? { auth: { mode: 'bearer' as const, credentialSource: 'personal' as const } } : {}), clientActionId: randomUUID() });
    if (personal) await lab.connectors!.setCredential(actor, value.connection.connectorId, { value: 'synthetic-admin-discovery-key', expectedVersion: 0, clientActionId: randomUUID() }, true);
    const discovery = await lab.connectors!.discover(actor, value.connection.connectorId, { expectedRevisionId: value.revision.revisionId, clientActionId: randomUUID() });
    value = await lab.connectors!.update(actor, value.connection.connectorId, { ...base(name, remote), auth: value.revision.auth, policy: { mode: 'all', seatIds: [], personal: true }, exposedTools: discovery.tools.map(tool => ({ name: tool.name, contractDigest: tool.contractDigest })), expectedRevisionId: value.revision.revisionId, clientActionId: randomUUID() });
    return lab.connectors!.lifecycle(actor, value.connection.connectorId, { action: 'restore', expectedStateRevision: value.connection.stateRevision, clientActionId: randomUUID() });
  }
  const first = await seed('资料连接甲'); const second = await seed('资料连接乙（名称较长的独立服务）', b); const own = await seed('个人账号资料', a, true);
  const identity = lab.access!.identityForSeat('one')!;
  const task = lab.access!.create(identity, { title: '连接器个人空间', goal: '', visibility: 'private', clientActionId: randomUUID() });
  const workspace = await lab.workspaces.ensureWorkspace(task.id, identity.seatId, task.title);
  const app = await createApp(lab);
  if (streaming) await app.listen({ host: '127.0.0.1', port: 4310 });
  const pages: Page[] = []; const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  let dropCredential = false;
  async function attach(page: Page) {
    pages.push(page);
    await page.route('**/api/**', async route => {
      const request = route.request(); const url = new URL(request.url());
      const body = request.postData() && request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() as Record<string, unknown> : {};
      if (request.method() !== 'GET') writes.push({ path: url.pathname, body });
      if (streaming) { await route.continue(); return; }
      const response = await app.inject({ method: request.method() as 'GET' | 'POST' | 'PUT' | 'DELETE', url: url.pathname + url.search, headers: { ...await request.allHeaders(), host: '127.0.0.1', origin: 'http://localhost:4310' }, ...(request.postDataBuffer() ? { payload: request.postDataBuffer()! } : {}) });
      if (dropCredential && request.method() === 'PUT' && url.pathname.endsWith('/credential') && response.statusCode === 200) { dropCredential = false; await route.abort('failed'); return; }
      await route.fulfill({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), body: response.rawPayload });
    });
  }
  return { lab, fake, controls, actor, base, first, second, own, workspace, a, b, writes, attach, dropNextCredential: () => { dropCredential = true; }, close: async () => { await lab.close(); for (const page of pages) if (!page.isClosed()) { await page.goto('about:blank').catch(() => {}); await page.unrouteAll({ behavior: 'wait' }); } await app.close(); await a.close(); await b.close(); await rm(dir, { recursive: true, force: true }); } };
}
async function login(page: Page, name: string) { await page.goto('/'); await page.getByLabel('席位', { exact: true }).selectOption({ label: name }); await page.getByLabel('密码', { exact: true }).fill('test-password-123'); await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible(); }
async function connectors(page: Page) { await page.getByRole('button', { name: '能力中心', exact: true }).click(); await page.getByRole('tab', { name: '连接器', exact: true }).click(); }
const input = (page: Page) => page.getByRole('textbox', { name: '发送消息', exact: true });

test('administrator configures, explicitly discovers, opens scope and enables separately; CAS keeps local edits', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    await login(page, '系统管理员'); await page.getByRole('tab', { name: '连接器', exact: true }).click();
    await expect(page.locator('.connector-card')).toHaveCount(3); await page.locator('.connector-card').first().getByText(/工具（/).click(); await page.screenshot({ path: test.info().outputPath('connector-cards-1440.png') }); await page.setViewportSize({ width: 1060, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: test.info().outputPath('connector-cards-1060.png') }); await page.setViewportSize({ width: 1440, height: 960 });
    const initial = env.a.records.length;
    await page.getByRole('button', { name: '添加 MCP', exact: true }).click();
    const manager = page.locator('dialog.connector-management-panel');
    await manager.getByLabel('连接名称', { exact: true }).fill('取消的连接'); await manager.getByLabel('服务地址', { exact: true }).fill(env.a.url);
    page.once('dialog', dialog => dialog.accept()); await manager.getByRole('button', { name: '关闭', exact: true }).click();
    expect(env.writes.filter(item => item.path === '/api/admin/connections')).toHaveLength(0); expect(env.a.records).toHaveLength(initial);
    await page.getByRole('button', { name: '添加 MCP', exact: true }).click();
    await manager.getByLabel('连接名称', { exact: true }).fill('显式发现资料'); await manager.getByLabel('服务地址', { exact: true }).fill(env.a.url);
    await manager.getByText('额外网络许可', { exact: true }).click(); await manager.getByLabel('获准的目标源站或 IP', { exact: true }).fill(`${env.a.origin}\n127.0.0.1`);
    await manager.getByRole('button', { name: '添加连接', exact: true }).click(); await expect(manager.getByRole('status')).toContainText('尚未启用'); expect(env.a.records).toHaveLength(initial);
    await manager.getByRole('button', { name: '工具', exact: true }).click(); await manager.getByRole('button', { name: '发现工具', exact: true }).click();
    await expect(manager.getByRole('checkbox', { name: /lookup/ })).toBeVisible(); expect(env.a.records.length).toBeGreaterThan(initial);
    await manager.getByRole('checkbox', { name: /lookup/ }).check(); await manager.getByRole('button', { name: '保存配置', exact: true }).click();
    await manager.getByRole('button', { name: '使用范围', exact: true }).click(); await manager.getByLabel('业务席位范围', { exact: true }).selectOption('all'); await manager.getByLabel('允许个人空间使用（含独立管理员）', { exact: true }).check(); await manager.getByRole('button', { name: '保存配置', exact: true }).click();
    await manager.getByRole('button', { name: '启用连接', exact: true }).click(); await expect(manager.getByRole('button', { name: '停用连接', exact: true })).toBeVisible();
    const created = env.lab.connectors!.list(env.actor).find(item => item.name === '显式发现资料')!;
    await manager.getByRole('button', { name: '连接配置', exact: true }).click(); await manager.getByLabel('连接名称', { exact: true }).fill('保留我的本地名称');
    const latest = env.lab.connectors!.detail(env.actor, created.connectorId); await env.lab.connectors!.update(env.actor, created.connectorId, { ...env.base('远端更新名称'), auth: latest.revision.auth, exposedTools: latest.revision.exposedTools, policy: latest.revision.policy, expectedRevisionId: latest.revision.revisionId, clientActionId: randomUUID() });
    await manager.getByRole('button', { name: '保存配置', exact: true }).click(); await expect(manager.getByRole('alert')).toContainText('已更新'); await expect(manager.getByLabel('连接名称', { exact: true })).toHaveValue('保留我的本地名称');
    await manager.getByRole('button', { name: '查看最新配置', exact: true }).click(); await expect(manager.getByRole('heading', { name: '最新配置（只读）', exact: true })).toBeVisible(); await expect(manager.getByLabel('连接名称', { exact: true })).toHaveValue('保留我的本地名称');
    await page.screenshot({ path: test.info().outputPath('connector-config-1440.png') }); await page.setViewportSize({ width: 1060, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: test.info().outputPath('connector-config-1060.png') });
    expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); }
});

test('ordinary users save only their own credentials without browser persistence or automatic replay', async ({ page, browser }) => {
  const env = await setup(); await env.attach(page); const second = await browser.newContext(); const other = await second.newPage(); await env.attach(other);
  try {
    await login(page, '席位甲'); await connectors(page); await expect(page.getByRole('button', { name: '添加 MCP', exact: true })).toHaveCount(0); await page.getByRole('button', { name: '查看连接器个人账号资料', exact: true }).click();
    const detail = page.locator('dialog.connector-detail-panel'); await expect(detail.getByText('尚未配置凭证。', { exact: true })).toBeVisible();
    const syntheticSecret = 'synthetic-user-one-personal-secret'; env.dropNextCredential(); await detail.getByLabel('新的本人凭证', { exact: true }).fill(syntheticSecret); await detail.getByRole('button', { name: '保存凭证', exact: true }).click();
    await expect(detail.getByText('保存结果尚未确认，请先读取当前凭证状态。', { exact: true })).toBeVisible(); await expect(detail.getByLabel('新的本人凭证', { exact: true })).toHaveValue('');
    const secretWrites = () => env.writes.filter(item => item.path.endsWith(`/connectors/${env.own.connection.connectorId}/credential`)); expect(secretWrites()).toHaveLength(1);
    const storage = await page.evaluate(() => JSON.stringify({ session: { ...sessionStorage }, local: { ...localStorage } })); expect(storage).not.toContain(syntheticSecret);
    await detail.getByRole('button', { name: '读取当前凭证状态', exact: true }).click(); await expect(detail.getByText('已配置，不显示密钥。', { exact: true })).toBeVisible(); expect(secretWrites()).toHaveLength(1);
    await login(other, '席位乙'); await connectors(other); await other.getByRole('button', { name: '查看连接器个人账号资料', exact: true }).click(); await expect(other.locator('dialog.connector-detail-panel').getByText('尚未配置凭证。', { exact: true })).toBeVisible();
    await expect(detail.getByLabel('服务地址', { exact: true })).toHaveCount(0); expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); await second.close(); }
});

test('two connector choices persist through reload and first send without leaking to a new draft', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    await login(page, '席位甲'); await page.goto(`/?new&workspace=${env.workspace.id}`); await expect(input(page)).toBeEnabled(); await input(page).fill('保留输入正文');
    await page.getByRole('button', { name: '添加附件', exact: true }).click(); await page.getByRole('button', { name: '连接器', exact: true }).click();
    const picker = page.getByRole('group', { name: '可选连接器', exact: true }); await picker.getByRole('checkbox', { name: /^资料连接甲/ }).check(); await picker.getByRole('checkbox', { name: /^资料连接乙/ }).check(); await page.getByRole('button', { name: '完成选择', exact: true }).click();
    const chips = page.getByLabel('本会话连接器', { exact: true }); await expect(chips).toContainText('资料连接甲'); await expect(chips).toContainText('资料连接乙'); await expect(input(page)).toHaveValue('保留输入正文'); expect(env.fake.calls).toHaveLength(0); expect(await env.lab.list()).toHaveLength(0);
    await page.reload(); await expect(chips).toContainText('资料连接乙'); await expect(input(page)).toHaveValue('保留输入正文'); await input(page).press('Enter'); await expect(page.getByLabel('Axon 的回复')).toContainText('合成回复已完成');
    await expect(chips).toContainText('资料连接甲'); await expect(chips).toContainText('资料连接乙'); const sent = env.writes.find(item => item.path.endsWith('/messages'))!; expect(sent.body.connectorIds).toEqual([env.first.connection.connectorId, env.second.connection.connectorId]);
    await page.reload(); await expect(chips).toContainText('资料连接甲'); await expect(page.getByLabel('Axon 的回复')).toContainText('合成回复已完成'); await page.screenshot({ path: test.info().outputPath('connector-chips-1440.png') }); await page.setViewportSize({ width: 1060, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: test.info().outputPath('connector-chips-1060.png') });
    await page.getByRole('button', { name: '新建对话', exact: true }).click(); await expect(page.getByLabel('本会话连接器', { exact: true })).toHaveCount(0); await expect(input(page)).toHaveValue('');
    expect(env.fake.calls).toHaveLength(1);
  } finally { await env.close(); }
});


test('expert form preserves explicit connection action contracts through save, reload and copy', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    await login(page, '系统管理员'); await page.getByRole('button', { name: '创建专家', exact: true }).click(); await page.getByRole('dialog', { name: '创建专家', exact: true }).getByRole('button', { name: '手动创建', exact: true }).click();
    const manager = page.locator('dialog.capability-management-panel'); await manager.getByLabel('专家名称', { exact: true }).fill('连接依赖专家'); await manager.getByLabel('简介', { exact: true }).fill('保留固定连接动作契约'); await manager.getByLabel('专业指令', { exact: true }).fill('按明确来源查询资料。');
    const group = manager.getByRole('group', { name: '连接器依赖', exact: true }); const connection = group.locator('.management-tool-group').filter({ has: page.getByRole('heading', { name: '资料连接甲', exact: true }) }); await connection.getByRole('checkbox', { name: /lookup/ }).check();
    const savedResponse = page.waitForResponse(response => response.request().method() === 'PUT' && /experts\/[^/]+\/draft$/.test(new URL(response.url()).pathname)); await manager.getByRole('button', { name: '保存草稿', exact: true }).click(); expect((await savedResponse).status()).toBe(200); await expect(connection.getByRole('checkbox', { name: /lookup/ })).toBeChecked();
    const save = env.writes.find(item => /experts\/[^/]+\/draft$/.test(item.path))!; expect(save.body.content).toMatchObject({ connectorRequirements: [{ connectorId: env.first.connection.connectorId, actions: [{ name: 'lookup', contractDigest: env.first.revision.exposedTools[0].contractDigest }] }] });
    await manager.getByRole('button', { name: '关闭面板', exact: true }).click(); await page.reload(); await page.getByRole('button', { name: '配置连接依赖专家', exact: true }).click(); await expect(connection.getByRole('checkbox', { name: /lookup/ })).toBeChecked();
    await manager.getByRole('button', { name: '复制为新专家', exact: true }).click(); await expect(connection.getByRole('checkbox', { name: /lookup/ })).toBeChecked(); expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); }
});

test('running requests freeze connector changes and library staging preserves the original text draft', async ({ page }) => {
  const env = await setup(true); await env.attach(page);
  try {
    await login(page, '席位甲'); await page.goto(`/?new&workspace=${env.workspace.id}`); await expect(input(page)).toBeEnabled();
    await input(page).fill('固定连接开始处理'); await page.getByRole('button', { name: '添加附件', exact: true }).click(); await page.getByRole('button', { name: '连接器', exact: true }).click(); await page.getByRole('group', { name: '可选连接器', exact: true }).getByRole('checkbox', { name: /^资料连接甲/ }).check(); await page.getByRole('button', { name: '完成选择', exact: true }).click();
    env.controls.hold = true; await input(page).press('Enter'); await expect(page.getByRole('button', { name: '停止回复', exact: true })).toBeEnabled(); await expect(page.getByRole('button', { name: '移除连接器资料连接甲', exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: '添加附件', exact: true })).toBeDisabled(); await input(page).fill('保留下一条独立草稿');
    const session = (await env.lab.list(env.workspace.id, 'one'))[0]; await connectors(page); await page.getByRole('button', { name: '查看连接器资料连接乙（名称较长的独立服务）', exact: true }).click(); const detail = page.locator('dialog.connector-detail-panel'); await detail.getByLabel('使用空间', { exact: true }).selectOption(env.workspace.id); await detail.getByRole('button', { name: '用于对话', exact: true }).click(); await expect(detail.getByRole('alert')).toContainText('正在执行');
    await detail.getByRole('button', { name: '关闭面板', exact: true }).click(); await page.goto(`/?session=${session.id}`); await expect(input(page)).toHaveValue('保留下一条独立草稿'); await page.getByRole('button', { name: '停止回复', exact: true }).click(); await expect(page.getByRole('button', { name: '移除连接器资料连接甲', exact: true })).toBeEnabled();
    await connectors(page); await page.getByRole('button', { name: '查看连接器资料连接乙（名称较长的独立服务）', exact: true }).click(); await detail.getByLabel('使用空间', { exact: true }).selectOption(env.workspace.id); await detail.getByRole('button', { name: '用于对话', exact: true }).click(); await expect(input(page)).toHaveValue('保留下一条独立草稿'); await expect(page.getByLabel('本会话连接器', { exact: true })).toContainText('资料连接乙');
    expect(env.fake.calls).toHaveLength(1); expect(env.writes.filter(item => item.path.endsWith('/messages'))).toHaveLength(1);
  } finally { await env.close(); }
});


test('original live confirmation shows exact connection account tool and inert arguments before any remote call', async ({ page }) => {
  const env = await setup(true); await env.attach(page);
  try {
    await login(page, '席位甲'); await page.goto(`/?new&workspace=${env.workspace.id}`); await expect(input(page)).toBeEnabled(); await page.getByRole('button', { name: '添加附件', exact: true }).click(); await page.getByRole('button', { name: '连接器', exact: true }).click(); const picker = page.getByRole('group', { name: '可选连接器', exact: true }); await picker.getByRole('checkbox', { name: /^资料连接甲/ }).check(); await picker.getByRole('checkbox', { name: /^资料连接乙/ }).check(); await page.getByRole('button', { name: '完成选择', exact: true }).click();
    env.controls.query = '核对 <img src=x onerror="window.untrusted=1"> 参数'; env.controls.toolName = mcpToolName(env.first.connection.connectorId, 'lookup'); await input(page).fill('仅查询资料连接甲'); await input(page).press('Enter'); const confirm = page.locator('.composer-interaction.confirmation-card'); await expect(confirm.getByRole('button', { name: '确认执行', exact: true })).toBeVisible(); await expect(confirm).toContainText('资料连接甲'); await expect(confirm).toContainText('无需凭证'); await expect(confirm).toContainText('lookup'); await expect(confirm.getByLabel('本次外发参数', { exact: true })).toHaveText(JSON.stringify({ query: env.controls.query }, null, 2)); await expect(confirm.locator('img')).toHaveCount(0); expect(env.a.records.filter(item => item.method === 'tools/call')).toHaveLength(0); expect(env.b.records.filter(item => item.method === 'tools/call')).toHaveLength(0);
    await confirm.getByRole('button', { name: '拒绝', exact: true }).click(); await expect(page.getByLabel('Axon 的回复')).toContainText('合成回复已完成'); expect(env.a.records.filter(item => item.method === 'tools/call')).toHaveLength(0);
    env.controls.toolName = mcpToolName(env.first.connection.connectorId, 'lookup'); await input(page).fill('重新提出相同查询，等待本次批准'); await input(page).press('Enter'); await expect(confirm.getByRole('button', { name: '确认执行', exact: true })).toBeVisible();
    for (const width of [1440, 1060]) { await page.setViewportSize({ width, height: 960 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: test.info().outputPath(`connector-confirmation-${width}.png`) }); }
    await confirm.getByRole('button', { name: '确认执行', exact: true }).click(); await expect(page.getByLabel('Axon 的回复').last()).toContainText('合成回复已完成'); expect(env.a.records.filter(item => item.method === 'tools/call')).toHaveLength(1); expect(env.b.records.filter(item => item.method === 'tools/call')).toHaveLength(0); expect(env.a.records.find(item => item.method === 'tools/call')?.params?.arguments).toEqual({ query: env.controls.query });
    const session = (await env.lab.list(env.workspace.id, 'one'))[0]; const snapshot = await env.lab.get(session.id, 'one'); expect(snapshot.messages.find(message => message.toolDetails?.mcp)?.toolDetails?.mcp).toMatchObject({ connectionName: '资料连接甲', accountLabel: '无需凭证', toolName: 'lookup', status: 'success' }); await page.reload(); await expect(page.getByLabel('本会话连接器', { exact: true })).toContainText('资料连接甲');
  } finally { await env.close(); }
});
