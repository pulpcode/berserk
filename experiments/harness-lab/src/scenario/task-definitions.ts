import type { ScenarioTaskBootstrap, ScenarioTaskDefinition } from '../contracts/scenarios.js';
import { isScenarioTaskBootstrap, LEGACY_SCENARIO_TASK_CODES } from '../contracts/scenarios.js';
import { RequestError } from '../contracts/errors.js';
import { contextRecord, contextRef, contextText } from '../context/validation.js';

const conflict = (message: string) => new RequestError('SCENARIO_HOST_CONFLICT', message, 409);
export function scenarioTaskBootstrap(value: unknown): ScenarioTaskBootstrap | undefined {
  if (value === undefined) return undefined;
  if (!isScenarioTaskBootstrap(value)) throw conflict('开场任务版本或校验清单无效。');
  return structuredClone(value);
}
export function scenarioTaskDefinitions(value: unknown, bootstrap?: ScenarioTaskBootstrap): ScenarioTaskDefinition[] {
  const expected: readonly ScenarioTaskDefinition['code'][] = bootstrap?.expectedTaskCodes ?? LEGACY_SCENARIO_TASK_CODES;
  if (!Array.isArray(value) || value.length !== expected.length) throw conflict('来源任务定义与保存的开场任务清单不一致。');
  const tasks = value.map(item => {
    const r = contextRecord(item, ['code', 'title', 'goal', 'businessRefs', 'areaIds'], ['code', 'title', 'goal', 'businessRefs', 'areaIds']);
    if (!expected.includes(r.code as ScenarioTaskDefinition['code']) || !Array.isArray(r.businessRefs) || r.businessRefs.length > 20 || !Array.isArray(r.areaIds) || r.areaIds.length > 10) throw conflict('演示任务定义无效。');
    return {code: r.code as ScenarioTaskDefinition['code'], title: contextText(r.title, 60), goal: contextText(r.goal, 8000), businessRefs: r.businessRefs.map(contextRef), areaIds: r.areaIds.map(id => contextText(id))};
  });
  if (new Set(tasks.map(task => task.code)).size !== expected.length) throw conflict('演示任务编号重复。');
  return tasks;
}
