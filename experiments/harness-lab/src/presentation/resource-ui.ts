export const resourceUiFence = 'berserk-ui-v1';
export const resourceUiCatalog = 'resource-v1';
export const resourceUiComponents = {
  stack: 'Stack',
  metrics: 'ResourceMetrics',
  bar: 'ResourceBar',
  view: 'ResourceResultView',
} as const;

export const resourceUiInstructions = [
  '用户要求图表或资源可视化时，可在正常 Markdown 回复中插入专用展示块。',
  '仅在本轮 task_resource_query 成功返回后使用，从工具结果 data.resultRef 原样复制固定引用；每块使用不同的短 ID。',
  '先给出一句可独立阅读的结论。正文避免复述图表中的数字、标题或范围。展示围栏从行首开始，围栏内每行是完整 JSON。',
  '下面是完整示例，替换 resultRef。按需在 Stack 中组合指标和柱状图，也可以只保留其中一个。',
  '指标使用固定结果中的记录数、条目数和实体总数；柱状图比较统计范围内每个类别的条目数，单位为项。',
  '需要核对来源或名单时，可向 Stack 加入一个 ResourceResultView 叶组件。props 只填写 {"section":"sources"}（来源和覆盖）或 {"section":"details"}（分页名单、逐项依据与来源），children 写 []。详情由用户展开。',
  '比较类别时使用柱状图；核对名单时使用详情。候选名单可能含未计入统计的条目，请保留这个区别。',
  '可在围栏后继续写解释与数据限制。展示块只编排组件，任何数值、样式、URL 或动作都不写入参数。',
  '```' + resourceUiFence,
  JSON.stringify({ id: 'resources', catalog: resourceUiCatalog, resultRef: 'resource:从工具结果复制' }),
  JSON.stringify({ op: 'add', path: '/root', value: 'overview' }),
  JSON.stringify({ op: 'add', path: '/elements/overview', value: { type: resourceUiComponents.stack, props: {}, children: ['metrics', 'chart'] } }),
  JSON.stringify({ op: 'add', path: '/elements/metrics', value: { type: resourceUiComponents.metrics, props: {}, children: [] } }),
  JSON.stringify({ op: 'add', path: '/elements/chart', value: { type: resourceUiComponents.bar, props: {}, children: [] } }),
  '```',
].join('\n');
