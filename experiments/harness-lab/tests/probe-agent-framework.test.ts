import {beforeEach, expect, it, vi} from 'vitest';
import type {ConfirmationInteraction, HandoffFile, Upload, WorkAction, WorkActionInput, WorkDetail} from '../src/contracts/index.js';
import type {MapTrialManifest} from '../scripts/probe-situation-map.js';
import {mapTrialRequest} from '../scripts/probe-situation-map.js';
import {verifyConfirmation} from '../scripts/probe-agent-framework.js';

vi.mock('../scripts/probe-situation-map.js',()=>({mapTrialRequest:vi.fn(),mapTrialAuth:vi.fn(),startMapTrial:vi.fn()}));
const request=vi.mocked(mapTrialRequest);
beforeEach(()=>request.mockReset());
const manifest:MapTrialManifest={version:1,trialId:'isolated-test',day:'2026-10-13',dataDir:'/unused',url:'http://127.0.0.1:1',socket:'/unused/socket',
  tasks:{supply:'supply-task',transfer:'transfer-task',control:'control-task'},objects:{road:{systemId:'situation',objectType:'road',objectId:'road'},resource:{systemId:'situation',objectType:'resource',objectId:'resource'}},createdAt:'now'};
function fixture(kind:'assign'|'submit'|'review') {
  const seat=kind==='submit'?'planning':'overall';
  const file:HandoffFile={fileId:'fixed-file',name:kind==='assign'?'初稿.md':'补给说明_v1.md',size:20,hash:'a'.repeat(64),createdAt:'now'};
  const upload:Upload={uploadId:'upload',workspaceId:'workspace',originalName:file.name,name:file.name,status:'completed',size:file.size,hash:file.hash,path:file.name};
  const work:WorkDetail={id:'work',taskSpaceId:manifest.tasks.supply,creatorSeatId:'seat-overall',assigneeSeatId:'seat-planning',
    title:'合成工作',goal:'合成目标',inputFileIds:[],state:kind==='review'?'submitted':'working',revision:2,latestSubmissionId:'submission',
    createdAt:'now',updatedAt:'now',inputFiles:[],sessionIds:[],submissions:[{id:'submission',workItemId:'work',attempt:1,file,submittedBy:'seat-planning',createdAt:'now'}]};
  const input:WorkActionInput=kind==='assign'?{kind,payload:{assigneeSeatId:'seat-planning',title:work.title,goal:work.goal,inputPaths:[file.name]}}
    :kind==='submit'?{kind,workItemId:work.id,expectedRevision:work.revision,payload:{path:file.name}}
    :{kind,workItemId:work.id,expectedRevision:work.revision,payload:{submissionId:'submission',decision:'accept'}};
  const action:WorkAction={operationId:'operation',source:'agent',kind,seatId:`seat-${seat}`,title:'合成确认',description:'合成业务',
    taskSpaceId:manifest.tasks.supply,creatorSeatId:'seat-overall',assigneeSeatId:'seat-planning',files:[file],createdAt:'now',status:'prepared',
    ...(kind==='assign'?{}:{workItemId:work.id,expectedRevision:work.revision})};
  const item:ConfirmationInteraction={schemaVersion:1,interactionId:'interaction',workspaceId:'workspace',sessionId:'session',requestId:'request',
    toolCallId:'tool-call',toolName:'work_item_action',createdAt:'now',kind:'confirmation',status:'pending',
    action:{title:action.title,description:action.description,parameters:{action:input},handoff:{operationId:action.operationId,kind,title:action.title,description:action.description,files:[file]}},
    rule:{ruleId:'business-confirmation',reason:'合成确认',version:'1'}};
  const expected:Parameters<typeof verifyConfirmation>[3]=kind==='assign'?{kind,file:upload}
    :kind==='submit'?{kind,workId:work.id,filename:file.name}:{kind,workId:work.id,submissionId:'submission',decision:'accept'};
  // No HTTP server, auth credentials, model or business commit is involved in these allowlist checks.
  request.mockResolvedValueOnce(action).mockResolvedValueOnce(kind==='assign'?[]:work);
  return {action,item,expected,work,input,seat,verify:()=>verifyConfirmation(manifest,seat,item,expected)};
}

it.each(['assign','submit','review'] as const)('allows the exact expected %s preparation',async kind=>{
  const test=fixture(kind);await expect(test.verify()).resolves.toBe(test.action);
  expect(request.mock.calls.every(call=>call[3]===undefined)).toBe(true); // Verification never commits.
});

it.each([
  ['taskSpaceId','foreign-task'],['creatorSeatId','foreign-creator'],['assigneeSeatId','foreign-assignee'],['seatId','seat-planning'],
  ['kind','review'],['source','page'],['status','committed'],
] as const)('rejects mismatched prepared %s',async(key,value)=>{
  const test=fixture('assign');Object.assign(test.action,{[key]:value});await expect(test.verify()).rejects.toThrow();
});

it('rejects a mismatched actual action despite a matching prepared kind',async()=>{
  const test=fixture('assign');test.item.action.parameters.action={kind:'claim',workItemId:'work',expectedRevision:2,payload:{}};
  await expect(test.verify()).rejects.toThrow();
});

it('rejects an altered input file hash',async()=>{
  const test=fixture('assign');test.action.files[0].hash='b'.repeat(64);await expect(test.verify()).rejects.toThrow();
});

it('rejects a submit with an unexpected file name',async()=>{
  const test=fixture('submit');test.action.files[0].name='其他文件.md';await expect(test.verify()).rejects.toThrow();
});

it('rejects a submit for another work item',async()=>{
  const test=fixture('submit');test.action.workItemId='other-work';await expect(test.verify()).rejects.toThrow();
});

it('rejects a stale prepared work revision',async()=>{
  const test=fixture('submit');test.action.expectedRevision=1;await expect(test.verify()).rejects.toThrow();
});

it('rejects a review of another submission',async()=>{
  const test=fixture('review');if(test.input.kind!=='review')throw new Error('Expected review fixture');
  test.input.payload.submissionId='other-submission';await expect(test.verify()).rejects.toThrow();
});

it('rejects a changed review decision',async()=>{
  const test=fixture('review');if(test.input.kind!=='review')throw new Error('Expected review fixture');
  test.input.payload.decision='return';await expect(test.verify()).rejects.toThrow();
});

it('rejects a non-work confirmation before any prepared-action lookup',async()=>{
  const test=fixture('assign');test.item.toolName='bash';await expect(test.verify()).rejects.toThrow();expect(request).not.toHaveBeenCalled();
});
