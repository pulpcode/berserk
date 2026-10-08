import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { ContextPrincipal } from '../contracts/context.js';
import type { ContextService } from '../context/service.js';
import type { TaskQueryService } from '../context/task-query.js';
import { RequestError } from '../contracts/errors.js';

const id = Type.String({minLength: 1, maxLength: 128});
const refs = Type.Array(Type.Object({systemId: id, objectType: id, objectId: id}, {additionalProperties: false}), {maxItems: 20});
const filters = {objectRefs: Type.Optional(Type.Array(refs.items, {minItems: 1, maxItems: 20})), areaIds: Type.Optional(Type.Array(id, {minItems: 1, maxItems: 10})),
  query: Type.Optional(Type.String({maxLength: 200})), limit: Type.Optional(Type.Integer({minimum: 1, maximum: 100})),
  cursor: Type.Optional(Type.String({minLength: 1, maxLength: 2048}))};
const time = {from: Type.Optional(Type.String({maxLength: 64})), to: Type.Optional(Type.String({maxLength: 64}))};

/** Host queries return their actual response to Pi; native tool history is the evidence store. */
export function contextTools(context: ContextService, tasks: TaskQueryService | undefined, principal: ContextPrincipal,
  controller: AbortController, authorize: () => void) {
  const visibleIds = principal.kind === 'seat' ? context.catalog(principal.seatId).systems.map(system => system.id) : principal.scope.systemIds;
  const systems = context.config.systems.filter(system => visibleIds.includes(system.id));
  const catalog = (adapter: 'mock-information-http' | 'mock-situation-http') => systems.filter(system => system.adapter === adapter)
    .map(system => `${system.id}（${system.name}）`).join('；') || '无';
  const execute = async (work: (signal: AbortSignal) => unknown, signal?: AbortSignal) => {
    const scoped = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    scoped.throwIfAborted(); authorize();
    try {
      const result = await work(scoped);
      scoped.throwIfAborted(); authorize();
      return {content: [{type: 'text' as const, text: JSON.stringify(result)}], details: {}};
    } catch (error) {
      scoped.throwIfAborted();
      if (error instanceof RequestError) throw new Error(`${error.code}: ${error.message}`);
      throw error;
    }
  };
  return [
    defineTool({name: 'information_search', label: '查询报告',
      description: `查询业务系统报告索引与历史修订，分页返回。支持的 systemId：${catalog('mock-information-http')}。组合筛选取交集；from/to 筛选观测时间。索引不等于正文，正文用 information_read。`,
      parameters: Type.Object({systemId: id, ...filters, reportId: Type.Optional(id), subjectId: Type.Optional(id), ...time}, {additionalProperties: false}), executionMode: 'sequential',
      execute: (_id, params, signal) => execute(scoped => context.query('information_search', params, principal, scoped), signal)}),
    defineTool({name: 'information_read', label: '读取报告', description: `按 systemId、reportId 读取完整报告。支持的 systemId：${catalog('mock-information-http')}。revision 指定历史修订，省略时返回最新修订；返回实际修订、业务时间和对象引用。`,
      parameters: Type.Object({systemId: id, reportId: id, revision: Type.Optional(Type.Integer({minimum: 1}))}, {additionalProperties: false}), executionMode: 'sequential',
      execute: (_id, params, signal) => execute(scoped => context.query('information_read', params, principal, scoped), signal)}),
    defineTool({name: 'situation_query', label: '查询态势', description: `查询当前对象状态（current）或变化记录（changes）。支持的 systemId：${catalog('mock-situation-http')}。changes 可用 after 变化游标或 from/to 业务时间范围，不能混用；cursor 仅用于翻页，末页 nextAfter 用于下次增量查询。unknownRefs 表示未找到的对象，不能推断其状态。`,
      parameters: Type.Object({systemId: id, mode: Type.Union([Type.Literal('current'), Type.Literal('changes')]), ...filters, ...time,
        after: Type.Optional(Type.String({minLength: 1, maxLength: 2048}))}, {additionalProperties: false}), executionMode: 'sequential',
      execute: (_id, params, signal) => execute(scoped => context.query('situation_query', params, principal, scoped), signal)}),
    ...(tasks ? [
      defineTool({name: 'task_search', label: '查询相关任务', description: '查询可见活动任务的目标与关注范围。businessRefs、areaIds、query 按并集查找候选，返回命中原因；候选不代表受影响，需结合任务时间和业务资料判断。服务身份仅查活动公共任务，不读取任务文件或会话。',
        parameters: Type.Object({businessRefs: Type.Optional(refs), areaIds: Type.Optional(Type.Array(id, {maxItems: 10})), query: filters.query, limit: filters.limit, cursor: filters.cursor}, {additionalProperties: false}), executionMode: 'sequential',
        execute: (_id, params, signal) => execute(scoped => tasks.search(params, principal, scoped), signal)}),
      defineTool({name: 'task_read', label: '读取任务', description: '按 taskId 读取获准任务的目标、业务引用和关注范围；不创建工作区或读取文件、聊天。',
        parameters: Type.Object({taskId: Type.String({format: 'uuid'})}, {additionalProperties: false}), executionMode: 'sequential',
        execute: (_id, params, signal) => execute(scoped => tasks.read(params.taskId, principal, scoped), signal)}),
    ] : []),
  ];
}
