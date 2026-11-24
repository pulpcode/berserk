import { useEffect, useMemo, useRef } from 'react';
import { BarChart, type BarSeriesOption } from 'echarts/charts';
import { GridComponent, type GridComponentOption } from 'echarts/components';
import { init, use as registerECharts, type ComposeOption, type EChartsType } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import type { ResourceResult } from '../../contracts/resource-results';
import { resourceStatisticsItems } from '../../contracts/resource-summary';
import { resourceCategoryLabels } from '../annotations/ResourceFields';

registerECharts([BarChart, GridComponent, SVGRenderer]);

type CategoryCount = { category: string; label: string; count: number };

function categoryCounts(result: ResourceResult): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const item of resourceStatisticsItems(result)) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }
  return Array.from(counts, ([category, count]) => ({
    category,
    label: Object.hasOwn(resourceCategoryLabels, category) ? resourceCategoryLabels[category] : category,
    count,
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));
}

function renderBars(element: HTMLDivElement, chart: EChartsType, rows: CategoryCount[]) {
  const theme = getComputedStyle(element);
  const text = theme.getPropertyValue('--text').trim();
  const muted = theme.getPropertyValue('--muted').trim();
  const grid = theme.getPropertyValue('--line').trim();
  const accent = theme.getPropertyValue('--accent').trim();
  const option: ComposeOption<BarSeriesOption | GridComponentOption> = {
    animation: false,
    textStyle: { fontFamily: theme.fontFamily, fontSize: 12 },
    grid: { top: 4, right: 38, bottom: 8, left: 4, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
    xAxis: { type: 'value', minInterval: 1, axisLabel: { color: muted }, splitLine: { lineStyle: { color: grid } } },
    yAxis: {
      type: 'category',
      inverse: true,
      data: rows.map(row => row.label),
      axisLabel: { color: text, width: 96, overflow: 'truncate', interval: 0 },
      axisLine: { lineStyle: { color: grid } },
      axisTick: { show: false },
    },
    series: [{
      type: 'bar',
      data: rows.map(row => row.count),
      barMaxWidth: 16,
      itemStyle: { color: accent, borderRadius: [0, 3, 3, 0] },
      label: { show: true, position: 'right', color: text },
    }],
  };
  chart.setOption(option);
}

function CategoryBars({ rows }: { rows: CategoryCount[] }) {
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
    if (host.current && instance.current) renderBars(host.current, instance.current, rows);
  }, [rows]);
  return <div ref={host} className="chat-result-ui-chart" data-result-ui-chart="" aria-hidden="true"
    style={{ height: Math.max(112, rows.length * 28 + 28) }} />;
}

export function ResourceBar({ result }: { result: ResourceResult }) {
  const rows = useMemo(() => categoryCounts(result), [result]);
  return <figure className="chat-result-ui-figure" aria-label="按类别统计条目">
    <figcaption>按类别统计条目 <span>（项）</span></figcaption>
    {rows.length ? <>
      <CategoryBars rows={rows} />
      <details className="chat-result-ui-values">
        <summary>查看各类条目数</summary>
        <dl>{rows.map(row => <div key={row.category}><dt>{row.label}</dt><dd>{row.count} 项</dd></div>)}</dl>
      </details>
    </> : <p className="chat-result-ui-notice">当前统计范围内没有条目。</p>}
  </figure>;
}
