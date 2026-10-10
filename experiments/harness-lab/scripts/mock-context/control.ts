import { createConnection } from 'node:net';

const path = process.env.MOCK_CONTEXT_CONTROL_SOCKET;
if (!path) throw new Error('请配置运行中的模拟服务使用的 MOCK_CONTEXT_CONTROL_SOCKET。');
const args = process.argv.slice(2);
if (!args.length) throw new Error('用法：control.ts reset | advance intel/situation/unknown/contract/recovery | event E1/E2/E3/E4 | unavailable intel/situation on/off | requests | status');
const result = await new Promise<string>((resolve, reject) => {
  const socket = createConnection(path); let body = '';
  socket.setTimeout(5_000, () => socket.destroy(new Error('模拟控制请求超时。')));
  socket.on('error', reject);
  socket.on('connect', () => socket.write(`${JSON.stringify(args)}\n`));
  socket.on('data', data => {body += data.toString('utf8'); if (body.length > 2_000_000) socket.destroy(new Error('控制响应过大。'));});
  socket.on('end', () => resolve(body));
});
process.stdout.write(result);
if (JSON.parse(result).error) process.exitCode = 1;
