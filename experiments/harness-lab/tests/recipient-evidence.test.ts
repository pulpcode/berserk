import {describe,expect,it} from 'vitest';
import {verifiedRecipientSuggestion} from '../src/background/recipient-evidence.js';
import type {BackgroundJob,RecipientSuggestion} from '../src/contracts/background.js';
import type {SessionSnapshot} from '../src/contracts/index.js';

const suggestion:RecipientSuggestion={recipients:[{seatId:'planning',reason:'方案可能受影响'}],toolCallId:'call-one',recordedAt:'2026-10-09T08:00:00Z'};
const job={requestId:'request-one',recipientSuggestion:suggestion} as BackgroundJob;
function evidence():SessionSnapshot {
  return {turns:[{requestId:'request-one',finalMessageId:'final'}],messages:[
    {id:'tool-result',role:'tool',requestId:'request-one',toolCallId:'call-one',toolName:'information_suggest_recipients',text:JSON.stringify({suggestion,published:false})},
    {id:'final',role:'assistant',requestId:'request-one',text:'分析完成'},
  ]} as SessionSnapshot;
}
describe('supplementary proposal native evidence',() => {
  it('matches exact request, tool call and persisted payload before the verified final message',() => {
    expect(verifiedRecipientSuggestion(job,evidence())).toBe(true);
    for (const patch of [{isError:true},{resultMissing:true as const},{toolCallId:'another-call'},{requestId:'another-request'},{toolName:'information_read'},
      {text:JSON.stringify({suggestion:{...suggestion,recipients:[]},published:false})}]) {
      const snapshot=evidence();Object.assign(snapshot.messages[0],patch);expect(verifiedRecipientSuggestion(job,snapshot)).toBe(false);
    }
    const later=evidence();later.messages.reverse();expect(verifiedRecipientSuggestion(job,later)).toBe(false);
    const missing=evidence();missing.messages.pop();expect(verifiedRecipientSuggestion(job,missing)).toBe(false);
  });
});
