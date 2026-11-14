import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

/** Closed synthetic-only adapters. These do not model a production interface or issue business receipts. */
export const syntheticTrialToolNames: readonly string[] = [
  'information_search', 'information_read', 'situation_query', 'task_search', 'task_read',
  'task_information_list', 'task_information_read', 'work_item_list', 'work_item_read', 'simulation_command_read',
  'annotation_list', 'annotation_read', 'spatial_analyze',
];
export const excludedTrialWriteTools: readonly string[] = ['work_item_action', 'handoff_import_file', 'simulation_command_send', 'annotation_from_source', 'annotation_action', 'annotation_from_analysis'];
export function syntheticTrialTools(names: readonly string[]): ToolDefinition[] {
  return names.filter(name => syntheticTrialToolNames.includes(name)).map(name => defineTool({
    name, label: `隔离模拟：${name}`,
    description: '仅用于专家草稿隔离试用的明确合成测试替身；使用通用测试参数，不验证真实接口兼容性。不会查询正式数据、下发指令、写任务或产生真实业务回执。',
    parameters: Type.Object({ scenario: Type.Optional(Type.String({ maxLength: 2048 })) }, { additionalProperties: true }),
    execute: async () => {
      const value = { simulated: true, testOnly: true, productionEffect: false, tool: name,
        source: 'synthetic-fixture', message: '模拟调用已记录。仅证明试用路径可用，未执行正式业务；真实接口及外部效果未验证。' };
      return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: value };
    },
  }));
}
