import type { AnnotationRef, AnnotationSelection } from '../../contracts/annotations';
export const annotationKey = (ref: AnnotationRef) => 'publicationId' in ref ? `published:${ref.publicationId}` : `${ref.setId}:r${ref.revision}`;
export const annotationLabel = (ref: AnnotationRef) => 'publicationId' in ref ? `发布版 ${ref.publicationId.slice(0,8)}` : `${ref.setId.slice(0,8)} · r${ref.revision}`;
export const annotationPath = (ref: AnnotationRef) => 'publicationId' in ref ? `/api/annotation-publications/${encodeURIComponent(ref.publicationId)}` : `/api/annotations/${encodeURIComponent(ref.setId)}/revisions/${ref.revision}`;
export function isAnnotationSelection(value: unknown): value is AnnotationSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ref=value as Record<string,unknown>;
  const validRef=typeof ref.publicationId==='string' && !('setId' in ref) && !('revision' in ref) || typeof ref.setId==='string' && Number.isSafeInteger(ref.revision) && Number(ref.revision)>0 && !('publicationId' in ref);
  return validRef && !(ref.layerIds && ref.objectIds) && ['layerIds','objectIds'].every(key=>ref[key]===undefined || Array.isArray(ref[key]) && ref[key].every(id=>typeof id==='string'));
}
