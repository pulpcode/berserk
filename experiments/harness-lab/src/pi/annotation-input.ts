import type { AnnotationContext, LoadedAnnotationSelection } from '../contracts/annotations.js';
import { UUID } from '../workspaces/store.js';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, fields: string[]) => Object.keys(v).every(k => fields.includes(k));
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(v);
const title = (v: unknown): v is string => typeof v === 'string' && v.length <= 200;
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= 500 && v.every(id) && new Set(v).size === v.length;
const uuid = (v: unknown) => typeof v === 'string' && UUID.test(v);
export function validAnnotationRef(v: unknown): boolean {
  return object(v) && (exact(v, ['publicationId']) && uuid(v.publicationId)
    || exact(v, ['setId', 'revision']) && uuid(v.setId) && Number.isSafeInteger(v.revision) && Number(v.revision) > 0);
}
export function validAnnotationContext(v: unknown, sessionId: string): v is AnnotationContext {
  return object(v) && exact(v, ['sessionId', 'draft', 'baseRef', 'writable']) && v.sessionId === sessionId
    && (v.draft === null || object(v.draft) && 'setId' in v.draft && validAnnotationRef(v.draft))
    && (v.baseRef === null || validAnnotationRef(v.baseRef)) && typeof v.writable === 'boolean';
}
export function validAnnotationSelections(v: unknown): v is LoadedAnnotationSelection[] {
  if (!Array.isArray(v) || !v.length || v.length > 20 || Buffer.byteLength(JSON.stringify(v)) > 256 * 1024) return false;
  return v.every(item => {
    if (!object(item) || !exact(item, ['ref', 'hash', 'title', 'layerIds', 'objectIds', 'layers', 'objects'])
      || !validAnnotationRef(item.ref) || typeof item.hash !== 'string' || !/^[0-9a-f]{64}$/.test(item.hash) || !title(item.title)
      || (item.layerIds !== undefined && item.objectIds !== undefined)
      || (item.layerIds !== undefined && !ids(item.layerIds)) || (item.objectIds !== undefined && !ids(item.objectIds))
      || !Array.isArray(item.layers) || item.layers.length > 32 || !Array.isArray(item.objects) || item.objects.length > 500) return false;
    if (!item.layers.every(layer => object(layer) && exact(layer, ['layerId', 'name']) && id(layer.layerId) && title(layer.name))
      || !item.objects.every(feature => object(feature) && exact(feature, ['objectId', 'name', 'kind', 'layerId']) && id(feature.objectId)
        && title(feature.name) && ['point', 'line', 'polygon', 'text'].includes(String(feature.kind)) && id(feature.layerId))) return false;
    const layers = item.layers as LoadedAnnotationSelection['layers'];
    const objects = item.objects as LoadedAnnotationSelection['objects'];
    return layers.length === (item.layerIds?.length ?? 0) && objects.length === (item.objectIds?.length ?? 0)
      && new Set(layers.map(layer => layer.layerId)).size === layers.length && new Set(objects.map(feature => feature.objectId)).size === objects.length
      && (item.layerIds === undefined || item.layerIds.every(selected => layers.some(layer => layer.layerId === selected)))
      && (item.objectIds === undefined || item.objectIds.every(selected => objects.some(feature => feature.objectId === selected)));
  });
}
