import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { RecordTaskAssessment, TaskAssessmentEvidence } from '../background/executor.js';
import { RequestError } from '../contracts/errors.js';

export interface TaskInformationReader {
  list(seatId: string, taskId: string, params: {query?: string; offset?: number; limit?: number}, signal?: AbortSignal): unknown | Promise<unknown>;
  read(seatId: string, taskId: string, params: {eventId: string; jobId: string; section: 'original' | 'analysis'}, signal?: AbortSignal): unknown | Promise<unknown>;
}

const taskId = Type.String({format: 'uuid'});
const reason = Type.String({minLength: 1, maxLength: 1500});

/** Normal Pi tool results are the model's only response; no extra prompt or history entry. */
async function execute(controller: AbortController, authorize: () => void, signal: AbortSignal | undefined,
  work: (signal: AbortSignal) => unknown | Promise<unknown>, maxBytes?: number) {
  const scoped = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  scoped.throwIfAborted(); authorize();
  try {
    const result = await work(scoped);
    scoped.throwIfAborted(); authorize();
    const text = JSON.stringify(result);
    if (maxBytes !== undefined && Buffer.byteLength(text, 'utf8') > maxBytes) throw new RequestError('TASK_INFORMATION_TOO_LARGE', '结果超过单次读取上限，请缩小查询范围或在网页查看。', 413);
    return {content: [{type: 'text' as const, text}], details: {}};
  } catch (error) {
    scoped.throwIfAborted();
    if (error instanceof RequestError) throw new Error(`${error.code}: ${error.message}`);
    throw error;
  }
}

export function taskAssessmentTool(record: RecordTaskAssessment, evidence: () => TaskAssessmentEvidence,
  controller: AbortController, authorize: () => void) {
  return defineTool({
    name: 'information_record_task_assessment', label: '记录任务判断',
    description: '记录当前信息的任务判断：关联已查询的公共任务，或建议新建公共任务，或说明暂不归口的原因。每次提交完整判断，三者选一；新建建议须有独立工作目标及理由；任务可为一次性交付。本工具不创建任务，不改变投递。',
    parameters: Type.Object({
      relations: Type.Array(Type.Object({taskId, reason}, {additionalProperties: false}), {maxItems: 100}),
      newTaskSuggestion: Type.Optional(Type.Object({title: Type.String({minLength: 1, maxLength: 60}),
        goal: Type.String({minLength: 1, maxLength: 8000}), reason}, {additionalProperties: false})),
      emptyReason: Type.Optional(reason),
    }, {additionalProperties: false}),
    executionMode: 'sequential',
    execute: (toolCallId, params, signal) => execute(controller, authorize, signal, async scoped => {
      const result = await record(params, evidence(), toolCallId, scoped);
      return {...result, message: result.assessment.newTaskSuggestion
        ? '建议已记录，尚未创建任务；本次分析成功结束后展示。'
        : '任务判断已记录，本次分析成功结束后展示。'};
    }),
  });
}

/** Seat callbacks recheck current authority; registration does not depend on external context systems. */
export function taskInformationTools(reader: TaskInformationReader, seatId: string, currentTaskId: string,
  controller: AbortController, authorize: () => void) {
  return [
    defineTool({name: 'task_information_list', label: '查询任务相关信息',
      description: '分页查询获准任务已关联的信息及分析版本，含关联理由。taskId 省略时使用当前任务；默认 20 条、最多 100 条。不会导入附件或启动分析。',
      parameters: Type.Object({taskId: Type.Optional(taskId), query: Type.Optional(Type.String({maxLength: 200})),
        offset: Type.Optional(Type.Integer({minimum: 0})), limit: Type.Optional(Type.Integer({minimum: 1, maximum: 100}))}, {additionalProperties: false}),
      executionMode: 'sequential', execute: (_id, {taskId, ...params}, signal) =>
        execute(controller, authorize, signal, scoped => reader.list(seatId, taskId ?? currentTaskId, params, scoped), 256 * 1024),
    }),
    defineTool({name: 'task_information_read', label: '读取任务相关信息',
      description: '按列表中的 eventId、jobId 读取该任务关联的原始信息（original）或指定版本分析（analysis），含来源、时间和附件元数据。taskId 省略时使用当前任务；不会导入文件，也不代表外部系统当前状态。',
      parameters: Type.Object({taskId: Type.Optional(taskId), eventId: Type.String({format: 'uuid'}), jobId: Type.String({format: 'uuid'}),
        section: Type.Union([Type.Literal('original'), Type.Literal('analysis')])}, {additionalProperties: false}),
      executionMode: 'sequential', execute: (_id, {taskId, ...params}, signal) =>
        execute(controller, authorize, signal, scoped => reader.read(seatId, taskId ?? currentTaskId, params, scoped), 256 * 1024),
    }),
  ];
}
