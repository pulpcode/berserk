import type { TaskBusinessRef, TaskContext } from '../contracts/access.js';
import { RequestError } from '../contracts/errors.js';

const invalid = () => new RequestError('INVALID_INPUT', '业务关联与关注范围格式无效，请检查字段、数量及带时区的时间。');
const idSchema = { type: 'string', minLength: 1, maxLength: 128 };
const timeSchema = { type: 'string', format: 'date-time', maxLength: 64 };
export const taskContextSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    businessRefs: {
      type: 'array', maxItems: 20, items: {
        type: 'object', additionalProperties: false, required: ['systemId', 'objectType', 'objectId'],
        properties: { systemId: idSchema, objectType: idSchema, objectId: idSchema, label: { type: 'string', maxLength: 200 } },
      },
    },
    focus: {
      type: 'object', additionalProperties: false,
      properties: {
        areaIds: { type: 'array', maxItems: 10, items: idSchema },
        topics: { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 200 } },
        time: { type: 'object', additionalProperties: false, properties: { from: timeSchema, to: timeSchema } },
      },
    },
  },
};

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw invalid();
  return value.trim();
}

function strings(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw invalid();
  return [...new Set(value.map(item => text(item, maxLength)))].sort();
}

function timestamp(value: unknown): string {
  const result = text(value, 64);
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/i.exec(result);
  if (!parts) throw invalid();
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = parts;
  const leapYear = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(month) - 1];
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > days || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || Number(offsetHour ?? 0) > 23 || Number(offsetMinute ?? 0) > 59 || !Number.isFinite(Date.parse(result))) throw invalid();
  return new Date(result).toISOString();
}

/** Canonical JSON for storage and create idempotency; references are not remotely verified here. */
export function normalizeTaskContext(value: unknown): TaskContext | undefined {
  const source = object(value, ['businessRefs', 'focus']);
  const result: TaskContext = {};
  if (source.businessRefs !== undefined) {
    if (!Array.isArray(source.businessRefs) || source.businessRefs.length > 20) throw invalid();
    const refs = new Map<string, TaskBusinessRef>();
    for (const value of source.businessRefs) {
      const item = object(value, ['systemId', 'objectType', 'objectId', 'label']);
      const ref: TaskBusinessRef = { systemId: text(item.systemId, 128), objectType: text(item.objectType, 128), objectId: text(item.objectId, 128) };
      if (item.label !== undefined) { const label = text(item.label, 200, true); if (label) ref.label = label; }
      const key = JSON.stringify([ref.systemId, ref.objectType, ref.objectId]);
      // A label is display-only. Repeated references keep one deterministic display label.
      const old = refs.get(key);
      if (!old || (ref.label !== undefined && (old.label === undefined || ref.label < old.label))) refs.set(key, ref);
    }
    if (refs.size) result.businessRefs = [...refs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, ref]) => ref);
  }
  if (source.focus !== undefined) {
    const item = object(source.focus, ['areaIds', 'time', 'topics']);
    const focus: NonNullable<TaskContext['focus']> = {};
    if (item.areaIds !== undefined) { const values = strings(item.areaIds, 10, 128); if (values.length) focus.areaIds = values; }
    if (item.time !== undefined) {
      const input = object(item.time, ['from', 'to']);
      const time: NonNullable<typeof focus.time> = {};
      if (input.from !== undefined) time.from = timestamp(input.from);
      if (input.to !== undefined) time.to = timestamp(input.to);
      if (time.from && time.to && Date.parse(time.from) >= Date.parse(time.to)) throw invalid();
      if (Object.keys(time).length) focus.time = time;
    }
    if (item.topics !== undefined) { const values = strings(item.topics, 10, 200); if (values.length) focus.topics = values; }
    if (Object.keys(focus).length) result.focus = focus;
  }
  return Object.keys(result).length ? result : undefined;
}
