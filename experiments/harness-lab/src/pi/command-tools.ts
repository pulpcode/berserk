import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { isDeepStrictEqual } from 'node:util';
import { commandToolSchema } from '../contracts/commands.js';
import type { CommandService } from '../commands/service.js';
import { RequestError } from '../contracts/errors.js';

export interface ApprovedCommand { id: string; parameters: Record<string, unknown> }
export function commandTools(service: CommandService, options: {
  seatId: string; taskId: string; check: () => void; signal: AbortSignal;
  takeApproval: (toolCallId: string) => ApprovedCommand | undefined;
}) {
  return [
    defineTool({ name: 'simulation_command_send', label: '下达指令',
      description: '向模拟外部系统下达车辆、目的地和路线指令。系统展示本次具体内容，等待人员确认后发送；只按真实回执说明已接收，接收不代表车辆出动。可选attachmentFileId引用已获准的固定交接文件。结果不明时查询原编号，不重新发送。',
      parameters: commandToolSchema, executionMode: 'sequential',
      execute: async (toolCallId, parameters, signal) => {
        options.check();
        const grant = options.takeApproval(toolCallId);
        if (!grant || !isDeepStrictEqual(grant.parameters, parameters)) throw new RequestError('CONFIRMATION_REQUIRED', '本次内容尚未获得对应确认。', 409);
        const combined = AbortSignal.any([options.signal, ...(signal ? [signal] : [])]);
        const result = await service.commit(options.seatId, grant.id, 'agent', combined);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
      },
    }),
    defineTool({ name: 'simulation_command_read', label: '核查指令', description: '查看当前任务下达记录；提供commandId时查询该指令并核对不明回执。查询不会重新发送。',
      parameters: Type.Object({ commandId: Type.Optional(Type.String({ pattern: '^[0-9a-f-]{36}$' })) }, { additionalProperties: false }), executionMode: 'sequential',
      execute: async (_id, parameters, signal) => {
        options.check();
        const combined = AbortSignal.any([options.signal, ...(signal ? [signal] : [])]);
        if (parameters.commandId && service.read(options.seatId, parameters.commandId).taskSpaceId !== options.taskId) throw new RequestError('COMMAND_NOT_FOUND', '指令不属于当前任务。', 404);
        const result = parameters.commandId ? await service.reconcile(options.seatId, parameters.commandId, combined) : service.list(options.seatId, options.taskId);
        options.check();
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
      },
    }),
  ];
}
