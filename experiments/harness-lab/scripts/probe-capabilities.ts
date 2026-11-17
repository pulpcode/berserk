/** R1 live-provider acceptance. Uses synthetic fixtures and a fresh data root only. */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiLab } from '../src/pi/lab.js';
import { loadConfig } from '../src/server/config.js';
import type { SessionSnapshot } from '../src/contracts/index.js';

const config = loadConfig({ ...process.env, LAB_AUTH_MODE: 'test', LAB_EXECUTION_ENABLED: 'false' });
assert.ok(config.apiKey, '请配置已有测试模型凭证。');
config.dataDir = await mkdtemp(join(tmpdir(), 'axon-capabilities-live-'));
config.seatId = 'test-seat';
config.testSeats = undefined;
config.agentRunTimeoutMs = 180_000;
let lab = await PiLab.create(config);
const snapshots: SessionSnapshot[] = [];
const checks: string[] = [];
let failure: string | undefined;

try {
  const [expert] = await lab.capabilities.list();
  assert.equal(expert.expertId, 'synthesis-expert');
  const session = await lab.createSession(undefined, 'test-seat', undefined, undefined, undefined,
    { expertRef: expert, expectedDigest: expert.digest, clientActionId: crypto.randomUUID() });
  assert.equal(session.messages.length, 0);
  checks.push('专业专家创建空会话');
  const ask = async (text: string, skillId: string) => {
    const fixed = (await lab.capabilities.resolve(expert, expert.digest)).skills.find(skill => skill.id === skillId)!;
    const request = lab.start(session.id, text, { skill: { id: fixed.id, hash: fixed.hash } });
    await request.run(event => {
      if (event.type === 'interaction.updated' && event.interaction.status === 'pending') lab.cancel(session.id, request.requestId);
    });
    const snapshot = lab.get(session.id); snapshots.push(snapshot);
    assert.equal(snapshot.lastResult?.status, 'succeeded', snapshot.lastResult?.message);
    assert.equal(snapshot.expert?.revisionId, expert.revisionId);
    assert.ok(snapshot.messages.some(message => message.role === 'assistant' && message.requestId === request.requestId && message.text.trim()));
    return snapshot;
  };
  const first = await ask('请实际读取当前工作区的项目讨论纪要和资源约束资料，按我选择的资料综合方法，给出活动目标、资源约束、冲突和待确认项。引用实际读取的来源，不修改文件或指令。', 'synthesis');
  assert.ok(first.messages.some(message => message.role === 'tool' && message.toolName === 'source.read' && !message.isError), '未实际读取受控资料');
  checks.push('真实模型读取资料并使用固定综合方法');
  await ask('请按我选择的结果检查方法复核上一轮结论，明确哪些结论有原文依据、哪些仍待确认；不要把推断说成事实。', 'review');
  checks.push('同专家多轮及固定复核方法');
  await lab.close();
  lab = await PiLab.create(config);
  assert.equal(lab.get(session.id).expert?.revisionId, expert.revisionId);
  await ask('延续上文，给我一份简短的下一步核实清单，保留资料中的不确定性。', 'review');
  checks.push('进程实例重建后原修订续聊');
} catch (error) { failure = error instanceof Error ? error.message : '验证失败。'; }
finally {
  const report = { checks, ...(failure ? { failure } : {}), dataDir: config.dataDir,
    model: config.model, snapshots, capabilityLoads: lab.capabilities.metrics(), executionTimings: lab.capabilityTimings,
    docker: '未执行：本探针不替代 Docker 与真实文件/确认验证。' };
  await writeFile(join(config.dataDir, 'capability-probe.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  await lab.close();
  console.info(JSON.stringify({ checks, ...(failure ? { failure } : {}), evidence: join(config.dataDir, 'capability-probe.json') }));
}
if (failure) process.exitCode = 1;
