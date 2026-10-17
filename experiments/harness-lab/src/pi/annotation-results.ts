import type { AnnotationReadInput } from '../contracts/annotations.js';
import { ANNOTATION_MODEL_FORMAT, extractAnnotationResult, projectAnnotationResult } from '../contracts/annotation-results.js';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function annotationToolResult(actual: unknown, toolName: string, query?: Partial<AnnotationReadInput> & {mode?: string}) {
  const data = projectAnnotationResult(actual);
  if (object(data) && object(data.objects) && (query?.mode === 'read' || query?.mode === 'draft')) {
    data.query = Object.fromEntries(['objectIds','layerIds','layerNames','fields'].filter(key => query[key as keyof typeof query] !== undefined).map(key => [key, structuredClone(query[key as keyof typeof query])]));
  }
  const replayed = object(actual) && actual.replayed === true;
  const annotationResult = extractAnnotationResult({annotationResult:{schemaVersion:1,origin:toolName === 'annotation_read' ? 'receipt_read' : replayed ? 'replay' : 'write',receipt:actual}}, toolName);
  return {content:[{type:'text' as const,text:JSON.stringify({format:ANNOTATION_MODEL_FORMAT,data})}],details:annotationResult ? {annotationResult} : {}};
}
