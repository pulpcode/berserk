import { describe, expect, it } from 'vitest';
import { processingText } from '../../src/background/service.js';
import type { PublicMessage, SessionSnapshot } from '../../src/contracts/index.js';

const requestId = 'current-request';
const assistant = (id: string, text: string, owner = requestId): PublicMessage => ({id, requestId: owner, role: 'assistant', text});
function snapshot(messages: PublicMessage[], finalMessageId?: string): SessionSnapshot {
  return {id: 'session', workspaceId: 'workspace', title: '测试', updatedAt: '2026-10-09T00:00:00Z', messages,
    active: null, lastResult: {requestId, status: 'succeeded'}, turns: [{requestId, status: 'succeeded', finalMessageId}]};
}

describe('background processing text projection', () => {
  it('preserves a single final response byte-for-byte', () => {
    const text = '\n# 分析\n\n原有 **格式** 与结尾换行。\n';
    expect(processingText(snapshot([assistant('final', text)], 'final'), requestId)).toBe(text);
  });

  it('retains analysis before a recording tool and distinguishes it from the final receipt', () => {
    // Representative of the real-provider evidence: the analysis preceded the assessment tool.
    const analysis = '## 结论摘要\n\n收到的编制需求与一项活动公共任务对应，建议直接归口承接。\n\n## 资料缺口\n\n具体参数尚需核实。';
    const final = '任务判断已记录（关联现有任务，不新建；未修改任务、未分派）。';
    const value = snapshot([assistant('analysis', analysis),
      {id: 'tool', requestId, role: 'tool', toolName: 'information_record_task_assessment', text: '{"status":"recorded"}'},
      assistant('final', final)], 'final');
    expect(processingText(value, requestId)).toBe(`## 处理过程中的说明\n\n${analysis}\n\n## 最终答复\n\n${final}`);
    expect(processingText(value, requestId)).not.toContain('"status"');
  });

  it('keeps earlier statements and their later correction in chronological order', () => {
    const value = snapshot([assistant('first', '初步认为需要新建任务。'), assistant('second', '补充查询发现已有任务可以承接，撤回新建建议。'),
      assistant('final', '最终建议关联已有任务。')], 'final');
    expect(processingText(value, requestId)).toBe('## 处理过程中的说明\n\n初步认为需要新建任务。\n\n---\n\n补充查询发现已有任务可以承接，撤回新建建议。\n\n## 最终答复\n\n最终建议关联已有任务。');
  });

  it('excludes foreign requests, non-assistant content, errors, blank messages and anything after the final entry', () => {
    const publicEntry = {...assistant('included', '本次公开说明'), thinking: 'PRIVATE_REASONING'};
    const value = snapshot([
      assistant('foreign', 'FOREIGN_EARLIER', 'another-request'),
      {id: 'legacy', role: 'assistant', text: 'UNSCOPED_TEXT'},
      {id: 'user', requestId, role: 'user', text: 'USER_TEXT'},
      {id: 'tool', requestId, role: 'tool', text: 'RAW_TOOL_RESULT'},
      {...assistant('failed', 'FAILED_TEXT'), isError: true}, assistant('blank', ' \n\t '), publicEntry,
      assistant('final', '本次最终答复'), assistant('later', 'LATER_SAME_REQUEST'), assistant('next', 'NEXT_REQUEST', 'next-request'),
    ], 'final');
    expect(processingText(value, requestId)).toBe('## 处理过程中的说明\n\n本次公开说明\n\n## 最终答复\n\n本次最终答复');
  });

  it.each([
    assistant('final', 'OTHER_REQUEST_FINAL', 'another-request'),
    {id: 'final', requestId, role: 'tool' as const, text: 'TOOL_FINAL'},
    {...assistant('final', 'ERROR_FINAL'), isError: true},
  ])('does not promote interim text when the final reference is outside the valid public response', final => {
    expect(processingText(snapshot([assistant('interim', '尚未完成的分析'), final], 'final'), requestId)).toBe('');
  });

  it('does not infer completion when the saved final reference or its message is missing', () => {
    expect(processingText(null, requestId)).toBe('');
    expect(processingText(snapshot([assistant('interim', '过程说明')]), requestId)).toBe('');
    expect(processingText(snapshot([assistant('interim', '过程说明')], 'missing'), requestId)).toBe('');
    expect(processingText(snapshot([assistant('final', '其他请求')], 'final'), 'not-in-turns')).toBe('');
  });
});
