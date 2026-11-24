import { describe, expect, it } from 'vitest';
import { init } from 'echarts/core';
import type { PublicMessage } from '../../src/contracts';
import { createResultDatasetRef, type ResultDatasetColumn, type ResultDatasetV1 } from '../../src/contracts/result-dataset';
import { prepareDatasetChart } from '../../src/web/result-ui/dataset-chart';
import { datasetFromEvidence } from '../../src/web/result-ui/dataset-evidence';
import { createDatasetChartOption } from '../../src/web/result-ui/ResultDatasetChart';

const radarScale = { min: 0, max: 25, direction: 'higher', source: '班组目标' } as const;
const columns: ResultDatasetColumn[] = [
  { id: 'team', label: '班组', type: 'string' },
  { id: 'time', label: '日期', type: 'datetime' },
  { id: 'orders', label: '工单数', type: 'number', unit: '件', radarScale },
  { id: 'done', label: '完成量', type: 'number', unit: '件', radarScale },
  { id: 'hours', label: '耗时', type: 'number', unit: '小时', radarScale: { ...radarScale, direction: 'lower' } },
];
const dataset: ResultDatasetV1 = {
  format: 'result-dataset.v1', columns,
  rows: [
    { id: 'team-a', values: { team: '甲班', time: '2026-11-25T00:00:00Z', orders: 12, done: 7, hours: 3 } },
    { id: 'team-b', values: { team: '乙班', time: '2026-11-24T00:00:00Z', orders: 8, done: 5, hours: 4 } },
  ],
  provenance: { source: '工单明细 CSV', scope: '本批工单', method: '按班组汇总' },
};

function changeRow(values: ResultDatasetV1['rows'][number]['values']): ResultDatasetV1 {
  return { ...dataset, rows: [dataset.rows[0], {
    ...dataset.rows[1], values: { ...dataset.rows[1].values, ...values },
  }] };
}

describe('dataset chart projections', () => {
  it('displays original bar values with a common unit and refuses incompatible axes or duplicate categories', () => {
    const config = { kind: 'bar', x: 'team', y: ['orders', 'done'] } as const;
    expect(prepareDatasetChart(dataset, { ...config, y: [...config.y] })).toMatchObject({ rows: dataset.rows });
    expect(prepareDatasetChart(dataset, { ...config, y: ['orders', 'hours'] })).toMatch(/单位不一致/);
    expect(prepareDatasetChart(changeRow({ team: '甲班' }), { ...config, y: ['orders'] })).toMatch(/重复/);
  });

  it('uses the fixed pie denominator and reports unknown, negative and all-zero data', () => {
    const config = { kind: 'pie', x: 'team', y: ['orders'] } as const;
    const input = { ...config, y: [...config.y] };
    expect(prepareDatasetChart(dataset, input)).toMatchObject({ total: 20 });
    expect(prepareDatasetChart(changeRow({ orders: null }), input)).toMatch(/无法确认构成比例/);
    expect(prepareDatasetChart(changeRow({ orders: -1 }), input)).toMatch(/必须非负/);
    expect(prepareDatasetChart({ ...dataset, rows: [changeRow({ orders: 0 }).rows[1]] }, input)).toMatch(/正数/);
    expect(prepareDatasetChart(changeRow({ orders: Number.MAX_SAFE_INTEGER }), input)).toMatch(/超出安全整数范围/);
  });

  it('sorts line data by instant, preserves null gaps and rejects duplicate instants', () => {
    const input = { kind: 'line' as const, x: 'time', y: ['orders'] };
    const withGap = changeRow({ orders: null });
    expect(prepareDatasetChart(withGap, input)).toMatchObject({ rows: [withGap.rows[1], withGap.rows[0]], note: '未知数值保留为空。' });
    expect(prepareDatasetChart(changeRow({ time: '2026-11-24T19:00:00-05:00' }), input)).toMatch(/横轴存在重复/);
    expect(prepareDatasetChart(changeRow({ time: null }), input)).toMatchObject({ rows: [dataset.rows[0]], note: '1 行缺少横轴值，未绘制。' });
  });

  it('requires a fixed scale for every radar axis and refuses out-of-range values', () => {
    const input = { kind: 'radar' as const, x: 'team', y: ['orders', 'done', 'hours'] };
    expect(prepareDatasetChart(dataset, input)).toMatchObject({ rows: dataset.rows });
    expect(prepareDatasetChart(changeRow({ hours: 40 }), input)).toMatch(/量程外/);
    const withNoScale = columns.map(column => column.id === 'hours' ? { ...column, radarScale: undefined } : column);
    expect(prepareDatasetChart({ ...dataset, columns: withNoScale }, input)).toMatch(/设有量程/);
  });

  it('pairs scatter coordinates within each row and counts dropped observations', () => {
    const input = { kind: 'scatter' as const, x: 'orders', y: ['hours'] };
    expect(prepareDatasetChart(dataset, input)).toMatchObject({ rows: dataset.rows });
    expect(prepareDatasetChart(changeRow({ hours: null }), input)).toMatchObject({ rows: [dataset.rows[0]], note: '1 行缺少坐标，未绘制。' });
    expect(prepareDatasetChart({ ...dataset, rows: [] }, input)).toMatch(/没有数据行/);
    expect(prepareDatasetChart(dataset, { ...input, x: 'missing' })).toMatch(/列不在计算结果中/);
  });

  it.each([
    { kind: 'bar', x: 'team', y: ['orders'], horizontal: true },
    { kind: 'pie', x: 'team', y: ['orders'], donut: true },
    { kind: 'line', x: 'time', y: ['orders'] },
    { kind: 'radar', x: 'team', y: ['orders', 'done', 'hours'] },
    { kind: 'scatter', x: 'orders', y: ['hours'] },
  ] as const)('renders $kind as SVG with the chart implementation', testConfig => {
    const config = { ...testConfig, y: [...testConfig.y] };
    const prepared = prepareDatasetChart(dataset, config);
    if (typeof prepared === 'string') throw new Error(prepared);
    const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 480, height: 260 });
    try {
      chart.setOption(createDatasetChartOption(prepared, config, { fontFamily: 'sans-serif', getPropertyValue: () => '#426354' }));
      expect(chart.renderToSVGString()).toMatch(/<svg[\s\S]+<path/);
    } finally {
      chart.dispose();
    }
  });
});

describe('dataset UI receipt evidence', () => {
  const ref = createResultDatasetRef('request', 'result-call');
  const message: PublicMessage = {
    id: 'output', role: 'tool', toolName: 'bash', toolStatus: 'completed', toolCallId: 'result-call',
    text: '数据集已保存', requestId: 'request', isError: false,
    resultDataset: { resultRef: ref, sessionId: 'session', requestId: 'request', toolCallId: 'result-call', dataset },
  };

  it('matches only successful preceding tool evidence in the same request and session', () => {
    expect(datasetFromEvidence([message], ref, 'session', 'request')).toBe(dataset);
    expect(datasetFromEvidence([message], ref, 'other-session', 'request')).toBeUndefined();
    expect(datasetFromEvidence([message], ref, 'session', 'other-request')).toBeUndefined();
    expect(datasetFromEvidence([{ ...message, isError: true }], ref, 'session', 'request')).toBeUndefined();
    expect(datasetFromEvidence([{ ...message, toolCallId: 'different' }], ref, 'session', 'request')).toBeUndefined();
    expect(datasetFromEvidence([{ ...message, toolStatus: 'running' }], ref, 'session', 'request')).toBeUndefined();
    expect(datasetFromEvidence([{ ...message, toolName: 'file_output' }], ref, 'session', 'request')).toBeUndefined();
  });
});
