import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { isDeepStrictEqual } from 'node:util';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { CollaborationService, type AgentCommitGrant } from '../collaboration/service.js';
import { workActionToolSchema, workReadSchema, handoffImportSchema, type ActorContext, type WorkPrepareInput } from '../contracts/collaboration.js';
import type { Workspace } from '../contracts/index.js';
import { RequestError } from '../contracts/errors.js';

export interface ApprovedWorkAction { operationId: string; parameters: Record<string, unknown>; grant: AgentCommitGrant }
interface Options {
  actor: ActorContext; workspace: Workspace; sessionId: string; requestId: string; signal: AbortSignal;
  check: () => void;
  takeApproval: (toolCallId: string) => ApprovedWorkAction | undefined;
  fail: () => void;
}
const relative = (path: string) => path.startsWith('/workspace/') ? path.slice('/workspace/'.length) : path;

/** Only explicit business/input rejections can be corrected by the model. */
export function recoverableWorkError(error: unknown): error is RequestError {
  return error instanceof RequestError && [
    'INVALID_INPUT', 'WORK_NOT_FOUND', 'WORK_CONFLICT', 'PRIVATE_TASK', 'TASK_NOT_FOUND', 'TASK_ARCHIVED', 'FORBIDDEN',
    'FILE_NOT_FOUND', 'FILE_TOO_LARGE', 'FILE_UNSAFE_FILE', 'FILE_EXISTS',
  ].includes(error.code);
}
/** Separate service DTO: never rewrite the model call or its native history. */
export function scopedWorkAction(service: CollaborationService, actor: ActorContext, workspace: Workspace, parameters: unknown): WorkPrepareInput {
  if (!Check(workActionToolSchema, parameters)) throw new RequestError('INVALID_INPUT', '工作操作参数无效。');
  if (!workspace.taskSpaceId) throw new RequestError('WORK_NOT_FOUND', '当前工作区没有可交接的项目。', 404);
  const value = structuredClone(parameters.action);
  if (value.kind === 'assign') return { ...value, taskSpaceId: workspace.taskSpaceId,
    payload: { ...value.payload, workspaceId: workspace.id, ...(value.payload.inputPaths ? { inputPaths: value.payload.inputPaths.map(relative) } : {}) } };
  if (service.read(actor, value.workItemId).taskSpaceId !== workspace.taskSpaceId) {
    throw new RequestError('WORK_NOT_FOUND', '操作不属于当前会话项目，请进入对应项目会话。', 404);
  }
  if (value.kind === 'submit') return { ...value, payload: { ...value.payload, workspaceId: workspace.id, path: relative(value.payload.path) } };
  return value;
}

/** Ordinary Pi tools; the host's existing beforeToolCall hook owns approval. */
export function collaborationTools(service: CollaborationService, options: Options) {
  const { actor, workspace } = options;
  async function execute<T>(operation: (signal: AbortSignal) => T | Promise<T>, signal?: AbortSignal) {
    options.check();
    const combined = AbortSignal.any([options.signal, ...(signal ? [signal] : [])]);
    combined.throwIfAborted();
    try {
      const result = await operation(combined);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
    } catch (error) {
      if (error instanceof RequestError) throw new Error(`${error.code}: ${error.message}`);
      if (combined.aborted) throw new Error('当前操作已停止；已提交的业务结果仍保留，请查询确认。');
      throw new Error('工作交接未完成，请查询原操作结果后再决定是否重试。');
    }
  }
  return [
    defineTool({ name: 'work_item_list', label: '查看工作待办', description: '查询当前席位在当前项目的工作，包含工作ID、目标和当前状态；不会签收或启动执行。',
      parameters: Type.Object({}, { additionalProperties: false }), executionMode: 'sequential',
      execute: (_id, _params, signal) => execute(() => service.list(actor).filter(item => item.taskSpaceId === workspace.taskSpaceId), signal) }),
    defineTool({ name: 'work_item_read', label: '查看工作详情', description: '提供workItemId查最新工作状态、revision、输入及提交记录；或只提供operationId查原操作的状态和回执。两个参数必须且只能选一个。结果不确定时先查询，不重复上报。',
      parameters: workReadSchema, executionMode: 'sequential',
      execute: (_id, params, signal) => execute(() => {
        if (Boolean(params.workItemId) === Boolean(params.operationId)) throw new RequestError('INVALID_INPUT', '请选择一个工作编号或操作编号查询。');
        return params.operationId ? service.getAction(actor, params.operationId) : service.read(actor, params.workItemId!);
      }, signal) }),
    defineTool({ name: 'work_item_action', label: '工作交接', description: '发起分派（assign）、签收（claim）、提交文件（submit）或验收／退回（review）。系统核对内容并展示确认卡，等待用户批准后执行；成功返回交接回执。文件来自当前工作区，交接使用固定副本。工作编号与 expectedRevision 从工作详情取得；需要澄清的业务信息先询问。',
      parameters: workActionToolSchema, executionMode: 'sequential',
      execute: (toolCallId, params, signal) => execute(async scopedSignal => {
        const approved = options.takeApproval(toolCallId);
        if (!approved || !isDeepStrictEqual(approved.parameters, params)) {
          options.fail();
          throw new RequestError('CONFIRMATION_REQUIRED', '该调用未获得对应内容的确认。', 409);
        }
        try { return await service.commitAgent(actor, approved.operationId, approved.grant, scopedSignal); }
        catch (error) {
          if (!scopedSignal.aborted && !recoverableWorkError(error)) options.fail();
          const code = error instanceof RequestError ? error.code : 'WORK_ACTION_FAILED';
          const reason = error instanceof RequestError ? error.message : '工作交接结果尚未确认，请查询原操作。';
          throw new RequestError(code, `${reason} operationId=${approved.operationId}`, error instanceof RequestError ? error.statusCode : 503);
        }
      }, signal) }),
    defineTool({ name: 'handoff_import_file', label: '接收交接文件', description: '将获准交接的固定文件复制到当前席位同项目工作区，返回普通文件路径供read/bash处理。已有相同内容可复用，同名不同内容不覆盖，可指定其他相对路径。',
      parameters: handoffImportSchema, executionMode: 'sequential',
      execute: (_id, params, signal) => execute(scopedSignal => service.importFile(actor, params.fileId, workspace.id, params.path ? relative(params.path) : undefined, scopedSignal), signal) }),
  ];
}
