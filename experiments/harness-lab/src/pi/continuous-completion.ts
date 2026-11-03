import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { CheckAnalysisCompletion } from '../background/executor.js';

/** Pi drains queued follow-ups before prompt() settles; never start a second host request. */
export function continuousCompletion(check: () => ReturnType<CheckAnalysisCompletion>,
  stopped: () => boolean, fail: (error: unknown) => void): ExtensionFactory {
  return pi => {
    let attempts = 0;
    pi.on('agent_end', event => {
      if (stopped()) return;
      const last = event.messages.at(-1);
      if (last?.role !== 'assistant' || last.stopReason !== 'stop'
        || last.content.some(block => block.type === 'toolCall')
        || !last.content.some(block => block.type === 'text' && block.text.trim())) return;
      try {
        if (check() !== 'missing' || stopped() || attempts >= 2) return;
        attempts++;
        pi.sendUserMessage(`[系统补做提示 ${attempts}/2] 本轮尚无完整有效的研判变化记录及成功回执，当前结论未发布。请根据已获取的资料调用 information_record_analysis_update，完整记录本轮变化（包含必要重评任务）；若调用失败，请依据工具错误处理。仅在正文中声明“已记录”不能完成此步骤。成功记录后给出最终结论。`,
          {deliverAs: 'followUp', expandPromptTemplates: false});
      } catch (error) { fail(error); }
    });
  };
}
