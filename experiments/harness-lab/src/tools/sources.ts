import { fileURLToPath } from 'node:url';
import type { SourceInfo } from '../contracts/index.js';
export const fixtureDir = fileURLToPath(new URL('../../fixtures/', import.meta.url));
export const sourceDefinitions: Omit<SourceInfo, 'hash'>[] = [
  { id: 'meeting-notes', title: '项目讨论纪要', description: '通用资料示例：目标、约束与待办。' },
  { id: 'resource-brief', title: '资源与约束说明', description: '通用资料示例：人员、时间与交付条件。' },
];
