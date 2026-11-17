import { createHash } from 'node:crypto';
import { type TSchema } from 'typebox';
import { Compile } from 'typebox/compile';

export const MCP_SCHEMA_LIMITS = Object.freeze({bytes: 64 * 1024, nodes: 2048, depth: 12, enumValues: 128, argumentsBytes: 64 * 1024});
export class McpSchemaError extends Error {
  constructor(readonly code: 'unsupported' | 'limit' | 'invalid' | 'arguments') {
    super(code === 'arguments' ? 'MCP 参数不符合已确认的工具约束。' : code === 'limit' ? 'MCP 工具约束超过安全上限。' : 'MCP 工具包含当前不支持或无效的约束。');
    this.name = 'McpSchemaError';
  }
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const annotations = new Set(['title', 'description', '$comment']);
const numeric = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf']);
const counts = new Set(['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties']);
const dialects = new Set(['https://json-schema.org/draft/2020-12/schema', 'http://json-schema.org/draft-07/schema#']);

/** Stable JSON identity; recursively rejects cycles, non-JSON values and pathological structures. */
export function canonicalMcpJson(value: unknown, maxBytes = MCP_SCHEMA_LIMITS.argumentsBytes): string {
  let nodes = 0;
  const ancestors = new Set<object>();
  const walk = (item: unknown, depth: number): unknown => {
    if (++nodes > 8192 || depth > 32) throw new McpSchemaError('limit');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object' || !item || ancestors.has(item)) throw new McpSchemaError('invalid');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new McpSchemaError('invalid');
    ancestors.add(item);
    let result: unknown;
    if (Array.isArray(item)) result = item.map((child) => walk(child, depth + 1));
    else result = Object.fromEntries(Object.keys(item).sort().map((key) => [key, walk((item as Record<string, unknown>)[key], depth + 1)]));
    ancestors.delete(item);
    return result;
  };
  const serialized = JSON.stringify(walk(value, 0));
  if (Buffer.byteLength(serialized) > maxBytes) throw new McpSchemaError('limit');
  return serialized;
}
export function mcpDigest(value: unknown, maxBytes = 1024 * 1024): string {
  return createHash('sha256').update(canonicalMcpJson(value, maxBytes)).digest('hex');
}

export interface AdmittedMcpSchema {
  /** Exact JSON schema. Pi accepts this plain schema through its public TypeBox-compatible interface. */
  schema: Record<string, unknown> & TSchema;
  validate(value: unknown): boolean;
}

/** A deliberately bounded JSON-schema subset, compiled by the same engine used by Pi. No reference resolution. */
export function admitMcpSchema(input: unknown, objectRoot = true): AdmittedMcpSchema {
  const serialized = canonicalMcpJson(input, MCP_SCHEMA_LIMITS.bytes);
  const schema: unknown = JSON.parse(serialized);
  if (!record(schema) || (objectRoot && schema.type !== 'object')) throw new McpSchemaError('invalid');
  let nodes = 0;
  const walk = (node: unknown, depth: number) => {
    if (++nodes > MCP_SCHEMA_LIMITS.nodes || depth > MCP_SCHEMA_LIMITS.depth) throw new McpSchemaError('limit');
    if (typeof node === 'boolean') return;
    if (!record(node)) throw new McpSchemaError('invalid');
    for (const [key, value] of Object.entries(node)) {
      if (annotations.has(key)) { if (typeof value !== 'string' || value.length > 8192) throw new McpSchemaError('invalid'); }
      else if (key === '$schema') { if (depth !== 0 || typeof value !== 'string' || !dialects.has(value)) throw new McpSchemaError('unsupported'); }
      else if (key === 'type') {
        const values = Array.isArray(value) ? value : [value];
        if (!values.length || values.length > 7 || new Set(values).size !== values.length || values.some((type) => typeof type !== 'string' || !types.has(type))) throw new McpSchemaError('invalid');
      } else if (key === 'properties') {
        if (!record(value) || Object.keys(value).length > 128) throw new McpSchemaError('limit');
        for (const [name, child] of Object.entries(value)) {
          if (name.length > 256 || ['__proto__', 'prototype', 'constructor'].includes(name)) throw new McpSchemaError('unsupported');
          walk(child, depth + 1);
        }
      } else if (key === 'required') {
        if (!Array.isArray(value) || value.length > 128 || value.some((entry) => typeof entry !== 'string' || entry.length > 256) || new Set(value).size !== value.length) throw new McpSchemaError('invalid');
      } else if (key === 'items' || key === 'additionalProperties' || key === 'not') walk(value, depth + 1);
      else if (['anyOf', 'oneOf', 'allOf'].includes(key)) {
        if (!Array.isArray(value) || !value.length || value.length > 16) throw new McpSchemaError('limit');
        value.forEach((child) => walk(child, depth + 1));
      } else if (key === 'enum') {
        if (!Array.isArray(value) || !value.length || value.length > MCP_SCHEMA_LIMITS.enumValues) throw new McpSchemaError('limit');
        if (new Set(value.map((entry) => canonicalMcpJson(entry, 8192))).size !== value.length) throw new McpSchemaError('invalid');
      } else if (key === 'const' || key === 'default') canonicalMcpJson(value, 8192);
      else if (numeric.has(key)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || (key === 'multipleOf' && value <= 0)) throw new McpSchemaError('invalid');
      } else if (counts.has(key)) {
        if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000) throw new McpSchemaError('invalid');
      } else if (key === 'uniqueItems') { if (typeof value !== 'boolean') throw new McpSchemaError('invalid'); }
      else if (key === 'pattern') {
        // Linear anchored character-class patterns only. Reject lookaround/backreferences/nested quantifiers.
        if (typeof value !== 'string' || value.length > 128 || !/^\^\[[a-zA-Z0-9_\\\- .]+\](?:[+*?]|\{\d{1,5}(?:,\d{0,5})?\})?\$$/.test(value)) throw new McpSchemaError('unsupported');
        try { new RegExp(value, 'u'); } catch { throw new McpSchemaError('invalid'); }
      } else throw new McpSchemaError('unsupported');
    }
  };
  walk(schema, 0);
  try {
    const typed = schema as Record<string, unknown> & TSchema;
    const validator = Compile(typed);
    return {schema: typed, validate: (value) => validator.Check(value)};
  } catch { throw new McpSchemaError('unsupported'); }
}

/** Call after Pi coercion and any original hook transforms, then confirm these exact returned arguments. */
export function validateMcpArguments(toolOrSchema: unknown, finalArguments: unknown): Record<string, unknown> {
  const schema = record(toolOrSchema) && 'inputSchema' in toolOrSchema ? toolOrSchema.inputSchema : toolOrSchema;
  const admitted = admitMcpSchema(schema);
  canonicalMcpJson(finalArguments, MCP_SCHEMA_LIMITS.argumentsBytes);
  const clone: unknown = structuredClone(finalArguments);
  if (!record(clone) || !admitted.validate(clone)) throw new McpSchemaError('arguments');
  return clone;
}
