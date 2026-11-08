import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { TaskAssessmentInput } from '../contracts/task-information.js';
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
  controller: AbortController, authorize: () => void, format?: 'decisions') {
  const shared = {
    name: 'information_record_task_assessment', label: '记录任务判断',
    executionMode: 'sequential' as const,
    execute: (toolCallId: string, params: TaskAssessmentInput, signal?: AbortSignal) => execute(controller, authorize, signal, async scoped => {
      const result = await record(params, evidence(), toolCallId, scoped);
      return {...result, message: result.assessment.newTaskSuggestion
        ? '任务判断及新建建议已记录，尚未创建任务；本次分析成功结束后展示。'
        : '任务判断已记录，本次分析成功结束后展示。'};
    }),
  };
  const optionalFields = {
    newTaskSuggestion: Type.Optional(Type.Object({title: Type.String({minLength: 1, maxLength: 60}),
      goal: Type.String({minLength: 1, maxLength: 8000}), reason}, {additionalProperties: false})),
    emptyReason: Type.Optional(reason),
  };
  if (format === 'decisions') return defineTool({
    ...shared,
    description: '查询获准活动公共任务并对照完整目标，逐项提交 taskId、verdict 及理由。link 表示事实支持该任务的核实问题或具体依赖，有条件的影响写清成立条件。exclude 表示已排除，insufficient 表示依据不足。只有 link 会进入任务关联清单。若存在已有任务无法承接的独立交付，在 newTaskSuggestion 中说明目标和理由。没有 link 和新建建议时填写 emptyReason。每个decision仅填写taskId、verdict、reason；newTaskSuggestion和emptyReason是顶层字段，不额外添加备注字段。用成功回执 assessment.items 核对最终关联，任务创建由人员确认。',
    parameters: Type.Object({
      decisions: Type.Array(Type.Object({
        taskId, verdict: Type.Union([Type.Literal('link'), Type.Literal('exclude'), Type.Literal('insufficient')]), reason,
      }, {additionalProperties: false}), {maxItems: 100}),
      ...optionalFields,
    }, {additionalProperties: false}),
  });
  return defineTool({
    ...shared,
    description: '保存当前信息的完整任务判断。先查询获准活动公共任务，必要时不带筛选遍历各页、读取完整目标；结合事实、时段和不确定性，关联所有有依据需要考虑该信息的任务，包括可能影响、事实确认和持续约束，不只找已确认冲突。地域或名称相同不等于相关，资料不足不等于无关。先覆盖已有任务，再判断是否另有独立目标需要新建；relations 与 newTaskSuggestion 可同时提交，新建须人员确认。本工具不创建任务、不改变投递。只有两者均无时才单独填写 emptyReason，不能全部留空。每次提交完整判断，以成功回执为准。',
    parameters: Type.Object({
      relations: Type.Array(Type.Object({taskId, reason}, {additionalProperties: false}), {maxItems: 100}),
      ...optionalFields,
    }, {additionalProperties: false}),
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
