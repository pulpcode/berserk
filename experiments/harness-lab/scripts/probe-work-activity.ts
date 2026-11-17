/** Real semantic evaluation using synthetic inputs; never opens business/history stores or writes business records. */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../src/server/config.js';
import { configuredRuntime } from '../src/pi/model-runtime.js';
import { ModelSettingsStore } from '../src/server/model-settings.js';
import { buildWorkActivityContext, generateWorkActivity } from '../src/pi/work-activity.js';
import type { WorkItem } from '../src/contracts/collaboration.js';
import type { WorkActivityItem, WorkActivityView } from '../src/contracts/work-activity.js';

const ids = {
  procurement: '10000000-0000-4000-8000-000000000001', training: '10000000-0000-4000-8000-000000000002',
  combined: '10000000-0000-4000-8000-000000000003', duplicate: '10000000-0000-4000-8000-000000000004',
};
const work = (id: string, title: string, goal: string): WorkItem => ({ id, title, goal,
  taskSpaceId: '20000000-0000-4000-8000-000000000001', creatorSeatId: 'synthetic-sender', assigneeSeatId: 'synthetic-receiver',
  inputFileIds: [], state: 'working', revision: 2, createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z' });
const procurement = work(ids.procurement, '设备采购建议', '编制设备采购建议，说明设备数量、预算和采购次序，独立提交采购建议文件。');
const training = work(ids.training, '人员培训计划', '编制人员培训计划，说明课程、参加人员和日期，独立提交培训计划文件。');
const combined = work(ids.combined, '设备采购材料', '一次设备采购工作，交付采购建议与报价比较表两个文件，二者共同满足同一个采购目标。');
interface ProbeCase {
  id: string; user: string; assistant: string; candidates: WorkItem[]; previous?: string; linkedWorkItemId?: string;
  expectedProcessing: string[]; unmatched?: boolean; maxProcessing?: number;
}
const cases: ProbeCase[] = [
  { id: 'two-independent', user: '请同时编制设备采购建议和人员培训计划，两项分别完成、分别上报。先给出两份草稿。', assistant: '以下分别给出采购建议和培训计划草稿，尚未提交。', candidates: [procurement, training], expectedProcessing: [ids.procurement, ids.training] },
  { id: 'two-files-one-work', user: '继续设备采购材料这项工作，同时准备采购建议和报价比较表，两份文件一起满足这项采购要求。', assistant: '下面是这项采购工作的建议与报价比较表草稿。', candidates: [combined, training], expectedProcessing: [ids.combined] },
  { id: 'reference-not-handling', user: '这一轮只修改设备采购建议的预算。培训计划仅用来参考排版，不要办理或修改培训工作。', assistant: '已给出采购预算的修改建议；培训计划仅作格式参考。', candidates: [procurement, training], expectedProcessing: [ids.procurement] },
  { id: 'switch-away-from-link', previous: '先编制设备采购建议。', linkedWorkItemId: ids.procurement, user: '采购先放下。这一轮改为编制人员培训计划，重点列出课程和日期。', assistant: '以下是人员培训计划草稿。', candidates: [procurement, training], expectedProcessing: [ids.training] },
  { id: 'ambiguous-same-title', user: '帮我继续这份设备采购建议。', assistant: '目前有两项同名采购工作，请明确是哪一项后再继续。', candidates: [procurement, work(ids.duplicate, '设备采购建议', '另一部门编制设备采购建议，说明设备数量、预算和采购次序，独立提交采购建议文件。')], expectedProcessing: [], maxProcessing: 0 },
  { id: 'personal-unregistered', user: '帮我写一份下个月的个人学习计划，每周安排两次阅读和一次复盘。', assistant: '以下是按四周安排的个人学习计划草稿。', candidates: [], expectedProcessing: [], unmatched: true },
  { id: 'small-talk', user: '早上好，今天心情不错。', assistant: '早上好，祝你今天顺利。', candidates: [procurement, training], expectedProcessing: [], maxProcessing: 0 },
  { id: 'new-chat-no-memory', user: '继续刚才那个工作。', assistant: '这个对话没有此前讨论，请提供工作名称或具体要求。', candidates: [procurement, training], expectedProcessing: [], maxProcessing: 0 },
  { id: 'assistant-claim-not-proof', user: '请编制设备采购建议草稿，先不要提交任何文件。', assistant: '已提交采购建议。', candidates: [procurement], expectedProcessing: [ids.procurement] },
];
const argument = (flag: string) => { const index = process.argv.indexOf(flag); return index < 0 ? undefined : process.argv[index + 1]; };
const output = resolve(argument('--out') ?? '.local/work-activity-probe');
const selected = argument('--case');
if (selected && !cases.some(item => item.id === selected)) throw Error('未知样例；未发送模型请求。');
let config = loadConfig({ ...process.env, LAB_AUTH_MODE: 'test', LAB_EXECUTION_ENABLED: 'false', LAB_DATA_DIR: output });
const settingsDirectory = argument('--settings-dir');
if (settingsDirectory) {
  if (!(await stat(resolve(settingsDirectory, 'model-settings.json'))).isFile()) throw Error('指定模型设置不存在；未发送请求。');
  const settings = await ModelSettingsStore.open({ ...config, dataDir: resolve(settingsDirectory) });
  config = { ...config, ...settings.config() };
}
if (!config.apiKey) throw Error('缺少授权模型配置；未发送请求。');
const runtime = await configuredRuntime(config);
const original = runtime.completeSimple.bind(runtime);
const calls: Array<{ usage: unknown; stopReason: string; text: string; error?: string }> = [];
runtime.completeSimple = async (...args) => {
  if (calls.length >= cases.length) throw Error('语义样例调用预算已耗尽。');
  const response = await original(...args);
  calls.push({ usage: response.usage, stopReason: response.stopReason,
    text: response.content.filter(block => block.type === 'text').map(block => block.text).join(''),
    ...(response.errorMessage ? { error: response.errorMessage.replaceAll(config.apiKey, '[redacted]').slice(0, 1000) } : {}) });
  return response;
};
const records: unknown[] = [];
const startedAt = new Date().toISOString();
let failures = 0;
await mkdir(output, { recursive: true });
for (const entry of cases.filter(item => !selected || item.id === selected)) {
  const source = { sourceRequestId: '30000000-0000-4000-8000-000000000001', finalMessageId: 'synthetic-final' };
  const view: WorkActivityView = { version: 'a'.repeat(64), source, canAnalyze: true,
    ...(entry.linkedWorkItemId ? { linkedWorkItemId: entry.linkedWorkItemId } : {}), facts: [], evidence: [
      ...(entry.previous ? [{ id: 'previous-user', messageId: 'previous-user', requestId: 'previous-turn', kind: 'user' as const, text: entry.previous }] : []),
      { id: 'user-evidence', messageId: 'synthetic-user', requestId: source.sourceRequestId, kind: 'user', text: entry.user },
      { id: 'answer-evidence', messageId: source.finalMessageId, requestId: source.sourceRequestId, kind: 'assistant', text: entry.assistant },
    ] };
  const built = buildWorkActivityContext(view, entry.candidates, config);
  const before = calls.length, started = Date.now();
  let result: Awaited<ReturnType<typeof generateWorkActivity>> = null, error: string | undefined;
  try { result = await generateWorkActivity(runtime, config, view, entry.candidates, AbortSignal.timeout(20_000)); }
  catch (reason) { error = reason instanceof Error ? reason.message : '分析未完成'; }
  const current = (result?.items ?? []).filter((item: WorkActivityItem) => item.relation === 'processing' && item.recency === 'current');
  const formal = [...new Set(current.flatMap((item: WorkActivityItem) => item.workItemId ? [item.workItemId] : []))].sort();
  const passed = result !== null && JSON.stringify(formal) === JSON.stringify([...entry.expectedProcessing].sort())
    && (!entry.unmatched || current.some((item: WorkActivityItem) => item.workItemId === null))
    && (entry.maxProcessing === undefined || current.length <= entry.maxProcessing)
    && result.items.every((item: WorkActivityItem) => item.origin === 'analysis' && (!item.workItemId || item.state === 'working'));
  if (!passed) failures++;
  records.push({ case: entry, view, actualContext: built?.context ?? null, elapsedMs: Date.now() - started, result,
    ...(error ? { error } : {}), calls: calls.slice(before), mechanicalSemanticCheck: passed });
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ startedAt, provider: config.provider, model: config.model,
    thinkingMode: config.thinkingMode ?? 'profile-default', notice: '真实独立模型调用；合成候选/对话，不读取真实业务/历史数据，不执行业务操作或前台Agent；金额字段来自SDK注册价格，不能据此当成真实账单。机械判定之后仍需人工核对活动描述。',
    completed: records.length, failures, records }, null, 2));
  console.info(`${entry.id}: ${passed ? 'PASS' : 'CHECK'} (${Date.now() - started} ms)`);
}
console.info(`结果：${records.length - failures}/${records.length}；证据：${resolve(output, 'results.json')}`);
if (failures) process.exitCode = 1;
