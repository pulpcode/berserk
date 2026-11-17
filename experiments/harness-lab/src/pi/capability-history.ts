import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { ExpertBinding, ExecutionManifest } from '../contracts/capabilities.js';
import { stateError } from '../resources/files.js';
import { UUID } from '../workspaces/store.js';

export const EXPERT_BINDING = 'berserk.expert-binding.v1';
export const EXECUTION_MANIFEST = 'berserk.execution-manifest.v1';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, fields: string[]) => Object.keys(v).every(key => fields.includes(key));
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const hash = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const uuid = (v: unknown) => typeof v === 'string' && UUID.test(v);
const ref = (v: unknown) => object(v) && exact(v, ['expertId', 'revisionId']) && text(v.expertId) && text(v.revisionId);

export function decodeExpertBinding(value: unknown, workspaceId: string, sessionId?: string): ExpertBinding {
  if (!object(value) || !exact(value, ['schemaVersion', 'sessionId', 'workspaceId', 'seatId', 'expertRef', 'digest', 'boundAt', 'legacy', 'userId'])
    || value.schemaVersion !== 1 || value.workspaceId !== workspaceId || !uuid(value.sessionId)
    || sessionId !== undefined && value.sessionId !== sessionId || !text(value.seatId) || !ref(value.expertRef)
    || !hash(value.digest) || !text(value.boundAt) || !Number.isFinite(Date.parse(value.boundAt))
    || value.legacy !== undefined && value.legacy !== true || value.userId !== undefined && !text(value.userId)) throw stateError();
  return structuredClone(value) as unknown as ExpertBinding;
}

export function expertBinding(entries: SessionEntry[], workspaceId: string, sessionId?: string): ExpertBinding | undefined {
  const found = entries.filter(entry => entry.type === 'custom' && entry.customType === EXPERT_BINDING);
  if (found.length > 1) throw stateError();
  return found[0]?.type === 'custom' ? decodeExpertBinding(found[0].data, workspaceId, sessionId) : undefined;
}

export function decodeExecutionManifest(value: unknown, workspaceId: string, sessionId?: string): ExecutionManifest {
  if (!object(value) || !exact(value, ['schemaVersion', 'requestId', 'sessionId', 'workspaceId', 'expertRef', 'digest', 'skills', 'identity', 'mode', 'tools', 'model', 'runtime'])
    || value.schemaVersion !== 1 || value.workspaceId !== workspaceId || !uuid(value.requestId) || !uuid(value.sessionId)
    || sessionId !== undefined && value.sessionId !== sessionId || !ref(value.expertRef) || !hash(value.digest)
    || !object(value.identity) || !exact(value.identity, ['seatId', 'userId']) || !text(value.identity.seatId)
    || value.identity.userId !== undefined && !text(value.identity.userId)
    || !['interactive', 'delegated', 'background', 'trial'].includes(String(value.mode))
    || !Array.isArray(value.tools) || !value.tools.every(text) || new Set(value.tools).size !== value.tools.length
    || !object(value.model) || !exact(value.model, ['id', 'version']) || !text(value.model.id) || !text(value.model.version)
    || !text(value.runtime) || !Array.isArray(value.skills)
    || !value.skills.every(item => object(item) && exact(item, ['id', 'name', 'revisionId', 'releaseVersion', 'digest'])
      && ['id', 'name', 'revisionId', 'releaseVersion'].every(key => text(item[key])) && hash(item.digest))
    || new Set(value.skills.map(item => item.id)).size !== value.skills.length) throw stateError();
  return structuredClone(value) as unknown as ExecutionManifest;
}
