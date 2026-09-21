import { describe, expect, it } from 'vitest';
import type { FileOutput, Interaction, PublicMessage, SessionSnapshot, SubagentSummary } from '../../src/contracts/index';
import { chatBlocks, processLabel } from '../../src/web/processGroups';
const msg = (id: string, role: PublicMessage['role'], extra: Partial<PublicMessage> = {}): PublicMessage => ({ id, role, text: id, requestId: 'r1', ...extra });
const base = (messages: PublicMessage[]): SessionSnapshot => ({ id: 's1', workspaceId: 'w1', title: 'Test', updatedAt: '', active: null, lastResult: null, messages, turns: [{ requestId: 'r1', status: 'succeeded', finalMessageId: 'final' }] });
const child: SubagentSummary = { subagentId: 'child', parentRequestId: 'r1', toolCallId: 'child-call', role: 'reviewer', description: 'Review', task: 'Check', status: 'succeeded', startedAt: '', result: 'Done' };
const interaction: Interaction = { schemaVersion: 1, interactionId: 'q', workspaceId: 'w1', sessionId: 's1', requestId: 'r1', toolCallId: 'question', toolName: 'ask_user', createdAt: '', kind: 'question', status: 'answered', questions: [{ id: 'q1', prompt: 'Continue?' }] };
const file: FileOutput = { path: 'report.md', name: 'report.md', size: 10, hash: 'hash', downloadId: 'download', workspaceId: 'w1', sessionId: 's1', requestId: 'r1', toolCallId: 'output', createdAt: '' };

describe('conversation presentation boundaries', () => {
  it('keeps final reply separate and counts only mapped evidence', () => {
    const snapshot = base([msg('user', 'user'), msg('note', 'assistant'), msg('read', 'tool', { toolName: 'read' }), msg('child-result', 'tool', { toolName: 'subagent', toolCallId: 'child-call' }), msg('final', 'assistant')]);
    snapshot.subagents = [child, child];
    const blocks = chatBlocks(snapshot);
    expect(blocks.map(item => item.kind)).toEqual(['message', 'process', 'message']);
    const group = blocks[1];
    expect(group.kind === 'process' && group.collapsible).toBe(true);
    if (group.kind !== 'process') throw new Error('Expected process');
    expect(processLabel(group)).toBe('处理过程 · 1 次工具调用 · 1 个 Agent 任务 · 1 条说明');
  });
  it.each(['missing-turns', 'failed', 'interrupted', 'no-final', 'wrong-request', 'active'] as const)('never collapses without trusted final evidence: %s', variant => {
    const snapshot = base([msg('user', 'user'), msg('read', 'tool', { toolName: 'read' }), msg('final', 'assistant')]);
    if (variant === 'missing-turns') delete snapshot.turns;
    if (variant === 'failed' || variant === 'interrupted') snapshot.turns![0].status = variant;
    if (variant === 'no-final') delete snapshot.turns![0].finalMessageId;
    if (variant === 'wrong-request') snapshot.messages[2].requestId = 'other';
    if (variant === 'active') snapshot.active = { requestId: 'r1', status: 'responding' };
    expect(chatBlocks(snapshot).filter(item => item.kind === 'process').every(item => !item.collapsible)).toBe(true);
  });
  it('keeps interactions, errors, unknown effects and file downloads at their original boundaries', () => {
    const snapshot = base([msg('read', 'tool', { toolName: 'read' }), msg('ask', 'tool', { toolName: 'ask_user', toolCallId: 'question' }), msg('edit', 'tool', { toolName: 'edit' }), msg('error', 'tool', { toolName: 'bash', isError: true }), msg('unknown', 'tool', { toolName: 'write', resultMissing: true }), msg('output', 'tool', { toolName: 'file_output', toolCallId: 'output' }), msg('final', 'assistant')]);
    snapshot.interactions = [interaction]; snapshot.fileOutputs = [file, file];
    const blocks = chatBlocks(snapshot);
    expect(blocks.map(item => item.kind)).toEqual(['process', 'interaction', 'process', 'message', 'message', 'file', 'message']);
    expect(blocks.filter(item => item.kind === 'file')).toHaveLength(1);
  });
  it('does not fold failed Agents or match another request with a reused tool call ID', () => {
    const snapshot = base([msg('old-output', 'tool', { requestId: 'old', toolName: 'file_output', toolCallId: 'output', resultMissing: true }), msg('child-result', 'tool', { toolName: 'subagent', toolCallId: 'child-call', isError: true }), msg('output', 'tool', { toolName: 'file_output', toolCallId: 'output' }), msg('final', 'assistant')]);
    snapshot.subagents = [{ ...child, status: 'failed' }]; snapshot.fileOutputs = [file];
    expect(chatBlocks(snapshot).map(item => item.kind)).toEqual(['message', 'subagent', 'file', 'message']);
  });
  it('does not add empty controls to a plain conversation and keeps stable process IDs while streaming', () => {
    expect(chatBlocks(base([msg('user', 'user'), msg('final', 'assistant')])).map(item => item.kind)).toEqual(['message', 'message']);
    const snapshot = base([msg('read', 'tool', { toolName: 'read' })]);
    const key = chatBlocks(snapshot)[0].key;
    snapshot.messages.push(msg('edit', 'tool', { toolName: 'edit' }), msg('final', 'assistant'));
    expect(chatBlocks(snapshot)[0].key).toBe(key);
  });
  it('keeps a fallback interaction at its own request when later tools reuse its call ID', () => {
    const snapshot = base([msg('u1', 'user'), msg('final', 'assistant'), msg('u2', 'user', { requestId: 'r2' }), msg('later-tool', 'tool', { requestId: 'r2', toolName: 'ask_user', toolCallId: 'question' })]);
    snapshot.interactions = [interaction];
    expect(chatBlocks(snapshot).map(item => item.key)).toEqual(['message:u1', 'message:final', 'interaction:q', 'message:u2', 'process:r2:message:later-tool']);
  });
  it('uses matching fixed output as file evidence but retains actual errors beside the download', () => {
    const snapshot = base([msg('unknown', 'tool', { toolName: 'file_output', toolCallId: 'output', resultMissing: true })]);
    snapshot.fileOutputs = [file];
    expect(chatBlocks(snapshot).map(item => item.kind)).toEqual(['file']);
    snapshot.messages[0].isError = true;
    expect(chatBlocks(snapshot).map(item => item.kind)).toEqual(['message', 'file']);
    snapshot.fileOutputs = [];
    expect(chatBlocks(snapshot).map(item => item.kind)).toEqual(['message']);
  });

});
