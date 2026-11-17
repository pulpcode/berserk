import { isMcpCredentialHeader } from './network.js';
import { isIP } from 'node:net';
import type { ConnectorConfigInput, ConnectorPolicy } from '../contracts/connectors.js';
import { RequestError } from '../contracts/errors.js';
export const connectorInvalid = () => new RequestError('INVALID_CONNECTOR_INPUT', '连接参数无效，请核对配置、认证和使用范围。', 400);
export const connectorConflict = () => new RequestError('CONNECTOR_CONFLICT', '连接已更新或操作参数变化，请刷新后重试。', 409);
export const connectorMissing = () => new RequestError('CONNECTOR_NOT_FOUND', '连接不存在或当前账号无权使用。', 404);
export const actionId = (value: string) => { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw connectorInvalid(); };
function record(value: unknown, keys: string[]): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw connectorInvalid(); return value as Record<string, unknown>; }
function text(value: unknown, max: number, empty = false): string { if (typeof value !== 'string' || value.length > max || !empty && !value.trim()) throw connectorInvalid(); return value; }
export function validateConnectorPolicy(value: unknown): ConnectorPolicy { const raw = record(value, ['mode', 'seatIds', 'personal']); if (typeof raw.mode !== 'string' || !['none', 'all', 'seats'].includes(raw.mode) || typeof raw.personal !== 'boolean' || !Array.isArray(raw.seatIds) || raw.seatIds.length > 100 || raw.seatIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || id.startsWith('account-')) || new Set(raw.seatIds).size !== raw.seatIds.length || raw.mode !== 'seats' && raw.seatIds.length) throw connectorInvalid(); return structuredClone(raw) as unknown as ConnectorPolicy; }
export function validateConnectorConfig(value: unknown): ConnectorConfigInput {
  const raw = record(value, ['name','description','endpoint','auth','approvedTargets','policy','exposedTools']);
  const name = text(raw.name, 128), description = text(raw.description, 2000, true), endpoint = text(raw.endpoint, 2048);
  let url: URL; try { url = new URL(endpoint); } catch { throw connectorInvalid(); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw connectorInvalid();
  const auth = record(raw.auth, ['mode','credentialSource','headerName']);
  if (typeof auth.mode !== 'string' || !['none','bearer','api-key'].includes(auth.mode) || typeof auth.credentialSource !== 'string' || !['organization','personal'].includes(auth.credentialSource)) throw connectorInvalid();
  if (auth.mode === 'api-key') { const header = text(auth.headerName, 64); if (!isMcpCredentialHeader(header) || /^authorization$/i.test(header)) throw connectorInvalid(); }
  else if (auth.headerName !== undefined) throw connectorInvalid();
  if (auth.mode === 'none' && auth.credentialSource !== 'organization') throw connectorInvalid();
  if (!Array.isArray(raw.approvedTargets) || raw.approvedTargets.length > 64 || new Set(raw.approvedTargets).size !== raw.approvedTargets.length) throw connectorInvalid();
  const approvedTargets = raw.approvedTargets.map(target => { const item = text(target, 2048); if (isIP(item)) return item; try { const targetUrl = new URL(item); if (!['http:','https:'].includes(targetUrl.protocol) || targetUrl.origin !== item) throw connectorInvalid(); } catch { throw connectorInvalid(); } return item; });
  if (!Array.isArray(raw.exposedTools) || raw.exposedTools.length > 256) throw connectorInvalid();
  const exposedTools = raw.exposedTools.map(item => { const tool = record(item, ['name','contractDigest']); const name = text(tool.name, 256), contractDigest = text(tool.contractDigest, 64); if (!/^[a-f0-9]{64}$/.test(contractDigest)) throw connectorInvalid(); return {name,contractDigest}; });
  if (new Set(exposedTools.map(tool => tool.name)).size !== exposedTools.length) throw connectorInvalid();
  return {name,description,endpoint:url.href,auth:structuredClone(auth) as unknown as ConnectorConfigInput['auth'],approvedTargets,policy:validateConnectorPolicy(raw.policy),exposedTools};
}
