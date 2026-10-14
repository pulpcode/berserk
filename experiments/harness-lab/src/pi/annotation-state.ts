import type { AnnotationBinding, AnnotationReceipt } from '../contracts/annotations.js';
import type { ContextQueryResult, ContextRef, SituationCurrent } from '../contracts/context.js';
import { RequestError } from '../contracts/errors.js';
import { AnnotationError, type AnnotationResourceIssue } from '../annotations/errors.js';

type DraftBasis = {setId: string; revision: number; hash: string};
type Observation = {draft?: DraftBasis | null; sources?: Map<string, number>; current?: number; receipt?: AnnotationReceipt};
const sourceKey = (ref: ContextRef) => JSON.stringify([ref.systemId, ref.objectType, ref.objectId]);
export const isMapTool = (name: string) => name.startsWith('annotation_') || name === 'situation_query';

/** One authenticated host request. Observations are not authority or a persistent transcript. */
export class AnnotationRequestState {
  private draft?: DraftBasis;
  private sources = new Map<string, number>();
  private current?: number;
  private pending = new Map<string, Observation>();
  private paused = false;
  private uncertain = new Set<string>();
  private completedWrites = new Map<string, string>();

  /** Only normal inference may consume completed, unaltered tool results. */
  beginInference() {
    for (const observation of this.pending.values()) {
      if ('draft' in observation) this.draft = observation.draft ?? undefined;
      if (observation.current !== undefined) this.current = observation.current;
      for (const [key, revision] of observation.sources ?? []) this.sources.set(key, revision);
      if (observation.receipt && this.uncertain.delete(observation.receipt.clientActionId)) {
        // Receipt confirms the original effect, not the current editable head. Require a fresh read.
        if (observation.receipt.action === 'set_current') this.current = undefined;
        else this.draft = undefined;
      }
    }
    this.pending.clear(); this.completedWrites.clear(); this.paused = false;
  }
  /** Context/lifecycle reset only. Unknown effects survive compaction until reconciled. */
  invalidate() {
    this.draft = undefined; this.current = undefined; this.sources.clear(); this.pending.clear(); this.paused = true;
  }
  pause() { this.paused = true; }
  rejectResult(callId: string) {
    this.pending.delete(callId); this.pause();
    const actionId = this.completedWrites.get(callId);
    if (actionId) this.markUncertain(actionId);
  }
  markUncertain(actionId: string) { this.uncertain.add(actionId); this.pause(); }
  noteWrite(callId: string, actionId: string) { this.completedWrites.set(callId, actionId); }
  observeDraft(binding: AnnotationBinding, callId = 'draft') {
    this.pending.set(callId, {draft: binding.draft ? {setId: binding.draft.setId, revision: binding.draft.headRevision, hash: binding.draft.hash} : null});
  }
  observeCurrent(sequence: number, callId = 'current') { this.pending.set(callId, {current: sequence}); }
  observeReceipt(receipt: AnnotationReceipt, callId: string) { this.pending.set(callId, {receipt}); }
  observeSources(result: ContextQueryResult, callId = 'sources') {
    if (!('mode' in result.query) || result.query.mode !== 'current' || !('items' in result.data)) return;
    const items = (result.data as SituationCurrent).items;
    const keys = new Set([...this.sources.keys(), ...[...this.pending.values()].flatMap(item => [...item.sources?.keys() ?? []]), ...items.map(item => sourceKey(item.ref))]);
    if (keys.size > 500) throw new RequestError('ANNOTATION_SOURCE_LIMIT', '本轮来源依据超过 500 个对象，请缩小查询范围并开始新请求。', 413);
    this.pending.set(callId, {sources: new Map(items.map(item => [sourceKey(item.ref), item.revision]))});
  }
  assertWritable() {
    if (this.uncertain.size) throw new AnnotationError('ANNOTATION_RESULT_UNCERTAIN', '原操作结果尚未核对。请先 annotation_read mode:receipt 查询以下动作；未找到回执不能视为未执行。确认后重新读取相关草稿或当前设定。', {outcome: 'unknown', clientActionIds: [...this.uncertain]});
    if (this.paused) throw new AnnotationError('ANNOTATION_BATCH_PAUSED', '本次模型输出的后续地图写入已暂停；请先处理前一个错误，再决定后续操作。已成功保存的操作不会撤销，已有读取记录保留。', {outcome: 'not_committed'});
  }
  /** Aggregate only already-known gaps; do not query extra sources to manufacture error detail. */
  requireDraftAndSources(refs: ContextRef[] = []) {
    this.assertWritable();
    const resources: AnnotationResourceIssue[] = this.draft ? [] : [{kind: 'draft', state: 'missing'}];
    refs.forEach((ref, itemIndex) => { if (!this.sources.has(sourceKey(ref))) resources.push({kind: 'source', state: 'missing', ref, itemIndex}); });
    if (resources.length) throw new AnnotationError(this.draft ? 'SOURCE_READ_REQUIRED' : 'ANNOTATION_READ_REQUIRED', '缺少已读依据；请按 resources 补读本会话 draft 或 situation_query current 来源，收到结果后再保存。其他已读记录保留。', {outcome: 'not_committed', resources});
  }
  draftBasis(): DraftBasis { this.requireDraftAndSources(); return {...this.draft!}; }
  currentSequence() {
    this.assertWritable();
    if (this.current === undefined) throw new AnnotationError('ANNOTATION_CURRENT_READ_REQUIRED', '请先 annotation_list 读取任务当前设定，收到结果后再采用。', {outcome: 'not_committed', resources: [{kind: 'current', state: 'missing'}]});
    return this.current;
  }
  sourceRevision(ref: ContextRef) {
    const revision = this.sources.get(sourceKey(ref));
    if (revision === undefined) throw new AnnotationError('SOURCE_READ_REQUIRED', '请先 situation_query mode:current 查询目标来源对象，收到结果后再保存。', {outcome: 'not_committed', resources: [{kind: 'source', state: 'missing', ref}]});
    return revision;
  }
  committed(receipt: AnnotationReceipt, replayed: boolean) {
    if (replayed) return;
    if (receipt.action === 'set_current' && receipt.current) {
      this.current = receipt.current.sequence;
      for (const observation of this.pending.values()) delete observation.current;
    }
    if (!['create_draft', 'apply', 'from_source'].includes(receipt.action)) return;
    const after = receipt.afterRef, before = receipt.beforeRef;
    const valid = receipt.action === 'create_draft' ? before === null
      : this.draft && before && 'setId' in before && before.setId === this.draft.setId && before.revision === this.draft.revision;
    if (!valid || !after || !('setId' in after) || !receipt.hash) {
      this.markUncertain(receipt.clientActionId);
      throw new AnnotationError('ANNOTATION_RESULT_UNCERTAIN', '保存结果与本轮编辑依据不一致，请查询原操作回执并重新读取。', {outcome: 'unknown', clientActionIds: [receipt.clientActionId]});
    }
    this.draft = {...after, hash: receipt.hash};
    // A prior read in the same batch must not rewind the confirmed commit chain.
    for (const observation of this.pending.values()) delete observation.draft;
  }
}
