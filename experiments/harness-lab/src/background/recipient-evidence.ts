import { isDeepStrictEqual } from 'node:util';
import type { BackgroundJob } from '../contracts/background.js';
import type { SessionSnapshot } from '../contracts/index.js';

/** Only the exact successful result of this request may publish the persisted proposal. */
export function verifiedRecipientSuggestion(job: BackgroundJob, snapshot: SessionSnapshot): boolean {
  const suggestion = job.recipientSuggestion;
  if (!suggestion || snapshot.recoveryWarning) return false;
  const end = snapshot.messages.findIndex(message => message.id === snapshot.turns?.find(turn => turn.requestId === job.requestId)?.finalMessageId);
  if (end < 0) return false;
  return snapshot.messages.slice(0, end).some(message => {
    if (message.role !== 'tool' || message.isError || message.resultMissing || message.requestId !== job.requestId
      || message.toolName !== 'information_suggest_recipients' || message.toolCallId !== suggestion.toolCallId) return false;
    try {
      const result = JSON.parse(message.text) as {suggestion?: unknown; published?: unknown};
      return result.published === false && isDeepStrictEqual(result.suggestion, suggestion);
    } catch { return false; }
  });
}
