import { defineTool, type SessionManager } from '@earendil-works/pi-coding-agent';
import type { AnnotationActor, AnnotationService } from '../annotations/service.js';
import type { ContextService } from '../context/service.js';
import { TaskResourceService } from '../context/task-resources.js';
import { resourceRequestSchema, type ResourceRequest } from '../contracts/resource-results.js';
import { RequestError } from '../contracts/errors.js';
import { SpatialInputs } from '../spatial/inputs.js';
import { resolveSpatialResult } from './spatial-results.js';
import { resolveResourceMessage, resolveResourceResult, resourceToolResult, resourceUserMessages } from './task-resource-results.js';

export function taskResourceTools(annotations: AnnotationService, context: ContextService | undefined, manager: SessionManager,
  scope: { actor: AnnotationActor; workspaceId: string; sessionId: string; taskId: string; requestId: string; signal: AbortSignal; check: () => void }) {
  const service = new TaskResourceService(annotations, context);
  return [defineTool({
    name: 'task_resource_query', label: '查询任务资源',
    description: '只读资源查询、固定结果读取和数量统计。query purpose:data 按明确 sources/annotations 范围读取；purpose:task 在未指定范围时按平台任务引用、当前草稿/基线、采用版及有据支援取数，不扫描全部授权来源。数据命中、任务相关、已分配、可用是不同事实；来源无需支持任务查询。关系未知不阻断明确数据范围的普通统计。保留未知、故障、缺位置、冲突和覆盖缺口，不将未知说成0。查询结果messageCandidates列出本次资源对应的用户原文和entryId供核对。messages仅接收本分支真实用户消息定位、其明确资源引用与原文，引用核实不认证模型理解。read使用本会话resultRef，offset/limit仅展示固定结果分页，不重新查询。summarize用完整固定结果，relation可选择关系，availability可选择可用/不可用/未知/冲突，实际统计条件和固定事实时间由statisticsScope回显；位置统计传来自该资源结果的spatialResultRef与position，不混另一查询；资源数量分单位/含义，不能合计时返回原因。新查询/统计生成新resultRef；不保存或发布标绘。',
    parameters: resourceRequestSchema, executionMode: 'sequential',
    execute: async (callId, params, signal) => {
      const active = { ...scope, signal: signal ? AbortSignal.any([scope.signal, signal]) : scope.signal,
        check: () => { scope.check(); annotations.actorForSeat(scope.actor.seatId, scope.actor.userId); annotations.binding(scope.actor, scope.sessionId); },
        listMessages: () => resourceUserMessages(manager.getBranch(), scope.workspaceId, scope.sessionId),
        resolveMessage: (entryId: string) => resolveResourceMessage(manager.getBranch(), scope.workspaceId, scope.sessionId, entryId),
        resolveResult: (ref: string) => resolveSpatialResult(manager.getBranch(), ref),
        resolveResourceResult: (ref: string) => resolveResourceResult(manager.getBranch(), ref),
      };
      try {
        active.signal.throwIfAborted(); active.check();
        const request = params as ResourceRequest;
        if (request.operation === 'query') return resourceToolResult(await service.query(request, active, scope.requestId, callId));
        const parent = active.resolveResourceResult(request.resultRef); service.authorize(parent, active);
        if (request.operation === 'read') return resourceToolResult({ ...parent, delivery: { requestId: scope.requestId, toolCallId: callId } }, request.offset, request.limit);
        const spatial = request.spatialResultRef ? active.resolveResult(request.spatialResultRef) : undefined;
        if (spatial) new SpatialInputs(annotations, context).authorize(spatial, active);
        const result = service.summarize(request, parent, active, scope.requestId, callId, spatial);
        active.signal.throwIfAborted(); active.check();
        return resourceToolResult(result);
      } catch (error) {
        active.signal.throwIfAborted();
        throw new Error(JSON.stringify({ code: error instanceof RequestError ? error.code : 'RESOURCE_QUERY_FAILED', message: error instanceof Error ? error.message : '资源查询失败。', outcome: 'not_committed' }));
      }
    },
  })];
}
