import type { PublicMessage } from '../contracts/index';

/** Actionable locators come only from successful host-projected tool evidence. */
export function messageAuthoringReceipt(message?: PublicMessage) {
  const receipt = message?.toolDetails?.authoringReceipt;
  if (!message || !receipt || message.isError || message.resultMissing || message.toolStatus === 'running') return undefined;
  if (message.toolName === 'capability_authoring_read') return receipt;
  return message.toolName === 'capability_authoring_save' && receipt.requestId === message.requestId && receipt.confirmation.toolCallId === message.toolCallId ? receipt : undefined;
}
