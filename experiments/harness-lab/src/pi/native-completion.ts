import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

/** Pi drains follow-ups before prompt settles; repair stays in the original native request. */
export function nativeCompletion(check: () => 'ready' | 'missing' | 'stale', stopped: () => boolean, fail: (error: unknown) => void,
  reminder: (attempt: number) => string, exhausted?: () => void): ExtensionFactory {
  return pi => {
    let attempts = 0;
    pi.on('agent_end', event => {
      if (stopped()) return;
      const last = event.messages.at(-1);
      if (last?.role !== 'assistant' || last.stopReason !== 'stop'
        || last.content.some(block => block.type === 'toolCall')
        || !last.content.some(block => block.type === 'text' && block.text.trim())) return;
      try {
        if (check() !== 'missing' || stopped()) return;
        if (attempts >= 2) { exhausted?.(); return; }
        attempts++;
        pi.sendUserMessage(reminder(attempts), {deliverAs: 'followUp', expandPromptTemplates: false});
      } catch (error) { fail(error); }
    });
  };
}
