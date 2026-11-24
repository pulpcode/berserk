import type { ResultDatasetColumn, ResultDatasetV1 } from '../../contracts/result-dataset';

const kinds = ['bar', 'pie', 'line', 'radar', 'scatter'] as const;
export type ChartConfig = {
  kind: typeof kinds[number];
  x: string;
  y: string[];
  horizontal?: boolean;
  donut?: boolean;
};
type Row = ResultDatasetV1['rows'][number];
type PreparedChart = {
  x: ResultDatasetColumn;
  y: ResultDatasetColumn[];
  rows: Row[];
  note?: string;
  total?: number;
};
const pointLimit = 1_000;

export function datasetChartConfig(value: Record<string, unknown>): ChartConfig | undefined {
  const { kind, x, y, horizontal, donut } = value;
  if (Object.keys(value).some(key => !['kind', 'x', 'y', 'horizontal', 'donut'].includes(key))
    || !kinds.some(type => kind === type) || !columnId(x) || !Array.isArray(y) || y.length < 1 || y.length > 8
    || !y.every(columnId) || new Set(y).size !== y.length || y.includes(x)
    || (horizontal !== undefined && (kind !== 'bar' || typeof horizontal !== 'boolean'))
    || (donut !== undefined && (kind !== 'pie' || typeof donut !== 'boolean'))) return;
  return { kind: kind as ChartConfig['kind'], x, y, horizontal, donut };
}

function columnId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value);
}

export function displayDatasetCell(value: Row['values'][string]): string {
  if (value === null) return '未知';
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

export function columnLabel(column: ResultDatasetColumn) {
  return column.unit ? `${column.label}（${column.unit}）` : column.label;
}

export function numericCell(row: Row, column: ResultDatasetColumn): number | null {
  const value = row.values[column.id];
  return typeof value === 'number' ? value : null;
}

export function orderedCoordinate(row: Row, column: ResultDatasetColumn): number {
  return column.type === 'datetime' ? Date.parse(String(row.values[column.id])) : Number(row.values[column.id]);
}

export function prepareDatasetChart(dataset: ResultDatasetV1, config: ChartConfig): PreparedChart | string {
  const columnMap = new Map(dataset.columns.map(column => [column.id, column]));
  const x = columnMap.get(config.x);
  const selected = config.y.map(id => columnMap.get(id));
  if (!x || selected.some(column => !column)) return '指定的图表列不在计算结果中。';
  const y = selected.filter((column): column is ResultDatasetColumn => Boolean(column));
  if (y.some(column => column.type !== 'number')) return '图表的数值列必须是数字。';
  if (!dataset.rows.length) return '计算结果没有数据行。';

  const { kind } = config;
  if (kind === 'scatter') {
    if (x.type !== 'number' || y.length !== 1) return '散点图需要两个数值列。';
    const rows = dataset.rows.filter(row => numericCell(row, x) !== null && numericCell(row, y[0]) !== null);
    if (!rows.length) return '没有同时具备横轴和纵轴数值的数据行。';
    if (rows.length > pointLimit) return '散点图超过 1,000 个数据点，请先汇总或筛选。';
    const omitted = dataset.rows.length - rows.length;
    return { x, y, rows, note: omitted ? `${omitted} 行缺少坐标，未绘制。` : undefined };
  }

  if (kind === 'line' ? x.type !== 'number' && x.type !== 'datetime' : x.type !== 'string' && x.type !== 'boolean') {
    return kind === 'line' ? '折线图需要数值或时间作为横轴。' : '此图需要文字或布尔值作为分类列。';
  }
  if ((kind === 'bar' || kind === 'line') && y.some(column => column.unit !== y[0].unit)) {
    return '数值列单位不一致，无法共用数轴。';
  }
  const rows = dataset.rows.filter(row => row.values[x.id] !== null);
  const omitted = dataset.rows.length - rows.length;
  const key = (row: Row) => kind === 'line' ? orderedCoordinate(row, x) : row.values[x.id];
  if (!rows.length) return kind === 'line' ? '没有可用的横轴数值。' : '没有可用的分类。';
  if (new Set(rows.map(key)).size !== rows.length) {
    return kind === 'line' ? '横轴存在重复值，请先按横轴汇总。' : '分类存在重复值，请先按类别汇总。';
  }
  if (rows.length * y.length > pointLimit) return '图表超过 1,000 个数据点，请先汇总或筛选。';

  if (kind === 'pie') {
    if (y.length !== 1) return '饼图需要一个可相加的数值列。';
    const values = rows.map(row => numericCell(row, y[0]));
    if (omitted || values.some(value => value === null)) return '部分分类或数值未知，无法确认构成比例。';
    const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    if (values.some(value => value! < 0) || total <= 0 || !Number.isFinite(total)) {
      return '饼图数值必须非负，且总和必须是有限的正数。';
    }
    if (Number.isInteger(total) && !Number.isSafeInteger(total)) return '饼图数值总和超出安全整数范围，请调整计量单位。';
    return { x, y, rows, total };
  }

  if (kind === 'radar') {
    if (y.length < 3 || y.some(column => !column.radarScale)) return '雷达图至少需要三个设有量程和方向的数值列。';
    if (rows.some(row => y.some(column => {
      const value = numericCell(row, column);
      const scale = column.radarScale!;
      return value === null || value < scale.min || value > scale.max || !Number.isFinite(scale.max - scale.min);
    }))) return '雷达图包含未知值或量程外的数值，请检查数据。';
    return { x, y, rows, note: omitted ? `${omitted} 行缺少对象标识，未绘制。` : undefined };
  }

  const known = rows.reduce((sum, row) => sum + y.filter(column => numericCell(row, column) !== null).length, 0);
  if (!known) return '没有可绘制的已知数值。';
  if (kind === 'line') rows.sort((left, right) => orderedCoordinate(left, x) - orderedCoordinate(right, x));
  const notes = [
    omitted ? `${omitted} 行缺少${kind === 'line' ? '横轴值' : '分类'}，未绘制。` : undefined,
    known < rows.length * y.length ? '未知数值保留为空。' : undefined,
  ];
  return { x, y, rows, note: notes.filter(Boolean).join(' ') || undefined };
}
