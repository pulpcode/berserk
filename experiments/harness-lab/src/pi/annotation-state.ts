import type { AnnotationBinding, AnnotationReceipt, AnnotationRef } from '../contracts/annotations.js';
import type { ContextQueryResult, ContextRef, SituationCurrent } from '../contracts/context.js';
import { RequestError } from '../contracts/errors.js';

type DraftBasis = {setId: string; revision: number; hash: string};
type EmptyBasis = {bindingRevision: number; baseRef: AnnotationRef | null};
const sourceKey = (ref: ContextRef) => JSON.stringify([ref.systemId, ref.objectType, ref.objectId]);
export const isAnnotationWrite = (name: string) => name === 'annotation_action' || name === 'annotation_from_source';

/** One host request only. Never restores authority from transcript text or latest head. */
export class AnnotationRequestState {
  private draft?: DraftBasis | EmptyBasis;
  private pendingDraft?: DraftBasis | EmptyBasis;
  private sources = new Map<string, number>();
  private pendingSources = new Map<string, number>();
  private current?: number;
  private pendingCurrent?: number;
  private blocked = false;

  /** Called only before a normal model inference, after completed results enter its context. */
  beginInference() {
    if (this.pendingDraft) { this.draft = this.pendingDraft; this.blocked = false; }
    if (this.pendingCurrent !== undefined) { this.current = this.pendingCurrent; this.blocked = false; }
    for (const [key, revision] of this.pendingSources) this.sources.set(key, revision);
    this.pendingDraft = undefined; this.pendingCurrent = undefined; this.pendingSources.clear();
  }
  invalidate() {
    this.draft = undefined; this.pendingDraft = undefined;
    this.current = undefined; this.pendingCurrent = undefined;
    this.sources.clear(); this.pendingSources.clear(); this.blocked = true;
  }
  observeDraft(binding: AnnotationBinding) {
    this.pendingDraft = binding.draft ? {setId: binding.draft.setId, revision: binding.draft.headRevision, hash: binding.draft.hash}
      : {bindingRevision: binding.bindingRevision, baseRef: structuredClone(binding.baseRef)};
  }
  observeCurrent(sequence: number) { this.pendingCurrent = sequence; }
  observeSources(result: ContextQueryResult) {
    // Report references and change history are not current object reads.
    if (!('mode' in result.query) || result.query.mode !== 'current' || !('items' in result.data)) return;
    const items = (result.data as SituationCurrent).items;
    const keys = new Set([...this.sources.keys(), ...this.pendingSources.keys(), ...items.map(item => sourceKey(item.ref))]);
    if (keys.size > 500) throw new RequestError('ANNOTATION_SOURCE_LIMIT', '本轮来源依据超过 500 个对象，请缩小查询范围并开始新请求。', 413);
    for (const item of items) this.pendingSources.set(sourceKey(item.ref), item.revision);
  }
  assertWritable() {
    if (this.blocked) throw new RequestError('ANNOTATION_READ_REQUIRED', '编辑依据已失效；请重新读取本会话草稿或任务当前设定，收到结果后再操作。', 409);
  }
  draftBasis(): DraftBasis {
    this.assertWritable();
    if (!this.draft || !('setId' in this.draft)) throw new RequestError('ANNOTATION_READ_REQUIRED', '请先 annotation_read mode:draft 读取本会话草稿，收到结果后再修改。', 409);
    return {...this.draft};
  }
  emptyBasis(): EmptyBasis {
    this.assertWritable();
    if (!this.draft || 'setId' in this.draft) throw new RequestError('ANNOTATION_READ_REQUIRED', '请先 annotation_read mode:draft 确认本会话尚无草稿，收到结果后再创建。', 409);
    return structuredClone(this.draft);
  }
  currentSequence() {
    this.assertWritable();
    if (this.current === undefined) throw new RequestError('ANNOTATION_CURRENT_READ_REQUIRED', '请先 annotation_list 读取任务当前设定，收到结果后再采用。', 409);
    return this.current;
  }
  sourceRevision(ref: ContextRef) {
    const revision = this.sources.get(sourceKey(ref));
    if (revision === undefined) throw new RequestError('SOURCE_READ_REQUIRED', '请先 situation_query mode:current 查询目标来源对象，收到结果后再保存。', 409);
    return revision;
  }
  committed(receipt: AnnotationReceipt, replayed: boolean) {
    if (replayed) return;
    if (receipt.action === 'set_current' && receipt.current) {
      this.current = receipt.current.sequence; this.pendingCurrent = undefined;
    }
    if (receipt.action !== 'create_draft' && receipt.action !== 'apply' && receipt.action !== 'from_source') return;
    const after = receipt.afterRef;
    const before = receipt.beforeRef;
    const valid = receipt.action === 'create_draft'
      ? this.draft && !('setId' in this.draft) && before === null
      : this.draft && 'setId' in this.draft && before && 'setId' in before
        && before.setId === this.draft.setId && before.revision === this.draft.revision;
    if (!valid || !after || !('setId' in after) || !receipt.hash) {
      this.invalidate(); throw new RequestError('ANNOTATION_RESULT_UNCERTAIN', '保存结果与本轮编辑依据不一致，请查询原操作回执并重新读取。', 409);
    }
    this.draft = {...after, hash: receipt.hash};
    // A read from earlier in this same tool batch must never rewind our own committed head.
    this.pendingDraft = undefined;
  }
}
