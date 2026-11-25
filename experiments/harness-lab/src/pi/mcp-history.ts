import { capabilityDigest } from '../capabilities/service.js';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ConfirmationInteraction, InteractionQuestion } from '../contracts/index.js';
import type { ConnectorReference } from '../contracts/connectors.js';
import { isMcpSource, isMcpConfirmation, type McpSource } from '../contracts/mcp.js';
import { stateError } from '../resources/files.js';
import { UUID } from '../workspaces/store.js';

export const MCP_ADMISSION = 'berserk.mcp-admission.v1';
export const MCP_ADMISSION_V2 = 'berserk.mcp-admission.v2';
export const MCP_POLICY = 'berserk.mcp-policy.v1';
export const MCP_REQUESTED = 'berserk.interaction.requested.v2';
export const MCP_RESOLVED = 'berserk.interaction.resolved.v2';
export const mcpToolName = (connectorId: string, action: string) => `mcp_${createHash('sha256').update(JSON.stringify([connectorId,action])).digest('hex').slice(0,40)}`;
export const mcpArgumentsDigest = capabilityDigest;
export interface McpAdmissionRecord {
  schemaVersion: 1; requestId: string; sessionId: string; workspaceId: string; userId: string;
  tools: Array<{name: string; source: McpSource}>;
  targetQuestion?: InteractionQuestion;
}
interface McpExplicitAdmissionRecord extends Omit<McpAdmissionRecord, 'schemaVersion'> {
  schemaVersion: 2;
  explicitConnectorIds: string[];
}
export type McpAdmission = McpAdmissionRecord | McpExplicitAdmissionRecord;
export function mcpTargetQuestion(tools:McpAdmissionRecord['tools'],requestId:string):InteractionQuestion {
  const sources=[...new Map(tools.map(tool=>[tool.source.connectorId,tool.source])).values()];
  return {id:`mcp_target_${requestId}`,prompt:'本次要使用哪个连接？',options:sources.map(source=>({id:source.connectorId,label:source.connectionName,description:`连接标识 ${source.connectorId}`}))};
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => key in value);
const text = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 16000;
export function decodeMcpAdmission(value: unknown, workspaceId: string, sessionId?: string): McpAdmissionRecord {
  if (!object(value) || !exact(value,['schemaVersion','requestId','sessionId','workspaceId','userId','tools',...(value.targetQuestion===undefined?[]:['targetQuestion'])]) || value.schemaVersion !== 1
    || value.workspaceId !== workspaceId || typeof value.sessionId !== 'string' || !UUID.test(value.sessionId) || sessionId !== undefined && value.sessionId !== sessionId
    || typeof value.requestId !== 'string' || !UUID.test(value.requestId) || !text(value.userId) || !Array.isArray(value.tools) || !value.tools.length || value.tools.length > 128
    || !value.tools.every(tool => object(tool) && exact(tool,['name','source']) && isMcpSource(tool.source) && (!tool.source.subjectId.startsWith('user:') || tool.source.subjectId === `user:${value.userId}`) && tool.name === mcpToolName(tool.source.connectorId,tool.source.toolName))
    || new Set(value.tools.map(tool => tool.name)).size !== value.tools.length) throw stateError();
  if (value.targetQuestion!==undefined && (!isDeepStrictEqual(value.targetQuestion,mcpTargetQuestion(value.tools as McpAdmissionRecord['tools'],String(value.requestId))) || new Set((value.tools as McpAdmissionRecord['tools']).map(tool=>tool.source.connectorId)).size<2)) throw stateError();
  return structuredClone(value) as unknown as McpAdmissionRecord;
}
export function readMcpAdmission(type: typeof MCP_ADMISSION | typeof MCP_ADMISSION_V2, value: unknown, workspaceId: string, sessionId?: string): McpAdmission {
  if (type === MCP_ADMISSION) return decodeMcpAdmission(value, workspaceId, sessionId);
  if (!object(value) || value.schemaVersion !== 2 || value.targetQuestion !== undefined) throw stateError();
  const { explicitConnectorIds, ...original } = value;
  const admission = decodeMcpAdmission({ ...original, schemaVersion: 1 }, workspaceId, sessionId);
  const sources = new Map<string, McpSource>();
  for (const { source } of admission.tools) {
    const previous = sources.get(source.connectorId);
    if (previous && (previous.revisionId !== source.revisionId || previous.connectionName !== source.connectionName)) throw stateError();
    sources.set(source.connectorId, source);
  }
  if (!Array.isArray(explicitConnectorIds) || !explicitConnectorIds.length || explicitConnectorIds.length > 8
    || explicitConnectorIds.length !== sources.size || new Set(explicitConnectorIds).size !== explicitConnectorIds.length
    || !explicitConnectorIds.every((id): id is string => typeof id === 'string' && sources.has(id))) throw stateError();
  return { ...admission, schemaVersion: 2, explicitConnectorIds: [...explicitConnectorIds] };
}

export function mcpConnectorReferences(admission: McpExplicitAdmissionRecord): ConnectorReference[] {
  const sources = new Map(admission.tools.map(({ source }) => [source.connectorId, source]));
  return admission.explicitConnectorIds.map(connectorId => {
    const { revisionId, connectionName } = sources.get(connectorId)!;
    return { connectorId, revisionId, name: connectionName };
  });
}
export function decodeMcpInteraction(value: unknown): ConfirmationInteraction {
  if (!object(value) || Object.keys(value).some(key => !['schemaVersion','interactionId','workspaceId','sessionId','requestId','toolCallId','toolName','createdAt','resolvedAt','reason','kind','status','action','rule'].includes(key))
    || value.schemaVersion !== 2 || value.kind !== 'confirmation' || !['interactionId','workspaceId','sessionId','requestId'].every(key => typeof value[key] === 'string' && UUID.test(value[key]))
    || !text(value.toolCallId) || !text(value.toolName) || !text(value.createdAt) || !Number.isFinite(Date.parse(String(value.createdAt)))
    || !['pending','approved','rejected','cancelled','expired'].includes(String(value.status))
    || value.status === 'pending' && (value.resolvedAt !== undefined || value.reason !== undefined)
    || value.status !== 'pending' && (!text(value.resolvedAt) || !Number.isFinite(Date.parse(String(value.resolvedAt))))
    || value.reason !== undefined && !text(value.reason) || !object(value.action) || !exact(value.action,['title','description','parameters','mcp'])
    || !text(value.action.title) || !text(value.action.description) || !object(value.action.parameters) || Buffer.byteLength(JSON.stringify(value.action.parameters)) > 65536
    || !isMcpConfirmation(value.action.mcp) || value.action.mcp.argumentsDigest !== mcpArgumentsDigest(value.action.parameters)
    || value.toolName !== mcpToolName(value.action.mcp.connectorId,value.action.mcp.toolName)
    || !isDeepStrictEqual(value.rule,{ruleId:'mcp.call',reason:'确认连接、账号、工具和本次外发参数后调用。',version:'1'})) throw stateError();
  return structuredClone(value) as unknown as ConfirmationInteraction;
}
export const mcpRule = {ruleId:'mcp.call',reason:'确认连接、账号、工具和本次外发参数后调用。',version:'1'};
export interface McpPolicyRecord {
  requestId: string; sessionId: string; workspaceId: string; seatId: string; toolCallId: string; toolName: string;
  parameters: Record<string,unknown>; originalArgumentsDigest: string; source: McpSource;
  policy: {decision:'ask';ruleId:string;reason:string;version:string};
}
export function decodeMcpPolicy(value: unknown): McpPolicyRecord {
  if (!object(value) || !exact(value,['requestId','sessionId','workspaceId','seatId','toolCallId','toolName','parameters','originalArgumentsDigest','source','policy'])
    || !['requestId','sessionId','workspaceId'].every(key => typeof value[key] === 'string' && UUID.test(value[key]))
    || typeof value.seatId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.seatId) || !text(value.toolCallId)
    || typeof value.originalArgumentsDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.originalArgumentsDigest) || !object(value.parameters) || Buffer.byteLength(JSON.stringify(value.parameters)) > 65536 || !isMcpSource(value.source)
    || value.toolName !== mcpToolName(value.source.connectorId,value.source.toolName) || !isDeepStrictEqual(value.policy,{decision:'ask',...mcpRule})) throw stateError();
  return structuredClone(value) as unknown as McpPolicyRecord;
}
