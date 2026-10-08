/** Capability-validation contracts; these are not a universal domain data model. */
export interface ContextRef { systemId: string; objectType: string; objectId: string }
export interface ContextScopeSnapshot { scopeId: string; systemIds: string[] }
export type ContextPrincipal =
  | {kind: 'seat'; seatId: string}
  | {kind: 'service'; profileId: string; jobId: string; scope: ContextScopeSnapshot};
export type ContextTool = 'information_search' | 'information_read' | 'situation_query';
export interface ContextCatalogSystem {
  id: string; name: string; objectTypes: string[];
  capabilities: string[]; areas: Array<{id: string; name: string}>;
}
export interface ContextCatalog { systems: ContextCatalogSystem[] }
export interface ContextFilters {
  objectRefs?: ContextRef[]; areaIds?: string[]; query?: string; limit?: number; cursor?: string;
}
export interface InformationSearchParams extends ContextFilters {
  systemId: string; reportId?: string; subjectId?: string; from?: string; to?: string;
}
export interface InformationReadParams { systemId: string; reportId: string; revision?: number }
export interface SituationQueryParams extends ContextFilters {
  systemId: string; mode: 'current' | 'changes'; from?: string; to?: string; after?: string;
}
export type ContextQueryParams = InformationSearchParams | InformationReadParams | SituationQueryParams;
export interface ContextTimeRange { from: string | null; to: string | null }
export interface ContextPage<T> {
  systemId: string; asOf: string; items: T[]; limit: number;
  nextCursor: string | null; hasMore: boolean; timeUnknownCount: number;
}
export interface InformationReportIndex {
  reportId: string; subjectId: string; revision: number; title: string; summary: string;
  objectRefs: ContextRef[]; areaIds: string[];
  observedAt: string | null; publishedAt: string | null; validTime: ContextTimeRange | null;
}
export interface InformationReport extends InformationReportIndex { content: string }
export interface InformationDetail { systemId: string; asOf: string; item: InformationReport }
export interface SituationObject {
  ref: ContextRef; name: string; revision: number; areaIds: string[];
  effectiveAt: string | null; validTime: ContextTimeRange | null;
  properties: {availableCount: number; unit: '辆'} | {memberRefs: ContextRef[]} | Record<string, never>;
}
export interface SituationChange {
  cursor: string; effectiveAt: string | null; before: SituationObject; after: SituationObject;
}
export interface SituationCurrent extends ContextPage<SituationObject> { unknownRefs: ContextRef[]; changeCursor: string }
export interface SituationChanges extends ContextPage<SituationChange> { unknownRefs: ContextRef[]; nextAfter: string | null }
export type ContextData = ContextPage<InformationReportIndex> | InformationDetail | SituationCurrent | SituationChanges;
export interface ContextQueryResult {
  systemId: string; query: ContextQueryParams; queriedAt: string; data: ContextData;
}
