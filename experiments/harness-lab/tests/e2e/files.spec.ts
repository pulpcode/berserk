import { expect, test, type Page, type Route } from '@playwright/test';
import type { SessionSnapshot, StreamEvent } from '../../src/contracts/index';
import type { FileOutput, Upload } from '../../src/contracts/files';

async function filesApi(page: Page) {
  const sessions: SessionSnapshot[] = ['A', 'B', 'C'].map(id => ({ id, workspaceId: id === 'C' ? 'w2' : 'w1', title: `会话 ${id}`, updatedAt: '2026-09-18', messages: [], active: null, lastResult: null }));
  const workspaces = [{ id: 'w1', name: '默认工作区', createdAt: '2026-09-18' }, { id: 'w2', name: '另一工作区', createdAt: '2026-09-18' }];
  const uploads = new Map<string, Upload>(); const contents = new Map<string, string>();
  const sent: { id: string; text: string; uploadIds?: string[]; fileRefs?: { path: string }[] }[] = [];
  const deletes: string[] = []; const transfers: string[] = []; const statusReads: string[] = [];
  const controls = { holdDelete: false, releaseDelete: undefined as (() => Promise<void>) | undefined, emptySecond: false, holdCreate: false, releaseCreate: undefined as (() => Promise<void>) | undefined, loseReply: false, hold: false, release: undefined as (() => Promise<void>) | undefined, fail: false, failSend: false };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); const path = url.pathname; const method = route.request().method();
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/api/info') return json({ model: 'deepseek-flash', configured: true, contextReady: true, files: { enabled: true, maxFileBytes: 104857600, maxAttachments: 20, executionAvailable: true }, limits: { agentRunTimeoutMs: null, httpIdleTimeoutMs: 300000, llmRequestTimeoutMs: null, maxOutputTokens: 393216 } });
    if (path === '/api/activity') return json({ defaultWorkspaceId: 'w1', workspaces, sessions: sessions.filter(session => !controls.emptySecond || session.id !== 'C').map(session => ({ ...session, statusUpdatedAt: session.updatedAt })) });
    if (path.includes('/resources')) return json({ workspaceId: path.split('/')[3], instructions: [], sources: [], skills: [] });
    if (path === '/api/sessions' && method === 'POST') {
      const session = { id: `new-${sessions.length}`, workspaceId: route.request().postDataJSON().workspaceId, title: '新对话', updatedAt: '2026-09-18', messages: [], active: null, lastResult: null };
      sessions.push(session); if (controls.holdCreate) { controls.holdCreate = false; controls.releaseCreate = () => json(session); return; } return json(session);
    }
    if (path.includes('/uploads')) {
      const workspaceId = path.split('/')[3]!; const uploadId = path.split('/')[5];
      if (!uploadId) { const input = route.request().postDataJSON(); const upload: Upload = { uploadId: `u${uploads.size}`, workspaceId, originalName: input.name, size: input.size, status: 'pending' }; uploads.set(upload.uploadId, upload); return json(upload); }
      const upload = uploads.get(uploadId)!;
      if (method === 'DELETE') { deletes.push(uploadId); if (upload.status !== 'completed') upload.status = 'cancelled'; if (controls.holdDelete) { controls.holdDelete = false; controls.releaseDelete = () => json(upload); return; } return json(upload); }
      if (method === 'GET') return json(upload);
      transfers.push(uploadId);
      const complete = async (request: Route) => {
        if (controls.fail) { controls.fail = false; upload.status = 'failed'; return request.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '上传失败，请重试。' } }) }); }
        if (upload.status === 'cancelled') return request.abort();
        let name = upload.originalName; if (contents.has(`${workspaceId}/${name}`)) name = `副本-${name}`;
        Object.assign(upload, { status: 'completed', name, path: name, hash: 'hash' }); contents.set(`${workspaceId}/${name}`, request.request().postDataBuffer()?.toString() || '');
        if (controls.loseReply) { controls.loseReply = false; return request.abort(); }
        await request.fulfill({ contentType: 'application/json', body: JSON.stringify(upload) });
      };
      if (controls.hold) { controls.hold = false; controls.release = () => complete(route); return; }
      return complete(route);
    }
    if (path.endsWith('/files')) {
      const workspaceId = path.split('/')[3]!; const search = url.searchParams.get('search') || '';
      const entries = [...contents.keys()].filter(key => key.startsWith(`${workspaceId}/`)).map(key => ({ name: key.slice(workspaceId.length + 1), path: key.slice(workspaceId.length + 1), kind: 'file', size: contents.get(key)!.length })).filter(file => file.name.includes(search));
      return json({ path: '', entries, total: entries.length, offset: 0, limit: 50 });
    }
    if (path.endsWith('/files/status')) {
      const key = `${path.split('/')[3]}/${url.searchParams.get('path')}`; statusReads.push(key);
      return json({ state: !contents.has(key) ? 'missing' : contents.get(key) === '原文' ? 'current' : 'changed' });
    }
    if (path.endsWith('/files/content')) return route.fulfill({ contentType: 'text/plain', body: contents.get(`${path.split('/')[3]}/${url.searchParams.get('path')}`) || '' });
    if (path.includes('/downloads/')) return route.fulfill({ contentType: 'application/octet-stream', headers: { 'Content-Disposition': 'attachment; filename="result.txt"' }, body: '固定交付内容' });
    const id = path.split('/')[3]!; const session = sessions.find(item => item.id === id)!;
    if (method === 'GET') return json(session);
    if (path.endsWith('/messages')) {
      const input = route.request().postDataJSON(); sent.push({ id, ...input });
      if (controls.failSend) { controls.failSend = false; return json({ error: { code: 'INVALID_INPUT', message: '文件不可用，请重新选择。' } }, 400); }
      const requestId = `r${sent.length}`;
      session.messages.push({ id: `m${sent.length}`, role: 'user', text: input.text, requestId });
      const file: FileOutput = { path: 'result.txt', name: 'result.txt', size: 18, hash: 'hash', downloadId: `d${sent.length}`, workspaceId: session.workspaceId, sessionId: id, requestId, toolCallId: `tc${sent.length}`, createdAt: '2026-09-18' };
      session.messages.push({ id: file.toolCallId, toolCallId: file.toolCallId, requestId, role: 'tool', toolName: 'file_output', text: 'server-confirmed' });
      session.fileOutputs = [...(session.fileOutputs || []), file]; session.lastResult = { requestId, status: 'succeeded' };
      const events: StreamEvent[] = [{ type: 'response.started', sessionId: id, requestId }, { type: 'files.output', sessionId: id, requestId, file }, { type: 'response.completed', sessionId: id, requestId, snapshot: session }];
      return route.fulfill({ contentType: 'text/event-stream', body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') });
    }
    return json({});
  });
  await page.goto('/'); await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toBeVisible();
  return { sent, deletes, uploads, transfers, controls, contents, sessions, statusReads };
}
const file = (name = '数据.csv') => ({ name, mimeType: 'text/csv', buffer: Buffer.from('姓名,数值\n甲,42') });
const composer = (page: Page) => page.getByRole('textbox', { name: '发送消息', exact: true });
const attach = (page: Page, name?: string) => page.getByLabel('选择附件', { exact: true }).setInputFiles(file(name));

// Deterministic HTTP evidence only; real Pi/container/provider acceptance is a separate probe.
test('upload stays with its original session, restores references after refresh, removal keeps workspace bytes', async ({ page }) => {
  const app = await filesApi(page); app.controls.hold = true;
  await composer(page).fill('甲会话草稿'); await attach(page);
  await expect.poll(() => Boolean(app.controls.release)).toBe(true);
  await page.getByRole('button', { name: /会话 B/ }).click(); await composer(page).fill('乙会话草稿');
  await app.controls.release!(); await expect(page.getByRole('list', { name: '消息附件' })).toBeEmpty();
  await page.getByRole('button', { name: /会话 A/ }).click();
  await expect(page.getByText('已保存到工作区', { exact: false })).toBeVisible(); await expect(composer(page)).toHaveValue('甲会话草稿');
  await page.reload(); await expect(page.getByText('已保存到工作区', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '移除引用 数据.csv' }).click();
  expect(app.deletes).toHaveLength(0); expect(app.contents.has('w1/数据.csv')).toBe(true);
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await expect(page.getByRole('button', { name: '预览 数据.csv' })).toBeVisible();
  await page.getByRole('button', { name: '预览 数据.csv' }).click(); await expect(page.getByRole('region', { name: '数据.csv 预览' })).toContainText('甲,42');
  await page.getByRole('button', { name: '引用 数据.csv' }).click();
  await expect(page.getByRole('list', { name: '消息附件' })).toContainText('工作区文件');
  await page.getByRole('button', { name: '发送消息', exact: true }).click(); await expect.poll(() => app.sent.length).toBe(1);
  expect(app.sent[0]!.fileRefs).toEqual([{ path: '数据.csv' }]);
  await expect(page.getByLabel('可下载文件：result.txt')).toBeVisible();
  await page.reload(); await expect(page.getByRole('link', { name: '下载 result.txt', exact: true })).toHaveAttribute('href', '/api/workspaces/w1/downloads/d1');
});

test('failed upload blocks sending, explicit retry verifies status, cancelled upload does not submit', async ({ page }) => {
  const app = await filesApi(page); app.controls.fail = true;
  await composer(page).fill('分析数据'); await attach(page);
  await expect(page.getByRole('button', { name: '核对并重试 数据.csv' })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '核对并重试 数据.csv' }).click();
  await expect(page.getByText('已保存到工作区', { exact: false })).toBeVisible(); expect(app.transfers).toHaveLength(2);
  app.controls.hold = true; await attach(page, '另一个.csv'); await expect.poll(() => Boolean(app.controls.release)).toBe(true);
  await page.getByRole('button', { name: '取消上传 另一个.csv' }).click();
  await expect(page.getByRole('list', { name: '消息附件' })).not.toContainText('另一个.csv');
  expect(app.deletes).toHaveLength(1); expect(app.sent).toHaveLength(0);
  app.controls.failSend = true;
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByText('文件不可用，请重新选择。')).toBeVisible();
  await expect(composer(page)).toHaveValue('分析数据');
  await expect(page.getByRole('list', { name: '消息附件' })).toContainText('数据.csv');
  expect(app.sent).toHaveLength(1);
});

test('project switching isolates files and file panel works on narrow screens without executing HTML', async ({ page }) => {
  const app = await filesApi(page); app.contents.set('w1/网页.html', '<script>window.filePreviewExecuted=true</script>');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '预览 网页.html' }).click();
  await expect(page.getByRole('region', { name: '网页.html 预览' })).toContainText('<script>');
  expect(await page.evaluate(() => 'filePreviewExecuted' in window)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: '文件', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '打开会话列表' }).click(); await page.getByRole('button', { name: /会话 C/ }).click();
  await page.getByRole('button', { name: '文件', exact: true }).click(); await expect(page.getByRole('list', { name: '项目文件列表' })).not.toContainText('网页.html');
});


test('uncertain upload response is checked without duplicate transfer and same names expose actual path', async ({ page }) => {
  const app = await filesApi(page); app.controls.loseReply = true;
  await attach(page); await expect(page.getByRole('button', { name: '核对并重试 数据.csv' })).toBeVisible();
  expect(app.contents.has('w1/数据.csv')).toBe(true);
  await page.getByRole('button', { name: '核对并重试 数据.csv' }).click();
  await expect(page.getByText('已保存到工作区', { exact: false })).toBeVisible(); expect(app.transfers).toHaveLength(1);
  await attach(page); await expect(page.getByRole('list', { name: '消息附件' })).toContainText('副本-数据.csv');
  await composer(page).fill('处理两份文件'); await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => app.sent.length).toBe(1); expect(app.sent[0]!.uploadIds).toEqual(['u0', 'u1']);
});

test('workspace draft attachments follow the captured first session while later navigation wins', async ({ page }) => {
  const app = await filesApi(page); app.controls.emptySecond = true;
  await page.reload(); await page.getByRole('button', { name: '进入项目：另一工作区' }).click();
  await attach(page); await expect(page.getByText('已保存到工作区', { exact: false })).toBeVisible();
  await composer(page).fill('新项目的文件任务'); app.controls.holdCreate = true;
  await page.getByRole('button', { name: '发送消息', exact: true }).click(); await expect.poll(() => Boolean(app.controls.releaseCreate)).toBe(true);
  await page.getByRole('button', { name: '会话 A', exact: true }).click(); await composer(page).fill('留在这里的草稿');
  await app.controls.releaseCreate!(); await expect.poll(() => app.sent.length).toBe(1);
  expect(app.sent[0]!.id).toBe('new-3'); expect(app.sent[0]!.uploadIds).toEqual(['u0']); expect(app.uploads.get('u0')!.workspaceId).toBe('w2');
  await expect(composer(page)).toHaveValue('留在这里的草稿'); await expect(page.getByRole('list', { name: '消息附件' })).toBeEmpty();
});

test('drag and drop has keyboard alternative and never fetches Markdown remote images', async ({ page }) => {
  const app = await filesApi(page); let externalLoads = 0;
  await page.route('https://external.invalid/**', route => { externalLoads++; return route.abort(); });
  const data = await page.evaluateHandle(() => { const transfer = new DataTransfer(); transfer.items.add(new File(['# 标题\n![外图](https://external.invalid/pixel.png)'], '说明.md', { type: 'text/markdown' })); return transfer; });
  await page.locator('form.composer').dispatchEvent('drop', { dataTransfer: data });
  await expect(page.getByRole('button', { name: '添加附件' })).toBeVisible();
  await expect(page.getByText('已保存到工作区', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '文件', exact: true }).click(); await page.getByRole('button', { name: '预览 说明.md' }).click();
  await expect(page.getByRole('region', { name: '说明.md 预览' })).toContainText('[图片：外图]'); expect(externalLoads).toBe(0); expect(app.sent).toHaveLength(0);
  await page.screenshot({ path: '/tmp/berserk-files-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 }); await page.screenshot({ path: '/tmp/berserk-files-mobile.png', fullPage: true });
});


test('historical references inspect only on demand, changed and missing files never imply preserved originals', async ({ page }) => {
  const app = await filesApi(page); app.contents.set('w1/旧资料.txt', '原文');
  app.sessions[0]!.messages = [{ id: 'historic', role: 'user', text: '分析此文件', attachments: [{ path: '旧资料.txt', name: '旧资料.txt', size: 6, hash: 'reference-hash' }] }];
  await page.reload(); await expect(page.getByRole('button', { name: '查看引用文件 旧资料.txt' })).toBeVisible(); expect(app.statusReads).toHaveLength(0);
  await page.getByRole('button', { name: '查看引用文件 旧资料.txt' }).click(); await expect(page.getByText('核对时文件与发送时一致。')).toBeVisible();
  app.contents.set('w1/旧资料.txt', '修改后的内容');
  await page.getByRole('button', { name: '查看引用文件 旧资料.txt' }).click(); await expect(page.getByText('文件已修改，下面链接为当前文件。')).toBeVisible();
  await expect(page.getByRole('link', { name: '下载当前文件', exact: true })).toHaveAttribute('href', '/api/workspaces/w1/files/content?path=%E6%97%A7%E8%B5%84%E6%96%99.txt');
  app.contents.delete('w1/旧资料.txt');
  await page.getByRole('button', { name: '查看引用文件 旧资料.txt' }).click(); await expect(page.getByText('此路径的文件已不可用，请重新选择文件。')).toBeVisible();
  await expect(page.getByRole('link', { name: '下载当前文件', exact: true })).toHaveCount(0); expect(app.statusReads).toHaveLength(3);
});


test('pending cancellation follows an attachment moved from project draft into a newly created session', async ({ page }) => {
  const app = await filesApi(page); app.controls.emptySecond = true;
  await page.reload(); await page.getByRole('button', { name: '进入项目：另一工作区' }).click();
  app.controls.hold = true; await attach(page); await expect.poll(() => Boolean(app.controls.release)).toBe(true);
  app.controls.holdDelete = true; await page.getByRole('button', { name: '取消上传 数据.csv' }).click();
  await expect.poll(() => Boolean(app.controls.releaseDelete)).toBe(true);
  await page.getByRole('button', { name: '在项目 另一工作区 中新建对话' }).click();
  await expect(page.getByRole('button', { name: '新对话', exact: true })).toBeVisible();
  await app.controls.releaseDelete!(); await expect(page.getByRole('list', { name: '消息附件' })).toBeEmpty();
  expect(app.sent).toHaveLength(0); expect(app.contents.size).toBe(0);
});
