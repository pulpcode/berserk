import { describe, expect, it } from 'vitest';
import type { FileOutput, Interaction, PublicMessage, SessionSnapshot, SubagentSummary } from '../../src/contracts/index';
import { chatBlocks, processLabel, toolActionLabel, type ProcessGroup } from '../../src/web/processGroups';
const msg = (id: string, role: PublicMessage['role'], extra: Partial<PublicMessage> = {}): PublicMessage => ({ id, role, text: id, requestId: 'r1', ...extra });
const base = (messages: PublicMessage[]): SessionSnapshot => ({ id: 's1', workspaceId: 'w1', title: 'Test', updatedAt: '', active: null, lastResult: null, messages, turns: [{ requestId: 'r1', status: 'succeeded', finalMessageId: 'final' }] });
const child: SubagentSummary = { subagentId: 'child', parentRequestId: 'r1', toolCallId: 'child-call', role: 'reviewer', description: 'Review', task: 'Check', status: 'succeeded', startedAt: '', result: 'Done' };
const interaction: Interaction = { schemaVersion: 1, interactionId: 'q', workspaceId: 'w1', sessionId: 's1', requestId: 'r1', toolCallId: 'question', toolName: 'ask_user', createdAt: '', kind: 'question', status: 'answered', questions: [{ id: 'q1', prompt: 'Continue?' }] };
const file: FileOutput = { path: 'report.md', name: 'report.md', size: 10, hash: 'hash', downloadId: 'download', workspaceId: 'w1', sessionId: 's1', requestId: 'r1', toolCallId: 'output', createdAt: '' };

describe('conversation presentation boundaries', () => {
  it('keeps each reply visible when native follow-ups share a host request', () => {
    const snapshot = base([msg('u1', 'user'), msg('reply1', 'assistant'), msg('u2', 'user'), msg('final', 'assistant')]);
    expect(chatBlocks(snapshot).map(item => item.kind)).toEqual(['message', 'message', 'message', 'message']);
    snapshot.active = { requestId: 'r1', status: 'responding' };
    expect(chatBlocks(snapshot).map(item => item.kind)).toEqual(['message', 'message', 'message', 'message']);
  });
  it('keeps progress notes visible and folds only tool and Agent records', () => {
    const snapshot = base([msg('user', 'user'), msg('note', 'assistant'), msg('read', 'tool', { toolName: 'read' }), msg('child-result', 'tool', { toolName: 'subagent', toolCallId: 'child-call' }), msg('final', 'assistant')]);
    snapshot.subagents = [child, child];
    const blocks = chatBlocks(snapshot);
    expect(blocks.map(item => item.kind)).toEqual(['message', 'message', 'process', 'message']);
    const group = blocks[2];
    expect(group.kind === 'process' && group.collapsible).toBe(true);
    if (group.kind !== 'process') throw new Error('Expected process');
    expect(group.items).toHaveLength(2);
    expect(processLabel(group)).toBe('处理过程 · 1 次工具调用（读取文件） · 1 个 Agent 任务');
  });
  it('keeps every assistant note visible in order between adjacent tool segments', () => {
    const snapshot = base([msg('u', 'user'), msg('note1', 'assistant'), msg('read', 'tool', { toolName: 'read' }), msg('note2', 'assistant'), msg('run', 'tool', { toolName: 'bash' }), msg('probe', 'tool', { toolName: 'custom_probe' }), msg('final', 'assistant')]);
    const blocks = chatBlocks(snapshot);
    expect(blocks.map(item => item.kind)).toEqual(['message', 'message', 'process', 'message', 'process', 'message']);
    const groups = blocks.filter((block): block is ProcessGroup => block.kind === 'process');
    expect(groups).toHaveLength(2);
    expect(groups.every(group => group.collapsible)).toBe(true);
    expect(processLabel(groups[0])).toBe('处理过程 · 1 次工具调用（读取文件）');
    expect(processLabel(groups[1])).toBe('处理过程 · 2 次工具调用（执行命令、其他工具）');
    expect(toolActionLabel('custom_probe')).toBe('调用工具');
    expect(toolActionLabel('constructor')).toBe('调用工具');
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
    expect(blocks.map(item => item.kind)).toEqual(['process', 'interaction', 'process', 'message', 'message', 'files', 'message']);
    expect(blocks.filter(item => item.kind === 'files')).toHaveLength(1);
  });
  it('does not fold failed Agents or match another request with a reused tool call ID', () => {
    const snapshot = base([msg('old-output', 'tool', { requestId: 'old', toolName: 'file_output', toolCallId: 'output', resultMissing: true }), msg('child-result', 'tool', { toolName: 'subagent', toolCallId: 'child-call', isError: true }), msg('output', 'tool', { toolName: 'file_output', toolCallId: 'output' }), msg('final', 'assistant')]);
    snapshot.subagents = [{ ...child, status: 'failed' }]; snapshot.fileOutputs = [file];
    expect(chatBlocks(snapshot).map(item => item.kind)).toEqual(['message', 'subagent', 'files', 'message']);
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
    expect(chatBlocks(snapshot).map(item => item.kind)).toEqual(['files']);
    snapshot.messages[0].isError = true;
    expect(chatBlocks(snapshot).map(item => item.kind)).toEqual(['message', 'files']);
    snapshot.fileOutputs = [];
    expect(chatBlocks(snapshot).map(item => item.kind)).toEqual(['message']);
  });
  it('merges only adjacent same-request files and keeps their original order', () => {
    const second = { ...file, downloadId: 'download-2', name: '数据.csv', toolCallId: 'output-2' };
    const snapshot = base([msg('output', 'tool', { toolName: 'file_output', toolCallId: 'output' }), msg('output-2', 'tool', { toolName: 'file_output', toolCallId: 'output-2' }), msg('final', 'assistant')]);
    snapshot.fileOutputs = [file, second];
    const blocks = chatBlocks(snapshot);
    expect(blocks.map(item => item.kind)).toEqual(['files', 'message']);
    const group = blocks[0];
    if (group.kind !== 'files') throw new Error('Expected file group');
    expect(group.requestId).toBe('r1');
    expect(group.files.map(item => item.name)).toEqual(['report.md', '数据.csv']);
  });
  it('starts a new group across messages, other requests and error cards', () => {
    const other = { ...file, downloadId: 'download-2', name: 'b.md', requestId: 'r2', toolCallId: 'output-2' };
    const crossRequest = base([msg('output', 'tool', { toolName: 'file_output', toolCallId: 'output' }), msg('output-2', 'tool', { requestId: 'r2', toolName: 'file_output', toolCallId: 'output-2' }), msg('final', 'assistant')]);
    crossRequest.fileOutputs = [file, other];
    expect(chatBlocks(crossRequest).map(item => item.kind)).toEqual(['files', 'files', 'message']);
    const split = base([msg('output', 'tool', { toolName: 'file_output', toolCallId: 'output' }), msg('note', 'assistant'), msg('output-2', 'tool', { toolName: 'file_output', toolCallId: 'output-2' }), msg('final', 'assistant')]);
    split.fileOutputs = [file, { ...other, requestId: 'r1' }];
    expect(chatBlocks(split).map(item => item.kind)).toEqual(['files', 'message', 'files', 'message']);
    const splitByInteraction = base([msg('output', 'tool', { toolName: 'file_output', toolCallId: 'output' }), msg('ask', 'tool', { toolName: 'ask_user', toolCallId: 'question' }), msg('output-2', 'tool', { toolName: 'file_output', toolCallId: 'output-2' }), msg('final', 'assistant')]);
    splitByInteraction.interactions = [interaction]; splitByInteraction.fileOutputs = [file, { ...other, requestId: 'r1' }];
    expect(chatBlocks(splitByInteraction).map(item => item.kind)).toEqual(['files', 'interaction', 'files', 'message']);
    const afterError = base([msg('output', 'tool', { toolName: 'file_output', toolCallId: 'output', isError: true }), msg('output-2', 'tool', { toolName: 'file_output', toolCallId: 'output-2' }), msg('final', 'assistant')]);
    afterError.fileOutputs = [file, { ...other, requestId: 'r1' }];
    expect(chatBlocks(afterError).map(item => item.kind)).toEqual(['message', 'files', 'message']);
  });
  it('keeps legacy files without request ownership aligned and does not merge unknown owners', () => {
    const snapshot = base([]);
    snapshot.fileOutputs = [{ ...file, requestId: '' }, { ...file, downloadId: 'download-2', requestId: '' }];
    const blocks = chatBlocks(snapshot);
    expect(blocks.map(item => item.kind)).toEqual(['files', 'files']);
    expect(blocks.every(item => item.kind === 'files' && item.files.length === 1)).toBe(true);
  });
  it('keeps a stable group key while more same-request files stream in', () => {
    const snapshot = base([msg('output', 'tool', { toolName: 'file_output', toolCallId: 'output' })]);
    snapshot.fileOutputs = [file];
    const key = chatBlocks(snapshot)[0]!.key;
    snapshot.messages.push(msg('output-2', 'tool', { toolName: 'file_output', toolCallId: 'output-2' }), msg('final', 'assistant'));
    snapshot.fileOutputs.push({ ...file, downloadId: 'download-2', name: 'b.md', toolCallId: 'output-2' });
    const blocks = chatBlocks(snapshot);
    expect(blocks[0]!.key).toBe(key);
    expect(blocks[0]!.kind === 'files' && blocks[0]!.files).toHaveLength(2);
  });

});
