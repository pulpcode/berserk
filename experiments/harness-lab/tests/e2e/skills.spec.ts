import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { migrateAdministratorAccounts } from '../../src/access/administrator-schema';
import { createApp } from '../../src/server/app';
import { PiLab } from '../../src/pi/lab';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';
import type { SkillImportPreview } from '../../src/contracts/skills';

async function setup(page: Page) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-skills-web-'));
  const db = await openDatabase(dir); const access = new AccessStore(db);
  await access.saveAccount({ username: 'business', displayName: '业务用户', seatId: 'business', seatName: '业务席', password: 'test-password-123', createPublicTask: false, manageModelSettings: false });
  migrateAdministratorAccounts(db); const adminId = await access.saveAdministratorAccount({ username: 'admin', displayName: '系统管理员', password: 'test-password-123' }); db.close();
  const config = testConfig(dir, { auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000 } });
  const fake = await fakeRuntime(config, () => ({ text: '合成结果。' })); const lab = await PiLab.create(config, fake.runtime); const app = await createApp(lab, false, undefined, undefined, { runtimeFactory: async () => fake.runtime });
  const writes: string[] = [];
  const createRequests: Array<{ clientActionId: string }> = []; let dropCreate = false;
  await page.route('**/api/**', async route => { const request = route.request(); const url = new URL(request.url()); if (request.method() !== 'GET') writes.push(url.pathname); if (request.method() === 'POST' && url.pathname === '/api/admin/capabilities/skills') createRequests.push(JSON.parse(request.postData()!)); const response = await app.inject({ url: url.pathname + url.search, method: request.method() as 'GET' | 'POST' | 'PUT', headers: { ...await request.allHeaders(), host: '127.0.0.1', origin: 'http://localhost:4310' }, ...(request.postDataBuffer() ? { payload: request.postDataBuffer()! } : {}) }); if (dropCreate && request.method() === 'POST' && url.pathname === '/api/admin/capabilities/skills' && response.statusCode === 200) { dropCreate = false; await route.abort('failed'); return; } await route.fulfill({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), body: response.rawPayload }); });
  return { lab, fake, adminId, writes, createRequests, dropNextCreate: () => { dropCreate = true; }, close: async () => { if (!page.isClosed()) { await page.goto('about:blank').catch(() => {}); await page.unrouteAll({ behavior: 'wait' }); } await app.close(); await rm(dir, { recursive: true, force: true }); } };
}
async function login(page: Page, name: string) { await page.goto('/'); await page.getByLabel('席位', { exact: true }).selectOption({ label: name }); await page.getByLabel('密码', { exact: true }).fill('test-password-123'); await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible(); }

async function openSource(manager: Locator) { const source = manager.locator('.skill-source-editor'); if (await source.getAttribute('open') === null) await source.locator('summary').click(); }

test('administrator imports a method package, cancels preview without writes, and publishes without trial or scan gate', async ({ page }, testInfo) => {
  const env = await setup(page);
  try {
    await login(page, '系统管理员'); await page.getByRole('tab', { name: '技能', exact: true }).click();
    await expect(page.getByRole('button', { name: '创建技能', exact: true })).toBeVisible();
    const payload = { name: 'summary.md', mimeType: 'text/markdown', buffer: Buffer.from('---\nname: summary-method\ndescription: 合成资料摘要方法\n---\n\n先核对输入，再归纳结论。') };
    await page.locator('.skill-library input[type=file]').setInputFiles(payload);
    const preview = page.getByRole('dialog', { name: '确认导入技能', exact: true }); await expect(preview.getByRole('heading', { name: 'summary-method', exact: true })).toBeVisible(); await preview.getByRole('button', { name: '取消', exact: true }).click();
    expect(env.writes.filter(path => path.endsWith('/skills/import'))).toHaveLength(0); expect(env.fake.calls).toHaveLength(0);
    await page.locator('.skill-library input[type=file]').setInputFiles(payload); await preview.getByRole('button', { name: '确认导入草稿', exact: true }).click();
    const manager = page.locator('dialog.skill-management-panel'); await expect(manager.getByLabel('使用说明', { exact: true })).toHaveValue(/先核对输入/);
    await manager.getByRole('button', { name: '使用范围', exact: true }).click(); await manager.getByLabel('开放范围', { exact: true }).selectOption('all'); await manager.getByRole('button', { name: '保存范围并继续', exact: true }).click(); await expect(manager.getByRole('status')).toContainText('使用范围已保存');
    await manager.getByRole('button', { name: '检查与发布', exact: true }).click(); await manager.getByRole('button', { name: '检查格式与完整性', exact: true }).click(); await expect(manager.getByRole('heading', { name: '格式与完整性检查完成', exact: true })).toBeVisible();
    await manager.getByLabel('技能发布说明', { exact: true }).fill('方法型首版，不要求试用。'); await manager.getByLabel('确认发布当前内容及使用范围。', { exact: true }).check(); await manager.getByRole('button', { name: '发布技能', exact: true }).click(); await expect(manager.getByRole('status')).toContainText('版本 1.0.0 已发布');
    expect(env.fake.calls).toHaveLength(0); expect(env.writes.filter(path => path.endsWith('/trials'))).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath('skill-publication-wide.png') }); await page.setViewportSize({ width: 1060, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: testInfo.outputPath('skill-publication-desktop.png') });
  } finally { await env.close(); }
});

test('ordinary user can stage a published skill into an existing conversation without sending or changing its draft', async ({ page }) => {
  const env = await setup(page);
  try {
    const actor = { userId: env.adminId, assertAdministrator: () => {} };
    const content = '---\nname: concise-summary\ndescription: 将明确输入整理为简短摘要\n---\n\n基于输入整理摘要。';
    const { previewSkillImport } = await import('../../src/skills/import'); const preview: SkillImportPreview = await previewSkillImport('SKILL.md', Buffer.from(content));
    const skill = await env.lab.skills.import(actor, { clientActionId: randomUUID(), preview }); await env.lab.skills.setPolicy(actor, skill.skill.skillId, { expectedRevision: 0, mode: 'all', seatIds: [], clientActionId: randomUUID() }); await env.lab.skills.publish(actor, skill.skill.skillId, { expectedDraftRevision: 1, expectedCurrentRevisionId: null, releaseNotes: '合成测试技能', clientActionId: randomUUID() });
    const identity = env.lab.access!.identityForSeat('business')!; const task = env.lab.access!.create(identity, { title: '摘要个人空间', goal: '', visibility: 'private', clientActionId: randomUUID() }); const workspace = await env.lab.workspaces.ensureWorkspace(task.id, identity.seatId, task.title); const session = await env.lab.createSession(workspace.id, identity.seatId);
    await login(page, '业务席'); await page.goto(`/?session=${session.id}`); await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('保留我的问题'); await page.getByRole('button', { name: '能力中心', exact: true }).click(); await page.getByRole('tab', { name: '技能', exact: true }).click(); await expect(page.getByRole('button', { name: '创建技能', exact: true })).toHaveCount(0); await page.getByRole('button', { name: '查看技能concise-summary', exact: true }).click();
    const detail = page.locator('dialog.skill-detail-panel'); await detail.getByLabel('使用空间', { exact: true }).selectOption(workspace.id); await detail.getByRole('button', { name: '用于对话', exact: true }).click();
    await expect(page.getByRole('button', { name: '查看 Skill：concise-summary', exact: true })).toBeVisible(); await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue('保留我的问题'); expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); }
});

test('policy and publication saves retain their viewed baselines across background detail refreshes', async ({ page }) => {
  const env = await setup(page);
  try {
    const actor = { userId: env.adminId, assertAdministrator: () => {} };
    const { previewSkillImport } = await import('../../src/skills/import');
    const method = (body: string) => `---\nname: cas-summary\ndescription: 检查并发修改的固定基线\n---\n\n${body}`;
    const imported = await env.lab.skills.import(actor, { clientActionId: randomUUID(), preview: await previewSkillImport('SKILL.md', Buffer.from(method('第一版。'))) });
    const id = imported.skill.skillId;
    await env.lab.skills.setPolicy(actor, id, { expectedRevision: 0, mode: 'all', seatIds: [], clientActionId: randomUUID() });
    const original = await env.lab.skills.publish(actor, id, { expectedDraftRevision: 1, expectedCurrentRevisionId: null, releaseNotes: '初始版本', clientActionId: randomUUID() });
    await login(page, '系统管理员'); await page.getByRole('tab', { name: '技能', exact: true }).click(); await page.getByRole('button', { name: '查看技能cas-summary', exact: true }).click();
    const manager = page.locator('dialog.skill-management-panel');
    await manager.getByRole('button', { name: '使用范围', exact: true }).click(); await manager.getByLabel('开放范围', { exact: true }).selectOption('none');
    const remotePolicy = await env.lab.skills.setPolicy(actor, id, { expectedRevision: 1, mode: 'seats', seatIds: ['business'], clientActionId: randomUUID() });
    // Validation refreshes the managed detail props, including the remotely changed policy.
    const detailRead = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/capabilities/skills/${id}` && response.request().method() === 'GET');
    await manager.getByRole('button', { name: '检查与发布', exact: true }).click(); await manager.getByRole('button', { name: '检查格式与完整性', exact: true }).click(); await detailRead; await expect(manager.getByRole('button', { name: '检查与发布', exact: true })).toHaveAttribute('aria-current', 'page');
    await manager.getByRole('button', { name: '使用范围', exact: true }).click(); await expect(manager.getByLabel('开放范围', { exact: true })).toHaveValue('none');
    const checksBeforeConflict = env.writes.filter(path => path.endsWith('/validate')).length;
    const rejectedPolicy = page.waitForResponse(response => response.url().endsWith(`/skills/${id}/policy`) && response.request().method() === 'PUT');
    await manager.getByRole('button', { name: '保存范围并继续', exact: true }).click(); expect((await rejectedPolicy).status()).toBe(409); await expect(manager.getByRole('button', { name: '使用范围', exact: true })).toHaveAttribute('aria-current', 'page');
    expect(env.writes.filter(path => path.endsWith('/validate'))).toHaveLength(checksBeforeConflict); expect(env.lab.skills.detail(id).policy).toEqual(remotePolicy); await expect(manager.getByLabel('开放范围', { exact: true })).toHaveValue('none');
    await manager.getByRole('button', { name: '查看最新使用范围', exact: true }).click(); await expect(manager.getByRole('heading', { name: '最新使用范围（只读）', exact: true })).toBeVisible(); await expect(manager.getByLabel('开放范围', { exact: true })).toHaveValue('none');
    await manager.getByRole('button', { name: '放弃本地范围修改，使用最新范围', exact: true }).click(); await expect(manager.getByLabel('开放范围', { exact: true })).toHaveValue('seats'); await manager.getByLabel('开放范围', { exact: true }).selectOption('all'); await manager.getByRole('button', { name: '保存范围并继续', exact: true }).click(); await expect(manager.getByRole('status')).toContainText('使用范围已保存'); expect(env.lab.skills.detail(id).policy.revision).toBe(3);
    // Save a new local draft, then another administrator publishes that exact draft.
    await manager.getByRole('button', { name: '技能内容', exact: true }).click(); await openSource(manager); await manager.getByLabel('编辑SKILL.md', { exact: true }).fill(method('第二版。')); await manager.getByRole('button', { name: '保存并继续', exact: true }).click(); await expect(manager.getByRole('status')).toContainText('草稿已保存');
    const remotePublication = await env.lab.skills.publish(actor, id, { expectedDraftRevision: 2, expectedCurrentRevisionId: original.revisionId, releaseNotes: '其他管理员发布第二版', clientActionId: randomUUID() });
    const publicationRead = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/capabilities/skills/${id}` && response.request().method() === 'GET');
    await manager.getByRole('button', { name: '检查与发布', exact: true }).click(); await manager.getByRole('button', { name: '检查格式与完整性', exact: true }).click(); await publicationRead;
    // A further local save must still use the originally viewed publication pointer.
    await manager.getByRole('button', { name: '技能内容', exact: true }).click(); await openSource(manager); await manager.getByLabel('编辑SKILL.md', { exact: true }).fill(method('第三版。')); await manager.getByRole('button', { name: '保存并继续', exact: true }).click(); await expect(manager.getByRole('status')).toContainText('草稿已保存');
    await manager.getByRole('button', { name: '检查与发布', exact: true }).click(); await manager.getByRole('button', { name: '检查格式与完整性', exact: true }).click(); await expect(manager.getByRole('heading', { name: '格式与完整性检查完成', exact: true })).toBeVisible(); await manager.getByLabel('技能发布说明', { exact: true }).fill('本地第三版'); await manager.getByLabel('确认发布当前内容及使用范围。', { exact: true }).check();
    const rejectedPublication = page.waitForResponse(response => response.url().endsWith(`/skills/${id}/publish`) && response.request().method() === 'POST'); await manager.getByRole('button', { name: '发布技能', exact: true }).click(); expect((await rejectedPublication).status()).toBe(409); expect(env.lab.skills.detail(id).skill.revisionId).toBe(remotePublication.revisionId); expect(env.lab.skills.detail(id).publications).toHaveLength(2); await expect(manager.getByLabel('技能发布说明', { exact: true })).toHaveValue('本地第三版');
    await manager.getByRole('button', { name: '查看最新草稿', exact: true }).click(); await manager.getByRole('button', { name: '技能内容', exact: true }).click(); await manager.getByRole('button', { name: '放弃本地修改，使用最新草稿与发布基线', exact: true }).click();
    await manager.getByRole('button', { name: '检查与发布', exact: true }).click(); await manager.getByRole('button', { name: '发布技能', exact: true }).click(); await expect(manager.getByRole('status')).toContainText('版本 1.0.2 已发布'); expect(env.lab.skills.detail(id).publications).toHaveLength(3); expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); }
});


test('administrator stages a published skill in a personal conversation without business scope or automatic sending', async ({ page }, testInfo) => {
  const env = await setup(page);
  try {
    const actor = { userId: env.adminId, assertAdministrator: () => {} };
    const { previewSkillImport } = await import('../../src/skills/import');
    const markdown = (name: string) => `---\nname: ${name}\ndescription: 管理员个人对话技能\n---\n\n核对输入后整理个人摘要。`;
    const published = await env.lab.skills.import(actor, { clientActionId: randomUUID(), preview: await previewSkillImport('SKILL.md', Buffer.from(markdown('personal-summary'))) });
    await env.lab.skills.setPolicy(actor, published.skill.skillId, { expectedRevision: 0, mode: 'none', seatIds: [], clientActionId: randomUUID() });
    await env.lab.skills.publish(actor, published.skill.skillId, { expectedDraftRevision: 1, expectedCurrentRevisionId: null, releaseNotes: '仅在个人对话查看效果', clientActionId: randomUUID() });
    await env.lab.skills.import(actor, { clientActionId: randomUUID(), preview: await previewSkillImport('SKILL.md', Buffer.from(markdown('unpublished-summary'))) });
    const identity = env.lab.access!.workspaceIdentity(env.adminId)!;
    const task = env.lab.access!.create(identity, { title: '管理员个人资料', goal: '', visibility: 'private', clientActionId: randomUUID() });
    const workspace = await env.lab.workspaces.ensureWorkspace(task.id, identity.seatId, task.title);
    const session = await env.lab.createSession(workspace.id, identity.seatId);
    await login(page, '系统管理员'); await page.goto(`/?session=${session.id}`);
    const textbox = page.getByRole('textbox', { name: '发送消息', exact: true }); await textbox.fill('保留管理员的测试问题');
    await page.getByRole('button', { name: '能力中心', exact: true }).click(); await page.getByRole('tab', { name: '技能', exact: true }).click();
    await expect(page.getByRole('button', { name: '使用技能unpublished-summary', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '使用技能personal-summary', exact: true }).click();
    const detail = page.locator('dialog.skill-detail-panel');
    await expect(detail.getByLabel('使用空间')).toContainText('管理员个人资料');
    await expect(detail.getByLabel('使用空间').locator('option')).toHaveCount(2);
    await detail.getByLabel('使用空间').selectOption(workspace.id); await detail.getByRole('button', { name: '用于对话', exact: true }).click();
    await expect(page.getByRole('button', { name: '查看 Skill：personal-summary', exact: true })).toBeVisible();
    await expect(textbox).toHaveValue('保留管理员的测试问题'); expect(env.fake.calls).toHaveLength(0);
    await expect(page.getByRole('button', { name: '工作待办', exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('admin-personal-skill-staged.png') });
    await env.lab.skills.lifecycle(actor, published.skill.skillId, { action: 'disable', expectedStateRevision: 0, clientActionId: randomUUID() });
    await page.getByRole('button', { name: '能力中心', exact: true }).click(); await page.getByRole('tab', { name: '技能', exact: true }).click();
    await expect(page.getByRole('button', { name: '使用技能personal-summary', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '查看技能personal-summary', exact: true })).toBeVisible();
  } finally { await env.close(); }
});


test('creation starts with an empty local form, cancel writes nothing, and invalid submission keeps the input', async ({ page }, testInfo) => {
  const env = await setup(page);
  try {
    await login(page, '系统管理员'); await page.getByRole('tab', { name: '技能', exact: true }).click();
    const before = env.lab.skills.list().length;
    await page.getByRole('button', { name: '创建技能', exact: true }).click();
    let form = page.getByRole('dialog', { name: '创建技能', exact: true });
    await expect(form.getByLabel('技能名称', { exact: true })).toBeFocused();
    await form.getByLabel('技能名称', { exact: true }).fill('资料摘要'); await form.getByLabel('技能简介', { exact: true }).fill('汇总资料中的重点与待办。'); await form.getByLabel('使用说明', { exact: true }).fill('先核对资料，再归纳要点。');
    expect(env.lab.skills.list()).toHaveLength(before); expect(env.createRequests).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath('skill-create-1440.png') }); await page.setViewportSize({ width: 1060, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: testInfo.outputPath('skill-create-1060.png') });
    await form.getByRole('button', { name: '取消', exact: true }).click(); expect(env.lab.skills.list()).toHaveLength(before); expect(env.createRequests).toHaveLength(0);
    await page.getByRole('button', { name: '创建技能', exact: true }).click(); form = page.getByRole('dialog', { name: '创建技能', exact: true });
    await expect(form.getByLabel('技能名称', { exact: true })).toHaveValue('');
    await form.getByLabel('技能名称', { exact: true }).fill('Invalid Name'); await form.getByLabel('技能简介', { exact: true }).fill('稍后补充使用说明。');
    await form.getByRole('button', { name: '创建草稿', exact: true }).click(); await expect(form.getByRole('alert')).toContainText('技能名称');
    await expect(form.getByLabel('技能名称', { exact: true })).toHaveValue('Invalid Name'); expect(env.lab.skills.list()).toHaveLength(before);
    await form.getByLabel('技能名称', { exact: true }).fill('empty-body');
    await form.locator('form').evaluate(node => { (node as HTMLFormElement).requestSubmit(); (node as HTMLFormElement).requestSubmit(); });
    const manager = page.locator('dialog.skill-management-panel'); await expect(manager.getByRole('button', { name: '使用范围', exact: true })).toHaveAttribute('aria-current', 'page'); await manager.getByRole('button', { name: '技能内容', exact: true }).click(); await expect(manager.getByLabel('技能名称', { exact: true })).toHaveValue('empty-body'); await expect(manager.getByLabel('使用说明', { exact: true })).toHaveValue('');
    expect(env.lab.skills.list()).toHaveLength(before + 1); expect(env.createRequests).toHaveLength(2); expect(env.fake.calls).toHaveLength(0);
    await expect(manager.getByLabel('编辑SKILL.md', { exact: true })).not.toBeVisible();
    await manager.getByRole('button', { name: '检查与发布', exact: true }).click(); await expect(manager.getByRole('button', { name: '设置使用范围', exact: true })).toBeVisible();
    const created = env.lab.skills.list().find(skill => skill.name === 'empty-body')!;
    await env.lab.skills.setPolicy({ userId: env.adminId, assertAdministrator: () => {} }, created.skillId, { expectedRevision: 0, mode: 'none', seatIds: [], clientActionId: randomUUID() });
    await manager.getByRole('button', { name: '检查格式与完整性', exact: true }).click(); await expect(manager.getByRole('heading', { name: '格式与完整性检查完成', exact: true })).toBeVisible();
    await expect(manager.getByRole('button', { name: '设置使用范围', exact: true })).toHaveCount(0);
    await manager.getByLabel('技能发布说明', { exact: true }).fill('仅核对发布准备状态'); await manager.getByLabel('确认发布当前内容及使用范围。', { exact: true }).check(); await expect(manager.getByRole('button', { name: '发布技能', exact: true })).toBeEnabled();
  } finally { await env.close(); }
});

test('a lost create response retries the same complete draft instead of creating another asset', async ({ page }) => {
  const env = await setup(page);
  try {
    await login(page, '系统管理员'); await page.getByRole('tab', { name: '技能', exact: true }).click();
    const before = env.lab.skills.list().length; env.dropNextCreate();
    await page.getByRole('button', { name: '创建技能', exact: true }).click(); const form = page.getByRole('dialog', { name: '创建技能', exact: true });
    await form.getByLabel('技能名称', { exact: true }).fill('retry-method'); await form.getByLabel('技能简介', { exact: true }).fill('完整草稿重试'); await form.getByLabel('使用说明', { exact: true }).fill('保留我的处理步骤。');
    await form.getByRole('button', { name: '创建草稿', exact: true }).click(); await expect(form.getByRole('alert')).toBeVisible();
    expect(env.lab.skills.list()).toHaveLength(before + 1); await expect(form.getByLabel('使用说明', { exact: true })).toHaveValue('保留我的处理步骤。');
    await form.getByRole('button', { name: '创建草稿', exact: true }).click(); const manager = page.locator('dialog.skill-management-panel');
    await expect(manager.getByRole('button', { name: '使用范围', exact: true })).toHaveAttribute('aria-current', 'page'); await manager.getByRole('button', { name: '技能内容', exact: true }).click(); await expect(manager.getByLabel('技能名称', { exact: true })).toHaveValue('retry-method'); expect(env.lab.skills.list()).toHaveLength(before + 1);
    expect(env.createRequests).toHaveLength(2); expect(env.createRequests[0]).toEqual(env.createRequests[1]); expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); }
});

test('form and source editing share the same draft and preserve imported extensions and other files', async ({ page }, testInfo) => {
  const env = await setup(page);
  try {
    const actor = { userId: env.adminId, assertAdministrator: () => {} };
    const original = '---\r\n# keep this comment\r\nname: form-method\r\ndescription: original description\r\nmetadata:\r\n  owner: external\r\ncustom-field: retained\r\n---\r\n原始正文。\r\n';
    const files = [{ path: 'SKILL.md', contentBase64: Buffer.from(original).toString('base64') }, { path: 'references/notes.txt', contentBase64: Buffer.from('原始资源').toString('base64') }];
    const created = await env.lab.skills.create(actor, { clientActionId: randomUUID(), files });
    const legacyFiles = files.map(file => ({ ...file, size: Buffer.from(file.contentBase64, 'base64').length, hash: createHash('sha256').update(Buffer.from(file.contentBase64, 'base64')).digest('hex'), mediaType: 'text/plain' }));
    env.lab.skills.db.prepare('UPDATE r3_skill_drafts SET data=? WHERE id=?').run(JSON.stringify({ ...created.draft, files: legacyFiles }), created.skill.skillId);
    await login(page, '系统管理员'); await page.getByRole('tab', { name: '技能', exact: true }).click(); await page.getByRole('button', { name: '查看技能form-method', exact: true }).click();
    const manager = page.locator('dialog.skill-management-panel'); await expect(manager.getByLabel('技能名称', { exact: true })).toHaveValue('form-method');
    await expect(manager.getByLabel('编辑SKILL.md', { exact: true })).not.toBeVisible(); expect(env.lab.skills.detail(created.skill.skillId).draft!.files).toEqual(legacyFiles); await expect(manager.getByRole('button', { name: '下一步：使用范围', exact: true })).toBeEnabled(); expect(env.writes.filter(path => path.endsWith('/draft'))).toHaveLength(0);
    await manager.getByLabel('技能简介', { exact: true }).fill('新的简介'); await manager.getByLabel('使用说明', { exact: true }).fill('表单里的处理步骤。');
    await openSource(manager); const source = manager.getByLabel('编辑SKILL.md', { exact: true });
    await expect(source).toHaveValue(/custom-field: retained/); await expect(source).toHaveValue(/# keep this comment/); await expect(source).toHaveValue(/表单里的处理步骤/);
    const raw = await source.inputValue(); await source.fill(raw.replace('form-method', 'source-method').replace('表单里的处理步骤。', '源码中的处理步骤。'));
    await expect(manager.getByLabel('技能名称', { exact: true })).toHaveValue('source-method'); await expect(manager.getByLabel('使用说明', { exact: true })).toHaveValue('源码中的处理步骤。');
    await manager.getByRole('button', { name: '保存并继续', exact: true }).click(); await expect(manager.getByRole('status')).toContainText('草稿已保存');
    const saved = env.lab.skills.detail(created.skill.skillId).draft!; expect(saved.files.find(f => f.path === 'references/notes.txt')).toEqual(files[1]);
    expect(Buffer.from(saved.files.find(f => f.path === 'SKILL.md')!.contentBase64, 'base64').toString()).toContain('custom-field: retained');
    await expect(manager.getByRole('button', { name: '使用范围', exact: true })).toHaveAttribute('aria-current', 'page'); await manager.getByRole('button', { name: '技能内容', exact: true }).click(); await manager.locator('.skill-source-editor > summary').click(); await page.screenshot({ path: testInfo.outputPath('skill-method-form-1440.png') });
    await page.setViewportSize({ width: 1060, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: testInfo.outputPath('skill-method-form-1060.png') });
  } finally { await env.close(); }
});


test('creation respects Unicode code-point limits without truncating supplementary-plane input', async ({ page }) => {
  const env = await setup(page);
  try {
    await login(page, '系统管理员'); await page.getByRole('tab', { name: '技能', exact: true }).click(); await page.getByRole('button', { name: '创建技能', exact: true }).click();
    const before = env.lab.skills.list().length, letter = String.fromCodePoint(0x10428), emoji = String.fromCodePoint(0x1f600);
    const form = page.getByRole('dialog', { name: '创建技能', exact: true }), name = form.getByLabel('技能名称', { exact: true }), description = form.getByLabel('技能简介', { exact: true });
    await name.fill(letter.repeat(65)); await description.fill(emoji.repeat(1024)); await expect(name).toHaveValue(letter.repeat(65));
    await form.getByRole('button', { name: '创建草稿', exact: true }).click(); await expect(form.getByRole('alert')).toContainText('技能名称'); expect(env.lab.skills.list()).toHaveLength(before);
    await name.fill(letter.repeat(64)); await description.fill(emoji.repeat(1025));
    await form.getByRole('button', { name: '创建草稿', exact: true }).click(); await expect(form.getByRole('alert')).toContainText('技能简介'); expect(env.lab.skills.list()).toHaveLength(before);
    await description.fill(emoji.repeat(1024)); await expect(description).toHaveValue(emoji.repeat(1024));
    await form.getByRole('button', { name: '创建草稿', exact: true }).click(); const manager = page.locator('dialog.skill-management-panel');
    await expect(manager.getByRole('button', { name: '使用范围', exact: true })).toHaveAttribute('aria-current', 'page'); await manager.getByRole('button', { name: '技能内容', exact: true }).click(); await expect(manager.getByLabel('技能名称', { exact: true })).toHaveValue(letter.repeat(64)); await expect(manager.getByLabel('技能简介', { exact: true })).toHaveValue(emoji.repeat(1024));
    expect(env.lab.skills.list()).toHaveLength(before + 1); expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); }
});

test('creation advances through saved scope and validation to explicit publication and completion', async ({ page }, testInfo) => {
  const env = await setup(page);
  try {
    await login(page, '系统管理员'); await page.getByRole('tab', { name: '技能', exact: true }).click();
    await page.getByRole('button', { name: '创建技能', exact: true }).click();
    const form = page.getByRole('dialog', { name: '创建技能', exact: true });
    await form.getByLabel('技能名称', { exact: true }).fill('guided-summary'); await form.getByLabel('技能简介', { exact: true }).fill('按明确步骤核对并汇总资料。'); await form.getByLabel('使用说明', { exact: true }).fill('先核对输入，再整理摘要与待办。');
    await form.getByRole('button', { name: '创建草稿', exact: true }).click();
    const manager = page.locator('dialog.skill-management-panel');
    await expect(manager.getByRole('button', { name: '使用范围', exact: true })).toHaveAttribute('aria-current', 'page');
    const skill = env.lab.skills.list().find(item => item.name === 'guided-summary')!;
    expect(env.lab.skills.detail(skill.skillId).policy.revision).toBe(0); expect(env.writes.filter(path => /\/(validate|publish|trials|scans)$/.test(path))).toHaveLength(0);
    await manager.getByLabel('开放范围', { exact: true }).selectOption('seats'); await expect(manager.getByRole('button', { name: '保存范围并继续', exact: true })).toBeDisabled(); await manager.getByLabel('业务席', { exact: true }).check();
    await page.screenshot({ path: testInfo.outputPath('skill-guided-scope-1440.png') }); await page.setViewportSize({ width: 1060, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: testInfo.outputPath('skill-guided-scope-1060.png') });
    const validation = page.waitForRequest(request => request.url().endsWith(`/skills/${skill.skillId}/validate`) && request.method() === 'POST');
    await manager.getByRole('button', { name: '保存范围并继续', exact: true }).click(); expect((await validation).postDataJSON()).toEqual({ expectedDraftRevision: 1 });
    await expect(manager.getByRole('button', { name: '检查与发布', exact: true })).toHaveAttribute('aria-current', 'page'); await expect(manager.getByRole('heading', { name: '格式与完整性检查完成', exact: true })).toBeVisible();
    expect(env.lab.skills.detail(skill.skillId).policy).toMatchObject({ revision: 1, mode: 'seats', seatIds: ['business'] }); await expect(manager.getByLabel('技能发布说明', { exact: true })).toBeFocused();
    await expect(manager.getByRole('button', { name: '发布技能', exact: true })).toBeDisabled(); expect(env.lab.skills.detail(skill.skillId).publications).toHaveLength(0); expect(env.fake.calls).toHaveLength(0); expect(env.writes.filter(path => /\/(publish|trials|scans)$/.test(path))).toHaveLength(0);
    await manager.getByLabel('技能发布说明', { exact: true }).fill('通过引导流程发布首版。'); await expect(manager.getByRole('button', { name: '发布技能', exact: true })).toBeDisabled(); await manager.getByLabel('确认发布当前内容及使用范围。', { exact: true }).check();
    await page.screenshot({ path: testInfo.outputPath('skill-guided-publish-1060.png') }); await page.setViewportSize({ width: 1440, height: 960 }); await page.screenshot({ path: testInfo.outputPath('skill-guided-publish-1440.png') });
    await manager.getByRole('button', { name: '发布技能', exact: true }).click(); await expect(manager.getByRole('button', { name: '发布历史', exact: true })).toHaveAttribute('aria-current', 'page'); await expect(manager.getByText('通过引导流程发布首版。', { exact: true })).toBeVisible();
    expect(env.lab.skills.detail(skill.skillId).publications).toHaveLength(1); expect(env.writes.filter(path => path.endsWith('/publish'))).toHaveLength(1); await page.screenshot({ path: testInfo.outputPath('skill-guided-complete-1440.png') }); await page.setViewportSize({ width: 1060, height: 900 }); await page.screenshot({ path: testInfo.outputPath('skill-guided-complete-1060.png') });
    await manager.getByRole('button', { name: '完成', exact: true }).click(); await expect(manager).not.toBeVisible(); await expect(page.getByRole('button', { name: '查看技能guided-summary', exact: true })).toBeVisible();
  } finally { await env.close(); }
});

test('a conflicting draft save retains edited fields and the content step even after reading latest data', async ({ page }) => {
  const env = await setup(page);
  try {
    const actor = { userId: env.adminId, assertAdministrator: () => {} };
    const method = (body: string) => [{ path: 'SKILL.md', contentBase64: Buffer.from(`---\nname: retained-draft\ndescription: 并发保存验证\n---\n\n${body}`).toString('base64') }];
    const created = await env.lab.skills.create(actor, { clientActionId: randomUUID(), files: method('初始步骤。') });
    await login(page, '系统管理员'); await page.getByRole('tab', { name: '技能', exact: true }).click(); await page.getByRole('button', { name: '查看技能retained-draft', exact: true }).click();
    const manager = page.locator('dialog.skill-management-panel');
    await manager.getByLabel('技能简介', { exact: true }).fill('保留我的简介'); await manager.getByLabel('使用说明', { exact: true }).fill('保留我的本地步骤。');
    const remote = await env.lab.skills.saveDraft(actor, created.skill.skillId, { expectedDraftRevision: 1, files: method('其他管理员的新步骤。') });
    const response = page.waitForResponse(value => value.url().endsWith(`/skills/${created.skill.skillId}/draft`) && value.request().method() === 'PUT'); await manager.getByRole('button', { name: '保存并继续', exact: true }).click(); expect((await response).status()).toBe(409);
    await expect(manager.getByRole('button', { name: '技能内容', exact: true })).toHaveAttribute('aria-current', 'page'); await expect(manager.getByLabel('技能简介', { exact: true })).toHaveValue('保留我的简介'); await expect(manager.getByLabel('使用说明', { exact: true })).toHaveValue('保留我的本地步骤。');
    await manager.getByRole('button', { name: '查看最新草稿', exact: true }).click(); await expect(manager.getByRole('heading', { name: '最新草稿已读取', exact: true })).toBeVisible();
    await expect(manager.getByRole('button', { name: '技能内容', exact: true })).toHaveAttribute('aria-current', 'page'); await expect(manager.getByLabel('使用说明', { exact: true })).toHaveValue('保留我的本地步骤。');
    expect(env.lab.skills.detail(created.skill.skillId).draft).toEqual(remote); expect(env.writes.filter(path => /\/(policy|validate|publish|trials)$/.test(path))).toHaveLength(0); expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); }
});

test('scope stays saved when automatic validation fails and the checks step offers a safe retry', async ({ page }) => {
  const env = await setup(page);
  try {
    await login(page, '系统管理员'); await page.getByRole('tab', { name: '技能', exact: true }).click(); await page.getByRole('button', { name: '创建技能', exact: true }).click();
    const form = page.getByRole('dialog', { name: '创建技能', exact: true }); await form.getByLabel('技能名称', { exact: true }).fill('validation-retry'); await form.getByLabel('技能简介', { exact: true }).fill('验证范围与检查失败分别反馈。'); await form.getByRole('button', { name: '创建草稿', exact: true }).click();
    const manager = page.locator('dialog.skill-management-panel'); await expect(manager.getByRole('button', { name: '使用范围', exact: true })).toHaveAttribute('aria-current', 'page'); const skill = env.lab.skills.list().find(item => item.name === 'validation-retry')!;
    let fail = true;
    await page.route(`**/skills/${skill.skillId}/validate`, async route => { if (fail) { fail = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: '格式检查暂不可用，请重试。' } }) }); } else await route.fallback(); });
    await manager.getByLabel('开放范围', { exact: true }).selectOption('all'); await manager.getByRole('button', { name: '保存范围并继续', exact: true }).click();
    await expect(manager.getByRole('button', { name: '检查与发布', exact: true })).toHaveAttribute('aria-current', 'page'); await expect(manager.getByRole('status')).toContainText('使用范围已保存'); await expect(manager.getByRole('alert')).toContainText('格式检查暂不可用');
    expect(env.lab.skills.detail(skill.skillId).policy).toMatchObject({ revision: 1, mode: 'all' }); await expect(manager.getByRole('button', { name: '发布技能', exact: true })).toBeDisabled();
    await manager.getByRole('button', { name: '检查格式与完整性', exact: true }).click(); await expect(manager.getByRole('heading', { name: '格式与完整性检查完成', exact: true })).toBeVisible();
    expect(env.lab.skills.detail(skill.skillId).policy.revision).toBe(1); expect(env.writes.filter(path => /\/(publish|trials)$/.test(path))).toHaveLength(0); expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); }
});

test('the skill heading shares one row with actions and only archived records are folded away', async ({ page }, testInfo) => {
  const env = await setup(page);
  try {
    const actor = { userId: env.adminId, assertAdministrator: () => {} };
    const archived = await env.lab.skills.create(actor, { clientActionId: randomUUID() }); await env.lab.skills.lifecycle(actor, archived.skill.skillId, { action: 'archive', expectedStateRevision: 0, clientActionId: randomUUID() });
    const empty = await env.lab.skills.create(actor, { clientActionId: randomUUID(), files: [{ path: 'SKILL.md', contentBase64: Buffer.from('---\nname: intentional-empty\ndescription: 合法的待补充说明草稿\n---\n\n').toString('base64') }] });
    await login(page, '系统管理员'); await page.getByRole('tab', { name: '技能', exact: true }).click();
    const directory = page.locator('.capability-skill-list'); await expect(directory.getByRole('button', { name: '查看技能intentional-empty', exact: true })).toBeVisible(); await expect(directory.getByRole('button', { name: '查看技能new-skill', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '可用技能', exact: true })).toHaveCount(1); await expect(page.locator('.skill-archive > summary')).toHaveText('已归档（1）'); await expect(page.getByRole('button', { name: '查看技能new-skill', exact: true })).not.toBeVisible();
    for (const width of [1440, 1060]) {
      await page.setViewportSize({ width, height: 960 }); const heading = await page.getByRole('heading', { name: '可用技能', exact: true }).boundingBox();
      for (const label of ['导入技能', '创建技能']) { const action = await page.getByRole('button', { name: label, exact: true }).boundingBox(); expect(Math.abs(heading!.y + heading!.height / 2 - action!.y - action!.height / 2)).toBeLessThan(2); }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: testInfo.outputPath(`skill-header-${width}.png`) });
    }
    await page.locator('.skill-archive').scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath('skill-archive-folded-1060.png') }); await page.locator('.skill-archive > summary').click(); await page.locator('.skill-archived-list').scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath('skill-archive-open-1060.png') }); await page.getByRole('button', { name: '查看技能new-skill', exact: true }).click();
    const manager = page.locator('dialog.skill-management-panel'); await expect(manager.getByLabel('技能名称', { exact: true })).toHaveValue('new-skill'); await expect(manager.getByLabel('技能名称', { exact: true })).toBeDisabled(); await expect(manager.getByRole('button', { name: '复制为新技能', exact: true })).toBeDisabled(); await expect(manager.getByRole('button', { name: '下一步：使用范围', exact: true })).toBeDisabled();
    expect(env.lab.skills.detail(archived.skill.skillId).skill.archived).toBe(true); expect(env.lab.skills.detail(empty.skill.skillId).skill.archived).toBe(false); expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); }
});


test('a retried creation reviews content changed after the original receipt before advancing', async ({ page }) => {
  const env = await setup(page);
  try {
    await login(page, '系统管理员'); await page.getByRole('tab', { name: '技能', exact: true }).click(); env.dropNextCreate();
    await page.getByRole('button', { name: '创建技能', exact: true }).click(); const form = page.getByRole('dialog', { name: '创建技能', exact: true });
    await form.getByLabel('技能名称', { exact: true }).fill('review-after-retry'); await form.getByLabel('技能简介', { exact: true }).fill('创建时的简介'); await form.getByLabel('使用说明', { exact: true }).fill('我确认的原始步骤。');
    await form.getByRole('button', { name: '创建草稿', exact: true }).click(); await expect(form.getByRole('alert')).toBeVisible();
    const created = env.lab.skills.list().find(skill => skill.name === 'review-after-retry')!;
    const actor = { userId: env.adminId, assertAdministrator: () => {} };
    const updated = await env.lab.skills.saveDraft(actor, created.skillId, { expectedDraftRevision: 1, files: [{ path: 'SKILL.md', contentBase64: Buffer.from('---\nname: review-after-retry\ndescription: 另一位管理员更新的简介\n---\n请先核对这份新的步骤。').toString('base64') }] });
    await form.getByRole('button', { name: '创建草稿', exact: true }).click(); const manager = page.locator('dialog.skill-management-panel');
    await expect(manager.getByRole('button', { name: '技能内容', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(manager.getByRole('status')).toContainText('技能内容已更新');
    await expect(manager.getByLabel('技能简介', { exact: true })).toHaveValue('另一位管理员更新的简介'); await expect(manager.getByLabel('使用说明', { exact: true })).toHaveValue('请先核对这份新的步骤。');
    expect(env.createRequests).toHaveLength(2); expect(env.createRequests[0]).toEqual(env.createRequests[1]); expect(env.lab.skills.detail(created.skillId).draft).toEqual(updated);
    expect(env.writes.filter(path => /\/(policy|validate|publish|trials)$/.test(path))).toHaveLength(0); expect(env.fake.calls).toHaveLength(0);
    await manager.getByRole('button', { name: '下一步：使用范围', exact: true }).click(); await expect(manager.getByRole('button', { name: '使用范围', exact: true })).toHaveAttribute('aria-current', 'page'); expect(env.lab.skills.detail(created.skillId).policy.revision).toBe(0);
  } finally { await env.close(); }
});
