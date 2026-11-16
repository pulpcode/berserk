import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { migrateAdministratorAccounts } from '../../src/access/administrator-schema';
import { createApp } from '../../src/server/app';
import { PiLab } from '../../src/pi/lab';
import { fakeRuntime, testConfig, type Reply } from '../pi/fake-runtime';
import type { AuthoringProposal } from '../../src/contracts/authoring';

test.setTimeout(90000);
async function setup(page: Page, reply: Parameters<typeof fakeRuntime>[1] = () => ({ text: '已处理合成请求。' })) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-authoring-web-'));
  const db = await openDatabase(dir), access = new AccessStore(db);
  await access.saveAccount({ username: 'business', displayName: '业务', seatId: 'business', seatName: '业务席', password: 'test-password-123', createPublicTask: false, manageModelSettings: false });
  migrateAdministratorAccounts(db); const adminId = await access.saveAdministratorAccount({ username: 'admin', displayName: '系统管理员', password: 'test-password-123' }); db.close();
  const config = testConfig(dir, { publicOrigin: `http://127.0.0.1:${process.env.AXON_E2E_PORT || 5187}`, auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000 } });
  const fake = await fakeRuntime(config, reply), lab = await PiLab.create(config, fake.runtime), app = await createApp(lab, false, undefined, undefined, { runtimeFactory: async () => fake.runtime });
  await app.listen({ host: '127.0.0.1', port: 4310 });
  const writes: Array<{ path: string; payload?: Record<string, unknown> }> = [];
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== 'GET') writes.push({ path: url.pathname, ...(request.postData() && request.headers()['content-type']?.includes('json') ? { payload: JSON.parse(request.postData()!) } : {}) });
    await route.continue();
  });
  return { lab, fake, adminId, writes, close: async () => { if (!page.isClosed()) { await page.goto('about:blank').catch(() => {}); await page.unrouteAll({ behavior: 'ignoreErrors' }); } await lab.close(); await app.close(); await rm(dir, { recursive: true, force: true }); } };
}
async function login(page: Page) { await page.goto('/'); await page.getByLabel('席位', { exact: true }).selectOption({ label: '系统管理员' }); await page.getByLabel('密码', { exact: true }).fill('test-password-123'); await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page.getByRole('heading', { name: '能力中心', exact: true })).toBeVisible(); }
async function personal(page: Page) {
  const space = page.getByRole('dialog', { name: '新建个人空间', exact: true });
  await space.getByLabel('空间名称', { exact: true }).fill('创作个人空间');
  await space.getByRole('button', { name: '创建并开始对话', exact: true }).click(); await expect(space).toBeHidden();
  await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toBeEnabled();
}
async function send(page: Page, text: string) { const input = page.getByRole('textbox', { name: '发送消息', exact: true }); await input.fill(text); await input.press('Enter'); }
const method = '---\nname: meeting-outline\ndescription: 将会议材料整理为简明提纲\nmetadata:\n  retained: yes\n---\n\n先核对事实，再归纳行动。\n';
const proposeSkill = (): Reply => ({ tools: [{ name: 'capability_authoring_propose', arguments: { kind: 'skill', summary: '创建会议提纲方法。', files: [{ path: 'SKILL.md', content: method }] } }] });
function saveProposal(context: Parameters<Parameters<typeof fakeRuntime>[1]>[0]): Reply {
  const result = [...context.messages].reverse().find(message => message.role === 'toolResult' && message.toolName === 'capability_authoring_propose');
  if (!result || result.role !== 'toolResult') throw Error('Missing actual proposal result');
  const proposal = JSON.parse(result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')) as AuthoringProposal;
  return { tools: [{ name: 'capability_authoring_save', arguments: { proposalId: proposal.proposalId } }] };
}

test('creation uses original new-chat flow, cancel has no writes, and manual skill creation stays independent', async ({ page }, info) => {
  const env = await setup(page);
  try {
    await login(page); await page.getByRole('button', { name: '创建专家', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '新建个人空间', exact: true })).toBeVisible(); await page.keyboard.press('Escape');
    expect(env.writes.filter(w => /\/api\/(tasks|sessions|admin\/capabilities)/.test(w.path))).toEqual([]); expect(env.fake.calls).toHaveLength(0);
    await page.getByRole('tab', { name: '技能', exact: true }).click(); await page.getByRole('button', { name: '手动创建', exact: true }).click();
    const manual = page.getByRole('dialog', { name: '创建技能', exact: true }); await manual.getByLabel('技能名称', { exact: true }).fill('manual-method'); await manual.getByLabel('技能简介', { exact: true }).fill('不依赖模型的手动方式'); await manual.getByRole('button', { name: '取消', exact: true }).click();
    expect(env.lab.skills.list().filter(s => !s.system)).toHaveLength(0); expect(env.fake.calls).toHaveLength(0);
    await page.getByRole('button', { name: '创建技能', exact: true }).click(); await personal(page);
    await expect(page.getByLabel('创作方法', { exact: true })).toHaveValue('skill');
    expect(env.lab.skills.list().filter(s => !s.system)).toHaveLength(0); expect(env.fake.calls).toHaveLength(0);
    const url = page.url(); await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('保留尚未发送的创作需求');
    await page.getByRole('button', { name: '能力中心', exact: true }).click(); await page.getByRole('button', { name: '创建专家', exact: true }).click();
    const picker = page.getByRole('dialog', { name: '新建对话', exact: true }); await expect(picker).toBeVisible(); await picker.getByRole('button', { name: '取消', exact: true }).click();
    await page.goto(url); await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue('保留尚未发送的创作需求'); await expect(page.getByLabel('创作方法', { exact: true })).toHaveValue('skill');
    await expect(page.getByRole('heading', { name: '今天，我们一起处理什么？', exact: true })).toBeVisible();
    for (const width of [1060, 1440]) { await page.setViewportSize({ width, height: 960 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath(`authoring-composer-${width}.png`) }); }
  } finally { await env.close(); }
});

test('the existing confirmation displays full candidate, rejection leaves no asset, and approved save stays in chat with an actual detail link', async ({ page }, info) => {
  const env = await setup(page, (context, index) => index === 0 || index === 3 ? proposeSkill() : index === 1 || index === 4 ? saveProposal(context) : { text: index === 2 ? '没有保存草稿。' : '草稿已保存，可以主动打开详情。' });
  try {
    await login(page); await page.getByRole('tab', { name: '技能', exact: true }).click(); await page.getByRole('button', { name: '创建技能', exact: true }).click(); await personal(page); const url = page.url();
    await send(page, '请创建一个整理会议提纲的方法技能。'); const confirm = page.locator('.composer-interaction.confirmation-card'); await expect(confirm.getByRole('button', { name: '确认保存草稿', exact: true })).toBeVisible();
    await confirm.getByText('查看完整候选', { exact: true }).click(); await expect(confirm).toContainText('retained: yes'); await expect(confirm).toContainText('先核对事实，再归纳行动。');
    expect(env.lab.skills.list().filter(s => !s.system)).toHaveLength(0); await confirm.getByRole('button', { name: '拒绝', exact: true }).click(); await expect(page.locator('.message.assistant').last()).toContainText('没有保存'); expect(env.lab.skills.list().filter(s => !s.system)).toHaveLength(0);
    await page.getByLabel('创作方法', { exact: true }).selectOption('skill'); await send(page, '重新提出该技能草稿，等待我确认。'); await expect(confirm.getByRole('button', { name: '确认保存草稿', exact: true })).toBeVisible();
    for (const width of [1060, 1440]) { await page.setViewportSize({ width, height: 960 }); await page.screenshot({ path: info.outputPath(`authoring-confirmation-${width}.png`) }); }
    await confirm.getByRole('button', { name: '确认保存草稿', exact: true }).click(); await expect(page.locator('.message.assistant').last()).toContainText('草稿已保存'); expect(env.lab.skills.list().filter(s => !s.system)).toHaveLength(1); await expect(page).toHaveURL(url);
    const saved = page.locator('.interaction-card.confirmation-card').filter({ has: page.getByRole('button', { name: '查看技能详情', exact: true, includeHidden: true }) }); await saved.locator(':scope > details > summary').click(); await saved.getByRole('button', { name: '查看技能详情', exact: true }).click();
    const manager = page.locator('dialog.skill-management-panel'); await expect(manager.getByRole('button', { name: '使用范围', exact: true })).toHaveAttribute('aria-current', 'page'); await expect(manager.getByLabel('开放范围', { exact: true })).toHaveValue('none');
    await manager.getByRole('button', { name: '关闭面板', exact: true }).click(); await expect(page).toHaveURL(url);
    expect(env.writes.filter(w => /\/policy$|\/publish$|\/trials$/.test(w.path))).toHaveLength(0);
  } finally { await env.close(); }
});


test('one personal conversation modifies two exact targets without changing unrelated fields', async ({ page }) => {
  let firstId = '', secondId = '';
  const env = await setup(page, (context, index) => {
    const round = index < 4 ? 0 : 1, step = index % 4, targetId = round === 0 ? firstId : secondId;
    if (step === 0) return { tools: [{ name: 'capability_authoring_read', arguments: { kind: 'expert', targetId } }] };
    if (step === 1) {
      const last = [...context.messages].reverse().find(message => message.role === 'toolResult' && message.toolName === 'capability_authoring_read');
      if (!last || last.role !== 'toolResult') throw Error('Missing saved target');
      const read = JSON.parse(last.content.filter(item => item.type === 'text').map(item => item.text).join('\n')) as { baseline: { draftRevision: number; digest: string } };
      return { tools: [{ name: 'capability_authoring_propose', arguments: { kind: 'expert', targetId, baseline: read.baseline, content: round === 0 ? { name: '甲专家新名称' } : { description: '乙专家新简介' }, summary: round === 0 ? '仅修改甲名称。' : '仅修改乙简介。' } }] };
    }
    if (step === 2) return saveProposal(context);
    return { text: round === 0 ? '甲专家名称已保存。' : '乙专家简介已保存。' };
  });
  try {
    const actor = { userId: env.adminId };
    const first = await env.lab.management!.create(actor, { clientActionId: randomUUID() }), second = await env.lab.management!.create(actor, { clientActionId: randomUUID() });
    firstId = first.expert.expertId; secondId = second.expert.expertId;
    const firstContent = { name: '甲专家', description: '甲保留简介', instructions: '甲保留指令', skillIds: [], allowedTools: [] }, secondContent = { name: '乙专家', description: '乙原简介', instructions: '乙保留指令', skillIds: [], allowedTools: [] };
    await env.lab.management!.save(actor, firstId, { expectedDraftRevision: 1, content: firstContent }); await env.lab.management!.save(actor, secondId, { expectedDraftRevision: 1, content: secondContent });
    await login(page); await page.getByRole('button', { name: '配置甲专家', exact: true }).click();
    const management = page.getByRole('dialog', { name: '专家管理', exact: true }); await expect(management.getByLabel('专家名称', { exact: true })).toHaveValue('甲专家');
    await management.getByLabel('简介', { exact: true }).fill('未保存的本地简介'); page.once('dialog', dialog => dialog.dismiss()); await management.getByRole('button', { name: '对话修改当前草稿', exact: true }).click(); await expect(management.getByLabel('简介', { exact: true })).toHaveValue('未保存的本地简介'); await expect(page.getByRole('dialog', { name: '新建个人空间', exact: true })).toHaveCount(0);
    page.once('dialog', dialog => dialog.accept()); await management.getByRole('button', { name: '对话修改当前草稿', exact: true }).click(); await personal(page); const url = page.url();
    await send(page, '仅修改甲专家名称。'); const confirm = page.locator('.composer-interaction.confirmation-card'); await expect(confirm.getByRole('button', { name: '确认保存草稿', exact: true })).toBeVisible(); await confirm.getByText('查看完整候选', { exact: true }).click(); await expect(confirm).toContainText('甲保留简介'); await confirm.getByRole('button', { name: '确认保存草稿', exact: true }).click(); await expect(page.locator('.message.assistant').last()).toContainText('甲专家名称已保存');
    expect((await env.lab.management!.get(firstId)).draft!.content).toEqual({ ...firstContent, name: '甲专家新名称' }); expect((await env.lab.management!.get(secondId)).draft!.content).toEqual(secondContent);
    await page.getByLabel('创作方法', { exact: true }).selectOption('expert'); await send(page, '接着只修改乙专家简介。'); await expect(confirm.getByRole('button', { name: '确认保存草稿', exact: true })).toBeVisible(); await confirm.getByRole('button', { name: '确认保存草稿', exact: true }).click(); await expect(page.locator('.message.assistant').last()).toContainText('乙专家简介已保存');
    expect((await env.lab.management!.get(firstId)).draft!.content).toEqual({ ...firstContent, name: '甲专家新名称' }); expect((await env.lab.management!.get(secondId)).draft!.content).toEqual({ ...secondContent, description: '乙专家新简介' }); await expect(page).toHaveURL(url);
    const authoringInputs = env.writes.filter(w => w.path.endsWith('/messages')).map(w => w.payload?.authoring) as Array<{ targetId?: string; baseline?: unknown }>;
    expect(authoringInputs[0]).toMatchObject({ kind: 'expert', targetId: firstId }); expect(authoringInputs[0].baseline).toBeDefined(); expect(authoringInputs[1]).toEqual({ kind: 'expert' });
  } finally { await env.close(); }
});
