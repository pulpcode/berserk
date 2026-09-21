import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { PiLab } from '../src/pi/lab.js';
import { loadConfig } from '../src/server/config.js';
import type { SessionSnapshot, StreamEvent } from '../src/contracts/index.js';

const config = loadConfig({...process.env,LAB_AUTH_MODE:'test'});
if (!config.apiKey) throw new Error('请先在 .env.local 配置 LLM_API_KEY；未发送任何模型请求。');
const selected = process.argv.includes('--case') ? process.argv[process.argv.indexOf('--case') + 1] : 'all';
if (!['all', 'C01', 'C02', 'C03', 'C04', 'C05'].includes(selected)) throw new Error('支持 --case C01～C05；C06 通过本地检查与集成测试验证。');
const dir = join(config.dataDir, 'probes', new Date().toISOString().replace(/[:.]/g, '-'));
config.dataDir = dir;
let lab = await PiLab.create(config);
const evidence: Array<{ case: string; sessionId: string; requestId: string; input: string; result: SessionSnapshot; eventTypes: string[] }> = [];
let currentCase = '';
async function prompt(sessionId: string, text: string, cancel = false) {
  const events: StreamEvent[] = [];
  const request = lab.start(sessionId, text);
  let didCancel = false;
  await request.run(event => {
    events.push(event);
    if (cancel && !didCancel && event.type === 'text.delta') {
      didCancel = true;
      lab.cancel(sessionId, request.requestId);
    }
  });
  const result = lab.get(sessionId);
  evidence.push({ case: currentCase, sessionId, requestId: request.requestId, input: text, result, eventTypes: events.map(event => event.type) });
  assert.equal(result.lastResult?.status, cancel ? 'cancelled' : 'succeeded', result.lastResult?.message);
  if (cancel) assert.ok(didCancel, '未观测到流式输出，不能把取消记为通过');
  console.info(`${currentCase} ${request.requestId}: ${result.lastResult?.status}`);
  return result;
}
const answer = (snapshot: SessionSnapshot) => snapshot.messages.filter(message => message.role === 'assistant').at(-1)?.text || '';
try {
  for (const code of ['C01', 'C02', 'C03', 'C04', 'C05']) {
    if (selected !== 'all' && selected !== code) continue;
    currentCase = code;
    const session = await lab.createSession();
    if (code === 'C01') {
      await prompt(session.id, '请记住：本会话的项目代号为青松，会议时长为60分钟。请简短确认。');
      assert.match(answer(await prompt(session.id, '纠正一下：时长改为45分钟，代号不变。请复述最新信息。')), /45|四十五/);
      const result = await prompt(session.id, '请只回答项目代号和最新会议时长。');
      assert.match(answer(result), /青松/); assert.match(answer(result), /45|四十五/);
    } else if (code === 'C02') {
      const result = await prompt(session.id, '请实际读取 meeting-notes 资料，列出首次培训时长、人数和交付物，注明来源。');
      assert.ok(result.messages.some(message => message.role === 'tool' && message.toolName === 'source.read' && message.text.includes('meeting-notes')));
      assert.match(answer(await prompt(session.id, '按刚读过的资料，培训总时长是多少分钟？只回答数字。')), /90|九十/);
    } else if (code === 'C03') {
      await prompt(session.id, '此会话代号为银杏，请记住并简短确认。');
      const second = await lab.createSession();
      await prompt(second.id, '此会话代号为白桦，请记住并简短确认。');
      const a = answer(await prompt(session.id, '本会话代号是什么？只回答代号。'));
      const b = answer(await prompt(second.id, '本会话代号是什么？只回答代号。'));
      assert.match(a, /银杏/); assert.doesNotMatch(a, /白桦/);
      assert.match(b, /白桦/); assert.doesNotMatch(b, /银杏/);
    } else if (code === 'C04') {
      await prompt(session.id, '请写一份详细的三千字通用学习计划，持续展开每个章节。', true);
      await prompt(session.id, '停止之前的计划，请只回复：可以继续。');
    } else if (code === 'C05') {
      await prompt(session.id, '请记住恢复测试代号为云杉，目标人数17人。简短确认。');
      await lab.close();
      lab = await PiLab.create(config);
      const result = await prompt(session.id, '刚才的恢复测试代号和目标人数是什么？');
      assert.match(answer(result), /云杉/); assert.match(answer(result), /17|十七/);
    }
  }
} finally {
  await lab.close();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'evidence.json'), JSON.stringify({
    model: config.model, provider: config.provider, baseUrl: config.baseUrl, thinking: 'disabled',
    pi: '0.85.1', date: new Date().toISOString(),
    note: '真实模型证据；C05 在此脚本中重建运行时。完整进程重启和页面行为另行检查，不由本脚本替代。', evidence,
  }, null, 2), { mode: 0o600 });
  console.info(`证据已保存到 ${join(dir, 'evidence.json')}`);
}
