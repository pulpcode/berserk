import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { RecordRecipientSuggestion } from '../background/executor.js';
import { RequestError } from '../contracts/errors.js';

/** A normal, completed Pi tool call records a proposal; human review happens after execution. */
export function recipientSuggestionTool(record: RecordRecipientSuggestion, controller: AbortController, authorize: () => void) {
  const reason = Type.String({minLength: 1, maxLength: 1500});
  return defineTool({name: 'information_suggest_recipients', label: '建议补充接收席位',
    description: '建议在固定接收席位之外补充通知哪些候选席位，并逐项说明原因；无需补充时说明理由。每次提交完整建议，分析成功结束后交总体席批准。本工具不投递信息。',
    parameters: Type.Object({recipients: Type.Array(Type.Object({seatId: Type.String({pattern: '^[a-zA-Z0-9_-]{1,64}$'}), reason}, {additionalProperties: false}), {maxItems: 100, description: '本次完整补充接收名单；非空时逐项填写 seatId 和 reason，并省略 noAdditionalReason。无需补充时填写空数组 []。'}),
      noAdditionalReason: Type.Optional(Type.String({minLength: 1, maxLength: 1500, description: '仅当 recipients 为空数组时必填，说明无需补充的理由。recipients 非空时不要填写此字段；它不是名单之外的补充说明。'}))}, {additionalProperties: false}), executionMode: 'sequential',
    execute: async (toolCallId, input, signal) => {
      const scoped = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
      scoped.throwIfAborted(); authorize();
      try {
        const result = await record(input, toolCallId, scoped);
        scoped.throwIfAborted(); authorize();
        return {content: [{type: 'text' as const, text: JSON.stringify({...result, message: '建议已记录，尚未批准或投递。'})}], details: {}};
      } catch (error) {
        scoped.throwIfAborted();
        if (error instanceof RequestError) throw new Error(`${error.code}: ${error.message}`);
        throw error;
      }
    },
  });
}
