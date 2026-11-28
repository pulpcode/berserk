import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SYNTHETIC_RULES, assertClearedNoDecoration, assertStrictLeadingPrefix, type AssertionResult } from './assertions.js';
import { startRedactedProxy, type RedactedProxyRecord } from './proxy.js';

interface CliRunOutput {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface ProbeStepReport {
  step: string;
  ruleFileWritten: string;
  prompt: string;
  reply: string;
  wireRequestsCount: number;
  wireContainsNewRule: boolean;
  wireContainsOldRule: boolean;
  classification: 'PASS' | 'MODEL_INERTIA_OR_CONTEXT_FAIL' | 'HARNESS_NO_HOT_RELOAD' | 'CLI_ERROR';
  assertion: AssertionResult;
  wireAudits: RedactedProxyRecord[];
}

function parseArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function execCli(bin: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs = 120_000): Promise<CliRunOutput> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI timed out after ${timeoutMs}ms: ${bin} ${args.join(' ')}`));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.once('error', err => { clearTimeout(timer); reject(err); });
    child.once('exit', code => { clearTimeout(timer); resolvePromise({ exitCode: code, stdout, stderr }); });
  });
}

function buildIsolatedEnv(evalHome: string, extra: Record<string, string>): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin',
    HOME: evalHome,
    XDG_CONFIG_HOME: join(evalHome, '.config'),
    XDG_DATA_HOME: join(evalHome, '.local', 'share'),
    XDG_CACHE_HOME: join(evalHome, '.cache'),
    CLAUDE_CONFIG_DIR: join(evalHome, '.claude'),
    CODEX_HOME: join(evalHome, '.codex'),
    ...extra,
  };
}

async function runClaudeCodeProbe(
  claudeBin: string,
  upstreamBaseUrl: string,
  apiKey: string,
  model: string,
  outDir: string,
): Promise<ProbeStepReport[]> {
  const root = await mkdtemp(join(tmpdir(), 'berserk-ctx-eval-claude-'));
  const evalHome = join(root, 'home');
  const workDir = join(root, 'workspace');
  await mkdir(evalHome, { recursive: true });
  await mkdir(workDir, { recursive: true });
  const proxy = await startRedactedProxy({
    upstreamBaseUrl,
    logPath: join(outDir, 'claude-code-wire.ndjson'),
    fingerprints: [SYNTHETIC_RULES.R1_PREFIX, SYNTHETIC_RULES.R2_PREFIX, '工作区格式约定'],
    secretValues: [apiKey],
    maxRequests: 16,
  });

  const steps: ProbeStepReport[] = [];
  try {
    const env = buildIsolatedEnv(evalHome, {
      ANTHROPIC_BASE_URL: proxy.baseUrl,
      ANTHROPIC_API_KEY: apiKey,
      ANTHROPIC_MODEL: model,
      DISABLE_TELEMETRY: '1',
      DISABLE_ERROR_REPORTING: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    });

    // Step 1: R1 initial
    await writeFile(join(workDir, 'CLAUDE.md'), SYNTHETIC_RULES.R1_CONTENT, 'utf8');
    const b1 = proxy.records.length;
    const r1 = await execCli(claudeBin, ['-p', '用两句话介绍太阳系中最大的行星。', '--model', model, '--output-format', 'json'], workDir, env);
    let sessionId = '';
    let reply1 = r1.stdout.trim();
    try {
      const parsed = JSON.parse(r1.stdout) as { result?: string; session_id?: string };
      reply1 = parsed.result ?? reply1;
      sessionId = parsed.session_id ?? '';
    } catch { /* fallback to raw stdout */ }
    const w1 = proxy.records.slice(b1);
    const a1 = assertStrictLeadingPrefix(reply1, SYNTHETIC_RULES.R1_PREFIX, [SYNTHETIC_RULES.R2_PREFIX]);
    const sentR1 = w1.some(rec => rec.fingerprintsInEntirePayload.includes(SYNTHETIC_RULES.R1_PREFIX));
    steps.push({
      step: 'P0-初始R1',
      ruleFileWritten: 'CLAUDE.md=R1',
      prompt: '介绍太阳系中最大的行星',
      reply: reply1,
      wireRequestsCount: w1.length,
      wireContainsNewRule: sentR1,
      wireContainsOldRule: false,
      classification: r1.exitCode !== 0 ? 'CLI_ERROR' : !sentR1 ? 'HARNESS_NO_HOT_RELOAD' : a1.passed ? 'PASS' : 'MODEL_INERTIA_OR_CONTEXT_FAIL',
      assertion: a1,
      wireAudits: w1,
    });

    // Step 2: P1 replace with R2 in same session
    await writeFile(join(workDir, 'CLAUDE.md'), SYNTHETIC_RULES.R2_CONTENT, 'utf8');
    const b2 = proxy.records.length;
    const resumeArgs = sessionId ? ['--resume', sessionId] : ['--continue'];
    const r2 = await execCli(claudeBin, [...resumeArgs, '-p', '用两句话介绍火星为什么呈现红色。', '--model', model, '--output-format', 'json'], workDir, env);
    let reply2 = r2.stdout.trim();
    try {
      const parsed = JSON.parse(r2.stdout) as { result?: string };
      reply2 = parsed.result ?? reply2;
    } catch { /* fallback */ }
    const w2 = proxy.records.slice(b2);
    const a2 = assertStrictLeadingPrefix(reply2, SYNTHETIC_RULES.R2_PREFIX, [SYNTHETIC_RULES.R1_PREFIX]);
    const sentR2 = w2.some(rec => rec.fingerprintsInEntirePayload.includes(SYNTHETIC_RULES.R2_PREFIX));
    const stillR1 = w2.some(rec => rec.audit?.systemFingerprints.includes(SYNTHETIC_RULES.R1_PREFIX));
    steps.push({
      step: 'P1-同会话替换R2',
      ruleFileWritten: 'CLAUDE.md=R2',
      prompt: '介绍火星为什么呈现红色',
      reply: reply2,
      wireRequestsCount: w2.length,
      wireContainsNewRule: sentR2,
      wireContainsOldRule: stillR1,
      classification: r2.exitCode !== 0 ? 'CLI_ERROR' : !sentR2 ? 'HARNESS_NO_HOT_RELOAD' : a2.passed ? 'PASS' : 'MODEL_INERTIA_OR_CONTEXT_FAIL',
      assertion: a2,
      wireAudits: w2,
    });

    // Step 3: P2 clear CLAUDE.md in same session
    await writeFile(join(workDir, 'CLAUDE.md'), '', 'utf8');
    const b3 = proxy.records.length;
    const r3 = await execCli(claudeBin, [...resumeArgs, '-p', '用两句话说明地球自转和公转分别带来什么现象。', '--model', model, '--output-format', 'json'], workDir, env);
    let reply3 = r3.stdout.trim();
    try {
      const parsed = JSON.parse(r3.stdout) as { result?: string };
      reply3 = parsed.result ?? reply3;
    } catch { /* fallback */ }
    const w3 = proxy.records.slice(b3);
    const a3 = assertClearedNoDecoration(reply3);
    const stillHasSystemRule = w3.some(rec => (rec.audit?.systemFingerprints.includes(SYNTHETIC_RULES.R2_PREFIX) ?? false) || (rec.audit?.systemFingerprints.includes(SYNTHETIC_RULES.R1_PREFIX) ?? false));
    steps.push({
      step: 'P2-同会话清空规则',
      ruleFileWritten: 'CLAUDE.md=""',
      prompt: '说明地球自转和公转带来的现象',
      reply: reply3,
      wireRequestsCount: w3.length,
      wireContainsNewRule: !stillHasSystemRule,
      wireContainsOldRule: stillHasSystemRule,
      classification: r3.exitCode !== 0 ? 'CLI_ERROR' : stillHasSystemRule ? 'HARNESS_NO_HOT_RELOAD' : a3.passed ? 'PASS' : 'MODEL_INERTIA_OR_CONTEXT_FAIL',
      assertion: a3,
      wireAudits: w3,
    });
  } finally {
    await proxy.close();
    await rm(root, { recursive: true, force: true });
  }
  return steps;
}

async function runOpenCodeProbe(
  opencodeBin: string,
  label: string,
  upstreamBaseUrl: string,
  apiKey: string,
  modelId: string,
  npmProviderPkg: '@ai-sdk/openai-compatible' | '@ai-sdk/anthropic',
  outDir: string,
): Promise<ProbeStepReport[]> {
  const root = await mkdtemp(join(tmpdir(), `berserk-ctx-eval-opencode-${label}-`));
  const evalHome = join(root, 'home');
  const workDir = join(root, 'workspace');
  await mkdir(evalHome, { recursive: true });
  await mkdir(workDir, { recursive: true });
  const proxy = await startRedactedProxy({
    upstreamBaseUrl,
    logPath: join(outDir, `opencode-${label}-wire.ndjson`),
    fingerprints: [SYNTHETIC_RULES.R1_PREFIX, SYNTHETIC_RULES.R2_PREFIX, '工作区格式约定'],
    secretValues: [apiKey],
    maxRequests: 16,
  });

  const configPath = join(evalHome, 'opencode.json');
  const opencodeConfig = {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      evalprov: {
        npm: npmProviderPkg,
        name: `Eval ${label}`,
        options: { baseURL: npmProviderPkg === '@ai-sdk/anthropic' ? `${proxy.baseUrl}/v1` : proxy.baseUrl, apiKey },
        models: { [modelId]: { name: modelId } },
      },
    },
    model: `evalprov/${modelId}`,
  };
  await writeFile(configPath, JSON.stringify(opencodeConfig, null, 2), 'utf8');

  const steps: ProbeStepReport[] = [];
  try {
    const env = buildIsolatedEnv(evalHome, {
      OPENCODE_CONFIG: configPath,
      OPENCODE_DISABLE_AUTOUPDATE: 'true',
    });

    await writeFile(join(workDir, 'AGENTS.md'), SYNTHETIC_RULES.R1_CONTENT, 'utf8');
    const b1 = proxy.records.length;
    const r1 = await execCli(opencodeBin, ['run', '--model', `evalprov/${modelId}`, '用两句话介绍太阳系中最大的行星。'], workDir, env);
    const w1 = proxy.records.slice(b1);
    const a1 = assertStrictLeadingPrefix(r1.stdout.trim(), SYNTHETIC_RULES.R1_PREFIX, [SYNTHETIC_RULES.R2_PREFIX]);
    const sentR1 = w1.some(rec => rec.fingerprintsInEntirePayload.includes(SYNTHETIC_RULES.R1_PREFIX));
    steps.push({
      step: 'P0-初始R1',
      ruleFileWritten: 'AGENTS.md=R1',
      prompt: '介绍太阳系中最大的行星',
      reply: r1.stdout.trim(),
      wireRequestsCount: w1.length,
      wireContainsNewRule: sentR1,
      wireContainsOldRule: false,
      classification: r1.exitCode !== 0 ? 'CLI_ERROR' : !sentR1 ? 'HARNESS_NO_HOT_RELOAD' : a1.passed ? 'PASS' : 'MODEL_INERTIA_OR_CONTEXT_FAIL',
      assertion: a1,
      wireAudits: w1,
    });

    await writeFile(join(workDir, 'AGENTS.md'), SYNTHETIC_RULES.R2_CONTENT, 'utf8');
    const b2 = proxy.records.length;
    const r2 = await execCli(opencodeBin, ['run', '--continue', '--model', `evalprov/${modelId}`, '用两句话介绍火星为什么呈现红色。'], workDir, env);
    const w2 = proxy.records.slice(b2);
    const a2 = assertStrictLeadingPrefix(r2.stdout.trim(), SYNTHETIC_RULES.R2_PREFIX, [SYNTHETIC_RULES.R1_PREFIX]);
    const sentR2 = w2.some(rec => rec.fingerprintsInEntirePayload.includes(SYNTHETIC_RULES.R2_PREFIX));
    const stillR1 = w2.some(rec => rec.audit?.systemFingerprints.includes(SYNTHETIC_RULES.R1_PREFIX));
    steps.push({
      step: 'P1-同会话替换R2',
      ruleFileWritten: 'AGENTS.md=R2',
      prompt: '介绍火星为什么呈现红色',
      reply: r2.stdout.trim(),
      wireRequestsCount: w2.length,
      wireContainsNewRule: sentR2,
      wireContainsOldRule: stillR1,
      classification: r2.exitCode !== 0 ? 'CLI_ERROR' : !sentR2 ? 'HARNESS_NO_HOT_RELOAD' : a2.passed ? 'PASS' : 'MODEL_INERTIA_OR_CONTEXT_FAIL',
      assertion: a2,
      wireAudits: w2,
    });

    await writeFile(join(workDir, 'AGENTS.md'), '', 'utf8');
    const b3 = proxy.records.length;
    const r3 = await execCli(opencodeBin, ['run', '--continue', '--model', `evalprov/${modelId}`, '用两句话说明地球自转和公转分别带来什么现象。'], workDir, env);
    const w3 = proxy.records.slice(b3);
    const a3 = assertClearedNoDecoration(r3.stdout.trim());
    const stillHasRule = w3.some(rec => (rec.audit?.systemFingerprints.includes(SYNTHETIC_RULES.R2_PREFIX) ?? false) || (rec.audit?.systemFingerprints.includes(SYNTHETIC_RULES.R1_PREFIX) ?? false));
    steps.push({
      step: 'P2-同会话清空规则',
      ruleFileWritten: 'AGENTS.md=""',
      prompt: '说明地球自转和公转带来的现象',
      reply: r3.stdout.trim(),
      wireRequestsCount: w3.length,
      wireContainsNewRule: !stillHasRule,
      wireContainsOldRule: stillHasRule,
      classification: r3.exitCode !== 0 ? 'CLI_ERROR' : stillHasRule ? 'HARNESS_NO_HOT_RELOAD' : a3.passed ? 'PASS' : 'MODEL_INERTIA_OR_CONTEXT_FAIL',
      assertion: a3,
      wireAudits: w3,
    });
  } finally {
    await proxy.close();
    await rm(root, { recursive: true, force: true });
  }
  return steps;
}

async function main() {
  const dryRun = hasFlag('--dry-run');
  const outDir = resolve(parseArg('--out') ?? '../../.trellis/tasks/11-27-context-assembly-eval/research/layer2-out');
  const opencodeBin = process.env.EVAL_OPENCODE_BIN ?? '/tmp/ctx-eval-tools/bin/opencode';
  const claudeBin = process.env.EVAL_CLAUDE_BIN ?? '/tmp/ctx-eval-tools/bin/claude';

  if (dryRun) {
    console.info(JSON.stringify({
      mode: 'dry-run',
      outDir,
      bins: { opencodeBin, claudeBin },
      isolation: 'All runs use mkdtemp workspace + isolated HOME/XDG/CLAUDE_CONFIG_DIR/CODEX_HOME + local 127.0.0.1 redacted proxy.',
    }, null, 2));
    return;
  }

  const sharedArkKey = process.env.EVAL_ARK_API_KEY ?? '';
  const dsKey = process.env.EVAL_DEEPSEEK_API_KEY ?? sharedArkKey;
  const kimiKey = process.env.EVAL_KIMI_API_KEY ?? sharedArkKey;
  if (!dsKey && !kimiKey) {
    throw new Error('未检测到实验凭证（EVAL_ARK_API_KEY / EVAL_DEEPSEEK_API_KEY / EVAL_KIMI_API_KEY）。未发送任何请求。');
  }

  await mkdir(outDir, { recursive: true });
  const reports: Record<string, ProbeStepReport[]> = {};

  if (dsKey && process.env.EVAL_SKIP_OPENCODE !== '1') {
    reports['opencode-deepseek'] = await runOpenCodeProbe(
      opencodeBin,
      'deepseek',
      process.env.EVAL_DEEPSEEK_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/plan/v3',
      dsKey,
      process.env.EVAL_DEEPSEEK_MODEL ?? 'deepseek-v4.1-flash',
      '@ai-sdk/openai-compatible',
      outDir,
    );
  }

  if (kimiKey && process.env.EVAL_SKIP_OPENCODE !== '1') {
    const kimiApi = process.env.EVAL_KIMI_API ?? 'anthropic-messages';
    reports['opencode-kimi'] = await runOpenCodeProbe(
      opencodeBin,
      'kimi',
      process.env.EVAL_KIMI_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/coding',
      kimiKey,
      process.env.EVAL_KIMI_MODEL ?? 'kimi-k2.5',
      kimiApi === 'anthropic-messages' ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible',
      outDir,
    );
  }

  if (kimiKey && process.env.EVAL_SKIP_CLAUDE !== '1') {
    reports['claude-code-kimi'] = await runClaudeCodeProbe(
      claudeBin,
      process.env.EVAL_KIMI_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/coding',
      kimiKey,
      process.env.EVAL_KIMI_MODEL ?? 'kimi-k2.5',
      outDir,
    );
  }

  const mdLines = ['# 第 2 层外部 Harness 参照探针结果（Issue #4）', '', `- 生成时间：${new Date().toISOString()}`, ''];
  for (const [name, steps] of Object.entries(reports)) {
    mdLines.push(`## ${name}`, '', '| 步骤 | 规则文件 | 请求数 | Wire含新规则 | Wire含旧规则 | 归因判定 | 断言说明 |', '| --- | --- | ---: | --- | --- | --- | --- |');
    for (const s of steps) {
      mdLines.push(`| ${s.step} | ${s.ruleFileWritten} | ${s.wireRequestsCount} | ${s.wireContainsNewRule ? 'YES' : 'NO'} | ${s.wireContainsOldRule ? 'YES' : 'NO'} | ${s.classification} | ${s.assertion.reasons.join('；') || 'PASS'} |`);
    }
    mdLines.push('');
  }

  await writeFile(join(outDir, 'layer2-evidence.json'), JSON.stringify(reports, null, 2), 'utf8');
  await writeFile(join(outDir, 'layer2-probes.md'), `${mdLines.join('\n')}\n`, 'utf8');
  console.info(`Layer 2 completed. Results written to ${outDir}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
