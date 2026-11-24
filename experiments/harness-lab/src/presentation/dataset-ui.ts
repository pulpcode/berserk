import { resultDatasetFormat, resultDatasetMaxBytes, resultDatasetMaxColumns, resultDatasetMaxRows } from '../contracts/result-dataset.js';
import { resourceUiFence } from './resource-ui.js';

export const datasetUiCatalog = 'dataset-v1';

export const datasetUiInstructions = [
  '用户要求用图表或表格展示文件计算结果时，先通过现有 bash 执行实际计算。只要求展示时无需调用 file_output。',
  `把要展示的数据作为命令的唯一输出，用 UTF-8 单行 JSON 对象。format 写 "${resultDatasetFormat}"，最多 ${resultDatasetMaxBytes / 1024} KiB、${resultDatasetMaxColumns} 列和 ${resultDatasetMaxRows} 行。前后无需附加日志、说明或代码标记。超限则先明确汇总范围后重算。`,
  '数据集示例如下，字段值由本次计算产生。',
  JSON.stringify({
    format: resultDatasetFormat,
    columns: [{ id: 'team', label: '班组', type: 'string' }, { id: 'orders', label: '工单数', type: 'number', unit: '件' }],
    rows: [{ id: 'team-a', values: { team: '甲班', orders: 12 } }],
    provenance: { source: '工单明细 CSV', scope: '已识别班组的记录', method: '按班组计数' },
  }),
  '列类型可用 string、number、boolean 或 datetime。datetime 用含时区的 ISO 时间。每行都提供已声明的列，缺失用 null，行和列 ID 各自唯一。使用有限数值，整数须在 JavaScript 安全整数范围内。',
  'bash 返回数据集回执后，复制其中的 resultRef，在普通 Markdown 回复中加入以下展示块。每个块使用不同短 ID。从行首开始写围栏，每行都是完整 JSON。只填写已返回的列 ID 和显示选项。',
  'ChartView 的 kind 可用 bar、pie、line、radar、scatter。bar、pie、radar 的 x 用文字或布尔列，line 的 x 用数值或时间列，scatter 的 x 用数值列。y 是至多八个互异的数值列 ID。bar 可选 horizontal，pie 可选 donut。pie 和 scatter 仅有一个 y。radar 至少三个 y，列须提供 radarScale，含 min、max、direction（higher 或 lower）和 source。',
  '只展示表格时保留 Stack 和 ResultTable；可以在围栏后继续说明统计口径。命令未返回有效回执时请说明限制或重新计算。',
  '```' + resourceUiFence,
  JSON.stringify({ id: 'orders', catalog: datasetUiCatalog, resultRef: 'dataset:从工具结果复制' }),
  JSON.stringify({ op: 'add', path: '/root', value: 'overview' }),
  JSON.stringify({ op: 'add', path: '/elements/overview', value: { type: 'Stack', props: {}, children: ['table', 'chart'] } }),
  JSON.stringify({ op: 'add', path: '/elements/table', value: { type: 'ResultTable', props: {}, children: [] } }),
  JSON.stringify({ op: 'add', path: '/elements/chart', value: { type: 'ChartView', props: { kind: 'bar', x: 'team', y: ['orders'] }, children: [] } }),
  '```',
].join('\n');
