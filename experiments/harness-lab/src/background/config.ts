import { timingSafeEqual } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { readControlled } from '../resources/files.js';
import type { BackgroundProfileSnapshot, InformationRuleInput } from '../contracts/background.js';
import { RequestError } from '../contracts/errors.js';

export interface BackgroundSourceConfig {
  sourceId: string; name: string; credentialRef: string;
  allowedProfileIds: string[]; allowedRecipientSeatIds: string[];
}
export interface BackgroundConfig {
  enabled: boolean; concurrency: number; modelConcurrency: number; backlogLimit: number;
  sources: BackgroundSourceConfig[]; profiles: BackgroundProfileSnapshot[];
}
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const tools = new Set(['read', 'write', 'edit', 'ls', 'find', 'bash', 'file_output', 'source_list', 'source_read', 'skill_read', 'subagent']);
const fail = () => new Error('后台配置无效，请核对来源、处理方案及容量；凭证只通过环境变量提供。');
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail();
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw fail();
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw fail();
  return value;
}
function identifier(value: unknown): string { const id = text(value, 64); if (!idPattern.test(id)) throw fail(); return id; }
function list(value: unknown, optional = false): string[] {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value) || value.length > 100) throw fail();
  const result = value.map(identifier); if (new Set(result).size !== result.length) throw fail(); return result;
}
function limit(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max) throw fail(); return Number(value);
}

export function parseBackgroundConfig(value: unknown): BackgroundConfig {
  const raw = record(value); fields(raw, ['enabled', 'concurrency', 'modelConcurrency', 'backlogLimit', 'sources', 'profiles']);
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') throw fail();
  if (!Array.isArray(raw.sources) || !Array.isArray(raw.profiles) || raw.sources.length > 100 || raw.profiles.length > 100) throw fail();
  const profiles = raw.profiles.map(item => {
    const p = record(item); fields(p, ['id', 'name', 'goal', 'tools', 'skillIds', 'agentIds', 'instructions', 'resources']);
    const selectedTools = list(p.tools); if (!selectedTools.length || selectedTools.some(tool => !tools.has(tool))) throw fail();
    if (p.resources !== undefined && (!Array.isArray(p.resources) || p.resources.length > 100)) throw fail();
    const resources = ((p.resources ?? []) as unknown[]).map(item => {
      const r = record(item); fields(r, ['id', 'title', 'content']);
      return {id: identifier(r.id), title: text(r.title, 200), content: text(r.content, 100_000, true)};
    });
    if (new Set(resources.map(r => r.id)).size !== resources.length) throw fail();
    const instructions = text(p.instructions ?? '', 16_384, true);
    if (Buffer.byteLength(instructions, 'utf8') > 16_384) throw fail();
    return {id: identifier(p.id), name: text(p.name ?? p.id, 100), goal: text(p.goal, 16_000), tools: selectedTools,
      skillIds: list(p.skillIds, true), agentIds: list(p.agentIds, true), instructions, resources};
  });
  const sources = raw.sources.map(item => {
    const s = record(item); fields(s, ['sourceId', 'name', 'credentialRef', 'allowedProfileIds', 'allowedRecipientSeatIds']);
    const credentialRef = text(s.credentialRef, 100); if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(credentialRef)) throw fail();
    const allowedProfileIds = list(s.allowedProfileIds), allowedRecipientSeatIds = list(s.allowedRecipientSeatIds);
    if (!allowedProfileIds.length || !allowedRecipientSeatIds.length || allowedProfileIds.some(id => !profiles.some(p => p.id === id))) throw fail();
    return {sourceId: identifier(s.sourceId), name: text(s.name, 100), credentialRef, allowedProfileIds, allowedRecipientSeatIds};
  });
  if (new Set(sources.map(s => s.sourceId)).size !== sources.length || new Set(profiles.map(p => p.id)).size !== profiles.length || new Set(sources.map(s => s.credentialRef)).size !== sources.length) throw fail();
  return {enabled: raw.enabled === true, concurrency: limit(raw.concurrency, 1, 32), modelConcurrency: limit(raw.modelConcurrency, 2, 64), backlogLimit: limit(raw.backlogLimit, 100, 100_000), sources, profiles};
}

/** Absent configuration leaves existing services and schema untouched. No token values are stored. */
export async function loadBackgroundConfig(env: NodeJS.ProcessEnv = process.env): Promise<BackgroundConfig | undefined> {
  if (!env.LAB_BACKGROUND_CONFIG) return undefined;
  const path = env.LAB_BACKGROUND_CONFIG;
  if (!isAbsolute(path)) throw new Error('LAB_BACKGROUND_CONFIG 必须是配置文件的绝对路径。');
  let config: BackgroundConfig;
  try { config = parseBackgroundConfig(JSON.parse((await readControlled(resolve(path), 2_000_000))!)); }
  catch { throw fail(); }
  if (config.sources.some(source => !env[source.credentialRef] || env[source.credentialRef]!.length < 24)) throw new Error('来源凭证未配置或不足 24 个字符，请在环境变量中配置。');
  return config;
}

export function authenticateSource(config: BackgroundConfig, sourceId: string, authorization: string | undefined, env: NodeJS.ProcessEnv = process.env): BackgroundSourceConfig {
  const source = config.sources.find(item => item.sourceId === sourceId);
  const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  const expected = source && env[source.credentialRef];
  const left = Buffer.from(supplied), right = Buffer.from(expected || '');
  if (!source || !expected || !supplied || left.length !== right.length || !timingSafeEqual(left, right)) throw new RequestError('SOURCE_UNAUTHORIZED', '来源凭证无效。', 401);
  return source;
}

/** The caller also validates source management grants and current seat/task state. */
export function validateRuleScope(config: BackgroundConfig, input: InformationRuleInput) {
  const source = config.sources.find(item => item.sourceId === input.sourceId);
  if (!source || !source.allowedProfileIds.includes(input.profileId) || !input.recipientSeatIds.length || input.recipientSeatIds.some(id => !source.allowedRecipientSeatIds.includes(id))) throw new RequestError('RULE_SCOPE_INVALID', '处理方案或接收席位不在来源允许的范围内。', 400);
}
