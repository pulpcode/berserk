export interface WirePayloadAudit {
  index: number;
  timestamp: string;
  endpoint: string;
  api: 'openai-completions' | 'anthropic-messages' | 'unknown';
  model: string;
  systemLength: number;
  systemFingerprints: string[];
  messageRoles: string[];
  systemMessageCount: number;
  hostReminderCount: number;
  systemReminderCount: number;
  reminderLocations: string[];
  tailUserContainsReminder: boolean;
  toolResultContainsReminder: boolean;
  containsSecret: boolean;
  thinkingField?: unknown;
  rawBodySummary: Record<string, unknown>;
}

export interface TokenUsageTotals {
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  unknownUsageRequests: number;
}

export interface BudgetLimits {
  maxRequests: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxConsecutiveUnknownUsage: number;
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(block => {
    if (!block || typeof block !== 'object') return '';
    const record = block as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.content === 'string') return record.content;
    if (Array.isArray(record.content)) return extractText(record.content);
    return '';
  }).join('\n');
}

export function sanitizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return rawUrl.split('?')[0] ?? rawUrl;
  }
}

export function redactSecrets(text: string, secrets: ReadonlyArray<string>): string {
  let result = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) result = result.split(secret).join('[REDACTED]');
  }
  return result;
}

export function inspectWirePayload(
  index: number,
  rawUrl: string,
  body: Record<string, unknown>,
  fingerprints: ReadonlyArray<string>,
  secrets: ReadonlyArray<string> = [],
): WirePayloadAudit {
  const endpoint = sanitizeUrl(rawUrl);
  const api: WirePayloadAudit['api'] = endpoint.endsWith('/messages') || Array.isArray(body.system) || typeof body.system === 'string'
    ? 'anthropic-messages'
    : endpoint.includes('/chat/completions') || Array.isArray(body.messages)
      ? 'openai-completions'
      : 'unknown';

  const messages = Array.isArray(body.messages) ? (body.messages as Array<Record<string, unknown>>) : [];
  let systemText = '';
  let systemMessageCount = 0;

  if (api === 'anthropic-messages') {
    systemText = extractText(body.system);
    if (systemText) systemMessageCount = 1;
  }

  const messageRoles: string[] = [];
  const reminderLocations: string[] = [];
  let hostReminderCount = 0;
  let systemReminderCount = 0;
  let tailUserContainsReminder = false;
  let toolResultContainsReminder = false;

  const lastUserIndex = messages.findLastIndex(msg => {
    if (msg.role !== 'user') return false;
    if (api === 'anthropic-messages' && Array.isArray(msg.content)) {
      return !msg.content.every(block => block && typeof block === 'object' && (block as Record<string, unknown>).type === 'tool_result');
    }
    return true;
  });

  messages.forEach((msg, msgIndex) => {
    const role = String(msg.role ?? 'unknown');
    const blocks = Array.isArray(msg.content) ? (msg.content as Array<Record<string, unknown>>) : null;
    const isAnthropicToolResult = api === 'anthropic-messages' && role === 'user' && blocks !== null
      && blocks.length > 0 && blocks.every(block => block.type === 'tool_result');
    const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0
      || (blocks?.some(block => block.type === 'tool_use') ?? false);
    const label = isAnthropicToolResult ? 'user(tool_result)' : hasToolCalls ? `${role}(tool_call)` : role;
    messageRoles.push(label);

    const text = extractText(msg.content);
    if (role === 'system') {
      systemMessageCount++;
      if (msgIndex === 0 && !systemText) systemText = text;
    }

    const hostMatches = text.match(/<host_request_instructions>/g)?.length ?? 0;
    const sysMatches = text.match(/<system-reminder>/g)?.length ?? 0;
    hostReminderCount += hostMatches;
    systemReminderCount += sysMatches;

    if (hostMatches > 0 || sysMatches > 0) {
      reminderLocations.push(`messages[${msgIndex}]:${label}`);
      if (msgIndex === lastUserIndex) tailUserContainsReminder = true;
      if (role === 'tool' || isAnthropicToolResult) toolResultContainsReminder = true;
    }
  });

  const systemFingerprints = fingerprints.filter(fp => fp && systemText.includes(fp));
  const serialized = JSON.stringify(body);
  const containsSecret = secrets.some(secret => secret.length >= 6 && serialized.includes(secret));

  return {
    index,
    timestamp: new Date().toISOString(),
    endpoint,
    api,
    model: typeof body.model === 'string' ? body.model : 'unknown',
    systemLength: systemText.length,
    systemFingerprints,
    messageRoles,
    systemMessageCount,
    hostReminderCount,
    systemReminderCount,
    reminderLocations,
    tailUserContainsReminder,
    toolResultContainsReminder,
    containsSecret,
    ...(body.thinking !== undefined ? { thinkingField: body.thinking } : {}),
    rawBodySummary: {
      messageCount: messages.length,
      toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
      maxTokens: body.max_tokens ?? body.max_completion_tokens ?? null,
    },
  };
}

export class BudgetGuard {
  private totals: TokenUsageTotals = {
    requests: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    unknownUsageRequests: 0,
  };
  private consecutiveUnknownUsage = 0;

  constructor(private readonly limits: BudgetLimits) {}

  assertCanRequest(contextLabel: string): void {
    if (this.totals.requests >= this.limits.maxRequests) {
      throw new Error(`BUDGET_EXCEEDED: 请求数已达硬上限 ${this.limits.maxRequests}（${contextLabel}）`);
    }
    if (this.totals.input >= this.limits.maxInputTokens) {
      throw new Error(`BUDGET_EXCEEDED: 输入 token 已达硬上限 ${this.limits.maxInputTokens}（${contextLabel}）`);
    }
    if (this.totals.output >= this.limits.maxOutputTokens) {
      throw new Error(`BUDGET_EXCEEDED: 输出 token 已达硬上限 ${this.limits.maxOutputTokens}（${contextLabel}）`);
    }
  }

  record(usage: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number } | null): void {
    this.totals.requests++;
    if (!usage || usage.totalTokens <= 0) {
      this.totals.unknownUsageRequests++;
      this.consecutiveUnknownUsage++;
      if (this.consecutiveUnknownUsage > this.limits.maxConsecutiveUnknownUsage) {
        throw new Error(`USAGE_MISSING_ABORT: 连续 ${this.consecutiveUnknownUsage} 次真实模型调用缺失 usage`);
      }
      return;
    }
    this.consecutiveUnknownUsage = 0;
    this.totals.input += usage.input;
    this.totals.output += usage.output;
    this.totals.cacheRead += usage.cacheRead;
    this.totals.cacheWrite += usage.cacheWrite;
    this.totals.totalTokens += usage.totalTokens;
  }

  snapshot(): TokenUsageTotals {
    return { ...this.totals };
  }
}

export function cacheHitRatio(totals: Pick<TokenUsageTotals, 'input' | 'cacheRead'>): {
  cacheOverInputPlusCache: number;
  cacheOverInput: number;
} {
  const denom = totals.input + totals.cacheRead;
  return {
    cacheOverInputPlusCache: denom > 0 ? Number((totals.cacheRead / denom).toFixed(4)) : 0,
    cacheOverInput: totals.input > 0 ? Number((totals.cacheRead / totals.input).toFixed(4)) : 0,
  };
}
