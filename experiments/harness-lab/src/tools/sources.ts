import { readFile } from 'node:fs/promises';
import type { SourceInfo } from '../contracts/index.js';

export const sources: SourceInfo[] = [
  { id: 'meeting-notes', title: '项目讨论纪要', description: '通用资料示例：目标、约束与待办。' },
  { id: 'resource-brief', title: '资源与约束说明', description: '通用资料示例：人员、时间与交付条件。' },
];
const files = new Map([
  ['meeting-notes', new URL('../../fixtures/meeting-notes.md', import.meta.url)],
  ['resource-brief', new URL('../../fixtures/resource-brief.md', import.meta.url)],
]);
export async function readSource(id: string): Promise<string> {
  const file = files.get(id);
  const source = sources.find(item => item.id === id);
  if (!file || !source) throw new Error('资料 ID 不存在，请从资料清单选择。');
  const content = await readFile(file, 'utf8');
  return `来源：${source.title} [${source.id}]\n\n${content}`;
}
