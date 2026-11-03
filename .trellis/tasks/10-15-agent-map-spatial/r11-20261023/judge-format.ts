/** Canonical fields remain authoritative and unchanged; all top-level extras remain auditable metadata. */
import assert from 'node:assert/strict';
const coreKeys=['schemaVersion','id','unit','verdict','severity','axes','clarity','reason','evidence'] as const;
export function normalizeJudgment(raw:unknown){
 assert.ok(raw!==null&&typeof raw==='object'&&!Array.isArray(raw),'Judgment must be an object');
 const value=raw as Record<string,unknown>,canonical=Object.fromEntries(coreKeys.map(key=>{assert.ok(Object.hasOwn(value,key),`Missing canonical field ${key}`);return [key,value[key]];}));
 // Extras cannot replace, repair or influence canonical fields. Nested canonical structure is still strictly validated.
 const extensions=Object.fromEntries(Object.entries(value).filter(([key])=>!(coreKeys as readonly string[]).includes(key)));
 return {canonical,extensions};
}
