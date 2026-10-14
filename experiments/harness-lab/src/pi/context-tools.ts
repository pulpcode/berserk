import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { ContextPrincipal, ContextQueryResult } from '../contracts/context.js';
import type { ContextService } from '../context/service.js';
import type { TaskQueryItem, TaskQueryService } from '../context/task-query.js';
import { RequestError } from '../contracts/errors.js';

const id = Type.String({minLength: 1, maxLength: 128});
const refs = Type.Array(Type.Object({systemId: id, objectType: id, objectId: id}, {additionalProperties: false}), {maxItems: 20});
const filters = {objectRefs: Type.Optional(Type.Array(refs.items, {minItems: 1, maxItems: 20, description: '精确选择完整来源对象引用；只查道路/车辆不会自动返回其所属区域对象。'})), areaIds: Type.Optional(Type.Array(id, {minItems: 1, maxItems: 10, description: '按所属区域筛选，可使用 task_read 的 context.focus.areaIds。查询区域边界时不要同时保留仅道路/车辆的 objectRefs 限制。区域标签不保证有边界几何。'})),
  query: Type.Optional(Type.String({maxLength: 200})), limit: Type.Optional(Type.Integer({minimum: 1, maximum: 100})),
  cursor: Type.Optional(Type.String({minLength: 1, maxLength: 2048}))};
const time = {from: Type.Optional(Type.String({maxLength: 64})), to: Type.Optional(Type.String({maxLength: 64}))};

/** Host queries return their actual response to Pi; native tool history is the evidence store. */
export function contextTools(context: ContextService, tasks: TaskQueryService | undefined, principal: ContextPrincipal,
  controller: AbortController, authorize: () => void,
  observeTasks?: (items: TaskQueryItem[], searched: boolean) => void, observeSituation?: (result: ContextQueryResult) => void) {
  const visibleIds = principal.kind === 'seat' ? context.catalog(principal.seatId).systems.map(system => system.id) : principal.scope.systemIds;
  const systems = context.config.systems.filter(system => visibleIds.includes(system.id));
  const catalog = (adapter: 'mock-information-http' | 'mock-situation-http') => systems.filter(system => system.adapter === adapter)
    .map(system => `${system.id}（${system.name}${system.adapter === 'mock-situation-http' ? '；对象类型 road 道路、resource 资源、area 区域' : ''}）`).join('；') || '无';
  const execute = async <T>(work: (signal: AbortSignal) => T | Promise<T>, signal?: AbortSignal, observe?: (result: T) => void) => {
    const scoped = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    scoped.throwIfAborted(); authorize();
    try {
      const result = await work(scoped);
      scoped.throwIfAborted(); authorize();
      observe?.(result);
      return {content: [{type: 'text' as const, text: JSON.stringify(result)}], details: {}};
    } catch (error) {
      scoped.throwIfAborted();
      if (error instanceof RequestError) throw new Error(`${error.code}: ${error.message}`);
      throw error;
    }
  };
  return [
    defineTool({name: 'information_search', label: '查询报告',
      description: `查询业务系统报告索引与历史修订，分页返回。支持的 systemId：${catalog('mock-information-http')}。组合筛选取交集；当前适配器 query 按完整文本包含匹配，不自动将多个词拆开搜索；无命中仅表示本次条件未找到。from/to 筛选观测时间。索引不等于正文，正文用 information_read。界面根据实际查询结果提供地图入口，正文无需拼写地图链接。`,
      parameters: Type.Object({systemId: id, ...filters, reportId: Type.Optional(id), subjectId: Type.Optional(id), ...time}, {additionalProperties: false}), executionMode: 'sequential',
      execute: (_id, params, signal) => execute(scoped => context.query('information_search', params, principal, scoped), signal)}),
    defineTool({name: 'information_read', label: '读取报告', description: `按 systemId、reportId 读取完整报告。支持的 systemId：${catalog('mock-information-http')}。revision 指定历史修订，省略时返回最新修订；返回实际修订、业务时间和对象引用。界面根据实际查询结果提供地图入口，正文无需拼写地图链接。`,
      parameters: Type.Object({systemId: id, reportId: id, revision: Type.Optional(Type.Integer({minimum: 1}))}, {additionalProperties: false}), executionMode: 'sequential',
      execute: (_id, params, signal) => execute(scoped => context.query('information_read', params, principal, scoped), signal)}),
    defineTool({name: 'situation_query', label: '查询态势', description: `查询当前对象状态（current）或变化记录（changes）。支持的 systemId：${catalog('mock-situation-http')}。需要来源区域边界时，可用任务 focus.areaIds 筛选并分页查找 area 对象，再用返回的完整 ref 精确读取；不猜测区域对象 ID。objectRefs/areaIds/query 组合取交集，query 为完整文本包含匹配。仅查询点线未返回区域不代表区域不存在；未查询、无命中、缺 geometry 和来源失败须区分，不自行估算来源边界。queriedAt 是宿主查询时间，asOf 是来源快照时间，effectiveAt/validTime 是业务时间，引用时保留原值，不只更换时区后缀。changes 可用 after 或 from/to，不能混用；cursor 仅翻页，末页 nextAfter 用于增量查询。unknownRefs 表示未找到，不能推断状态。界面根据实际查询结果提供地图入口，正文无需拼写地图链接。`,
      parameters: Type.Object({systemId: id, mode: Type.Union([Type.Literal('current'), Type.Literal('changes')]), ...filters, ...time,
        after: Type.Optional(Type.String({minLength: 1, maxLength: 2048}))}, {additionalProperties: false}), executionMode: 'sequential',
      execute: (_id, params, signal) => execute(scoped => context.query('situation_query', params, principal, scoped), signal, observeSituation)}),
    ...(tasks ? [
      defineTool({name: 'task_search', label: '查询相关任务', description: '查询可见活动任务的目标与关注范围。businessRefs、areaIds、query 按并集查找候选，返回命中原因；候选不代表受影响，需结合任务时间和业务资料判断。服务身份仅查活动公共任务，不读取任务文件或会话。',
        parameters: Type.Object({businessRefs: Type.Optional(refs), areaIds: Type.Optional(Type.Array(id, {maxItems: 10})), query: filters.query, limit: filters.limit, cursor: filters.cursor}, {additionalProperties: false}), executionMode: 'sequential',
        execute: (_id, params, signal) => execute(scoped => tasks.search(params, principal, scoped), signal, result => observeTasks?.(result.data.items, true))}),
      defineTool({name: 'task_read', label: '读取任务', description: '按 taskId 读取获准任务的目标、业务引用和关注范围；不创建工作区或读取文件、聊天。',
        parameters: Type.Object({taskId: Type.String({format: 'uuid'})}, {additionalProperties: false}), executionMode: 'sequential',
        execute: (_id, params, signal) => execute(scoped => tasks.read(params.taskId, principal, scoped), signal, result => observeTasks?.([result.data.item], false))}),
    ] : []),
  ];
}
