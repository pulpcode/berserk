/** Nonsecret source evidence. Remote text never becomes host authorization. */
export interface McpSource {
  connectorId: string; revisionId: string; connectionName: string;
  accountLabel: string; toolName: string; contractDigest: string; catalogDigest: string;
  subjectId: string; credentialVersion: number;
}
export interface McpConfirmation extends McpSource { argumentsDigest: string }
export interface McpCallEvidence extends McpConfirmation {
  schemaVersion: 1; intentId: string; status: 'success' | 'remote_error' | 'input_required' | 'unknown' | 'not_sent';
  sent: boolean; protocolVersion: string; protocolEra: string;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const sourceKeys = ['connectorId','revisionId','connectionName','accountLabel','toolName','contractDigest','catalogDigest','subjectId','credentialVersion'];
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function isMcpSource(value: unknown): value is McpSource {
  if (!object(value) || Object.keys(value).some(key => !sourceKeys.includes(key))) return false;
  return ['connectorId','revisionId','connectionName','accountLabel','toolName','subjectId'].every(key => typeof value[key] === 'string' && !!value[key] && String(value[key]).length <= 2048)
    && hash(value.contractDigest) && hash(value.catalogDigest) && Number.isSafeInteger(value.credentialVersion)
    && (value.subjectId === 'anonymous' ? value.credentialVersion === 0 && value.accountLabel === '无需凭证' : Number(value.credentialVersion) >= 1 && (value.subjectId === 'organization' ? value.accountLabel === '组织凭证' : typeof value.subjectId === 'string' && value.subjectId.startsWith('user:') && value.subjectId.length > 5 && value.accountLabel === '本人凭证'));
}
export function isMcpConfirmation(value: unknown): value is McpConfirmation {
  if (!object(value)) return false;
  const {argumentsDigest, ...source} = value;
  return hash(argumentsDigest) && isMcpSource(source);
}
export function isMcpCallEvidence(value: unknown): value is McpCallEvidence {
  if (!object(value)) return false;
  const {schemaVersion,intentId,status,sent,protocolVersion,protocolEra,...confirmation} = value;
  return schemaVersion === 1 && typeof intentId === 'string' && intentId.length > 0 && intentId.length <= 128
    && ['success','remote_error','input_required','unknown','not_sent'].includes(String(status)) && typeof sent === 'boolean'
    && (status === 'not_sent' ? !sent : sent) && ['2026-07-28','2025-11-25'].includes(String(protocolVersion))
    && (protocolVersion === '2026-07-28' ? protocolEra === 'modern' : protocolEra === 'legacy') && isMcpConfirmation(confirmation);
}
