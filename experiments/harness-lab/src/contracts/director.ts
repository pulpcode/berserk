import type { ScenarioAction, ScenarioInstance } from './scenarios.js';
import type { InformationReport, SituationObject } from './context.js';
export type DirectorMode = 'scenario' | 'free_debug';
export interface DirectorSwitchInput {
  clientActionId: string; mode: DirectorMode; expectedActiveRevision: number;
  expectedInstanceId: string | null; expectedRevision: number | null; confirmed: true; restart?: boolean;
}
export interface DirectorState {
  mode: DirectorMode; activeInstanceId: string | null; activeRevision: number;
  activeInstance?: ScenarioInstance; pending?: DirectorSwitchInput;
}
export interface DebugState { instance: ScenarioInstance; objects: SituationObject[]; reports: InformationReport[]; actions: ScenarioAction[] }
