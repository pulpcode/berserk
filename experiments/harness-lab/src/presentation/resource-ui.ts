export const resourceUiFence = 'berserk-ui-v1';
export const resourceUiCatalog = 'resource-v1';
export const resourceUiComponents = {
  stack: 'Stack',
  metrics: 'ResourceMetrics',
  bar: 'ResourceBar',
} as const;

export const resourceUiInstructions = [
  '用户要求图表或资源可视化时，可在正常 Markdown 回复中插入专用展示块。',
  '仅在本轮 task_resource_query 成功返回后使用，从工具结果 data.resultRef 原样复制固定引用；每块使用不同的短 ID。',
  '先给出可独立阅读的简要结论。展示围栏从行首开始，围栏内每行是完整 JSON，不要插入说明。',
  '下面是完整示例，替换 resultRef。按需在 Stack 中组合指标和柱状图，也可以只保留其中一个。',
  '指标使用固定结果中的记录数、条目数和实体总数；柱状图比较统计范围内每个类别的条目数，单位为项。',
  '可在围栏后继续写解释与数据限制。展示块只编排组件，任何数值、样式、URL 或动作都不写入参数。',
  '```' + resourceUiFence,
  JSON.stringify({ id: 'resources', catalog: resourceUiCatalog, resultRef: 'resource:从工具结果复制' }),
  JSON.stringify({ op: 'add', path: '/root', value: 'overview' }),
  JSON.stringify({ op: 'add', path: '/elements/overview', value: { type: resourceUiComponents.stack, props: {}, children: ['metrics', 'chart'] } }),
  JSON.stringify({ op: 'add', path: '/elements/metrics', value: { type: resourceUiComponents.metrics, props: {}, children: [] } }),
  JSON.stringify({ op: 'add', path: '/elements/chart', value: { type: resourceUiComponents.bar, props: {}, children: [] } }),
  '```',
].join('\n');
