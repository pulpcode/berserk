import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { ConfirmationInteraction } from '../../src/contracts/interactions';
import type { AuthoringProposal } from '../../src/contracts/authoring';
import { ComposerInteractionCard, InteractionCard } from '../../src/web/InteractionCard';
import { selectionInput } from '../../src/web/useComposerSelections';
const hash = 'a'.repeat(64);
const confirmation: ConfirmationInteraction = {
  schemaVersion: 2, interactionId: 'interaction', workspaceId: 'workspace', sessionId: 'session', requestId: 'request', toolCallId: 'call', toolName: 'mcp_tool', createdAt: '2026-11-17T00:00:00Z', kind: 'confirmation', status: 'pending',
  action: { title: '调用资料检索', description: '核对后批准本次调用。', parameters: { query: '<img src=x onerror=alert(1)>', target: { id: 'object-17', region: '区域甲' } }, mcp: { connectorId: 'connection-a', revisionId: 'revision-a', connectionName: '同名资料 · 连接甲', accountLabel: '本人账号甲', toolName: 'lookup', contractDigest: hash, catalogDigest: hash, subjectId: 'user:one', credentialVersion: 3, argumentsDigest: hash } }, rule: { ruleId: 'mcp', version: '1', reason: '逐次确认' },
};
it('the original pending confirmation shows fixed connection, account, remote tool and complete inert parameters', () => {
  const html = renderToStaticMarkup(createElement(ComposerInteractionCard, { interaction: confirmation, respond: async () => {}, query: async () => {}, composerInput: createRef<HTMLTextAreaElement>(), dockFocus: { current: false }, focusScope: { current: 'scope' } }));
  expect(html).toContain('同名资料 · 连接甲'); expect(html).toContain('本人账号甲'); expect(html).toContain('lookup'); expect(html).toContain('object-17'); expect(html).toContain('区域甲'); expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;'); expect(html).not.toContain('<img src=x'); expect(html).toContain('确认执行');
});
it('historical unknown result remains uncertain with its captured source after current configuration changes', () => {
  const html = renderToStaticMarkup(createElement(InteractionCard, { interaction: { ...confirmation, status: 'approved', execution: 'unknown' }, canRespond: false, respond: async () => {}, query: async () => {} }));
  expect(html).toContain('同名资料 · 连接甲'); expect(html).toContain('执行结果未确认'); expect(html).not.toContain('执行已完成'); expect(html).toContain('object-17');
});
it('composer submissions carry only selected IDs and keep the display snapshot intact', () => {
  const connectorRefs = [{connectorId:'connection-a',revisionId:'revision-a',name:'资料甲'}, {connectorId:'connection-b',revisionId:'revision-b',name:'资料乙'}];
  const input = selectionInput({ connectorRefs });
  expect(input).toEqual({ connectorIds: ['connection-a', 'connection-b'] });
  input.connectorIds!.pop();
  expect(connectorRefs).toHaveLength(2);
});
it('the original v3 authoring confirmation exposes both exact connector-reference candidates from a v2 proposal',()=>{
  const content={schemaVersion:2 as const,name:'资料专家',description:'保留固定动作引用',instructions:'核对来源',skillIds:[],allowedTools:['ask_user']};
  const proposal:AuthoringProposal={schemaVersion:2,proposalId:'proposal',proposalDigest:hash,ownerUserId:'owner',sessionId:confirmation.sessionId,requestId:confirmation.requestId,targetId:'expert',baseline:{draftRevision:2,digest:hash},createdAt:confirmation.createdAt,summary:'修改连接器依赖',
    before:{kind:'expert',content:{...content,connectorRequirements:[{connectorId:'before-connection',actions:[{name:'lookup-before',contractDigest:hash}]}]}},
    candidate:{kind:'expert',content:{...content,connectorRequirements:[{connectorId:'after-connection',actions:[{name:'lookup-after',contractDigest:'b'.repeat(64)}]}]}}};
  const item:ConfirmationInteraction={...confirmation,schemaVersion:3,toolName:'capability_authoring_save',action:{title:'保存专家草稿',description:proposal.summary,parameters:{proposalId:proposal.proposalId},authoring:{proposal}}};
  const html=renderToStaticMarkup(createElement(ComposerInteractionCard,{interaction:item,respond:async()=>{},query:async()=>{},composerInput:createRef<HTMLTextAreaElement>(),dockFocus:{current:false},focusScope:{current:'scope'}}));
  for(const text of ['本次变更：连接器依赖','保存前的完整内容','查看完整候选','before-connection','lookup-before','after-connection','lookup-after','b'.repeat(64),'确认保存草稿'])expect(html).toContain(text);
});
