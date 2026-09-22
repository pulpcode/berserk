import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { CollaborationService } from '../collaboration/service.js';
import { workPrepareSchema, workReadSchema, workCommitSchema, handoffImportSchema, type ActorContext, type WorkPrepareInput } from '../contracts/collaboration.js';
import type { Workspace } from '../contracts/index.js';
import { RequestError } from '../contracts/errors.js';

interface Options {
  actor: ActorContext; workspace: Workspace; sessionId: string; requestId: string; signal: AbortSignal;
  check: () => void;
  grant: (toolCallId: string) => { sessionId: string; requestId: string; toolCallId: string; interactionId: string } | undefined;
}
const relative = (path: string) => path.startsWith('/workspace/') ? path.slice('/workspace/'.length) : path;

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
  function scoped(input: WorkPrepareInput): WorkPrepareInput {
    const value = structuredClone(input);
    const taskSpaceId = value.kind === 'assign' ? value.taskSpaceId : service.read(actor, value.workItemId).taskSpaceId;
    if (taskSpaceId !== workspace.taskSpaceId || ('workspaceId' in value.payload && value.payload.workspaceId !== workspace.id)) {
      throw new RequestError('WORK_NOT_FOUND', '操作不属于当前会话项目或工作区，请进入对应项目会话。', 404);
    }
    if (value.kind === 'assign' && value.payload.inputPaths) value.payload.inputPaths = value.payload.inputPaths.map(relative);
    if (value.kind === 'submit') value.payload.path = relative(value.payload.path);
    return value;
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
    defineTool({ name: 'work_item_prepare', label: '准备工作交接', description: '准备分派（assign）、签收（claim）、提交文件（submit）或验收/退回（review）。assign/submit 的 workspaceId 使用当前工作区；claim/submit/review 的 expectedRevision 使用工作最新版本。保存准备内容，返回 operationId 和本次实际附件 files。核对交接内容后，用返回的 operationId 调用 work_item_commit 展示确认卡片并等待用户批准。对象或文件不明确时先澄清。',
      parameters: Type.Object({ action: workPrepareSchema }, { additionalProperties: false }), executionMode: 'sequential',
      execute: (toolCallId, params, signal) => execute(scopedSignal => service.prepare(actor, scoped(params.action), {
        source: 'agent', sessionId: options.sessionId, requestId: options.requestId, toolCallId,
      }, scopedSignal), signal) }),
    defineTool({ name: 'work_item_commit', label: '确认工作交接', description: '提交本请求准备的operationId；工具会展示固定内容并等待用户明确批准。不能替换参数、借旧批准或用AskUser答案授权。拒绝后不要重复尝试同一操作。成功回执表示已交接，可结束本轮，无需等待对方办理。',
      parameters: workCommitSchema, executionMode: 'sequential',
      execute: (toolCallId, params, signal) => execute(scopedSignal => {
        const grant = options.grant(toolCallId);
        if (!grant) throw new RequestError('CONFIRMATION_REQUIRED', '该调用尚未获得确认。', 409);
        return service.commitAgent(actor, params.operationId, grant, scopedSignal);
      }, signal) }),
    defineTool({ name: 'handoff_import_file', label: '接收交接文件', description: '将获准交接的固定文件复制到当前席位同项目工作区，返回普通文件路径供read/bash处理。已有相同内容可复用，同名不同内容不覆盖，可指定其他相对路径。',
      parameters: handoffImportSchema, executionMode: 'sequential',
      execute: (_id, params, signal) => execute(scopedSignal => service.importFile(actor, params.fileId, workspace.id, params.path ? relative(params.path) : undefined, scopedSignal), signal) }),
  ];
}
