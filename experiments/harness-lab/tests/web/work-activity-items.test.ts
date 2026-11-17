import { expect, it } from 'vitest';
import type { WorkActivityItem } from '../../src/contracts/work-activity';
import { groupWorkActivity } from '../../src/web/work-activity-items';

const fact: WorkActivityItem = { id: 'receipt', workItemId: 'work-a', title: '采购建议', description: '已接收该项工作。', relation: 'processing', recency: 'earlier', origin: 'receipt', state: 'working', evidenceIds: ['receipt-proof'] };
const analysis: WorkActivityItem = { id: 'analysis', workItemId: 'work-a', title: '采购建议', description: '正在编制采购文件', relation: 'processing', recency: 'current', origin: 'analysis', state: 'working', evidenceIds: ['user-proof'] };
it('one work keeps current intent and the real receipt, while ignoring intent leaves the earlier fact', () => {
  const groups = groupWorkActivity([fact], [analysis]);
  expect(groups).toHaveLength(1); expect(groups[0]).toMatchObject({ fact, analysis, item: { recency: 'current', evidenceIds: ['receipt-proof', 'user-proof'] } });
  expect(groupWorkActivity([fact], [])).toEqual([{ fact, item: fact }]);
});
it('distinct formal works and unmatched activities remain separate; real submitted state is retained', () => {
  const submitted = { ...fact, state: 'submitted' as const };
  const unmatched = { ...analysis, id: 'unmatched', workItemId: null };
  const other = { ...analysis, id: 'other', workItemId: 'work-b' };
  const groups = groupWorkActivity([submitted], [analysis, unmatched, other]);
  expect(groups).toHaveLength(3); expect(groups[0].item.state).toBe('submitted'); expect(groups[1].item.workItemId).toBeNull();
});
