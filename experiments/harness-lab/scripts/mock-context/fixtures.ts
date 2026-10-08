import type { ContextRef, InformationReport, SituationObject } from '../../src/contracts/context.js';

/** Synthetic source facts only. Axon tasks and expected analysis belong to the test driver. */
export const at = (time: string) => `2026-10-01T${time}:00+08:00`;
export const roadRef: ContextRef = {systemId: 'situation', objectType: 'road', objectId: 'road-west-01'};
export const vehicleRef: ContextRef = {systemId: 'situation', objectType: 'resource', objectId: 'vehicles-west-01'};
export function reports(): InformationReport[] {
  return [{reportId: 'report-west-01', subjectId: 'report-west-01', revision: 1,
    title: '西区通道观测记录', summary: '截至观测时刻未报告西区通道限制。',
    content: '截至 2026-10-01 08:50 的观测，未报告西区通道限制。本记录描述观测时掌握的信息，不保证后续通行情况。',
    objectRefs: [roadRef], areaIds: ['zone-west'], observedAt: at('08:50'), publishedAt: at('08:55'),
    validTime: {from: at('09:00'), to: at('11:00')}}];
}
export function updatedReport(): InformationReport {
  return {...reports()[0], revision: 2, title: '西区通道限制更新', summary: '西区通道 09:20 至 10:10 临时受限。',
    content: '本报告更新此前观测：西区通道在 09:20 至 10:10 临时受限。此前截至 08:50 的记录未报告此限制。',
    observedAt: at('09:18'), publishedAt: at('09:20'), validTime: {from: at('09:20'), to: at('10:10')}};
}
export function unknownReport(): InformationReport {
  return {reportId: 'report-unknown-01', subjectId: 'report-unknown-01', revision: 1,
    title: '待核实通道信息', summary: '西区一处通道临时受限，对象编号有待核实。',
    content: '09:35 收到西区通道临时受限的报告，预计持续至 10:10。来源填写的道路编号为 road-unknown-99，尚未核实该编号对应的具体通道。不能据此确定其与其他已知道路的关系。',
    objectRefs: [{systemId: 'situation', objectType: 'road', objectId: 'road-unknown-99'}], areaIds: ['zone-west'],
    observedAt: at('09:35'), publishedAt: at('09:35'), validTime: {from: at('09:35'), to: at('10:10')}};
}
export function objects(): SituationObject[] {
  const result: SituationObject[] = [];
  for (const [area, name, count] of [['west', '西区', 4], ['east', '东区', 5]] as const) {
    const road: ContextRef = {systemId: 'situation', objectType: 'road', objectId: `road-${area}-01`};
    const vehicles: ContextRef = {systemId: 'situation', objectType: 'resource', objectId: `vehicles-${area}-01`};
    const base = {revision: 1, areaIds: [`zone-${area}`], effectiveAt: at('09:00'), validTime: {from: at('09:00'), to: at('11:00')}};
    result.push({...base, ref: road, name: `${name}通道`, properties: {}},
      {...base, ref: vehicles, name: `${name}可用车辆`, properties: {availableCount: count, unit: '辆'}},
      {...base, ref: {systemId: 'situation', objectType: 'area', objectId: `zone-${area}`}, name, properties: {memberRefs: [road, vehicles]}});
  }
  return result;
}
