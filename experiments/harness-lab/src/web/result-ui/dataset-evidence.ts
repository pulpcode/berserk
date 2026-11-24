import type { PublicMessage } from '../../contracts/index';
import { resultDatasetReceipt } from '../../contracts/result-dataset';

export function datasetFromEvidence(messages: readonly PublicMessage[], resultRef: string, sessionId: string, requestId?: string) {
  if (!requestId) return;
  const match = messages.find(message => message.role === 'tool' && message.toolName === 'bash'
    && message.requestId === requestId && message.toolStatus === 'completed' && !message.isError && !message.resultMissing
    && message.toolCallId && message.resultDataset?.resultRef === resultRef);
  if (!match?.toolCallId) return;
  return resultDatasetReceipt(match.resultDataset, { resultRef, sessionId, requestId, toolCallId: match.toolCallId })?.dataset;
}
