import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { ReadAnalysisCurrent, RecordAnalysisUpdate, TaskAssessmentEvidence } from '../background/executor.js';
import { RequestError } from '../contracts/errors.js';

/** A separate allowlist prevents a legacy profile from granting mutations to a stream. */
export const continuousToolNames = new Set(['read', 'ls', 'find', 'source_list', 'source_read', 'skill_read',
  'information_search', 'information_read', 'situation_query', 'task_search', 'task_read',
  'analysis_current_read', 'information_record_analysis_update']);

export function continuousTools(read: ReadAnalysisCurrent, record: RecordAnalysisUpdate,
  evidence: () => TaskAssessmentEvidence, controller: AbortController, authorize: () => void) {
  const uuid = Type.String({format: 'uuid'});
  const reason = Type.String({minLength: 1, maxLength: 1500});
  async function run(signal: AbortSignal | undefined, work: (signal: AbortSignal) => unknown | Promise<unknown>) {
    const scoped = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    scoped.throwIfAborted(); authorize();
    try {
      const result = await work(scoped);
      scoped.throwIfAborted(); authorize();
      const text = JSON.stringify(result);
      if (Buffer.byteLength(text) > 256 * 1024) throw new RequestError('ANALYSIS_RESULT_TOO_LARGE', '研判结果超过读取上限，请缩小查询范围。', 413);
      return {content: [{type: 'text' as const, text}], details: {}};
    } catch (error) {
      scoped.throwIfAborted();
      if (error instanceof RequestError) throw new Error(`${error.code}: ${error.message}`);
      throw error;
    }
  }
  return [defineTool({
    name: 'analysis_current_read', label: '读取已发布研判',
    description: '读取当前配置范围已发布研判。taskId 返回该任务上次已发布判断；jobId 固定读取一轮；省略时分页列出轮次（默认20，最多50）。section=result 读取公开过程说明和最终答复，section=evidence 列出当次原始输入、成功查询及文件读取证据；超限时返回 evidenceIndex。用索引的 evidenceId 和 textOffset/textLimit 分段读取原文（每段最多32000字符），按 nextOffset 继续，不能将片段当成完整证据。旧判断是待复核推断，不是当前事实；未列出任务不代表没有变化。仅能读取宿主已发布索引内的引用。',
    parameters: Type.Object({taskId: Type.Optional(uuid), jobId: Type.Optional(uuid), offset: Type.Optional(Type.Integer({minimum: 0})),
      limit: Type.Optional(Type.Integer({minimum: 1, maximum: 50})), section: Type.Optional(Type.Union([Type.Literal('result'), Type.Literal('evidence')])),
      evidenceId: Type.Optional(Type.String({minLength: 1, maxLength: 128})), textOffset: Type.Optional(Type.Integer({minimum: 0})),
      textLimit: Type.Optional(Type.Integer({minimum: 1, maximum: 32000}))}, {additionalProperties: false}),
    executionMode: 'sequential', execute: (_id, query, signal) => run(signal, scoped => read(query, scoped)),
  }), defineTool({
    name: 'information_record_analysis_update', label: '记录本轮研判变化',
    description: '记录本轮完整变化元数据，任务可有多个或为空。先成功查询任务当前说明，宿主绑定观察到的任务版本和该任务上次已发布判断。inputIds 是该任务实际相关的获准输入引用；任务修订要求重评的任务须明确更新。区分首次、改变、无实质变化、撤回旧判断、依据不足；查询失败不能记作无变化。unassigned 说明未归属任务变化，uncertainties 记录资料缺口。重要性由各任务或未归属变化分别判断；任一重要即提醒。记录成功尚不代表发布，最终答复与原生证据核验后才可发布。',
    parameters: Type.Object({taskUpdates: Type.Array(Type.Object({taskId: uuid, inputIds: Type.Array(uuid, {minItems: 1, maxItems: 100}),
      change: Type.Union(['initial', 'changed', 'unchanged', 'retracted', 'uncertain'].map(value => Type.Literal(value))), reason, significant: Type.Boolean()}, {additionalProperties: false}), {maxItems: 100}),
    unassigned: Type.Object({significant: Type.Boolean(), reason}, {additionalProperties: false}), uncertainties: Type.Array(reason, {maxItems: 100})}, {additionalProperties: false}),
    executionMode: 'sequential', execute: (id, input, signal) => run(signal, scoped => record(input, evidence(), id, scoped)),
  })];
}
