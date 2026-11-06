import { isDeepStrictEqual } from 'node:util';
import type { BackgroundJob } from '../contracts/background.js';
import type { SessionSnapshot } from '../contracts/index.js';

/** Execution proof only: a successful search does not prove semantic task coverage. */
export function verifiedTaskAssessment(job: BackgroundJob, snapshot: SessionSnapshot): boolean {
  const assessment = job.taskAssessment;
  if (!assessment || snapshot.recoveryWarning) return false;
  const end = snapshot.messages.at(-1);
  if (end?.role !== 'assistant' || end.requestId !== job.requestId || end.isError || !end.text.trim()) return false;
  const before = snapshot.messages.slice(0, -1).filter(message => message.requestId === job.requestId && message.role === 'tool');
  // A failed later submission cannot be replaced by an older successful receipt.
  const latest = before.findLast(message => message.toolName === 'information_record_task_assessment');
  if (!latest || latest.isError || latest.resultMissing) return false;
  try {
    const result = JSON.parse(latest.text);
    if (result.published !== false || !['recorded', 'unchanged'].includes(result.status)
      || !isDeepStrictEqual(result.assessment, assessment)) return false;
    if (result.status === 'recorded' && latest.toolCallId !== assessment.toolCallId) return false;
    // unchanged keeps the original stored toolCallId; its original save must also belong to this request.
    if (!before.some(message => {
      if (message.toolName !== 'information_record_task_assessment' || message.toolCallId !== assessment.toolCallId
        || message.isError || message.resultMissing) return false;
      try {
        const saved = JSON.parse(message.text);
        return saved.status === 'recorded' && saved.published === false && isDeepStrictEqual(saved.assessment, assessment);
      } catch { return false; }
    })) return false;
    const observed = new Map<string, number>();
    let searched = false;
    for (const message of before.slice(0, before.indexOf(latest))) {
      if (message.isError || message.resultMissing || !['task_search', 'task_read'].includes(message.toolName ?? '')) continue;
      const value = JSON.parse(message.text);
      if (value.systemId !== 'axon') continue;
      const items = message.toolName === 'task_search' ? value.data?.items : [value.data?.item];
      if (!Array.isArray(items) || items.some(item => !item || typeof item.id !== 'string'
        || !Number.isSafeInteger(item.revision) || item.revision < 1 || item.visibility !== 'public' || item.state !== 'active')) continue;
      if (message.toolName === 'task_search') searched = true;
      for (const item of items) observed.set(item.id, item.revision);
    }
    return searched && assessment.items.every(item => observed.get(item.taskSpaceId) === item.taskRevision);
  } catch { return false; }
}
