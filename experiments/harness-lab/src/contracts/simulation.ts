import type { ContextRef, ContextTimeRange, InformationReport, RoadProperties, SituationObject } from './context.js';
export interface SimulationNotification {sourceMessageId: string; title: string; text: string; subjectId: string; occurredAt: string}
export interface SimulationReceipt {eventId: string; sourceMessageId: string; receivedAt: string; status: 'accepted'}
export interface SimulationAction {
  id: string; systemId: string; createdAt: string; revision: number;
  notification: SimulationNotification; sendState: 'unsent' | 'accepted' | 'unconfirmed';
  receipt?: SimulationReceipt; error?: string;
}
export interface SimulationState {instanceId: string; objects: SituationObject[]; reports: InformationReport[]; actions: SimulationAction[]}
export interface SimulationObjectUpdate {
  clientActionId: string; ref: ContextRef; expectedRevision: number;
  properties: RoadProperties | {availableCount: number; unit: '辆'};
  effectiveAt: string; validTime: ContextTimeRange | null;
}
export interface SimulationReportUpdate {
  clientActionId: string; reportId: string; expectedRevision: number;
  report: Omit<InformationReport, 'reportId' | 'revision'>;
}
