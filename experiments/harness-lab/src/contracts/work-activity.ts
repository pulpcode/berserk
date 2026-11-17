import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';

const strict = { additionalProperties: false };
const text = (maxLength: number) => Type.String({ minLength: 1, maxLength });
const sourceSchema = Type.Object({ sourceRequestId: text(160), finalMessageId: text(160) }, strict);
const stateSchema = Type.Union([Type.Literal('assigned'), Type.Literal('working'), Type.Literal('submitted'), Type.Literal('returned'), Type.Literal('completed')]);
const relationSchema = Type.Union([Type.Literal('processing'), Type.Literal('reference'), Type.Literal('uncertain')]);
const evidenceSchema = Type.Object({ id: text(200), messageId: text(160), requestId: text(160),
  kind: Type.Union([Type.Literal('user'), Type.Literal('assistant'), Type.Literal('receipt')]), text: text(1600) }, strict);
const itemSchema = Type.Object({ id: text(200), workItemId: Type.Union([text(160), Type.Null()]), title: text(240), description: text(480),
  relation: relationSchema, recency: Type.Union([Type.Literal('current'), Type.Literal('earlier')]),
  origin: Type.Union([Type.Literal('receipt'), Type.Literal('analysis')]), state: Type.Optional(stateSchema),
  evidenceIds: Type.Array(text(200), { minItems: 1, maxItems: 16 }) }, strict);

export const workActivityRequestSchema = Type.Object({
  sourceRequestId: Type.String({ format: 'uuid' }), finalMessageId: text(160),
  version: Type.String({ pattern: '^[a-f0-9]{64}$' }),
}, strict);
export const workActivityViewSchema = Type.Object({ version: text(64), source: Type.Union([sourceSchema, Type.Null()]),
  canAnalyze: Type.Boolean(), reason: Type.Optional(text(480)), linkedWorkItemId: Type.Optional(text(160)),
  facts: Type.Array(itemSchema), evidence: Type.Array(evidenceSchema) }, strict);
export const workActivityResponseSchema = Type.Object({ version: text(64), source: sourceSchema,
  status: Type.Union([Type.Literal('ready'), Type.Literal('unavailable')]), items: Type.Array(itemSchema),
  coverage: Type.Union([Type.Literal('complete'), Type.Literal('partial')]), reason: Type.Optional(text(480)),
}, strict);

export type WorkActivitySource = Static<typeof sourceSchema>;
export type WorkActivityEvidence = Static<typeof evidenceSchema>;
export type WorkActivityItem = Static<typeof itemSchema>;
export type WorkActivityRequest = Static<typeof workActivityRequestSchema>;
export type WorkActivityView = Static<typeof workActivityViewSchema>;
export type WorkActivityResponse = Static<typeof workActivityResponseSchema>;
export const isWorkActivityView = (value: unknown): value is WorkActivityView => Check(workActivityViewSchema, value);
export const isWorkActivityResponse = (value: unknown): value is WorkActivityResponse => Check(workActivityResponseSchema, value);
