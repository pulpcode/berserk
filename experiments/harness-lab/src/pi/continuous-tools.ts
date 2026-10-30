import { calculationSchema } from './analysis-calculation.js';
import type { BackgroundExecutionInput } from '../background/executor.js';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { ReadAnalysisCurrent, RecordAnalysisUpdate, TaskAssessmentEvidence, ReadTaskCandidates } from '../background/executor.js';
import { projectTaskDiscovery } from '../contracts/continuous.js';
import { RequestError } from '../contracts/errors.js';

/** A separate allowlist prevents a legacy profile from granting mutations to a stream. */
export const continuousToolNames = new Set(['read', 'ls', 'find', 'source_list', 'source_read', 'skill_read',
  'information_search', 'information_read', 'situation_query', 'task_search', 'task_read',
  'analysis_current_read', 'information_record_analysis_update', 'analysis_calculate', 'analysis_evidence_read', 'analysis_task_candidates', 'spatial_analyze']);

export function continuousTools(read: ReadAnalysisCurrent, record: RecordAnalysisUpdate,
  evidence: () => TaskAssessmentEvidence, controller: AbortController, authorize: () => void, readCandidates?: ReadTaskCandidates, calculateAnalysis?: BackgroundExecutionInput['calculateAnalysis'], readAssessmentSource?: BackgroundExecutionInput['readAssessmentSource']) {
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
  const citation=Type.Object({id:Type.String({minLength:1,maxLength:200}),quote:Type.String({minLength:1,maxLength:4000})},{additionalProperties:false});
  const assessment=Type.Object({summary:reason,conditions:Type.Array(Type.Object({id:Type.String({minLength:1,maxLength:100,description:'已有条件沿用ID；新条件使用new:短名称，宿主返回稳定ID'}),name:Type.String({minLength:1,maxLength:200}),before:Type.Union([Type.String(),Type.Null()]),status:Type.Union(['met','blocked','unknown','not_applicable'].map(v=>Type.Literal(v))),kind:Type.Union([Type.Literal('source'),Type.Literal('inference')]),change:Type.Union(['initial','changed','unchanged','corrected','withdrawn'].map(v=>Type.Literal(v))),reason,significant:Type.Boolean(),evidence:Type.Array(citation,{minItems:1,maxItems:20})},{additionalProperties:false}),{minItems:1,maxItems:40}),recommendations:Type.Array(reason,{maxItems:20})},{additionalProperties:false});
  return [...(readAssessmentSource?[defineTool({name:'analysis_evidence_read',label:'读取研判原始依据',description:'读取候选assessmentSources中标记truncated的确切原文。id限定当前获准证据，offset/limit按字符分页，按nextOffset继续；不可把预览当完整资料。返回原id供引用。',parameters:Type.Object({id:Type.String({minLength:1,maxLength:200}),offset:Type.Optional(Type.Integer({minimum:0})),limit:Type.Optional(Type.Integer({minimum:1,maximum:16000}))},{additionalProperties:false}),executionMode:'sequential',execute:(_id,input,signal)=>run(signal,scoped=>readAssessmentSource(input.id,input.offset??0,input.limit??16000,scoped))})]:[]),...(calculateAnalysis?[defineTool({name:'analysis_calculate',label:'核算时间与数量',description:'有限只读计算。先读取候选中的assessmentSources，引用原始值。先确认输入值的业务字段、对象、适用时段和单位，不能把任务截止当成资源占用结束。时间支持明确同日HH:mm，跨日须完整日期时区；interval_overlap按闭区间计算，仅证明给定区间重叠，不证明资源独占冲突。占用／交接依据不足时说明方案待核实，不以计算结果代替缺失事实；剩余时间也不等于准备耗时或迟到时长。每个values按序对应一条evidence，原文须含该值；数字旁须有同一unit（如t/kg/辆），不自动补日期或换算。返回计算证据ID；记录时kind=inference，quote填写result的JSON值（例如40、true或带双引号的less），页面直接显示原生计算结果。',parameters:calculationSchema,executionMode:'sequential',execute:(id,input,signal)=>run(signal,scoped=>calculateAnalysis(input,id,scoped,evidence()))})]:[]),...(readCandidates ? [defineTool({
    name:'analysis_task_candidates', label:'核验本轮任务关联',
    description:'完整分页核验当前活动公共任务与本批来源对象的直接及空间关联。无参数：由宿主依据真实来源systemId/subjectId、报告对象引用或任务修订定位对象，不能自行指定变化对象。返回任务原说明、related候选、unrelated已核验无关联、uncertain待核实及空间证据。候选不等于有业务影响，需结合时间和任务条件判断；未定位和缺资料不能当无关联。本轮记录前必须成功调用，记录需覆盖全部返回任务；之前的建议、假设及旧模型判断不是新事实。',
    parameters:Type.Object({}, {additionalProperties:false}), executionMode:'sequential',
    execute:async(id,_params,signal)=>{const scoped=signal?AbortSignal.any([signal,controller.signal]):controller.signal;scoped.throwIfAborted();authorize();const result=await readCandidates(id,scoped);scoped.throwIfAborted();authorize();const text=JSON.stringify(projectTaskDiscovery(result));if(Buffer.byteLength(text)>256*1024)throw new Error('TASK_DISCOVERY_LIMIT:完整候选超过单轮读取上限，未截断为成功结果。');return {content:[{type:'text' as const,text}],details:{taskDiscovery:result}};},
  })] : []), defineTool({
    name: 'analysis_current_read', label: '读取已发布研判',
    description: '读取当前配置范围已发布研判。taskId 返回该任务上次已发布判断；jobId 固定读取一轮；省略时分页列出轮次（默认20，最多50）。section=result 读取公开过程说明和最终答复，分段读取原始input/tool时返回citationId可在本轮记录中引用。section=evidence 列出当次原始输入、成功查询及文件读取证据；超限时返回 evidenceIndex。用索引的 evidenceId 和 textOffset/textLimit 分段读取原文（每段最多32000字符），按 nextOffset 继续，不能将片段当成完整证据。旧判断是待复核推断，不是当前事实；未列出任务不代表没有变化。仅能读取宿主已发布索引内的引用。',
    parameters: Type.Object({taskId: Type.Optional(uuid), jobId: Type.Optional(uuid), offset: Type.Optional(Type.Integer({minimum: 0})),
      limit: Type.Optional(Type.Integer({minimum: 1, maximum: 50})), section: Type.Optional(Type.Union([Type.Literal('result'), Type.Literal('evidence')])),
      evidenceId: Type.Optional(Type.String({minLength: 1, maxLength: 128})), textOffset: Type.Optional(Type.Integer({minimum: 0})),
      textLimit: Type.Optional(Type.Integer({minimum: 1, maximum: 32000}))}, {additionalProperties: false}),
    executionMode: 'sequential', execute: (_id, query, signal) => run(signal, scoped => read(query, scoped)),
  }), defineTool({
    name: 'information_record_analysis_update', label: '记录本轮研判变化',
    description: '记录本轮完整结构研判。assessment必填，conditions须覆盖上次全部条件，before必须等于上次status；新条件before=null，id使用new:名称。覆盖旧条件不等于继续认可：核对原始依据、适用对象／时段和新资料，分别保留unchanged、更新changed、纠正corrected或撤回withdrawn（status=not_applicable），在reason和evidence说明依据；无新信息不自动失效。新增执行条件须说明任务要求／适用规则／事件与执行影响的关系，不因缺少模型自行要求的资料就判unknown或blocked；确有必要条件且未知或不满足时应如实记录。evidence使用候选assessmentSources的id和逐字引文；随后成功读取的来源工具可用tool:实际toolCallId及逐字原文。普通检查及备选方案放recommendations，不作为实际安排或新增硬性前提；旧推断、引文匹配和计算成功均不等于业务结论成立。摘要、条件和建议须一致使用有效依据，不把原本未受阻写成风险解除。significant按有依据的条件重要变化汇总，不能仅因倒计时缩短或未实施方案变化就提醒。记录本轮完整变化元数据，任务可有多个或为空。先成功调用analysis_task_candidates并逐一交代全部任务，宿主绑定观察到的任务版本和该任务上次已发布判断。inputIds 是该任务实际相关的获准输入引用；任务修订要求重评的任务须明确更新。区分首次、改变、无实质变化、撤回旧判断、依据不足；查询失败不能记作无变化。unassigned 说明未归属任务变化，uncertainties 记录资料缺口。重要性由各任务或未归属变化分别判断；任一重要即提醒。记录成功尚不代表发布，最终答复与原生证据核验后才可发布。',
    parameters: Type.Object({taskCoverage:Type.Optional(Type.Array(Type.Object({taskId:uuid,status:Type.Union(['assessed','unrelated','uncertain'].map(value=>Type.Literal(value))),reason},{additionalProperties:false}),{maxItems:100,description:'覆盖完整候选清单；assessed/uncertain须有对应taskUpdates；仅宿主已核验无关联且无旧基线时可用unrelated。省略时从taskUpdates生成覆盖。'})),taskUpdates: Type.Array(Type.Object({taskId: uuid, inputIds: Type.Array(uuid, {minItems: 1, maxItems: 100}),
      change: Type.Union(['initial', 'changed', 'unchanged', 'retracted', 'uncertain'].map(value => Type.Literal(value))), reason, significant: Type.Boolean(), assessment}, {additionalProperties: false}), {maxItems: 100}),
    unassigned: Type.Object({significant: Type.Boolean(), reason}, {additionalProperties: false}), uncertainties: Type.Array(reason, {maxItems: 100})}, {additionalProperties: false}),
    executionMode: 'sequential', execute: (id, input, signal) => run(signal, scoped => record(input, evidence(), id, scoped)),
  })];
}
