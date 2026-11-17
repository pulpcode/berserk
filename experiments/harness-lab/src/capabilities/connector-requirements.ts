import type { ConnectorRequirement } from '../contracts/connectors.js';
import { RequestError } from '../contracts/errors.js';
/** Immutable action contracts, never a credential or a runtime use grant. */
export function connectorRequirements(value: unknown): ConnectorRequirement[] {
  const fail = (): never => {throw new RequestError('INVALID_INPUT','专家连接器能力引用无效。');};
  const record = (v:unknown):v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!Array.isArray(value) || value.length > 8) return fail();
  const refs = value.map(item => {
    if (!record(item) || Object.keys(item).some(key=>!['connectorId','actions'].includes(key)) || typeof item.connectorId !== 'string'
      || !/^[a-zA-Z0-9_-]{1,160}$/.test(item.connectorId) || !Array.isArray(item.actions) || !item.actions.length || item.actions.length > 128) return fail();
    const actions = item.actions.map(action => {
      if (!record(action) || Object.keys(action).length !== 2 || typeof action.name !== 'string' || !action.name || action.name.length > 128
        || typeof action.contractDigest !== 'string' || !/^[a-f0-9]{64}$/.test(action.contractDigest)) return fail();
      return {name:action.name,contractDigest:action.contractDigest};
    }).sort((a,b)=>a.name.localeCompare(b.name));
    if (new Set(actions.map(action=>action.name)).size !== actions.length) return fail();
    return {connectorId:item.connectorId,actions};
  }).sort((a,b)=>a.connectorId.localeCompare(b.connectorId));
  if (new Set(refs.map(ref=>ref.connectorId)).size !== refs.length) return fail();
  return refs;
}
