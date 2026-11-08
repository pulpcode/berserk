import type { ContextRef, InformationReport, SituationObject } from './context.js';
import type { SimulationAction, SimulationNotification } from './simulation.js';

export const SCENARIO_MODES = ['main_story', 'source_replay'] as const;
export type ScenarioMode = typeof SCENARIO_MODES[number];
export interface ScenarioClock { instanceId: string; businessNow: string; revision: number }
/** Shared boundary guard; a clock is trusted only after source configuration authorizes it. */
export function isScenarioClock(value: unknown): value is ScenarioClock {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (Object.keys(r).length !== 3 || Object.keys(r).some(key => !['instanceId', 'businessNow', 'revision'].includes(key))
    || typeof r.instanceId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(r.instanceId)
    || typeof r.businessNow !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(r.businessNow)
    || !Number.isFinite(Date.parse(r.businessNow)) || !Number.isSafeInteger(r.revision) || Number(r.revision) < 1) return false;
  const date = new Date(`${r.businessNow.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === r.businessNow.slice(0, 10)
    && Number(r.businessNow.slice(11, 13)) < 24 && Number(r.businessNow.slice(14, 16)) < 60 && Number(r.businessNow.slice(17, 19)) < 60;
}

export interface ScenarioActor { userId: string; seatId: string }
export interface ScenarioDefinitionSummary {
  id: string; version: string; name: string; description: string; definitionHash: string;
  businessDay: string; initialBusinessNow: string; modes: ScenarioMode[];
  counts: { vehicles: number; objects: number; resources: number; steps: number; messages: number };
  geography: { label: string; attribution: string; bounds: [number, number, number, number]; synthetic: true };
}
export interface ScenarioStepSummary { id: string; title: string; description: string; businessTime: string; messageCount: number; taskCodes?: ScenarioTaskDefinition['code'][]; kind?: 'source'|'execution'; state?: 'applied'|'pending' }
export interface ScenarioInstance extends ScenarioClock {
  definitionId: string; definitionVersion: string; definitionHash: string; name: string; mode: ScenarioMode;
  status: 'prepared' | 'active' | 'frozen'; paused: boolean; stepIndex: number; stepCount: number;
  createdAt: string; updatedAt: string;
}
export interface ScenarioAction extends SimulationAction { instanceId: string; stepId: string; actor: ScenarioActor; deliveryActor?: ScenarioActor; deliveryAt?: string }
export interface ScenarioOperation {
  id: string; instanceId: string; kind: 'create' | 'activate' | 'step' | 'pause' | 'resume';
  revision: number; businessNow: string; createdAt: string; actor: ScenarioActor; actionIds: string[];
}
export interface ScenarioInstanceDetail {
  instance: ScenarioInstance; steps: ScenarioStepSummary[]; timeline?: ScenarioStepSummary[]; objects: SituationObject[];
  reports: InformationReport[]; actions: ScenarioAction[]; operations: ScenarioOperation[];
  taskDefinitions?: ScenarioTaskDefinition[];
  taskBootstrap?: ScenarioTaskBootstrap;
}
export interface ScenarioDefinitions { items: ScenarioDefinitionSummary[] }
export interface ScenarioInstances { items: ScenarioInstance[]; activeInstanceId: string | null; activeRevision: number; hasMore: boolean; nextCursor: string | null }
export interface ScenarioPreview {
  instance: ScenarioInstance; step: ScenarioStepSummary | null; changes: string[];
  notifications: SimulationNotification[]; canApply: boolean; reason?: string;
}
export interface ScenarioMutationResult { instance: ScenarioInstance; operation: ScenarioOperation; actions: ScenarioAction[] }
export interface ScenarioCreateInput { definitionId: string; version: string; mode: ScenarioMode; clientActionId: string; businessDay?: string }
export interface ScenarioMutationInput { clientActionId: string; expectedRevision: number }
export interface ScenarioActivateInput extends ScenarioMutationInput { expectedActiveRevision: number; terminateUnsent?: boolean }
export interface ScenarioControlInput extends ScenarioMutationInput { action: 'pause' | 'resume' }
export interface ScenarioTaskDefinition { code: 'T01' | 'T02' | 'T03'; title: string; goal: string; businessRefs: ContextRef[]; areaIds: string[] }
export interface ScenarioTaskBootstrap {
  schemaVersion: 2; definitionId: 'harbor-fire'; definitionVersion: '4'|'5'; definitionHash: string;
  expectedTaskCodes: ['T02', 'T03'];
}
export const LEGACY_SCENARIO_TASK_CODES = ['T01', 'T02', 'T03'] as const;
export const SCENARIO_BOOTSTRAP_TASK_CODES = ['T02', 'T03'] as const;
export function isScenarioTaskBootstrap(value: unknown): value is ScenarioTaskBootstrap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return Object.keys(r).length === 5 && Object.keys(r).every(key => ['schemaVersion', 'definitionId', 'definitionVersion', 'definitionHash', 'expectedTaskCodes'].includes(key))
    && r.schemaVersion === 2 && r.definitionId === 'harbor-fire' && (r.definitionVersion === '4' || r.definitionVersion === '5')
    && typeof r.definitionHash === 'string' && /^[a-f0-9]{64}$/.test(r.definitionHash)
    && Array.isArray(r.expectedTaskCodes) && r.expectedTaskCodes.length === SCENARIO_BOOTSTRAP_TASK_CODES.length
    && r.expectedTaskCodes.every((code, index) => code === SCENARIO_BOOTSTRAP_TASK_CODES[index]);
}
export interface ScenarioTaskInitialization { instanceId: string; tasks: Array<{code: 'T01' | 'T02' | 'T03'; taskId: string; title: string}>; initialized: boolean; taskBootstrap?: ScenarioTaskBootstrap }
export interface ScenarioPreflight { queuedJobs: number; runningJobs: number; foregroundRequests: number; unconfirmedNotifications: number; unsentNotifications: number }
