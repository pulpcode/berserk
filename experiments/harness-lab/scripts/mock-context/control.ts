import { createConnection } from 'node:net';

const args = process.argv.slice(2);
if(args.length!==1||!['status','requests'].includes(args[0]))throw new Error('仅支持只读 status | requests。旧 reset/advance/event/unavailable 控制入口已停用；请以导演身份进入 /director，确认切换自由调试后在指定轮次中编辑或发送通知。');
const path = process.env.MOCK_CONTEXT_CONTROL_SOCKET;
if (!path) throw new Error('请配置运行中的模拟服务使用的 MOCK_CONTEXT_CONTROL_SOCKET。');
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
