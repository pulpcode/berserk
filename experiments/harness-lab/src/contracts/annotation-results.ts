import type { AnnotationReadInput, AnnotationReceipt, AnnotationRef, AnnotationSelection } from './annotations.js';

export const ANNOTATION_MODEL_FORMAT = 'annotation.model-result.v1';
export const ANNOTATION_EXPLAINED_MODEL_FORMAT = 'annotation.model-result.v2';
export interface AnnotationResult {
  schemaVersion: 1;
  origin: 'write' | 'replay' | 'receipt_read';
  receipt: AnnotationReceipt & {replayed?: boolean};
}
export interface AnnotationMapEntry { selection: AnnotationSelection; original: boolean; publication: boolean }
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const positiveRevision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const objectId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
function fixedRef(value: unknown): AnnotationRef | undefined {
  if (!record(value)) return;
  if (uuid(value.publicationId) && value.setId === undefined && value.revision === undefined) return {publicationId:value.publicationId};
  if (uuid(value.setId) && positiveRevision(value.revision) && value.publicationId === undefined) return {setId:value.setId,revision:value.revision};
}
const sourceRef = (value: unknown) => record(value) && ['systemId','objectType','objectId'].every(key => typeof value[key] === 'string' && Boolean(value[key].trim()) && value[key].length <= 128) && ['road','resource','area'].includes(String(value.objectType));
/** Shared strict projection for legacy receipts and native structured results. */
export function receiptMapEntry(value: unknown, toolName: string): AnnotationMapEntry | undefined {
  if (!['annotation_action','annotation_from_source','annotation_from_analysis','annotation_read'].includes(toolName)) return;
  if (!record(value) || !uuid(value.clientActionId) || !uuid(value.taskId) || typeof value.committedAt !== 'string' || !Number.isFinite(Date.parse(value.committedAt))) return;
  if (!['create_draft','apply','from_source','publish','set_current'].includes(String(value.action)) || value.outcome !== undefined) return;
  if (toolName === 'annotation_from_source' && value.action !== 'from_source') return;
  if (toolName === 'annotation_from_analysis' && (value.action !== 'apply' || !record(value.fromAnalysis) || typeof value.fromAnalysis.resultRef !== 'string' || !value.fromAnalysis.resultRef.startsWith('spatial:'))) return;
  if (toolName === 'annotation_action' && value.action === 'from_source') return;
  if (value.replayed !== undefined && typeof value.replayed !== 'boolean') return;
  const publication = value.action === 'publish' || value.action === 'set_current';
  const ref = fixedRef(value.ref);
  if (!ref || publication !== ('publicationId' in ref)) return;
  if (value.afterRef !== undefined && JSON.stringify(fixedRef(value.afterRef)) !== JSON.stringify(ref)) return;
  if (record(value.publication) && value.publication.publicationId !== ('publicationId' in ref ? ref.publicationId : undefined)) return;
  if (record(value.current) && record(value.current.publication) && value.current.publication.publicationId !== ('publicationId' in ref ? ref.publicationId : undefined)) return;
  const sources = value.fromSources !== undefined ? value.fromSources : value.fromSource !== undefined ? [value.fromSource] : undefined;
  if (value.action === 'from_source' && (!Array.isArray(sources) || !sources.length || sources.length > 20 || !sources.every(item => record(item) && ['add','refresh'].includes(String(item.mode)) && objectId(item.objectId) && objectId(item.layerId) && sourceRef(item.sourceRef) && positiveRevision(item.sourceRevision) && typeof item.queriedAt === 'string' && Number.isFinite(Date.parse(item.queriedAt))))) return;
  let ids: string[] | undefined;
  if (value.objectIds !== undefined) {
    if (!Array.isArray(value.objectIds) || value.objectIds.length > 500 || !value.objectIds.every(objectId)) return;
    ids = [...new Set(value.objectIds)];
  } else if (value.action === 'from_source' && Array.isArray(sources)) ids = [...new Set(sources.map(item => (item as {objectId:string}).objectId))];
  return {selection:{...ref,...(ids?.length ? {objectIds:ids} : {})},original:toolName === 'annotation_read' || value.replayed === true,publication};
}
/** Details are UI evidence only; invalid new metadata never falls back to model prose. */
export function extractAnnotationResult(details: unknown, toolName: string, isError = false, text?: string): AnnotationResult | null | undefined {
  if (!record(details) || !Object.hasOwn(details, 'annotationResult')) return;
  if (isError || !record(details.annotationResult)) return null;
  const value = details.annotationResult;
  if (Object.keys(value).some(key => !['schemaVersion','origin','receipt'].includes(key)) || value.schemaVersion !== 1 || !record(value.receipt) || !receiptMapEntry(value.receipt, toolName)) return null;
  const origin = toolName === 'annotation_read' ? 'receipt_read' : value.receipt.replayed === true ? 'replay' : 'write';
  if (value.origin !== origin) return null;
  if (text !== undefined) {
    try {
      const model: unknown = JSON.parse(text);
      if (!record(model) || JSON.stringify(model.data) !== JSON.stringify(projectAnnotationResult(value.receipt))) return null;
      if (model.format === ANNOTATION_MODEL_FORMAT) {
        if (Object.keys(model).some(key => !['format','data'].includes(key))) return null;
      } else if (model.format !== ANNOTATION_EXPLAINED_MODEL_FORMAT || Object.keys(model).some(key => !['format','data','meaning'].includes(key))
        || JSON.stringify(model.meaning) !== JSON.stringify(annotationReceiptMeaning(origin))) return null;
    } catch { return null; }
  }
  return structuredClone(value) as unknown as AnnotationResult;
}

/** Remove only annotation metadata hashes, never arbitrary business attributes. */
export function projectAnnotationResult(actual: unknown): unknown {
  const result = structuredClone(actual);
  if (!record(result)) return result;
  const omit = (value: unknown) => { if (record(value)) delete value.hash; };
  omit(result);
  omit(result.draft);
  if (record(result.binding)) omit(result.binding.draft);
  omit(result.publication);
  if (record(result.current)) omit(result.current.publication);
  for (const key of ['drafts','publications']) {
    const page = result[key];
    if (record(page) && Array.isArray(page.items)) page.items.forEach(omit);
  }
  return result;
}

/** Describes this delivery only, never the conversation's overall save state. */
export function annotationReceiptMeaning(origin:AnnotationResult['origin']) {
  return {effect:origin==='receipt_read' ? '本次读取既有动作回执，没有重新执行写入；data记录原动作、版本和对象。'
    :origin==='replay' ? '本次返回同一动作的已有回执，没有重复写入；data记录原动作、版本和对象。'
    :'本次动作已成功，具体动作、版本和涉及对象以data为准；其他动作的状态须分别核对。'};
}
export function annotationReadMeaning(actual:unknown, query:Partial<AnnotationReadInput>) {
  if(!record(actual) || !record(actual.objects) || !Array.isArray(actual.objects.items) || typeof actual.objects.total!=='number') return;
  const objectFilter=Boolean(query.objectIds || query.objectNames),layerFilter=Boolean(query.layerIds || query.layerNames);
  return {
    scope:objectFilter ? 'data.ref固定版本内，按data.query的图层及对象条件读取；layers仅列有匹配对象的图层。'
      :layerFilter ? 'data.ref固定版本内，读取data.query指定图层的对象。' : '读取data.ref固定版本的全部图层及对象，objects.items按页返回。',
    counts:`本次条件共匹配${actual.objects.total}个对象，本页返回${actual.objects.items.length}个；分页位置与后续页以objects.offset/hasMore为准。${objectFilter?'不能据此推断全草稿或全图层总数，零匹配也不表示整个草稿为空。':''}`,
    effect:'本次只读取已有对象，没有创建或修改标绘。',
    ...(Array.isArray(actual.nameLookupHints) && actual.nameLookupHints.length ? {nameLookupHints:'名称查询仍为零匹配；这些字符串与同版本、同图层范围内的对象ID完全一致。需要时保留原ref及图层限制，使用objectIds重新读取，不自动替换本次结果。'} : {}),
  };
}
