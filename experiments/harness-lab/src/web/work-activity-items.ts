import type { WorkActivityItem } from '../contracts/work-activity';

export interface WorkActivityGroup {
  item: WorkActivityItem; fact?: WorkActivityItem; analysis?: WorkActivityItem;
}

/** A formal work is one card; ignoring an interpretation never removes its business receipt. */
export function groupWorkActivity(facts: WorkActivityItem[], analyses: WorkActivityItem[]): WorkActivityGroup[] {
  const groups = new Map<string, WorkActivityGroup>();
  const key = (item: WorkActivityItem) => item.workItemId ? `work:${item.workItemId}` : item.id;
  for (const fact of facts) groups.set(key(fact), { item: fact, fact });
  for (const analysis of analyses) {
    const id = key(analysis), fact = groups.get(id)?.fact;
    const item = fact ? { ...analysis, title: fact.title, state: fact.state,
      relation: fact.relation,
      recency: fact.recency === 'current' || analysis.relation === 'processing' && analysis.recency === 'current' ? 'current' as const : 'earlier' as const,
      evidenceIds: [...new Set([...fact.evidenceIds, ...analysis.evidenceIds])],
    } : analysis;
    groups.set(id, { item, fact, analysis });
  }
  return [...groups.values()];
}
