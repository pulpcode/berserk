/** Controlled, shared symbol semantics. Assets are bundled locally; aliases are for search only. */
export interface MapSymbolDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly aliases: readonly string[];
  readonly sourceKind: 'standard' | 'extension';
  readonly standardRef?: string;
  readonly geometryKind: 'point';
  readonly defaultIconSize: number;
  readonly anchor: 'center';
  readonly orientation: 'heading' | 'upright';
  /** Clockwise from true north in the unrotated source artwork. */
  readonly intrinsicHeading: number;
  readonly assetKey: string;
}
export const MAP_SYMBOL_STANDARD = 'XF/T 3013—2020';
export const MAP_SYMBOL_SOURCE_URL = 'https://www.mem.gov.cn/gk/zfxxgkpt/fdzdgknr/202101/W020210118711682130047.pdf';
export const MAP_SYMBOL_ICON_SIZE = {min:20,max:64,default:32} as const;
const symbols = [
  {"id":"xf3013-2020.6.2.1","name":"水罐消防车","category":"灭火及高空作业车辆","aliases":["水罐车"],"sourceKind":"standard","standardRef":"6.2.1","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"heading","intrinsicHeading":90,"assetKey":"xf3013-2020.6.2.1"},
  {"id":"xf3013-2020.6.2.2","name":"泡沫消防车","category":"灭火及高空作业车辆","aliases":["泡沫车"],"sourceKind":"standard","standardRef":"6.2.2","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"heading","intrinsicHeading":90,"assetKey":"xf3013-2020.6.2.2"},
  {"id":"xf3013-2020.6.2.5","name":"干粉消防车","category":"灭火及高空作业车辆","aliases":["干粉车"],"sourceKind":"standard","standardRef":"6.2.5","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"heading","intrinsicHeading":90,"assetKey":"xf3013-2020.6.2.5"},
  {"id":"xf3013-2020.6.2.8","name":"泵浦消防车","category":"灭火及高空作业车辆","aliases":["泵浦车"],"sourceKind":"standard","standardRef":"6.2.8","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"heading","intrinsicHeading":90,"assetKey":"xf3013-2020.6.2.8"},
  {"id":"xf3013-2020.6.2.10","name":"云梯消防车","category":"灭火及高空作业车辆","aliases":["云梯车"],"sourceKind":"standard","standardRef":"6.2.10","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"heading","intrinsicHeading":90,"assetKey":"xf3013-2020.6.2.10"},
  {"id":"xf3013-2020.6.2.11","name":"登高平台消防车","category":"灭火及高空作业车辆","aliases":["登高平台车"],"sourceKind":"standard","standardRef":"6.2.11","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"heading","intrinsicHeading":90,"assetKey":"xf3013-2020.6.2.11"},
  {"id":"xf3013-2020.6.2.12","name":"举高喷射消防车","category":"灭火及高空作业车辆","aliases":["举高喷射车"],"sourceKind":"standard","standardRef":"6.2.12","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"heading","intrinsicHeading":90,"assetKey":"xf3013-2020.6.2.12"},
  {"id":"xf3013-2020.6.2.13","name":"抢险救援消防车","category":"救援及保障车辆","aliases":["抢险救援车"],"sourceKind":"standard","standardRef":"6.2.13","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"heading","intrinsicHeading":90,"assetKey":"xf3013-2020.6.2.13"},
  {"id":"xf3013-2020.6.2.14","name":"化学事故抢险救援消防车","category":"救援及保障车辆","aliases":["化学事故抢险救援车"],"sourceKind":"standard","standardRef":"6.2.14","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"heading","intrinsicHeading":90,"assetKey":"xf3013-2020.6.2.14"},
  {"id":"xf3013-2020.6.2.15","name":"化学洗消消防车","category":"救援及保障车辆","aliases":["化学洗消车"],"sourceKind":"standard","standardRef":"6.2.15","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"heading","intrinsicHeading":90,"assetKey":"xf3013-2020.6.2.15"},
  {"id":"xf3013-2020.6.2.16","name":"照明消防车","category":"救援及保障车辆","aliases":["照明车"],"sourceKind":"standard","standardRef":"6.2.16","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"heading","intrinsicHeading":90,"assetKey":"xf3013-2020.6.2.16"},
  {"id":"xf3013-2020.6.2.17","name":"通信指挥消防车","category":"救援及保障车辆","aliases":["通信指挥车"],"sourceKind":"standard","standardRef":"6.2.17","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"heading","intrinsicHeading":90,"assetKey":"xf3013-2020.6.2.17"},
  {"id":"xf3013-2020.6.2.18","name":"排烟消防车","category":"救援及保障车辆","aliases":["排烟车"],"sourceKind":"standard","standardRef":"6.2.18","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"heading","intrinsicHeading":90,"assetKey":"xf3013-2020.6.2.18"},
  {"id":"xf3013-2020.6.2.23","name":"供水消防车","category":"救援及保障车辆","aliases":["供水车"],"sourceKind":"standard","standardRef":"6.2.23","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"heading","intrinsicHeading":90,"assetKey":"xf3013-2020.6.2.23"},
  {"id":"xf3013-2020.6.2.30","name":"救护车","category":"医疗、水空救援","aliases":[],"sourceKind":"standard","standardRef":"6.2.30","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"heading","intrinsicHeading":90,"assetKey":"xf3013-2020.6.2.30"},
  {"id":"xf3013-2020.6.2.35","name":"消防直升机","category":"医疗、水空救援","aliases":[],"sourceKind":"standard","standardRef":"6.2.35","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"heading","intrinsicHeading":0,"assetKey":"xf3013-2020.6.2.35"},
  {"id":"xf3013-2020.6.2.36","name":"消防无人机","category":"医疗、水空救援","aliases":[],"sourceKind":"standard","standardRef":"6.2.36","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"upright","intrinsicHeading":0,"assetKey":"xf3013-2020.6.2.36"},
  {"id":"xf3013-2020.6.2.37","name":"消防艇","category":"医疗、水空救援","aliases":["消防船"],"sourceKind":"standard","standardRef":"6.2.37","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"heading","intrinsicHeading":90,"assetKey":"xf3013-2020.6.2.37"},
  {"id":"xf3013-2020.6.1.21","name":"战斗员","category":"人员及集结","aliases":[],"sourceKind":"standard","standardRef":"6.1.21","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"upright","intrinsicHeading":0,"assetKey":"xf3013-2020.6.1.21"},
  {"id":"xf3013-2020.6.1.27","name":"集结地","category":"人员及集结","aliases":[],"sourceKind":"standard","standardRef":"6.1.27","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"upright","intrinsicHeading":0,"assetKey":"xf3013-2020.6.1.27"},
  {"id":"app.rescue-inflatable-boat","name":"冲锋舟","category":"水域救援扩展","aliases":["橡皮艇","救援冲锋舟"],"sourceKind":"extension","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"heading","intrinsicHeading":90,"assetKey":"app.rescue-inflatable-boat"},
  {"id":"app.rescue-vessel","name":"救援舰船","category":"水域救援扩展","aliases":["救援船","救援船舶"],"sourceKind":"extension","geometryKind":"point","defaultIconSize":32,"anchor":"center","orientation":"heading","intrinsicHeading":90,"assetKey":"app.rescue-vessel"},
] as const satisfies readonly MapSymbolDefinition[];
export type MapSymbolId = typeof symbols[number]['id'];
export const MAP_SYMBOLS: readonly MapSymbolDefinition[] = symbols;
const symbolsById = new Map<string, MapSymbolDefinition>(MAP_SYMBOLS.map(symbol => [symbol.id, symbol]));
export function getMapSymbol(id: string | undefined): MapSymbolDefinition | undefined {
  return id === undefined ? undefined : symbolsById.get(id);
}
