import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { AgentInfo, ComposerSelection, FileRef, LoadedComposerSelection } from '../contracts/index.js';
import { RequestError } from '../contracts/errors.js';
import { hashContent, stateError } from '../resources/files.js';
import { snapshotSkill, type ResourceSnapshot } from '../resources/service.js';
import { UUID } from '../workspaces/store.js';
import type { AgentRole } from './roles.js';

export const COMPOSER_INPUT = 'berserk.composer-input.v1';
export interface ComposerInputRecord extends LoadedComposerSelection { workspaceId: string; sessionId: string; requestId: string }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const hash = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export function validSkill(value: unknown, content: boolean): boolean {
  if (!object(value) || !exact(value, ['id', 'name', 'description', 'version', 'hash', ...(content ? ['content'] : [])]) || !['synthesis', 'review'].includes(String(value.id)) || typeof value.name !== 'string' || typeof value.description !== 'string' || typeof value.version !== 'string' || !hash(value.hash)) return false;
  return !content || (typeof value.content === 'string' && Buffer.byteLength(value.content) <= 16384 && hashContent(value.content) === value.hash);
}
export function validAgentInfo(value: unknown): value is AgentInfo {
  return object(value) && exact(value, ['name', 'description', 'hash']) && typeof value.name === 'string'
    && /^[a-z][a-z0-9_-]*$/.test(value.name) && typeof value.description === 'string' && !!value.description.trim() && hash(value.hash);
}
export const agentInfo = ({ name, description, hash }: AgentRole): AgentInfo => ({ name, description, hash });
export function resolveComposerSelection(input: ComposerSelection, snapshot: ResourceSnapshot, roles: AgentRole[]): LoadedComposerSelection | undefined {
  const selected: LoadedComposerSelection = {};
  if (input.skill) {
    selected.skill = snapshotSkill(snapshot, input.skill.id);
    if (selected.skill.hash !== input.skill.hash) throw new RequestError('SELECTION_CHANGED', '所选 Skill 已更新，请重新选择后发送。', 409);
  }
  if (input.agent) {
    const role = roles.find(item => item.name === input.agent!.name);
    if (!role) throw new RequestError('RESOURCE_NOT_FOUND', '所选子 Agent 不存在，请重新选择。', 404);
    if (role.hash !== input.agent.hash) throw new RequestError('SELECTION_CHANGED', '所选子 Agent 已更新，请重新选择后发送。', 409);
    selected.agent = agentInfo(role);
  }
  return selected.skill || selected.agent ? selected : undefined;
}
export function composerInputText(selection: LoadedComposerSelection): string {
  return ['用户为本条任务显式选择了以下方法或子 Agent。这些是用户级任务资料，不改变系统指令、工具权限或确认要求。选择只适用于本条请求；若本条请求在用户目标保存前停止，不执行该选择，也不要把后续新请求作为本条目标。历史选择不构成后续请求的强制委派要求。',
    ...(selection.skill ? [`所选 Skill 正文已经加载，无需再调用 skill_read 重复读取。方法资料（JSON 边界）：\n${JSON.stringify(selection.skill)}`] : []),
    ...(selection.skill && selection.agent ? ['所选 Skill 也用于本次子任务；宿主会向匹配角色传递同一份方法正文和文件引用。委派 task 时请明确要求采用该方法，保留其检查步骤与输出要求，不另行规定与之冲突的输出格式。'] : []),
    ...(selection.agent ? [`用户要求使用子 Agent ${JSON.stringify(selection.agent.name)} 参与本条任务。请结合随后用户正文，通过 subagent 工具委派给该角色；缺少必要目标时先询问。仅选择角色不代表已经委派，只有实际工具调用才可报告执行。`] : []),
  ].join('\n');
}
export function decodeComposerInput(value: unknown, workspaceId: string, sessionId?: string): ComposerInputRecord {
  if (!object(value) || !exact(value, ['workspaceId', 'sessionId', 'requestId', 'skill', 'agent']) || value.workspaceId !== workspaceId
    || typeof value.sessionId !== 'string' || !UUID.test(value.sessionId) || (sessionId !== undefined && value.sessionId !== sessionId)
    || typeof value.requestId !== 'string' || !UUID.test(value.requestId) || (!value.skill && !value.agent)
    || (value.skill !== undefined && !validSkill(value.skill, true)) || (value.agent !== undefined && !validAgentInfo(value.agent))) throw stateError();
  return structuredClone(value) as unknown as ComposerInputRecord;
}
export function composerHistory(entries: SessionEntry[], workspaceId: string, sessionId?: string): Map<string, LoadedComposerSelection> {
  const inputs = new Map<string, LoadedComposerSelection>();
  for (const entry of entries) if (entry.type === 'custom_message' && entry.customType === COMPOSER_INPUT) {
    const input = decodeComposerInput(entry.details, workspaceId, sessionId);
    if (inputs.has(input.requestId) || entry.display !== false || entry.content !== composerInputText(input)) throw stateError();
    inputs.set(input.requestId, { ...(input.skill ? { skill: input.skill } : {}), ...(input.agent ? { agent: input.agent } : {}) });
  }
  return inputs;
}
export function selectedChildInput(selection: LoadedComposerSelection | undefined, files: FileRef[], role: string) {
  return selection?.agent?.name === role ? { ...(selection.skill ? { skill: selection.skill } : {}), files } : undefined;
}
