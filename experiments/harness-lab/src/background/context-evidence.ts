import type { PublicMessage, SessionSnapshot } from '../contracts/index.js';
import type { BackgroundEvent } from '../contracts/background.js';

const queryTools = new Set(['information_search', 'information_read', 'situation_query', 'task_search', 'task_read']);
export function queryEvidence(snapshot: SessionSnapshot | null, requestId: string): PublicMessage[] {
  return snapshot?.messages.filter(message => message.requestId === requestId && message.role === 'tool'
    && !message.isError && !message.resultMissing && queryTools.has(message.toolName ?? '')) ?? [];
}

export function sourceReference(event: BackgroundEvent): string {
  return `来源标识：${JSON.stringify({sourceId: event.sourceId, systemId: event.systemId,
    subjectId: event.subjectId, occurredAt: event.occurredAt})}`;
}

/** Reference hints only; original query bodies remain in the originating native history. */
export function queryReferences(messages: PublicMessage[]): string {
  const references = messages.flatMap(message => {
    try {
      const value = JSON.parse(message.text);
      if (!value || typeof value !== 'object' || !value.query || !value.queriedAt) return [];
      return [{tool: message.toolName, systemId: value.systemId, query: value.query, queriedAt: value.queriedAt, asOf: value.data?.asOf}];
    } catch { return []; }
  });
  return references.length ? `\n当次查询线索（历史依据，当前情况需重新查询）：\n${JSON.stringify(references)}` : '';
}
