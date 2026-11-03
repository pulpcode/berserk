import { resourceNamespace, resourceQuantityMembers, resourceQuantitySignature } from './resource-summary.js';
import type { ResourceItem, ResourceRecord, ResourceResult } from './resource-results.js';

// These limits bound explanatory examples only, never resource data or business statistics.
const OVERLAP_RECORD_EXAMPLES = 3;
const OVERLAP_MEMBER_EXAMPLES = 5;
export function resourceOverlapIndex(result: ResourceResult) {
  return new Map(result.records.map(row => [row.id, {
    namespace: resourceNamespace(row), signature: resourceQuantitySignature(row),
    members: new Set(resourceQuantityMembers(row, result.statisticsScope.at) ?? []),
  }]));
}

/** Version 3 presentation only: explain stored facts; never recalculate a status. */
export function resourceItemExplanation(result: ResourceResult, item: ResourceItem, overlapIndex?: ReturnType<typeof resourceOverlapIndex>) {
  const rows = result.records.filter(row => item.recordIds.includes(row.id));
  const at = Date.parse(result.statisticsScope.at);
  const availabilityReasons: Array<{ recordId?: string; code: string; message: string }> = [];
  for (const row of rows) {
    const fact = row.resource.availability;
    if (!fact) {
      availabilityReasons.push({ recordId: row.id, code: 'missing_evidence', message: '该记录未提供可用状态声明或依据；这不否定另行声明的可用数量，也不能据此认定不可用或相应事实未发生。' });
      continue;
    }
    const expired = !!fact.validUntil && Date.parse(fact.validUntil) <= at;
    const future = !!fact.effectiveAt && Date.parse(fact.effectiveAt) > at;
    if (expired) availabilityReasons.push({ recordId: row.id, code: 'expired', message: '该状态依据已失效，不能用作统计时点的可用或不可用的判断。' });
    if (future) availabilityReasons.push({ recordId: row.id, code: 'not_yet_effective', message: '该状态依据尚未生效。' });
    if (fact.conditions?.length) availabilityReasons.push({ recordId: row.id, code: 'conditions_unconfirmed', message: `条件尚未核实：${fact.conditions.join('；')}。未收到确认不等于条件已被否定。` });
    if (!expired && !future && !fact.conditions?.length) availabilityReasons.push({ recordId: row.id, code: fact.state === 'unknown' ? 'declared_unknown' : 'current_evidence', message: fact.state === 'unknown' ? '该记录明确表示状态尚未确认。' : `该记录有统计时点有效的${fact.state === 'available' ? '可用' : '不可用'}依据。` });
  }
  if (item.availability === 'conflict') availabilityReasons.push({ code: 'conflict', message: '统计时点有效的可用与不可用依据相冲突，保留双方依据，不能降为未知或任选一方。' });
  if (result.messages.some(message => rows.some(row => { const ref = row.source?.ref ?? row.association?.source; return ref && ref.systemId === message.resourceRef.systemId && ref.objectType === message.resourceRef.objectType && ref.objectId === message.resourceRef.objectId; }))) availabilityReasons.push({ code: 'unverified_user_report', message: '存在尚待核实的用户报告；原文及来源事实分别保留。' });

  const identity = rows.map(row => {
    if (row.association || row.source?.data?.entityId) return { recordId: row.id, kind: 'individual_identity', message: '有来源实体身份或受控导入关联，可按该身份核对重复记录。' };
    if (row.resource.granularity === 'aggregate') {
      const coverage = row.source?.data?.coverage;
      const index = overlapIndex ?? resourceOverlapIndex(result);
      const current = index.get(row.id)!;
      const overlaps: Array<{recordId: string; sharedMemberCount: number; memberEntityIds: string[]; memberIdsComplete: boolean}> = [];
      let overlapRecordCount = 0;
      for (const [recordId, other] of index) {
        if (recordId === row.id || other.namespace !== current.namespace || other.signature !== current.signature) continue;
        let sharedMemberCount = 0;
        const memberEntityIds: string[] = [];
        for (const id of other.members) if (current.members.has(id)) {
          sharedMemberCount++;
          if (memberEntityIds.length < OVERLAP_MEMBER_EXAMPLES) memberEntityIds.push(id);
        }
        if (!sharedMemberCount) continue;
        overlapRecordCount++;
        if (overlaps.length < OVERLAP_RECORD_EXAMPLES) overlaps.push({recordId, sharedMemberCount, memberEntityIds, memberIdsComplete: memberEntityIds.length === sharedMemberCount});
      }
      return coverage?.complete && coverage.memberEntityIds
        ? { recordId: row.id, kind: 'complete_members', overlaps, overlapRecordCount, overlapExamplesComplete: overlaps.length === overlapRecordCount, overlapEvidence: { resultRef: result.resultRef, meaning: '仅统计同口径且有完整有效成员依据的已知重叠；0不证明互不重叠。重叠仅列有界示例；完整成员依据保留在固定结果records的source.data.coverage，可继续read分页读取。' }, message: '这是汇总记录，成员身份清单完整；没有单体entityId不表示成员身份未知。能否合计仍以数量含义、范围、时间及汇总校验为准。' }
        : { recordId: row.id, kind: 'incomplete_members', message: '这是汇总记录，尚无完整成员依据，不能据此证明与其他记录互不重叠。' };
    }
    return { recordId: row.id, kind: 'unknown_identity', message: '单体身份或记录粒度未确认，不能仅按名称、位置认定相同或不同实体。' };
  });
  const relationMessage = item.relation === 'assigned' ? '有有效的本任务分配依据；分配本身不证明可用。'
    : item.relation === 'potential_support' ? '有有效的潜在支援依据；支援不等于已分配。'
    : item.relation === 'related' ? '仅确认与任务相关；平台引用或固定标注关联不证明已分配或可用。'
    : '本任务关系尚未确认；缺少关系依据不表示现实中没有关联。';
  return {
    availability: { state: item.availability, evaluatedAt: result.statisticsScope.at, reasons: availabilityReasons },
    relation: { state: item.relation, message: relationMessage, recordIds: item.recordIds, basis: item.relationBasis },
    identity,
    position: { message: item.positionReason ?? '有适用于该资源的实际位置；是否在范围内以空间分析为准。' },
  };
}

export function resourceRecordTimes(result: ResourceResult, row: ResourceRecord) {
  const facts = [
    ['quantity', row.resource.quantity], ['availability', row.resource.availability], ['position', row.resource.position],
    ...(row.resource.taskRelations ?? []).map(fact => [`taskRelation:${fact.taskId}`, fact] as const),
  ] as const;
  const annotationVersionAt = row.annotation && result.coverage.find(entry => entry.source === JSON.stringify(row.annotation!.ref))?.asOf;
  return {
    ...(row.source ? { sourceSnapshotAt: { value: row.source.asOf, meaning: '来源快照时间，不是本次查询时间' }, sourceQueriedAt: { value: row.source.queriedAt, meaning: '实际查询该来源的时间，不是业务事实发生时间' } } : {}),
    ...(row.annotation ? { annotationVersion: { ref: row.annotation.ref, ...(annotationVersionAt ? { createdAt: annotationVersionAt } : {}), meaning: '固定标注版本；版本时间不代表资源事实发生时间' } } : {}),
    facts: facts.flatMap(([field, fact]) => fact ? [{ field, ...(fact.reportedAt ? { reportedAt: fact.reportedAt } : {}), ...(fact.effectiveAt ? { effectiveAt: fact.effectiveAt } : {}), ...(fact.validUntil ? { validUntil: fact.validUntil } : {}) }] : []),
    factTimeMeanings: { reportedAt: '该事实的上报时间', effectiveAt: '该事实的生效时间', validUntil: '该事实依据的有效截止时间' },
  };
}

const legacyIdentityWarning = '没有可靠实体关联，是否重复未确认。';
const legacySummaryWarning = '存在实体身份未确认记录；记录数不能作为确定实体总数。';
export function resourceItemLimitations(result: ResourceResult, item: ResourceItem): string[] {
  if (result.schemaVersion !== 3) return item.limitations;
  return item.limitations.filter(text => text !== legacyIdentityWarning);
}
export function resourceSummaryLimitations(result: ResourceResult): string[] {
  if (result.schemaVersion !== 3) return result.summary.limitations;
  return result.summary.limitations.map(text => text === legacySummaryWarning ? '清单含汇总或未确认单体身份的条目，条目数不等于实体总数；成员覆盖和业务数量见各记录及分组统计。' : text);
}
