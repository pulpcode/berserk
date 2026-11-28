import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PiLab } from '../../src/pi/lab.js';
import type { ContextEvalStrategy } from '../../src/pi/context-eval-strategy.js';
import { loadServerConfig, type LabConfig } from '../../src/server/config.js';
import type { ModelApi, ModelThinkingMode, SessionSnapshot } from '../../src/contracts/index.js';
import {
  SYNTHETIC_RULES,
  assertClearedNoDecoration,
  assertClearedRuleExplanation,
  assertStrictLeadingPrefix,
  assertWorkspaceMinimalEdit,
  type AssertionResult,
} from './assertions.js';
import { BudgetGuard, cacheHitRatio, inspectWirePayload, type WirePayloadAudit } from './wire-capture.js';

interface TargetModelSpec {
  key: 'deepseek' | 'kimi';
  label: string;
  provider: string;
  api: ModelApi;
  baseUrl: string;
  model: string;
  apiKey: string;
  thinkingMode?: ModelThinkingMode;
  thinkingLevels?: ModelThinkingMode[];
  defaultThinkingLevel?: ModelThinkingMode;
  thinkingLevelMap?: Partial<Record<ModelThinkingMode, string | null>>;
  compat?: Record<string, unknown>;
  contextWindow: number;
  maxOutputTokens: number;
}

interface TurnEvidence {
  turn: string;
  prompt: string;
  answer: string;
  status: string;
  assertion: AssertionResult;
  wireCount: number;
  wireSummary: WirePayloadAudit[];
}

interface ScenarioResult {
  scenario: string;
  runIndex: number;
  modelKey: string;
  strategy: ContextEvalStrategy;
  passed: boolean;
  turns: TurnEvidence[];
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; modelAttempts: number };
  nativeHistoryClean: boolean;
  error?: string;
}

const FINGERPRINTS = [
  SYNTHETIC_RULES.R1_PREFIX,
  SYNTHETIC_RULES.R2_PREFIX,
  SYNTHETIC_RULES.R4_PREFIX,
  '工作区格式约定',
  '<host_request_instructions>',
  '<system-reminder>',
];

function parseArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function lastAssistantText(snapshot: SessionSnapshot): string {
  return snapshot.messages.filter(msg => msg.role === 'assistant').at(-1)?.text ?? '';
}

function loadTargetModels(): TargetModelSpec[] {
  const sharedArkKey = process.env.EVAL_ARK_API_KEY ?? '';
  const dsKey = process.env.EVAL_DEEPSEEK_API_KEY ?? sharedArkKey;
  const kimiKey = process.env.EVAL_KIMI_API_KEY ?? sharedArkKey;
  const models: TargetModelSpec[] = [];

  if (dsKey) {
    models.push({
      key: 'deepseek',
      label: process.env.EVAL_DEEPSEEK_LABEL ?? 'DeepSeek (Ark/OpenAI)',
      provider: process.env.EVAL_DEEPSEEK_PROVIDER ?? 'deepseek',
      api: (process.env.EVAL_DEEPSEEK_API as ModelApi | undefined) ?? 'openai-completions',
      baseUrl: process.env.EVAL_DEEPSEEK_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/plan/v3',
      model: process.env.EVAL_DEEPSEEK_MODEL ?? 'deepseek-v4.1-flash',
      apiKey: dsKey,
      thinkingMode: (process.env.EVAL_DEEPSEEK_THINKING as ModelThinkingMode | undefined) ?? 'off',
      thinkingLevels: ['off', 'high'],
      defaultThinkingLevel: 'off',
      contextWindow: Number(process.env.EVAL_DEEPSEEK_CONTEXT_WINDOW ?? 131072),
      maxOutputTokens: Number(process.env.EVAL_DEEPSEEK_MAX_OUTPUT ?? 2048),
    });
  }

  if (kimiKey) {
    const kimiApi = (process.env.EVAL_KIMI_API as ModelApi | undefined) ?? 'anthropic-messages';
    models.push({
      key: 'kimi',
      label: process.env.EVAL_KIMI_LABEL ?? 'Kimi (Ark/Anthropic)',
      provider: process.env.EVAL_KIMI_PROVIDER ?? 'kimi-coding',
      api: kimiApi,
      baseUrl: process.env.EVAL_KIMI_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/coding',
      model: process.env.EVAL_KIMI_MODEL ?? 'kimi-k2.5',
      apiKey: kimiKey,
      thinkingMode: process.env.EVAL_KIMI_THINKING as ModelThinkingMode | undefined,
      compat: kimiApi === 'anthropic-messages'
        ? { allowEmptySignature: true, supportsEagerToolInputStreaming: false, supportsCacheControlOnTools: false }
        : undefined,
      contextWindow: Number(process.env.EVAL_KIMI_CONTEXT_WINDOW ?? 131072),
      maxOutputTokens: Number(process.env.EVAL_KIMI_MAX_OUTPUT ?? 4096),
    });
  }
  return models;
}

function buildLabConfig(dir: string, spec: TargetModelSpec, overrides: Partial<LabConfig> = {}): LabConfig {
  const base = loadServerConfig({
    LAB_AUTH_MODE: 'test',
    LAB_DATA_DIR: dir,
    LLM_PROVIDER: spec.provider,
    LLM_MODEL: spec.model,
    LLM_BASE_URL: spec.baseUrl,
    LLM_API: spec.api,
    LLM_CONTEXT_WINDOW: String(spec.contextWindow),
    LLM_MAX_OUTPUT_TOKENS: String(spec.maxOutputTokens),
    LLM_REQUEST_TIMEOUT_MS: String(Number(process.env.EVAL_REQUEST_TIMEOUT_MS ?? 60000)),
    HTTP_IDLE_TIMEOUT_MS: String(Number(process.env.EVAL_IDLE_TIMEOUT_MS ?? 60000)),
    COMPACTION_RESERVE_TOKENS: String(overrides.compactionReserveTokens ?? 4096),
    COMPACTION_KEEP_RECENT_TOKENS: String(overrides.compactionKeepRecentTokens ?? 4096),
  });
  return {
    ...base,
    api: spec.api,
    apiKey: spec.apiKey,
    thinkingMode: spec.thinkingMode,
    thinkingLevels: spec.thinkingLevels,
    defaultThinkingLevel: spec.defaultThinkingLevel,
    thinkingLevelMap: spec.thinkingLevelMap,
    compat: spec.compat as LabConfig['compat'],
    ...overrides,
  };
}

async function checkNativeHistoryClean(dataDir: string): Promise<boolean> {
  const files = await readdir(join(dataDir, 'sessions'));
  for (const file of files) {
    const raw = await readFile(join(dataDir, 'sessions', file), 'utf8');
    if (raw.includes('<host_request_instructions>') || raw.includes('<system-reminder>')) return false;
  }
  return true;
}

async function withCapturedFetch<T>(
  guard: BudgetGuard,
  secrets: ReadonlyArray<string>,
  fn: (audits: WirePayloadAudit[]) => Promise<T>,
): Promise<{ result: T; audits: WirePayloadAudit[] }> {
  const audits: WirePayloadAudit[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const bodyText = await request.clone().text();
    guard.assertCanRequest(request.url);
    if (bodyText.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(bodyText) as Record<string, unknown>;
        audits.push(inspectWirePayload(audits.length, request.url, parsed, FINGERPRINTS, secrets));
      } catch { /* ignore non-JSON body */ }
    }
    return originalFetch(request);
  }) as typeof globalThis.fetch;
  try {
    const result = await fn(audits);
    return { result, audits };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runCoreChainS1S2S3(
  spec: TargetModelSpec,
  strategy: ContextEvalStrategy,
  runIndex: number,
  guard: BudgetGuard,
): Promise<ScenarioResult> {
  const dir = await mkdtemp(join(tmpdir(), `berserk-ctx-s123-${spec.key}-${strategy}-`));
  const turns: TurnEvidence[] = [];
  const usageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, modelAttempts: 0 };
  try {
    const { audits } = await withCapturedFetch(guard, [spec.apiKey], async captured => {
      const lab = await PiLab.create(buildLabConfig(dir, spec));
      lab.contextEvalStrategy = strategy;
      try {
        const session = await lab.createSession();
        const setWs = async (content: string) => {
          const cur = await lab.resources.readInstruction(session.workspaceId, 'workspace');
          await lab.resources.updateInstruction(session.workspaceId, 'workspace', content, cur.hash);
        };

        const runTurn = async (turn: string, prompt: string, check: (answer: string) => AssertionResult) => {
          const before = captured.length;
          await lab.start(session.id, prompt).run(() => {});
          const snap = lab.get(session.id);
          const ans = lastAssistantText(snap);
          const u = snap.lastResult?.usageSummary;
          if (u) {
            usageTotals.modelAttempts += u.modelAttempts;
            if (u.actual) {
              usageTotals.input += u.actual.input;
              usageTotals.output += u.actual.output;
              usageTotals.cacheRead += u.actual.cacheRead;
              usageTotals.cacheWrite += u.actual.cacheWrite;
              usageTotals.totalTokens += u.actual.totalTokens;
            }
            guard.record(u.actual ?? null);
          }
          turns.push({
            turn,
            prompt,
            answer: ans,
            status: snap.lastResult?.status ?? 'unknown',
            assertion: snap.lastResult?.status === 'succeeded' ? check(ans) : { passed: false, reasons: [`请求未成功: ${snap.lastResult?.message ?? snap.lastResult?.status}`] },
            wireCount: captured.length - before,
            wireSummary: captured.slice(before),
          });
        };

        await setWs(SYNTHETIC_RULES.R1_CONTENT);
        await runTurn('S1-T1(初始R1)', '用两句话介绍太阳系中最大的行星。', ans => assertStrictLeadingPrefix(ans, SYNTHETIC_RULES.R1_PREFIX, [SYNTHETIC_RULES.R2_PREFIX, SYNTHETIC_RULES.R4_PREFIX]));
        await runTurn('S1-T2(续聊R1)', '它有几颗最著名的伽利略卫星？简短回答。', ans => assertStrictLeadingPrefix(ans, SYNTHETIC_RULES.R1_PREFIX, [SYNTHETIC_RULES.R2_PREFIX, SYNTHETIC_RULES.R4_PREFIX]));

        await setWs(SYNTHETIC_RULES.R2_CONTENT);
        await runTurn('S2-T1(替换R2首轮)', '用两句话介绍火星为什么呈现红色。', ans => assertStrictLeadingPrefix(ans, SYNTHETIC_RULES.R2_PREFIX, [SYNTHETIC_RULES.R1_PREFIX, SYNTHETIC_RULES.R4_PREFIX]));
        await runTurn('S2-T2(替换R2次轮)', '火星目前有几颗天然卫星？简短回答。', ans => assertStrictLeadingPrefix(ans, SYNTHETIC_RULES.R2_PREFIX, [SYNTHETIC_RULES.R1_PREFIX, SYNTHETIC_RULES.R4_PREFIX]));

        await setWs(SYNTHETIC_RULES.R3_CONTENT);
        await runTurn('S3-T1(清空后问答)', '用两句话说明地球自转和公转分别带来什么现象。', ans => assertClearedNoDecoration(ans));
        await runTurn('S3-T2(清空后追问约定)', '请问当前工作区还有没有要求回答必须带特定格式前缀的约定？直接如实回答。', ans => assertClearedRuleExplanation(ans));
      } finally {
        await lab.close();
      }
    });
    const clean = await checkNativeHistoryClean(dir);
    void audits;
    return {
      scenario: 'S1-S2-S3',
      runIndex,
      modelKey: spec.key,
      strategy,
      passed: clean && turns.every(t => t.assertion.passed),
      turns,
      usage: usageTotals,
      nativeHistoryClean: clean,
    };
  } catch (error) {
    return {
      scenario: 'S1-S2-S3',
      runIndex,
      modelKey: spec.key,
      strategy,
      passed: false,
      turns,
      usage: usageTotals,
      nativeHistoryClean: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runScenarioS4(
  spec: TargetModelSpec,
  strategy: ContextEvalStrategy,
  guard: BudgetGuard,
): Promise<ScenarioResult> {
  const dir = await mkdtemp(join(tmpdir(), `berserk-ctx-s4-${spec.key}-${strategy}-`));
  const turns: TurnEvidence[] = [];
  const usageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, modelAttempts: 0 };
  try {
    await withCapturedFetch(guard, [spec.apiKey], async captured => {
      const lab = await PiLab.create(buildLabConfig(dir, spec));
      lab.contextEvalStrategy = strategy;
      try {
        const session = await lab.createSession();
        const common = await lab.resources.readInstruction(session.workspaceId, 'common');
        const ws0 = await lab.resources.readInstruction(session.workspaceId, 'workspace');
        await lab.resources.updateInstruction(session.workspaceId, 'workspace', SYNTHETIC_RULES.R1_CONTENT, ws0.hash);

        const before1 = captured.length;
        await lab.start(session.id, `请帮我更新当前工作区指令文件（workspace），改为：${SYNTHETIC_RULES.R4_CONTENT}。只修改工作区约定，不要复制通用指令。`).run(() => {});
        const snap1 = lab.get(session.id);
        const ans1 = lastAssistantText(snap1);
        const wsAfter = await lab.resources.readInstruction(session.workspaceId, 'workspace');
        const editCheck = assertWorkspaceMinimalEdit(wsAfter.content, common.content, SYNTHETIC_RULES.R4_PREFIX, [SYNTHETIC_RULES.R1_PREFIX]);
        const sameTurnCheck = assertStrictLeadingPrefix(ans1, SYNTHETIC_RULES.R1_PREFIX, [SYNTHETIC_RULES.R4_PREFIX]);
        const u1 = snap1.lastResult?.usageSummary;
        if (u1) {
          usageTotals.modelAttempts += u1.modelAttempts;
          if (u1.actual) {
            usageTotals.input += u1.actual.input; usageTotals.output += u1.actual.output;
            usageTotals.cacheRead += u1.actual.cacheRead; usageTotals.cacheWrite += u1.actual.cacheWrite;
            usageTotals.totalTokens += u1.actual.totalTokens;
          }
          guard.record(u1.actual ?? null);
        }
        turns.push({
          turn: 'S4-T1(同轮写入并遵守旧R1)',
          prompt: '更新工作区指令为 R4',
          answer: ans1,
          status: snap1.lastResult?.status ?? 'unknown',
          assertion: { passed: editCheck.passed && sameTurnCheck.passed, reasons: [...editCheck.reasons, ...sameTurnCheck.reasons] },
          wireCount: captured.length - before1,
          wireSummary: captured.slice(before1),
        });

        const before2 = captured.length;
        await lab.start(session.id, '用一句话介绍海王星。').run(() => {});
        const snap2 = lab.get(session.id);
        const ans2 = lastAssistantText(snap2);
        const u2 = snap2.lastResult?.usageSummary;
        if (u2) {
          usageTotals.modelAttempts += u2.modelAttempts;
          if (u2.actual) {
            usageTotals.input += u2.actual.input; usageTotals.output += u2.actual.output;
            usageTotals.cacheRead += u2.actual.cacheRead; usageTotals.cacheWrite += u2.actual.cacheWrite;
            usageTotals.totalTokens += u2.actual.totalTokens;
          }
          guard.record(u2.actual ?? null);
        }
        turns.push({
          turn: 'S4-T2(下轮生效R4)',
          prompt: '用一句话介绍海王星。',
          answer: ans2,
          status: snap2.lastResult?.status ?? 'unknown',
          assertion: assertStrictLeadingPrefix(ans2, SYNTHETIC_RULES.R4_PREFIX, [SYNTHETIC_RULES.R1_PREFIX, SYNTHETIC_RULES.R2_PREFIX]),
          wireCount: captured.length - before2,
          wireSummary: captured.slice(before2),
        });
      } finally {
        await lab.close();
      }
    });
    const clean = await checkNativeHistoryClean(dir);
    return { scenario: 'S4', runIndex: 1, modelKey: spec.key, strategy, passed: clean && turns.every(t => t.assertion.passed), turns, usage: usageTotals, nativeHistoryClean: clean };
  } catch (error) {
    return { scenario: 'S4', runIndex: 1, modelKey: spec.key, strategy, passed: false, turns, usage: usageTotals, nativeHistoryClean: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runScenarioS5(
  spec: TargetModelSpec,
  strategy: ContextEvalStrategy,
  guard: BudgetGuard,
): Promise<ScenarioResult> {
  const dir = await mkdtemp(join(tmpdir(), `berserk-ctx-s5-${spec.key}-${strategy}-`));
  const turns: TurnEvidence[] = [];
  const usageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, modelAttempts: 0 };
  try {
    await withCapturedFetch(guard, [spec.apiKey], async captured => {
      const lab = await PiLab.create(buildLabConfig(dir, spec));
      lab.contextEvalStrategy = strategy;
      try {
        const session = await lab.createSession();
        const ws0 = await lab.resources.readInstruction(session.workspaceId, 'workspace');
        await lab.resources.updateInstruction(session.workspaceId, 'workspace', SYNTHETIC_RULES.R2_CONTENT, ws0.hash);
        const info = await lab.resources.info(session.workspaceId);
        const sourceIds = info.sources.map(s => s.id);

        const before1 = captured.length;
        const req = lab.start(session.id, `请先用 source_read 依次读取资料 ${sourceIds.join(' 和 ')}，然后用两句话总结它们的核心主题。`);
        let mutatedMidRequest = false;
        await req.run(event => {
          if (!mutatedMidRequest && event.type === 'tool.completed') {
            mutatedMidRequest = true;
            void lab.resources.readInstruction(session.workspaceId, 'workspace')
              .then(cur => lab.resources.updateInstruction(session.workspaceId, 'workspace', SYNTHETIC_RULES.R1_CONTENT, cur.hash))
              .then(() => {
                try {
                  lab.submitInput(session.id, { submissionId: 's5-followup-1', expectedRequestId: req.requestId, mode: 'followUp', text: '补充一句：顺便列出你刚才读到的资料名称。' });
                } catch { /* ignore if already finalizing */ }
              });
          }
        });
        const snap1 = lab.get(session.id);
        const ans1 = lastAssistantText(snap1);
        const u1 = snap1.lastResult?.usageSummary;
        if (u1) {
          usageTotals.modelAttempts += u1.modelAttempts;
          if (u1.actual) {
            usageTotals.input += u1.actual.input; usageTotals.output += u1.actual.output;
            usageTotals.cacheRead += u1.actual.cacheRead; usageTotals.cacheWrite += u1.actual.cacheWrite;
            usageTotals.totalTokens += u1.actual.totalTokens;
          }
          guard.record(u1.actual ?? null);
        }
        const noDupReminder = captured.slice(before1).every(w => w.hostReminderCount <= 1 && w.systemReminderCount <= 1);
        const check1 = assertStrictLeadingPrefix(ans1, SYNTHETIC_RULES.R2_PREFIX, [SYNTHETIC_RULES.R1_PREFIX]);
        turns.push({
          turn: 'S5-T1(多步工具+followUp锁定R2)',
          prompt: '多步工具读取 + 中途改盘为 R1 + followUp',
          answer: ans1,
          status: snap1.lastResult?.status ?? 'unknown',
          assertion: { passed: check1.passed && noDupReminder, reasons: [...check1.reasons, ...(noDupReminder ? [] : ['多步工具续轮中出现提醒累计'])] },
          wireCount: captured.length - before1,
          wireSummary: captured.slice(before1),
        });

        const before2 = captured.length;
        await lab.start(session.id, '用一句话介绍土星光环。').run(() => {});
        const snap2 = lab.get(session.id);
        const ans2 = lastAssistantText(snap2);
        const u2 = snap2.lastResult?.usageSummary;
        if (u2) {
          usageTotals.modelAttempts += u2.modelAttempts;
          if (u2.actual) {
            usageTotals.input += u2.actual.input; usageTotals.output += u2.actual.output;
            usageTotals.cacheRead += u2.actual.cacheRead; usageTotals.cacheWrite += u2.actual.cacheWrite;
            usageTotals.totalTokens += u2.actual.totalTokens;
          }
          guard.record(u2.actual ?? null);
        }
        turns.push({
          turn: 'S5-T2(下轮独立请求切到R1)',
          prompt: '用一句话介绍土星光环。',
          answer: ans2,
          status: snap2.lastResult?.status ?? 'unknown',
          assertion: assertStrictLeadingPrefix(ans2, SYNTHETIC_RULES.R1_PREFIX, [SYNTHETIC_RULES.R2_PREFIX]),
          wireCount: captured.length - before2,
          wireSummary: captured.slice(before2),
        });
      } finally {
        await lab.close();
      }
    });
    const clean = await checkNativeHistoryClean(dir);
    return { scenario: 'S5', runIndex: 1, modelKey: spec.key, strategy, passed: clean && turns.every(t => t.assertion.passed), turns, usage: usageTotals, nativeHistoryClean: clean };
  } catch (error) {
    return { scenario: 'S5', runIndex: 1, modelKey: spec.key, strategy, passed: false, turns, usage: usageTotals, nativeHistoryClean: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runScenarioS6Compaction(
  spec: TargetModelSpec,
  strategy: ContextEvalStrategy,
  runIndex: number,
  guard: BudgetGuard,
): Promise<ScenarioResult> {
  const dir = await mkdtemp(join(tmpdir(), `berserk-ctx-s6-${spec.key}-${strategy}-`));
  const turns: TurnEvidence[] = [];
  const usageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, modelAttempts: 0 };
  try {
    await withCapturedFetch(guard, [spec.apiKey], async captured => {
      // Deliberately tighten contextWindow/compaction thresholds so native Pi compaction triggers reliably in ~3-4 turns.
      const lab = await PiLab.create(buildLabConfig(dir, spec, {
        contextWindow: 14000,
        maxOutputTokens: spec.key === 'kimi' ? 2560 : 1536,
        compactionReserveTokens: 6500,
        compactionKeepRecentTokens: 1500,
      }));
      lab.contextEvalStrategy = strategy;
      try {
        const session = await lab.createSession();
        const setWs = async (content: string) => {
          const cur = await lab.resources.readInstruction(session.workspaceId, 'workspace');
          await lab.resources.updateInstruction(session.workspaceId, 'workspace', content, cur.hash);
        };
        await setWs(SYNTHETIC_RULES.R1_CONTENT);

        const filler = '合成背景材料片段：'.repeat(300);
        for (let i = 1; i <= 3; i++) {
          const before = captured.length;
          await lab.start(session.id, `第${i}段长文本整理（请用简短两句话概括要点）：${filler} 编号-${i}`).run(() => {});
          const snap = lab.get(session.id);
          const u = snap.lastResult?.usageSummary;
          if (u) {
            usageTotals.modelAttempts += u.modelAttempts;
            if (u.actual) {
              usageTotals.input += u.actual.input; usageTotals.output += u.actual.output;
              usageTotals.cacheRead += u.actual.cacheRead; usageTotals.cacheWrite += u.actual.cacheWrite;
              usageTotals.totalTokens += u.actual.totalTokens;
            }
            guard.record(u.actual ?? null);
          }
          turns.push({
            turn: `S6-预热${i}(R1)`,
            prompt: `长文本预热-${i}`,
            answer: lastAssistantText(snap),
            status: snap.lastResult?.status ?? 'unknown',
            assertion: assertStrictLeadingPrefix(lastAssistantText(snap), SYNTHETIC_RULES.R1_PREFIX, [SYNTHETIC_RULES.R2_PREFIX]),
            wireCount: captured.length - before,
            wireSummary: captured.slice(before),
          });
        }

        // Switch to R2, push another large turn to guarantee compaction, then continue chatting post-compaction.
        await setWs(SYNTHETIC_RULES.R2_CONTENT);
        const beforeComp = captured.length;
        await lab.start(session.id, `请继续简短概括以下新材料：${filler} 触发压缩-4`).run(() => {});
        const snapComp = lab.get(session.id);
        const uComp = snapComp.lastResult?.usageSummary;
        if (uComp) {
          usageTotals.modelAttempts += uComp.modelAttempts;
          if (uComp.actual) {
            usageTotals.input += uComp.actual.input; usageTotals.output += uComp.actual.output;
            usageTotals.cacheRead += uComp.actual.cacheRead; usageTotals.cacheWrite += uComp.actual.cacheWrite;
            usageTotals.totalTokens += uComp.actual.totalTokens;
          }
          guard.record(uComp.actual ?? null);
        }
        turns.push({
          turn: 'S6-切换R2与压缩',
          prompt: '触发原生压缩并切R2',
          answer: lastAssistantText(snapComp),
          status: snapComp.lastResult?.status ?? 'unknown',
          assertion: assertStrictLeadingPrefix(lastAssistantText(snapComp), SYNTHETIC_RULES.R2_PREFIX, [SYNTHETIC_RULES.R1_PREFIX]),
          wireCount: captured.length - beforeComp,
          wireSummary: captured.slice(beforeComp),
        });

        const beforePost = captured.length;
        await lab.start(session.id, '压缩后续聊：用两句话介绍金星的温室效应。').run(() => {});
        const snapPost = lab.get(session.id);
        const ansPost = lastAssistantText(snapPost);
        const hasCompaction = Boolean(snapPost.latestCompaction);
        const checkPost = assertStrictLeadingPrefix(ansPost, SYNTHETIC_RULES.R2_PREFIX, [SYNTHETIC_RULES.R1_PREFIX]);
        const uPost = snapPost.lastResult?.usageSummary;
        if (uPost) {
          usageTotals.modelAttempts += uPost.modelAttempts;
          if (uPost.actual) {
            usageTotals.input += uPost.actual.input; usageTotals.output += uPost.actual.output;
            usageTotals.cacheRead += uPost.actual.cacheRead; usageTotals.cacheWrite += uPost.actual.cacheWrite;
            usageTotals.totalTokens += uPost.actual.totalTokens;
          }
          guard.record(uPost.actual ?? null);
        }
        turns.push({
          turn: `S6-压缩后续聊(compaction=${hasCompaction})`,
          prompt: '压缩后续聊',
          answer: ansPost,
          status: snapPost.lastResult?.status ?? 'unknown',
          assertion: { passed: checkPost.passed && hasCompaction, reasons: [...checkPost.reasons, ...(hasCompaction ? [] : ['未观察到原生 compaction 触发'])] },
          wireCount: captured.length - beforePost,
          wireSummary: captured.slice(beforePost),
        });
      } finally {
        await lab.close();
      }
    });
    const clean = await checkNativeHistoryClean(dir);
    return { scenario: 'S6', runIndex, modelKey: spec.key, strategy, passed: clean && turns.every(t => t.assertion.passed), turns, usage: usageTotals, nativeHistoryClean: clean };
  } catch (error) {
    return { scenario: 'S6', runIndex, modelKey: spec.key, strategy, passed: false, turns, usage: usageTotals, nativeHistoryClean: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runScenarioS7CrossModel(
  dsSpec: TargetModelSpec,
  kimiSpec: TargetModelSpec,
  strategy: Exclude<ContextEvalStrategy, 'B'>,
  runIndex: number,
  guard: BudgetGuard,
): Promise<ScenarioResult> {
  const dir = await mkdtemp(join(tmpdir(), `berserk-ctx-s7-${strategy}-`));
  const turns: TurnEvidence[] = [];
  const usageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, modelAttempts: 0 };
  try {
    await withCapturedFetch(guard, [dsSpec.apiKey, kimiSpec.apiKey], async captured => {
      const lab = await PiLab.create(buildLabConfig(dir, dsSpec));
      lab.contextEvalStrategy = strategy;
      try {
        const platform = await lab.updateModelPlatform({
          name: kimiSpec.label,
          provider: kimiSpec.provider,
          baseUrl: kimiSpec.baseUrl,
          api: kimiSpec.api,
          apiKey: kimiSpec.apiKey,
          enabled: true,
          ...(kimiSpec.compat ? { compat: kimiSpec.compat as LabConfig['compat'] } : {}),
          expectedVersion: lab.modelCatalog().version,
        }, 'default', true);
        const kimiProfile = await lab.updateModelProfile({
          platformId: platform.id,
          model: kimiSpec.model,
          displayName: kimiSpec.label,
          enabled: true,
          usageConfirmed: true,
          contextWindow: kimiSpec.contextWindow,
          maxOutputTokens: kimiSpec.maxOutputTokens,
          expectedVersion: lab.modelCatalog().version,
        }, 'default', true);

        const session = await lab.createSession();
        const setWs = async (content: string) => {
          const cur = await lab.resources.readInstruction(session.workspaceId, 'workspace');
          await lab.resources.updateInstruction(session.workspaceId, 'workspace', content, cur.hash);
        };

        const runStep = async (turn: string, prompt: string, check: (ans: string) => AssertionResult) => {
          const before = captured.length;
          await lab.start(session.id, prompt).run(() => {});
          const snap = lab.get(session.id);
          const ans = lastAssistantText(snap);
          const u = snap.lastResult?.usageSummary;
          if (u) {
            usageTotals.modelAttempts += u.modelAttempts;
            if (u.actual) {
              usageTotals.input += u.actual.input; usageTotals.output += u.actual.output;
              usageTotals.cacheRead += u.actual.cacheRead; usageTotals.cacheWrite += u.actual.cacheWrite;
              usageTotals.totalTokens += u.actual.totalTokens;
            }
            guard.record(u.actual ?? null);
          }
          turns.push({
            turn,
            prompt,
            answer: ans,
            status: snap.lastResult?.status ?? 'unknown',
            assertion: snap.lastResult?.status === 'succeeded' ? check(ans) : { passed: false, reasons: [`请求未成功: ${snap.lastResult?.message ?? snap.lastResult?.status}`] },
            wireCount: captured.length - before,
            wireSummary: captured.slice(before),
          });
        };

        await setWs(SYNTHETIC_RULES.R1_CONTENT);
        await runStep('S7-T1(DeepSeek+R1)', '请记住代号「北极星-77」，并简短回答地球的卫星叫什么。', ans => assertStrictLeadingPrefix(ans, SYNTHETIC_RULES.R1_PREFIX, [SYNTHETIC_RULES.R2_PREFIX]));

        await setWs(SYNTHETIC_RULES.R2_CONTENT);
        lab.selectModel(session.id, kimiProfile.id);
        await runStep('S7-T2(切Kimi+R2)', '先告诉我上一轮让你记住的代号是什么，再简短介绍木星。', ans => {
          const prefix = assertStrictLeadingPrefix(ans, SYNTHETIC_RULES.R2_PREFIX, [SYNTHETIC_RULES.R1_PREFIX]);
          const memory = ans.includes('北极星-77');
          return { passed: prefix.passed && memory, reasons: [...prefix.reasons, ...(memory ? [] : ['切换 Kimi 后丢失历史代号 北极星-77'])] };
        });

        await setWs(SYNTHETIC_RULES.R3_CONTENT);
        lab.selectModel(session.id, 'default');
        await runStep('S7-T3(切回DeepSeek+清空R3)', '请再次确认我们第一轮约定的代号，并用一句话总结刚才两轮聊到的天体。', ans => {
          const cleared = assertClearedNoDecoration(ans);
          const memory = ans.includes('北极星-77');
          return { passed: cleared.passed && memory, reasons: [...cleared.reasons, ...(memory ? [] : ['切回 DeepSeek 后丢失历史代号 北极星-77'])] };
        });
      } finally {
        await lab.close();
      }
    });
    const clean = await checkNativeHistoryClean(dir);
    return { scenario: 'S7-CrossModel', runIndex, modelKey: 'deepseek<->kimi', strategy, passed: clean && turns.every(t => t.assertion.passed), turns, usage: usageTotals, nativeHistoryClean: clean };
  } catch (error) {
    return { scenario: 'S7-CrossModel', runIndex, modelKey: 'deepseek<->kimi', strategy, passed: false, turns, usage: usageTotals, nativeHistoryClean: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function renderMarkdownReport(results: ScenarioResult[], budgetTotals: ReturnType<BudgetGuard['snapshot']>): string {
  const lines: string[] = [
    '# 第 1 层对照实验结果汇总（Issue #4）',
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 累计真实请求：${budgetTotals.requests} 次（缺失 usage：${budgetTotals.unknownUsageRequests} 次）`,
    `- 累计 Token：input=${budgetTotals.input}, cacheRead=${budgetTotals.cacheRead}, output=${budgetTotals.output}, total=${budgetTotals.totalTokens}`,
    `- 综合缓存命中参考：cache/(input+cache)=${cacheHitRatio(budgetTotals).cacheOverInputPlusCache}, cache/input=${cacheHitRatio(budgetTotals).cacheOverInput}`,
    '',
    '## 分组汇总矩阵',
    '',
    '| 模型 | 策略 | 场景 | 轮次 | 结果 | 原生历史洁净 | input | cacheRead | output | 失败原因 |',
    '| --- | --- | --- | ---: | --- | --- | ---: | ---: | ---: | --- |',
  ];
  for (const r of results) {
    const reasons = r.error ? [r.error] : r.turns.flatMap(t => t.assertion.passed ? [] : [`${t.turn}: ${t.assertion.reasons.join('；')}`]);
    lines.push(`| ${r.modelKey} | ${r.strategy} | ${r.scenario} | ${r.runIndex} | ${r.passed ? 'PASS' : 'FAIL'} | ${r.nativeHistoryClean ? 'YES' : 'NO'} | ${r.usage.input} | ${r.usage.cacheRead} | ${r.usage.output} | ${reasons.join(' / ') || '-'} |`);
  }

  const failed = results.filter(r => !r.passed);
  lines.push('', '## 失败样本全文（不截断）', '');
  if (!failed.length) {
    lines.push('本批次无失败样本。');
  } else {
    for (const r of failed) {
      lines.push(`### ${r.modelKey} / ${r.strategy} / ${r.scenario} (#${r.runIndex})`);
      if (r.error) lines.push(`- 异常：${r.error}`);
      for (const t of r.turns.filter(item => !item.assertion.passed)) {
        lines.push(`- **${t.turn}**（状态：${t.status}，失败理由：${t.assertion.reasons.join('；')}）`);
        lines.push('  ```text');
        lines.push(t.answer);
        lines.push('  ```');
      }
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const dryRun = hasFlag('--dry-run');
  const outDir = resolve(parseArg('--out') ?? '../../.trellis/tasks/11-27-context-assembly-eval/research/layer1-out');
  const maxRequests = Number(process.env.EVAL_MAX_REQUESTS ?? 276);
  const maxInputTokens = Number(process.env.EVAL_MAX_INPUT_TOKENS ?? 2_000_000);
  const maxOutputTokens = Number(process.env.EVAL_MAX_OUTPUT_TOKENS ?? 150_000);

  const models = loadTargetModels();
  if (dryRun) {
    console.info(JSON.stringify({
      mode: 'dry-run',
      outDir,
      budgetLimits: { maxRequests, maxInputTokens, maxOutputTokens },
      configuredModels: models.map(m => ({ key: m.key, label: m.label, provider: m.provider, api: m.api, baseUrl: m.baseUrl, model: m.model, thinkingMode: m.thinkingMode, contextWindow: m.contextWindow, maxOutputTokens: m.maxOutputTokens })),
      plan: [
        'DeepSeek: A/B/C/D1 (S1-S2-S3 x2, S4 x1, S5 x1, S6 x2) + D2 (S1-S2-S3 x2, S6 x2)',
        'Kimi: A/C/D1 (S1-S2-S3 x2, S4 x1, S5 x1, S6 x2)',
        'CrossModel S7 (DeepSeek <-> Kimi): A/C/D1 x2',
      ],
    }, null, 2));
    return;
  }

  if (!models.length) {
    throw new Error('未检测到任何实验凭证（EVAL_ARK_API_KEY / EVAL_DEEPSEEK_API_KEY / EVAL_KIMI_API_KEY）。未发送任何请求。');
  }

  const guard = new BudgetGuard({
    maxRequests,
    maxInputTokens,
    maxOutputTokens,
    maxConsecutiveUnknownUsage: 2,
  });

  const results: ScenarioResult[] = [];
  const ds = models.find(m => m.key === 'deepseek');
  const kimi = models.find(m => m.key === 'kimi');

  const pushResult = (res: ScenarioResult) => {
    results.push(res);
    const snap = guard.snapshot();
    console.info(`[L1] ${res.modelKey} | ${res.strategy} | ${res.scenario}#${res.runIndex} -> ${res.passed ? 'PASS' : 'FAIL'} (req=${snap.requests}, in=${snap.input}, cache=${snap.cacheRead}, out=${snap.output})${res.error ? ` ERR=${res.error}` : ''}`);
  };

  const only = parseArg('--only'); // optional: 'deepseek' | 'kimi' | 'cross'
  const runDs = !only || only === 'deepseek';
  const runKimi = !only || only === 'kimi';
  const runCross = !only || only === 'cross';

  if (ds && runDs) {
    for (const strategy of ['A', 'B', 'C', 'D1'] as const) {
      for (const runIndex of [1, 2]) pushResult(await runCoreChainS1S2S3(ds, strategy, runIndex, guard));
      pushResult(await runScenarioS4(ds, strategy, guard));
      pushResult(await runScenarioS5(ds, strategy, guard));
      for (const runIndex of [1, 2]) pushResult(await runScenarioS6Compaction(ds, strategy, runIndex, guard));
    }
    // D2 specialist comparison: S1-S2-S3 + S6 compaction
    for (const runIndex of [1, 2]) pushResult(await runCoreChainS1S2S3(ds, 'D2', runIndex, guard));
    for (const runIndex of [1, 2]) pushResult(await runScenarioS6Compaction(ds, 'D2', runIndex, guard));
  }

  if (kimi && runKimi) {
    for (const strategy of ['A', 'C', 'D1'] as const) {
      for (const runIndex of [1, 2]) pushResult(await runCoreChainS1S2S3(kimi, strategy, runIndex, guard));
      pushResult(await runScenarioS4(kimi, strategy, guard));
      pushResult(await runScenarioS5(kimi, strategy, guard));
      for (const runIndex of [1, 2]) pushResult(await runScenarioS6Compaction(kimi, strategy, runIndex, guard));
    }
  }

  if (ds && kimi && runCross) {
    for (const strategy of ['A', 'C', 'D1'] as const) {
      for (const runIndex of [1, 2]) pushResult(await runScenarioS7CrossModel(ds, kimi, strategy, runIndex, guard));
    }
  }

  await mkdir(outDir, { recursive: true });
  const totals = guard.snapshot();
  await writeFile(join(outDir, 'layer1-evidence.json'), JSON.stringify({ generatedAt: new Date().toISOString(), totals, results }, null, 2), 'utf8');
  await writeFile(join(outDir, 'layer1-results.md'), renderMarkdownReport(results, totals), 'utf8');
  console.info(`Layer 1 completed. Results written to ${outDir}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
