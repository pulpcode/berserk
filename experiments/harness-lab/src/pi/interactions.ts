import { isDeepStrictEqual } from 'node:util';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import type { SessionEntry, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { Interaction, InteractionAnswer, InteractionResponse, QuestionInteraction } from '../contracts/index.js';
import { handoffConfirmationSchema } from '../contracts/collaboration.js';
import { RequestError } from '../contracts/errors.js';
import { stateError } from '../resources/files.js';
import { RESOURCE_ENTRY, RESULT_ENTRY } from './resource-tools.js';

export const COMMAND_POLICY = 'berserk.command-policy.v1';
export const INTERACTION_REQUESTED = 'berserk.interaction.requested.v1';
export const INTERACTION_RESOLVED = 'berserk.interaction.resolved.v1';
const strict = { additionalProperties: false };
const id = Type.String({ minLength: 1, maxLength: 80 });
const uuid = Type.String({ pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' });
const text = Type.String({ minLength: 1, maxLength: 16000 });
export const questionSchema = Type.Object({
  questions: Type.Array(Type.Object({ id, prompt: text,
    options: Type.Optional(Type.Array(Type.Object({ id, label: text, description: Type.Optional(text) }, strict), { minItems: 1, maxItems: 20 })),
    multiSelect: Type.Optional(Type.Boolean()),
  }, strict), { minItems: 1, maxItems: 4 }),
}, strict);
const answerSchema = Type.Union([
  Type.Object({ questionId: id, optionIds: Type.Array(id, { minItems: 1, maxItems: 20, uniqueItems: true }) }, strict),
  Type.Object({ questionId: id, text }, strict),
]);
export const interactionResponseSchema = Type.Union([
  Type.Object({ requestId: uuid, kind: Type.Literal('question'), action: Type.Literal('answer'), answers: Type.Array(answerSchema, { minItems: 1, maxItems: 4 }) }, strict),
  Type.Object({ requestId: uuid, kind: Type.Literal('question'), action: Type.Literal('skip') }, strict),
  Type.Object({ requestId: uuid, kind: Type.Literal('confirmation'), decision: Type.Union([Type.Literal('approve'), Type.Literal('reject')]) }, strict),
]);
const base = { schemaVersion: Type.Literal(1), interactionId: uuid, workspaceId: uuid, sessionId: uuid, requestId: uuid,
  toolCallId: Type.String({ minLength: 1 }), toolName: id, createdAt: text, resolvedAt: Type.Optional(text), reason: Type.Optional(text) };
const policySchema = Type.Object({ requestId: uuid, workspaceId: uuid, sessionId: uuid, seatId: Type.String({ pattern: '^[a-zA-Z0-9_-]{1,64}$' }),
  toolCallId: text, toolName: Type.Union([Type.Literal('bash'), Type.Literal('confirmation_demo'), Type.Literal('work_item_commit')]), parameters: Type.Record(Type.String(), Type.Unknown()),
  policy: Type.Object({ decision: Type.Union([Type.Literal('allow'), Type.Literal('ask'), Type.Literal('deny')]), ruleId: text, reason: text, version: text }, strict),
}, strict);
const interactionSchema = Type.Union([
  Type.Object({ ...base, kind: Type.Literal('question'), questions: questionSchema.properties.questions,
    status: Type.Union(['pending', 'answered', 'skipped', 'cancelled', 'expired'].map(value => Type.Literal(value))), answers: Type.Optional(Type.Array(answerSchema)) }, strict),
  Type.Object({ ...base, kind: Type.Literal('confirmation'),
    status: Type.Union(['pending', 'approved', 'rejected', 'cancelled', 'expired'].map(value => Type.Literal(value))),
    action: Type.Object({ title: text, description: text, command: Type.Optional(Type.String({ minLength: 1 })), cwd: Type.Optional(text), parameters: Type.Record(Type.String(), Type.Unknown()), handoff: Type.Optional(handoffConfirmationSchema) }, strict),
    rule: Type.Object({ ruleId: text, reason: text, version: text }, strict),
  }, strict),
]);
function invalid(): never { throw new RequestError('INVALID_INPUT', '交互回答格式不正确，请检查问题和选项。', 400); }
export function validateQuestions(value: unknown): asserts value is { questions: QuestionInteraction['questions'] } {
  if (!Check(questionSchema, value)) invalid();
  const questions = value.questions;
  if (new Set(questions.map(item => item.id)).size !== questions.length || questions.some(item => !item.prompt.trim() || new Set(item.options?.map(option => option.id)).size !== (item.options?.length ?? 0))) invalid();
}
function answersFor(item: QuestionInteraction, answers: InteractionAnswer[]): InteractionAnswer[] {
  if (answers.length !== item.questions.length || new Set(answers.map(answer => answer.questionId)).size !== answers.length) invalid();
  return item.questions.map(question => {
    const answer = answers.find(answer => answer.questionId === question.id);
    if (!answer) invalid();
    if ('text' in answer) { if (!answer.text.trim()) invalid(); return { questionId: question.id, text: answer.text }; }
    if (!question.options || (!question.multiSelect && answer.optionIds.length !== 1) || answer.optionIds.some(id => !question.options!.some(option => option.id === id))) invalid();
    return { questionId: question.id, optionIds: question.options.filter(option => answer.optionIds.includes(option.id)).map(option => option.id) };
  });
}
export function decodeResponse(value: unknown, item: Interaction): InteractionResponse {
  if (!Check(interactionResponseSchema, value) || value.kind !== item.kind) invalid();
  if (value.kind === 'question' && value.action === 'answer' && item.kind === 'question') return { ...value, answers: answersFor(item, value.answers) };
  return value;
}
export function resolveInteraction(item: Interaction, response: InteractionResponse, resolvedAt = new Date().toISOString()): Interaction {
  if (item.kind === 'question' && response.kind === 'question') return { ...item, resolvedAt,
    status: response.action === 'answer' ? 'answered' : 'skipped', ...(response.action === 'answer' ? { answers: response.answers } : {}) };
  if (item.kind === 'confirmation' && response.kind === 'confirmation') return { ...item, resolvedAt, status: response.decision === 'approve' ? 'approved' : 'rejected' };
  return invalid();
}
export function sameResponse(item: Interaction, response: InteractionResponse): boolean {
  const expected = resolveInteraction(item, response, item.resolvedAt);
  return expected.status === item.status && (item.kind !== 'question' || isDeepStrictEqual(item.answers, (expected as QuestionInteraction).answers));
}
export function questionResult(item: QuestionInteraction) {
  return { status: item.status, ...(item.status === 'answered' ? { answers: item.answers } : {}) };
}
/** Trusted fixed factory; no TUI and no independently implemented agent loop. */
export function interactionExtension(ask: (toolCallId: string, questions: QuestionInteraction['questions'], signal?: AbortSignal) => Promise<QuestionInteraction>, demo: boolean): ExtensionFactory {
  return pi => {
    pi.registerTool({ name: 'ask_user', label: '询问用户', description: '在当前任务中等待用户补充信息。通常优先一题，可提1至4题，选项外始终允许自定义文字。用户可以跳过，不得将跳过视为默认答案或操作批准。不要用它申请操作授权。',
      parameters: questionSchema, executionMode: 'sequential',
      async execute(toolCallId, params, signal) {
        validateQuestions(params);
        const interaction = await ask(toolCallId, params.questions, signal);
        const result = questionResult(interaction);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: { interactionId: interaction.interactionId, ...result } };
      },
    });
    if (demo) pi.registerTool({ name: 'confirmation_demo', label: '确认演示', description: '仅用于验证操作确认。批准后生成本地回执，不发送消息或改动用户文件。fail=true用于验证批准后执行失败。',
      parameters: Type.Object({ content: text, fail: Type.Optional(Type.Boolean()) }, strict), executionMode: 'sequential',
      async execute(_id, params, signal) {
        signal?.throwIfAborted();
        if (params.fail) throw new Error('演示操作执行失败。');
        return { content: [{ type: 'text', text: `演示回执：${params.content}` }], details: { receipt: params.content } };
      },
    });
  };
}
function decodeInteraction(value: unknown): Interaction {
  if (!Check(interactionSchema, value)) throw stateError();
  const item = structuredClone(value) as Interaction;
  if (!Number.isFinite(Date.parse(item.createdAt)) || (item.status === 'pending' ? item.resolvedAt !== undefined || item.reason !== undefined : !item.resolvedAt || !Number.isFinite(Date.parse(item.resolvedAt)))) throw stateError();
  if (item.kind === 'question') {
    try { validateQuestions({ questions: item.questions }); } catch { throw stateError(); }
    if (item.toolName !== 'ask_user' || (item.status === 'answered') !== (item.answers !== undefined)) throw stateError();
    if (item.answers) { try { decodeResponse({ requestId: item.requestId, kind: 'question', action: 'answer', answers: item.answers }, item); } catch { throw stateError(); } }
  } else {
    if (!['bash', 'confirmation_demo', 'work_item_commit'].includes(item.toolName)) throw stateError();
    if (item.toolName === 'work_item_commit') {
      if (!item.action.handoff || !isDeepStrictEqual(item.action.parameters, { operationId: item.action.handoff.operationId })
        || item.action.command !== undefined || item.action.cwd !== undefined || item.action.title !== item.action.handoff.title
        || item.action.description !== item.action.handoff.description) throw stateError();
    } else if (item.action.handoff !== undefined) throw stateError();
  }
  return item;
}
/** One strict replay owner for live snapshots and restart history. Never inject custom entries into context. */
export function interactionHistory(entries: SessionEntry[], workspaceId: string, sessionId?: string, activeRequestId?: string, seatId?: string): Interaction[] {
  const items = new Map<string, Interaction>();
  const calls = new Map<string, { name: string; arguments: Record<string, unknown> }>();
  const returned = new Set<string>();
  const policies = new Map<string, { decision: string; ruleId: string; reason: string; version: string }>();
  let requestId: string | undefined;
  for (const entry of entries) {
    if (entry.type === 'custom' && entry.customType === RESOURCE_ENTRY) requestId = (entry.data as { requestId: string }).requestId;
    if (entry.type === 'message' && entry.message.role === 'assistant') for (const call of entry.message.content) {
      if (call.type === 'toolCall') calls.set(`${requestId}:${call.id}`, call);
    }
    if (entry.type === 'message' && entry.message.role === 'toolResult') {
      const result = entry.message;
      const item = [...items.values()].find(item => item.requestId === requestId && item.toolCallId === result.toolCallId);
      const key = `${requestId}:${result.toolCallId}`;
      const policy = policies.get(key);
      if (!result.isError && ((result.toolName === 'ask_user' && !item) || (result.toolName === 'work_item_commit' && (!item || !policy)) || (policy?.decision === 'ask' && (!item || item.status !== 'approved')))) throw stateError();
      const details = result.details as { commandPolicy?: unknown; executionStarted?: unknown } | undefined;
      if (policy && ((!result.isError && (details?.executionStarted !== true || !isDeepStrictEqual(details.commandPolicy, policy)))
        || (policy.decision === 'deny' && (!result.isError || details?.executionStarted === true))
        || (details?.commandPolicy !== undefined && !isDeepStrictEqual(details.commandPolicy, policy)))) throw stateError();
      if (item) {
        if (returned.has(key) || result.toolName !== item.toolName || item.status === 'pending') throw stateError();
        returned.add(key);
        if (item.kind === 'confirmation') {
          if (item.status !== 'approved' && (!result.isError || details?.executionStarted === true)) throw stateError();
          if (item.status === 'approved') item.execution = details?.executionStarted === true ? (result.isError ? 'failed' : 'succeeded') : 'not_started';
        } else if (!result.isError && (!['answered', 'skipped'].includes(item.status)
          || !isDeepStrictEqual(result.details, { interactionId: item.interactionId, ...questionResult(item) })
          || !isDeepStrictEqual(result.content, [{ type: 'text', text: JSON.stringify(questionResult(item)) }]))) throw stateError();
      }
    }
    if (entry.type !== 'custom') continue;
    if (entry.customType === RESULT_ENTRY) {
      const terminal = entry.data as { requestId?: string; status?: string };
      if ([...items.values()].some(item => item.requestId === terminal.requestId && (item.status === 'pending'
        || (terminal.status === 'succeeded' && !returned.has(`${terminal.requestId}:${item.toolCallId}`))))) throw stateError();
      requestId = undefined; continue;
    }
    if (entry.customType === COMMAND_POLICY) {
      if (!Check(policySchema, entry.data)) throw stateError();
      const data = entry.data; const key = `${requestId}:${data.toolCallId}`; const call = calls.get(key);
      if (!sessionId || data.sessionId !== sessionId || data.workspaceId !== workspaceId || data.requestId !== requestId || (seatId && data.seatId !== seatId)
        || !call || call.name !== data.toolName || !isDeepStrictEqual(call.arguments, data.parameters) || policies.has(key)) throw stateError();
      policies.set(key, data.policy); continue;
    }
    if (entry.customType !== INTERACTION_REQUESTED && entry.customType !== INTERACTION_RESOLVED) continue;
    const data = entry.data as { requestId?: string; seatId?: string; interaction?: unknown };
    if (!data || typeof data !== 'object' || Object.keys(data).some(key => !['requestId', 'seatId', 'interaction'].includes(key)) || typeof data.seatId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(data.seatId) || (seatId && data.seatId !== seatId)) throw stateError();
    const item = decodeInteraction(data.interaction);
    if (!sessionId || item.sessionId !== sessionId || item.workspaceId !== workspaceId || data.requestId !== requestId || item.requestId !== requestId) throw stateError();
    const call = calls.get(`${requestId}:${item.toolCallId}`);
    if (!call || call.name !== item.toolName) throw stateError();
    const previous = items.get(item.interactionId);
    if (entry.customType === INTERACTION_REQUESTED) {
      // An unresolved interaction from an earlier request is expired, not a live wait.
      if (previous || item.status !== 'pending' || [...items.values()].some(old => old.requestId === requestId && (old.status === 'pending' || old.toolCallId === item.toolCallId))) throw stateError();
      if (item.kind === 'question' ? !isDeepStrictEqual(call.arguments, { questions: item.questions }) : !isDeepStrictEqual(call.arguments, item.action.parameters)) throw stateError();
      if (item.kind === 'confirmation') {
        const policy = policies.get(`${requestId}:${item.toolCallId}`);
        if (!policy || policy.decision !== 'ask' || !isDeepStrictEqual(item.rule, { ruleId: policy.ruleId, reason: policy.reason, version: policy.version })) throw stateError();
      }
      if (item.kind === 'confirmation' && item.toolName === 'bash' && (item.action.cwd !== '/workspace' || item.action.command !== call.arguments.command)) throw stateError();
    } else {
      if (!previous || previous.status !== 'pending' || item.status === 'pending') throw stateError();
      const immutable = (value: Interaction) => { const copy = { ...value }; delete copy.resolvedAt; delete copy.reason; if (copy.kind === 'question') delete copy.answers; return { ...copy, status: 'pending' }; };
      if (!isDeepStrictEqual(immutable(previous), immutable(item))) throw stateError();
    }
    items.set(item.interactionId, item);
  }
  return [...items.values()].map(item => {
    if (item.status === 'pending' && item.requestId !== activeRequestId) return { ...item, status: 'expired', reason: '服务重启，原交互已失效。' };
    if (item.kind === 'confirmation' && item.status === 'approved' && !item.execution && item.requestId !== activeRequestId) return { ...item, execution: 'unknown' };
    return item;
  });
}
