import type { ContextRef, ContextTimeRange, SituationGeometry } from './context.js';

/** Immutable version selectors. No implicit latest lookup is accepted. */
export type AnnotationRef = { setId: string; revision: number } | { publicationId: string };
export type AnnotationSelection = AnnotationRef & { layerIds?: string[]; objectIds?: string[] };
export interface AnnotationStyle {
  color?: string; fillColor?: string; opacity?: number; size?: number; width?: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted'; symbol?: 'circle' | 'square' | 'triangle'; label?: string;
}
export interface AnnotationFeature {
  objectId: string; kind: 'point' | 'line' | 'polygon' | 'text'; name: string;
  geometry: SituationGeometry; note?: string; attributes?: Record<string, string | number | boolean | null>;
  style?: AnnotationStyle;
  sourceRefs?: Array<ContextRef & { revision?: number; queriedAt?: string }>;
  originFeatureRef?: { ref: AnnotationRef; objectId: string };
}
export interface AnnotationLayer { layerId: string; name: string; order: number; defaultVisible: boolean; features: AnnotationFeature[] }
export interface AnnotationDocument { schemaVersion: 1; title: string; layers: AnnotationLayer[] }
export interface AnnotationDraft {
  setId: string; ownerSessionId: string; taskId: string; workspaceId: string; headRevision: number;
  title: string; hash: string; baseRef: AnnotationRef | null; createdAt: string; updatedAt: string;
}
export interface AnnotationBinding {
  sessionId: string; taskId: string; workspaceId: string; bindingRevision: number;
  baseRef: AnnotationRef | null; draft: AnnotationDraft | null; writable: boolean;
}
export interface AnnotationVersion {
  ref: AnnotationRef; title: string; hash: string; createdAt: string;
  document: AnnotationDocument;
}
export interface AnnotationPublication {
  publicationId: string; taskId: string; title: string; note: string; hash: string;
  publishedByUserId: string; publishedAt: string;
}
export interface AnnotationCurrent {
  taskId: string; sequence: number; publication: AnnotationPublication | null;
  selectedAt?: string; selectedByUserId?: string;
}
export interface AnnotationPage<T> { items: T[]; offset: number; limit: number; total: number; hasMore: boolean }
export interface AnnotationListing {
  drafts: AnnotationPage<AnnotationDraft>; publications: AnnotationPage<AnnotationPublication>;
  canSetCurrent: boolean;
}
export type AnnotationOperation =
  | { op: 'rename_set'; title: string }
  | { op: 'add_layer'; layer: AnnotationLayer }
  | { op: 'update_layer'; layerId: string; changes: Partial<Pick<AnnotationLayer, 'name' | 'order' | 'defaultVisible'>> }
  | { op: 'delete_layer'; layerId: string }
  | { op: 'add_object'; layerId: string; feature: AnnotationFeature }
  | { op: 'update_object'; objectId: string; changes: Partial<Omit<AnnotationFeature, 'objectId' | 'originFeatureRef'>>; layerId?: string }
  | { op: 'delete_object'; objectId: string }
  | { op: 'copy_object'; source: AnnotationRef; objectId: string; newObjectId: string; layerId: string };
export type AnnotationAction =
  | { action: 'create_draft'; clientActionId: string; baseRef?: AnnotationRef | null; title?: string; operations?: AnnotationOperation[] }
  | { action: 'apply'; clientActionId: string; expectedRevision: number; operations: AnnotationOperation[] }
  | { action: 'publish'; clientActionId: string; revision: number; title: string; note?: string };
export interface AnnotationBaseInput { clientActionId: string; expectedBindingRevision: number; baseRef: AnnotationRef | null }
export interface AnnotationCurrentInput { clientActionId: string; publicationId: string; expectedCurrentSequence: number }
/** Coordinates, source timestamps and actor/session authority are resolved by the host. */
export interface AnnotationFromSourceInput {
  clientActionId: string; mode: 'add' | 'refresh'; sourceRef: ContextRef; expectedSourceRevision: number;
  expectedRevision: number; layerId: string; objectId: string;
}
export type AnnotationSourceItem = Omit<AnnotationFromSourceInput, 'clientActionId' | 'expectedRevision'>;
export interface AnnotationFromSourcesInput { clientActionId: string; expectedRevision: number; items: AnnotationSourceItem[] }
/** Internal adapter intent; never accepted by the HTTP mutation routes. */
export type AnnotationHostIntent = Exclude<AnnotationAction, {action:'apply'}>
  | Omit<Extract<AnnotationAction, {action:'apply'}>, 'expectedRevision'>
  | {action:'from_analysis';clientActionId:string;resultRef:string;itemId?:string;layerId:string;objectId:string;name:string}
  | {action:'from_source'; clientActionId:string; items:Array<Omit<AnnotationSourceItem,'expectedSourceRevision'>>}
  | {action:'set_current'; clientActionId:string; publicationId:string};
export type AnnotationEditBasis = {setId:string; revision:number} | {bindingRevision:number; baseRef:AnnotationRef|null};
export interface AnnotationHostResult { receipt: AnnotationReceipt; replayed: boolean }
export interface AnnotationFromSourceResult {
  mode: 'add' | 'refresh'; layerId: string; objectId: string; sourceRef: ContextRef;
  sourceRevision: number; queriedAt: string; effectiveAt: string | null; validTime: ContextTimeRange | null;
}
export interface AnnotationReceipt {
  clientActionId: string; action: AnnotationAction['action'] | 'set_current' | 'set_base' | 'from_source'; taskId: string;
  sessionId?: string; committedAt: string; ref?: AnnotationRef; hash?: string;
  binding?: AnnotationBinding; publication?: AnnotationPublication; current?: AnnotationCurrent;
  fromSource?: AnnotationFromSourceResult;
  fromSources?: AnnotationFromSourceResult[];
  fromAnalysis?: {resultRef:string;itemId?:string};
  beforeRef?: {setId:string; revision:number} | null;
  afterRef?: {setId:string; revision:number};
  objectIds?: string[];
}
export type AnnotationReadField = 'geometry' | 'note' | 'attributes' | 'style' | 'sourceRefs' | 'originFeatureRef';
export interface AnnotationReadInput {
  ref: AnnotationRef; layerIds?: string[]; layerNames?: string[]; objectIds?: string[]; fields?: AnnotationReadField[]; offset?: number; limit?: number;
}
export interface AnnotationReadResult {
  ref: AnnotationRef; title: string; hash: string; createdAt: string;
  layers: Array<Omit<AnnotationLayer, 'features'>>;
  objects: AnnotationPage<Pick<AnnotationFeature, 'objectId' | 'kind' | 'name'> & Partial<AnnotationFeature> & { layerId: string }>;
}
export interface AnnotationChange { kind: 'layer' | 'object' | 'title'; id: string; change: 'added' | 'removed' | 'changed'; fields: string[] }
export interface AnnotationComparison {
  left: AnnotationRef; right: AnnotationRef; changes: AnnotationPage<AnnotationChange>;
  counts: { added: number; removed: number; changed: number };
}
/** Bounded host-verified material supplied with a message; never full geometry. */
export interface LoadedAnnotationSelection {
  ref: AnnotationRef; hash: string; title: string; layerIds?: string[]; objectIds?: string[];
  layers: Array<{layerId: string; name: string}>;
  objects: Array<{objectId: string; name: string; kind: AnnotationFeature['kind']; layerId: string}>;
}
export interface AnnotationContext {
  sessionId: string; draft: {setId: string; revision: number} | null; baseRef: AnnotationRef | null; writable: boolean;
}
