import { chmod, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createMockContextServer, type MockEventName, type MockStage } from './server.js';

const token = process.env.MOCK_CONTEXT_API_TOKEN;
if (!token) throw new Error('请配置 MOCK_CONTEXT_API_TOKEN。');
const mock = createMockContextServer({token});
const port = Number(process.env.MOCK_CONTEXT_PORT ?? 4401);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('MOCK_CONTEXT_PORT 无效。');
const url = await mock.listen(port);
const socketPath = process.env.MOCK_CONTEXT_CONTROL_SOCKET;
const control = createServer(socket => {
  let buffer = '', handled = false;
  socket.setTimeout(5_000, () => socket.destroy());
  socket.on('data', data => {
    if (handled) return;
    buffer += data.toString('utf8'); if (buffer.length > 8192) { socket.destroy(); return; }
    if (!buffer.includes('\n')) return; handled = true;
    try {
      const args: unknown = JSON.parse(buffer.trim());
      if (!Array.isArray(args) || args.some(item => typeof item !== 'string')) throw new Error('无效控制指令。');
      const [action, value, enabled] = args as string[];
      let result: unknown = {ok: true};
      if (action === 'reset') mock.reset();
      else if (action === 'advance' && ['intel', 'situation', 'unknown', 'contract'].includes(value)) mock.advance(value as MockStage);
      else if (action === 'unavailable' && ['intel', 'situation'].includes(value) && ['on', 'off'].includes(enabled)) mock.setUnavailable(value as 'intel' | 'situation', enabled === 'on');
      else if (action === 'event' && ['E1', 'E2', 'E3'].includes(value)) result = mock.event(value as MockEventName);
      else if (action === 'requests') result = mock.requests;
      else if (action === 'status') result = {url, changeCursor: mock.snapshot().changeCursor};
      else throw new Error('无效控制指令。');
      socket.end(`${JSON.stringify(result)}\n`);
    } catch { socket.end(`${JSON.stringify({error: '模拟控制指令无效。'})}\n`); }
  });
});
if (socketPath) {
  if (!socketPath.startsWith('/')) throw new Error('MOCK_CONTEXT_CONTROL_SOCKET 必须是绝对路径。');
  await new Promise<void>((resolve, reject) => { control.once('error', reject); control.listen(socketPath, () => {control.removeListener('error', reject); resolve(); }); });
  await chmod(socketPath, 0o600);
}
console.info(`模拟业务查询服务：${url}；控制入口${socketPath ? '为本机 Unix socket' : '未启用'}。`);
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  if (socketPath) { await new Promise<void>(resolve => control.close(() => resolve())); await unlink(socketPath).catch(() => {}); }
  await mock.close();
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
