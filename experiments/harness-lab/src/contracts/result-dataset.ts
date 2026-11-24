export const resultDatasetFormat = 'result-dataset.v1';
export const resultDatasetMaxBytes = 48 * 1024;
export const resultDatasetMaxColumns = 32;
export const resultDatasetMaxRows = 1000;

export type ResultDatasetCell = string | number | boolean | null;
export interface ResultDatasetColumn {
  id: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'datetime';
  unit?: string;
  radarScale?: { min: number; max: number; direction: 'higher' | 'lower'; source: string };
}
export interface ResultDatasetV1 {
  format: typeof resultDatasetFormat;
  columns: ResultDatasetColumn[];
  rows: Array<{ id: string; values: Record<string, ResultDatasetCell> }>;
  provenance: { source: string; scope: string; method: string };
}
export interface ResultDatasetReceipt {
  resultRef: string;
  sessionId: string;
  requestId: string;
  toolCallId: string;
  dataset: ResultDatasetV1;
}
type ResultDatasetScope = Partial<Pick<ResultDatasetReceipt, 'sessionId' | 'requestId' | 'toolCallId' | 'resultRef'>>;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function fields(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  return required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function id(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value);
}
function label(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && value.trim().length > 0;
}
function number(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
    && (!Number.isInteger(value) || Number.isSafeInteger(value));
}
function datetime(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value)) || value.slice(11, 13) === '24') return false;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return date.getUTCDate() === Number(match[3]);
}
function column(value: unknown): value is ResultDatasetColumn {
  if (!record(value) || !fields(value, ['id', 'label', 'type'], ['unit', 'radarScale'])
    || !id(value.id) || !label(value.label, 120)
    || typeof value.type !== 'string' || !['string', 'number', 'boolean', 'datetime'].includes(value.type)) return false;
  if (Object.hasOwn(value, 'unit') && (value.type !== 'number' || !label(value.unit, 40))) return false;
  if (!Object.hasOwn(value, 'radarScale')) return true;
  const scale = value.radarScale;
  return value.type === 'number' && record(scale) && fields(scale, ['min', 'max', 'direction', 'source'])
    && number(scale.min) && number(scale.max) && scale.min < scale.max
    && (scale.direction === 'higher' || scale.direction === 'lower') && label(scale.source, 240);
}
function cell(value: unknown, type: ResultDatasetColumn['type']): boolean {
  if (value === null) return true;
  switch (type) {
    case 'string': return typeof value === 'string' && value.length <= 512;
    case 'number': return number(value);
    case 'boolean': return typeof value === 'boolean';
    case 'datetime': return datetime(value);
  }
}
export function resultDatasetValid(value: unknown): value is ResultDatasetV1 {
  if (!record(value) || !fields(value, ['format', 'columns', 'rows', 'provenance'])
    || value.format !== resultDatasetFormat
    || !Array.isArray(value.columns) || value.columns.length === 0 || value.columns.length > resultDatasetMaxColumns
    || !value.columns.every(column) || new Set(value.columns.map(item => item.id)).size !== value.columns.length
    || !Array.isArray(value.rows) || value.rows.length > resultDatasetMaxRows) return false;
  const { columns, provenance } = value;
  if (!record(provenance) || !fields(provenance, ['source', 'scope', 'method'])
    || !label(provenance.source, 500) || !label(provenance.scope, 500) || !label(provenance.method, 500)) return false;
  const rows = new Set<string>();
  for (const row of value.rows) {
    if (!record(row) || !fields(row, ['id', 'values']) || !id(row.id) || rows.has(row.id) || !record(row.values)) return false;
    const cells = row.values;
    if (Object.keys(cells).length !== columns.length
      || !columns.every(item => Object.hasOwn(cells, item.id) && cell(cells[item.id], item.type))) return false;
    rows.add(row.id);
  }
  return new TextEncoder().encode(JSON.stringify(value)).length <= resultDatasetMaxBytes;
}

export function createResultDatasetRef(requestId: string, toolCallId: string): string {
  return `dataset:${requestId}:${encodeURIComponent(toolCallId)}`;
}
export function resultDatasetReceipt(value: unknown, scope: ResultDatasetScope = {}): ResultDatasetReceipt | undefined {
  if (!record(value) || !fields(value, ['resultRef', 'sessionId', 'requestId', 'toolCallId', 'dataset'])
    || !label(value.sessionId, 128) || !label(value.toolCallId, 256) || !label(value.resultRef, 500)
    || typeof value.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.requestId)
    || Object.entries(scope).some(([key, expected]) => value[key] !== expected)) return;
  try {
    if (value.resultRef !== createResultDatasetRef(value.requestId, value.toolCallId) || !resultDatasetValid(value.dataset)) return;
  } catch { return; }
  return { resultRef: value.resultRef, sessionId: value.sessionId, requestId: value.requestId, toolCallId: value.toolCallId, dataset: value.dataset };
}
