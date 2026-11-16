import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { AuthoringProposal, AuthoringReceipt } from '../../src/contracts/authoring.js';
import type { ConfirmationInteraction } from '../../src/contracts/interactions.js';
import { authoringReceipt, proposalDigest } from '../../src/authoring/integrity.js';
import { COMMAND_POLICY, INTERACTION_REQUESTED, INTERACTION_RESOLVED, interactionHistory } from '../../src/pi/interactions.js';
import { RESOURCE_ENTRY } from '../../src/pi/resource-tools.js';

function history() {
  const sessionId=randomUUID(), workspaceId=randomUUID(), requestId=randomUUID(), toolCallId='save-call', interactionId=randomUUID();
  const body: Omit<AuthoringProposal,'proposalDigest'> = {schemaVersion:1,proposalId:randomUUID(),ownerUserId:'admin',sessionId,requestId,targetId:'expert-fixed-target',baseline:{draftRevision:3,digest:'a'.repeat(64)},candidate:{kind:'expert',content:{name:'目标专家',description:'资料核对',instructions:'保留未知项',allowedTools:[],skillIds:[]}},summary:'只调整说明',createdAt:new Date().toISOString()};
  const proposal={...body,proposalDigest:proposalDigest(body)};
  const policy={decision:'ask',ruleId:'capability_authoring_save',reason:'确认实际候选后保存',version:'1'};
  const item:ConfirmationInteraction={schemaVersion:1,interactionId,workspaceId,sessionId,requestId,toolCallId,toolName:'capability_authoring_save',createdAt:body.createdAt,kind:'confirmation',status:'pending',action:{title:'保存专家草稿',description:proposal.summary,parameters:{proposalId:proposal.proposalId},authoring:{proposal}},rule:{ruleId:policy.ruleId,reason:policy.reason,version:policy.version}};
  const receipt=authoringReceipt(proposal,proposal.targetId!,4,'b'.repeat(64),{interactionId,toolCallId});
  // Focused native replay fixture: surrounding session/header/resource decoding has its own tests.
  const entries=[
    {type:'custom',customType:RESOURCE_ENTRY,data:{requestId}},
    {type:'message',message:{role:'assistant',content:[{type:'toolCall',id:toolCallId,name:item.toolName,arguments:item.action.parameters}]}},
    {type:'custom',customType:COMMAND_POLICY,data:{workspaceId,sessionId,requestId,seatId:'account-admin',toolCallId,toolName:item.toolName,parameters:item.action.parameters,policy}},
    {type:'custom',customType:INTERACTION_REQUESTED,data:{requestId,seatId:'account-admin',interaction:item}},
    {type:'custom',customType:INTERACTION_RESOLVED,data:{requestId,seatId:'account-admin',interaction:{...item,status:'approved',resolvedAt:body.createdAt}}},
    {type:'message',message:{role:'toolResult',toolCallId,toolName:item.toolName,isError:false,content:[{type:'text',text:JSON.stringify(receipt)}],details:{authoringReceipt:receipt,commandPolicy:policy,executionStarted:true}}},
  ] as unknown as SessionEntry[];
  return {entries,sessionId,workspaceId};
}

test('replay rejects changed saved target and baseline rather than projecting a successful save',()=>{
  const fixture=history();
  expect(interactionHistory(fixture.entries,fixture.workspaceId,fixture.sessionId,undefined,'account-admin')[0]).toMatchObject({status:'approved',execution:'succeeded'});
  for(const field of ['target','baseline'] as const){
    const altered=structuredClone(fixture.entries);const entry=altered.at(-1)!;
    if(entry.type!=='message'||entry.message.role!=='toolResult')throw Error('fixture');
    const details=entry.message.details as {authoringReceipt:AuthoringReceipt};
    if(field==='target')details.authoringReceipt.targetId='expert-another-target';
    else details.authoringReceipt.baseline={draftRevision:2,digest:'a'.repeat(64)};
    expect(()=>interactionHistory(altered,fixture.workspaceId,fixture.sessionId,undefined,'account-admin'),field).toThrow();
  }
});
