import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { normalizeTaskContext } from '../access/context.js';
import type { AccessStore } from '../access/store.js';
import type { TaskBusinessRef, TaskSpace } from '../contracts/access.js';
import type { ContextPrincipal, ContextRef } from '../contracts/context.js';
import { RequestError } from '../contracts/errors.js';
import { UUID } from '../workspaces/store.js';

export interface TaskSearchParams {
  businessRefs?: ContextRef[];
  areaIds?: string[];
  query?: string;
  limit?: number;
  cursor?: string;
}
export type TaskQueryItem = Pick<TaskSpace, 'id' | 'title' | 'goal' | 'visibility' | 'state' | 'context' | 'revision' | 'createdAt' | 'updatedAt'>;
export interface TaskMatches { businessRefs: ContextRef[]; areaIds: string[]; textFields: Array<'title' | 'goal' | 'topics'> }
export interface TaskSearchResult {
  systemId: 'axon'; query: TaskSearchParams; queriedAt: string;
  data: { items: Array<TaskQueryItem & {matches: TaskMatches}>; limit: number; nextCursor: string | null; hasMore: boolean };
}
export interface TaskReadResult {
  systemId: 'axon'; query: {taskId: string}; queriedAt: string; data: {item: TaskQueryItem};
}

const invalid = () => new RequestError('INVALID_ARGUMENT', '任务查询参数无效。');
const invalidCursor = () => new RequestError('INVALID_CURSOR', '分页游标无效或与本次查询不匹配，请从第一页查询。');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const refKey = (ref: ContextRef) => JSON.stringify([ref.systemId, ref.objectType, ref.objectId]);

function normalize(input: TaskSearchParams): TaskSearchParams & {limit: number} {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['businessRefs', 'areaIds', 'query', 'limit', 'cursor'].includes(key))) throw invalid();
  const limit = input.limit === undefined ? 20 : input.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw invalid();
  if (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 200)) throw invalid();
  if (input.cursor !== undefined && (typeof input.cursor !== 'string' || !input.cursor || input.cursor.length > 2048)) throw invalidCursor();
  let context;
  try {
    if (input.businessRefs?.some(ref => Object.keys(ref).some(key => !['systemId', 'objectType', 'objectId'].includes(key)))) throw invalid();
    context = normalizeTaskContext({
      ...(input.businessRefs === undefined ? {} : {businessRefs: input.businessRefs}),
      ...(input.areaIds === undefined ? {} : {focus: {areaIds: input.areaIds}}),
    });
  } catch { throw invalid(); }
  return {
    ...(context?.businessRefs ? {businessRefs: context.businessRefs} : {}),
    ...(context?.focus?.areaIds ? {areaIds: context.focus.areaIds} : {}),
    ...(input.query?.trim() ? {query: input.query.trim().toLocaleLowerCase('en-US')} : {}),
    limit, ...(input.cursor ? {cursor: input.cursor} : {}),
  };
}

function project(task: TaskSpace): TaskQueryItem {
  return {
    id: task.id, title: task.title, goal: task.goal, visibility: task.visibility, state: task.state,
    revision: task.revision, createdAt: task.createdAt, updatedAt: task.updatedAt,
    ...(task.context ? {context: task.context} : {}),
  };
}

function matches(task: TaskSpace, query: TaskSearchParams): TaskMatches {
  const wanted = new Set(query.businessRefs?.map(refKey));
  const businessRefs = (task.context?.businessRefs ?? []).filter(ref => wanted.has(refKey(ref)))
    .map(({systemId, objectType, objectId}: TaskBusinessRef) => ({systemId, objectType, objectId}));
  const areaIds = (task.context?.focus?.areaIds ?? []).filter(id => query.areaIds?.includes(id));
  const textFields: TaskMatches['textFields'] = [];
  if (query.query) {
    const needle = query.query;
    for (const key of ['title', 'goal'] as const) if (task[key].toLocaleLowerCase('en-US').includes(needle)) textFields.push(key);
    if (task.context?.focus?.topics?.some(topic => topic.toLocaleLowerCase('en-US').includes(needle))) textFields.push('topics');
  }
  return { businessRefs, areaIds, textFields };
}

/** Read-only metadata queries. No workspace/session/file service is used by this class. */
export class TaskQueryService {
  private readonly cursorKey = randomBytes(32);
  constructor(private readonly access: AccessStore) {}

  private authorize(principal: ContextPrincipal) {
    if (principal.kind === 'service') return;
    if (principal.kind !== 'seat' || !this.access.seats().some(seat => seat.id === principal.seatId)) throw new RequestError('FORBIDDEN', '当前席位不可查询任务。', 403);
  }

  search(input: TaskSearchParams, principal: ContextPrincipal, signal?: AbortSignal): TaskSearchResult {
    signal?.throwIfAborted(); this.authorize(principal);
    const query = normalize(input);
    const tasks = (principal.kind === 'service' ? this.access.listActivePublic() : this.access.list(principal.seatId).filter(task => task.state === 'active'))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const filtered = !!(query.businessRefs?.length || query.areaIds?.length || query.query);
    const items = tasks.map(task => ({...project(task), matches: matches(task, query)}))
      .filter(task => !filtered || task.matches.businessRefs.length || task.matches.areaIds.length || task.matches.textFields.length);
    const {cursor, ...conditions} = query;
    const queryHash = hash([principal.kind, principal.kind === 'seat' ? principal.seatId : principal.profileId, conditions]);
    // Include all visible active revisions: a later edit could introduce a new match on an earlier page.
    const datasetHash = hash(tasks.map(task => [task.id, task.revision]));
    const offset = cursor ? this.readCursor(cursor, queryHash, datasetHash) : 0;
    if (offset > items.length) throw invalidCursor();
    const page = items.slice(offset, offset + query.limit);
    const nextCursor = offset + page.length < items.length ? this.makeCursor(queryHash, datasetHash, offset + page.length) : null;
    signal?.throwIfAborted();
    return { systemId: 'axon', query, queriedAt: new Date().toISOString(), data: {items: page, limit: query.limit, nextCursor, hasMore: nextCursor !== null} };
  }

  read(taskId: string, principal: ContextPrincipal, signal?: AbortSignal): TaskReadResult {
    signal?.throwIfAborted(); this.authorize(principal);
    if (typeof taskId !== 'string' || !UUID.test(taskId)) throw invalid();
    const task = principal.kind === 'service' ? this.access.getActivePublic(taskId) : this.access.get(taskId, principal.seatId);
    return {systemId: 'axon', query: {taskId}, queriedAt: new Date().toISOString(), data: {item: project(task)}};
  }

  private makeCursor(queryHash: string, datasetHash: string, offset: number) {
    const payload = Buffer.from(JSON.stringify({queryHash, datasetHash, offset})).toString('base64url');
    return `${payload}.${createHmac('sha256', this.cursorKey).update(payload).digest('base64url')}`;
  }

  private readCursor(cursor: string, queryHash: string, datasetHash: string): number {
    const parts = cursor.split('.');
    if (parts.length !== 2) throw invalidCursor();
    const [payload, signature] = parts;
    const expected = createHmac('sha256', this.cursorKey).update(payload).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw invalidCursor();
    let value: {queryHash?: unknown; datasetHash?: unknown; offset?: unknown};
    try { value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw invalidCursor(); }
    if (!value || value.queryHash !== queryHash || !Number.isSafeInteger(value.offset) || Number(value.offset) < 1) throw invalidCursor();
    if (value.datasetHash !== datasetHash) throw new RequestError('CURSOR_STALE', '任务资料已变化，请从第一页重新查询。', 409);
    return Number(value.offset);
  }
}
