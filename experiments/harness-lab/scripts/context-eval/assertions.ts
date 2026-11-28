export const SYNTHETIC_RULES = {
  R1_PREFIX: '【赤松】',
  R1_CONTENT: '工作区格式约定：所有中文正式回答的第一行必须严格以【赤松】开头，不要在开头使用其他方括号或书名号装饰前缀。',
  R2_PREFIX: '【青竹】',
  R2_CONTENT: '工作区格式约定：所有中文正式回答的第一行必须严格以【青竹】开头，不要在开头使用任何其他旧前缀或装饰标记。',
  R3_CONTENT: '',
  R4_PREFIX: '【雪松】',
  R4_CONTENT: '工作区格式约定：所有中文正式回答的第一行必须严格以【雪松】开头，不要在开头使用任何其他旧前缀或装饰标记。',
} as const;

export interface AssertionResult {
  passed: boolean;
  reasons: string[];
}

const INTERNAL_LEAK_PATTERNS = [
  /<host_request_instructions>/i,
  /<system-reminder>/i,
  /\[工作区规则变更声明/,
  /宿主本轮提醒/,
  /project_context/i,
  /expectedHash/i,
];

const LEADING_DECORATION_PATTERN = /^\s*(?:【[^】]{1,20}】|\[[^\]]{1,20}\]|「[^」]{1,20}」|『[^』]{1,20}』|《[^》]{1,20}》)/;

export function assertNoInternalLeak(answer: string): AssertionResult {
  const reasons: string[] = [];
  for (const pattern of INTERNAL_LEAK_PATTERNS) {
    if (pattern.test(answer)) reasons.push(`回复泄露了内部提示或机制标记: ${pattern.source}`);
  }
  return { passed: reasons.length === 0, reasons };
}

/**
 * Strict prefix assertion: required prefix must appear at the very start of the answer,
 * not at the end or middle, and no forbidden legacy prefixes may appear.
 */
export function assertStrictLeadingPrefix(
  answer: string,
  requiredPrefix: string,
  forbiddenPrefixes: ReadonlyArray<string>,
): AssertionResult {
  const reasons: string[] = [];
  const trimmed = answer.trimStart();
  if (!trimmed) {
    reasons.push('模型回复为空');
    return { passed: false, reasons };
  }
  if (!trimmed.startsWith(requiredPrefix)) {
    const appearsElsewhere = trimmed.includes(requiredPrefix);
    reasons.push(appearsElsewhere
      ? `前缀 ${requiredPrefix} 未位于回答开头（疑似句中/句末假阳性）`
      : `回答未以要求的前缀 ${requiredPrefix} 开头`);
  }
  for (const forbidden of forbiddenPrefixes) {
    if (trimmed.includes(forbidden)) reasons.push(`回答包含已失效的旧前缀 ${forbidden}`);
  }
  const leak = assertNoInternalLeak(answer);
  reasons.push(...leak.reasons);
  return { passed: reasons.length === 0, reasons };
}

/**
 * Strict cleared-rule assertion: after AGENTS.md is cleared, the model must not inherit
 * any legacy prefix AND must not fabricate a new leading bracket/decoration tag.
 */
export function assertClearedNoDecoration(
  answer: string,
  legacyPrefixes: ReadonlyArray<string> = [SYNTHETIC_RULES.R1_PREFIX, SYNTHETIC_RULES.R2_PREFIX, SYNTHETIC_RULES.R4_PREFIX],
): AssertionResult {
  const reasons: string[] = [];
  const trimmed = answer.trimStart();
  if (!trimmed) {
    reasons.push('模型回复为空');
    return { passed: false, reasons };
  }
  for (const legacy of legacyPrefixes) {
    if (trimmed.includes(legacy)) reasons.push(`清空规则后仍出现旧前缀 ${legacy}`);
  }
  const match = trimmed.match(LEADING_DECORATION_PATTERN);
  if (match) {
    reasons.push(`清空规则后开头仍存在装饰性前缀标记: ${match[0]}`);
  }
  const leak = assertNoInternalLeak(answer);
  reasons.push(...leak.reasons);
  return { passed: reasons.length === 0, reasons };
}

/**
 * When explicitly asked whether the workspace currently has a format prefix rule after clearing,
 * the model must confirm there is none and must not claim an old rule is still active.
 */
export function assertClearedRuleExplanation(answer: string): AssertionResult {
  const reasons: string[] = [];
  const trimmed = answer.trimStart();
  const base = assertClearedNoDecoration(trimmed);
  reasons.push(...base.reasons);
  const confirmsNone = /(没有|无|不存在|已清空|为空|未设置|不再有).{0,20}(工作区|格式|前缀|约定|规则)/.test(trimmed)
    || /(工作区|格式|前缀|约定|规则).{0,20}(为空|已清空|没有|无|已删除|已移除|不存在)/.test(trimmed);
  if (!confirmsNone) {
    reasons.push('追问当前约定状态时，未明确说明当前没有工作区格式前缀约定');
  }
  const falselyActive = /(当前|目前|现在).{0,16}(仍然|依然|还是|继续|有效|需要).{0,16}(【赤松】|【青竹】|【雪松】|前缀)/.test(trimmed);
  if (falselyActive) {
    reasons.push('清空规则后仍错误声称旧规则有效');
  }
  return { passed: reasons.length === 0, reasons };
}

/**
 * Ensure Agent's instructions_update wrote the new workspace rule cleanly without copying
 * read-only common instructions into the workspace file.
 */
export function assertWorkspaceMinimalEdit(
  workspaceContent: string,
  commonContent: string,
  requiredSubstring: string,
  forbiddenSubstrings: ReadonlyArray<string> = [],
): AssertionResult {
  const reasons: string[] = [];
  if (!workspaceContent.includes(requiredSubstring)) {
    reasons.push(`工作区指令未包含预期内容: ${requiredSubstring}`);
  }
  for (const forbidden of forbiddenSubstrings) {
    if (workspaceContent.includes(forbidden)) reasons.push(`工作区指令残留旧内容: ${forbidden}`);
  }
  const commonAnchor = commonContent.trim().split('\n').map(line => line.trim()).find(line => line.length >= 16);
  if (commonAnchor && workspaceContent.includes(commonAnchor)) {
    reasons.push(`工作区编辑越界复制了只读通用指令片段: ${commonAnchor.slice(0, 32)}`);
  }
  return { passed: reasons.length === 0, reasons };
}
