import { useEffect, useMemo, useRef } from 'react';
import { BarChart, LineChart, PieChart, RadarChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, RadarComponent, TooltipComponent } from 'echarts/components';
import { init, use as registerECharts, type EChartsType } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import type { ResultDatasetV1 } from '../../contracts/result-dataset';
import { columnLabel, displayDatasetCell, numericCell, orderedCoordinate, prepareDatasetChart, type ChartConfig } from './dataset-chart';
import { ResultDatasetTable } from './ResultDatasetTable';

registerECharts([BarChart, LineChart, PieChart, RadarChart, ScatterChart, GridComponent, LegendComponent, RadarComponent, TooltipComponent, SVGRenderer]);

type PreparedChart = Exclude<ReturnType<typeof prepareDatasetChart>, string>;
const chartLabels = { bar: '柱状图', pie: '饼图', line: '折线图', radar: '雷达图', scatter: '散点图' };

export function createDatasetChartOption(chart: PreparedChart, config: ChartConfig, theme: Pick<CSSStyleDeclaration, 'getPropertyValue' | 'fontFamily'>): EChartsOption {
  const { x, y, rows } = chart;
  const text = theme.getPropertyValue('--text').trim();
  const muted = theme.getPropertyValue('--muted').trim();
  const grid = theme.getPropertyValue('--line').trim();
  const accent = theme.getPropertyValue('--accent').trim();
  const labelFor = (row: PreparedChart['rows'][number]) => displayDatasetCell(row.values[x.id]);
  const categoryLabels = rows.map(labelFor);
  const yNames = y.map(columnLabel);
  // Named cartesian series need distinct labels for the legend.
  const seriesName = (index: number) => yNames.indexOf(yNames[index]) === yNames.lastIndexOf(yNames[index])
    ? yNames[index] : `${yNames[index]}（${y[index].id}）`;
  const common: EChartsOption = {
    animation: false,
    useUTC: true,
    textStyle: { fontFamily: theme.fontFamily, fontSize: 12, color: text },
    color: [accent, '#326aa0', '#a95426', '#7855a2', '#9b3866', '#187875', '#755d2b', '#474d95'],
    tooltip: {
      trigger: 'item',
      renderMode: 'richText',
      confine: true,
      formatter: params => {
        if (Array.isArray(params)) return '';
        const index = params.dataIndex;
        const row = rows[index];
        if (!row) return '';
        return [`${columnLabel(x)} ${labelFor(row)}`, ...y.map(column =>
          `${columnLabel(column)} ${displayDatasetCell(row.values[column.id])}`)].join('\n');
      },
    },
  };
  if (config.kind === 'pie') {
    return { ...common, series: [{
      type: 'pie',
      radius: config.donut ? ['34%', '62%'] : '62%',
      stillShowZeroSum: false,
      label: { color: text, alignTo: 'edge', edgeDistance: 6, overflow: 'truncate', formatter: '{b} {d}%' },
      data: rows.map(row => ({ name: labelFor(row), value: numericCell(row, y[0])! })),
    }] };
  }
  if (config.kind === 'radar') {
    return {
      ...common,
      radar: {
        radius: '52%',
        indicator: y.map(column => ({ name: columnLabel(column), min: 0, max: 1 })),
        axisName: { color: text, width: 82, overflow: 'truncate' },
      },
      series: [{
        type: 'radar',
        symbolSize: 4,
        data: rows.map((row, index) => ({
          name: labelFor(row),
          symbol: ['circle', 'rect', 'triangle', 'diamond'][index % 4],
          lineStyle: { type: index % 2 ? 'dashed' : 'solid' },
          value: y.map(column => {
            const scale = column.radarScale!;
            const value = numericCell(row, column)!;
            return (scale.direction === 'higher' ? value - scale.min : scale.max - value) / (scale.max - scale.min);
          }),
        })),
      }],
    };
  }

  const categoryAxis = {
    type: 'category' as const, data: categoryLabels, axisLabel: { color: muted, width: 88, overflow: 'truncate' as const },
  };
  const valueAxis = {
    type: 'value' as const, axisLabel: { color: muted }, splitLine: { lineStyle: { color: grid } }, nameTextStyle: { color: muted },
  };
  const cartesian: EChartsOption = {
    ...common,
    grid: { top: 28, bottom: y.length > 1 ? 26 : 12, left: 12, right: 14, outerBoundsContain: 'all' },
    legend: y.length > 1 ? { type: 'scroll', bottom: 0, textStyle: { color: text }, selectedMode: false } : undefined,
  };
  if (config.kind === 'scatter') {
    return {
      ...cartesian,
      xAxis: { ...valueAxis, name: columnLabel(x), nameLocation: 'middle', nameGap: 22, scale: true },
      yAxis: { ...valueAxis, name: columnLabel(y[0]), scale: true },
      series: [{ type: 'scatter', symbolSize: 8, data: rows.map(row => [numericCell(row, x), numericCell(row, y[0])]) }],
    };
  }

  const yAxisName = y[0].unit;
  if (config.kind === 'line') {
    return {
      ...cartesian,
      xAxis: { ...valueAxis, type: x.type === 'datetime' ? 'time' : 'value', scale: true, name: x.unit },
      yAxis: { ...valueAxis, name: yAxisName },
      series: y.map((column, index) => ({
        name: seriesName(index), type: 'line', connectNulls: false,
        symbol: ['circle', 'rect', 'triangle', 'diamond'][index % 4],
        lineStyle: { type: index % 2 ? 'dashed' : 'solid' },
        data: rows.map(row => [orderedCoordinate(row, x), numericCell(row, column)]),
      })),
    };
  }

  return {
    ...cartesian,
    xAxis: config.horizontal ? { ...valueAxis, name: yAxisName } : categoryAxis,
    yAxis: config.horizontal ? { ...categoryAxis, inverse: true } : { ...valueAxis, name: yAxisName },
    series: y.map((column, index) => ({
      name: seriesName(index), type: 'bar', barMaxWidth: 24, data: rows.map(row => numericCell(row, column)),
      ...(index % 2 ? { itemStyle: { decal: { symbol: 'rect' } } } : {}),
    })),
  };
}

function ChartSurface({ chart, config }: { chart: PreparedChart; config: ChartConfig }) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<EChartsType | null>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const chart = init(element, undefined, { renderer: 'svg' });
    instance.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      chart.dispose();
      instance.current = null;
    };
  }, []);
  useEffect(() => {
    if (host.current) instance.current?.setOption(createDatasetChartOption(chart, config, getComputedStyle(host.current)), { notMerge: true });
  }, [chart, config]);
  const height = config.horizontal ? Math.min(480, Math.max(240, chart.rows.length * 24 + 52)) : 260;
  return <div ref={host} className="chat-result-ui-chart" style={{ height }}
    data-result-ui-dataset-chart={config.kind} data-result-ui-chart="" aria-hidden="true" />;
}

export function ResultDatasetChart({ dataset, config }: { dataset: ResultDatasetV1; config: ChartConfig }) {
  const prepared = useMemo(() => prepareDatasetChart(dataset, config), [dataset, config]);
  const label = config.donut ? '环形图' : chartLabels[config.kind];
  return <figure className="chat-result-ui-figure" aria-label={label}>
    <figcaption>{label}{typeof prepared !== 'string' && <span> · {columnLabel(prepared.x)} / {prepared.y.map(columnLabel).join('、')}</span>}</figcaption>
    {typeof prepared === 'string' ? <p className="chat-result-ui-notice">{prepared}</p> : <>
      {prepared.total !== undefined && <p className="chat-result-ui-notice">
        构成比例的分母为 {prepared.total}{prepared.y[0].unit ? ` ${prepared.y[0].unit}` : ''}
      </p>}
      {prepared.note && <p className="chat-result-ui-notice">{prepared.note}</p>}
      <ChartSurface chart={prepared} config={config} />
      <details className="chat-result-ui-values">
        <summary>查看图表数值</summary>
        {config.kind === 'radar' && <dl>{prepared.y.map(column => <div key={column.id}>
          <dt>{columnLabel(column)}</dt>
          <dd>{column.radarScale!.min}–{column.radarScale!.max} · {column.radarScale!.direction === 'higher' ? '越高越优' : '越低越优'}
            {' · '}{column.radarScale!.source}</dd>
        </div>)}</dl>}
        <ResultDatasetTable columns={[prepared.x, ...prepared.y]} rows={prepared.rows} title="图表数值" />
      </details>
    </>}
  </figure>;
}
