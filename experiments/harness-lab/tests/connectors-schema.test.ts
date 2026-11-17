import { describe, expect, it } from 'vitest';
import { admitMcpSchema, canonicalMcpJson, mcpDigest, validateMcpArguments } from '../src/connectors/schema.js';

describe('bounded MCP schema admission', () => {
  const schema = {type: 'object', properties: {count: {type: 'integer', minimum: 1}, query: {type: 'string', minLength: 2}, tags: {type: 'array', items: {enum: ['a', 'b']}, maxItems: 2}}, required: ['count', 'query'], additionalProperties: false};
  it('uses actual TypeBox compilation and preserves final arguments without coercion', () => {
    const admitted = admitMcpSchema(schema);
    expect(admitted.schema).toEqual(schema);
    expect(validateMcpArguments({inputSchema: schema}, {query: 'ok', count: 2, tags: ['a']})).toEqual({count: 2, query: 'ok', tags: ['a']});
    expect(() => validateMcpArguments(schema, {count: '2', query: 'ok'})).toThrow('参数');
    expect(() => validateMcpArguments(schema, {count: 2, query: 'x'})).toThrow('参数');
    expect(() => validateMcpArguments(schema, {count: 2, query: 'ok', extra: true})).toThrow('参数');
  });
  it.each([
    {type: 'object', properties: {x: {$ref: 'https://example.com/secret'}}},
    {type: 'object', properties: {x: {$ref: '#/$defs/x'}}, $defs: {x: {type: 'string'}}},
    {type: 'object', properties: {x: {type: 'string', format: 'uri'}}},
    {type: 'object', properties: {x: {type: 'string', pattern: '(a+)+$'}}},
    {type: 'object', $schema: 'https://example.com/other-dialect'},
    {type: 'object', unevaluatedProperties: false},
    {type: 'object', properties: {x: {type: 'string', 'x-mcp-header': 'Authorization'}}},
  ])('rejects unsupported constraints without erasing them: %j', (value) => { expect(() => admitMcpSchema(value)).toThrow(); });
  it('limits recursive graphs, depth, enums, serialized bytes and outgoing arguments', () => {
    const cycle: Record<string, unknown> = {type: 'object'}; cycle.properties = {cycle};
    expect(() => admitMcpSchema(cycle)).toThrow();
    let deep: unknown = {type: 'string'}; for (let i = 0; i < 14; i++) deep = {type: 'object', properties: {next: deep}};
    expect(() => admitMcpSchema(deep)).toThrow();
    expect(() => admitMcpSchema({type: 'object', properties: {x: {enum: Array.from({length: 129}, (_, i) => i)}}})).toThrow();
    expect(() => admitMcpSchema({type: 'object', description: 'x'.repeat(70_000)})).toThrow();
    expect(() => validateMcpArguments({type: 'object'}, {x: 'x'.repeat(70_000)})).toThrow();
  });
  it('has order-independent contract digests and validates union and safe patterns', () => {
    expect(mcpDigest({b: 2, a: 1})).toBe(mcpDigest({a: 1, b: 2}));
    expect(canonicalMcpJson({query: '中文'})).toBe('{"query":"中文"}');
    const admitted = admitMcpSchema({type: 'object', properties: {x: {anyOf: [{type: 'integer'}, {type: 'string', pattern: '^[a-z]{1,8}$'}]}}, required: ['x']});
    expect(admitted.validate({x: 'abc'})).toBe(true); expect(admitted.validate({x: 'ABC'})).toBe(false); expect(admitted.validate({x: 1})).toBe(true);
  });
});
