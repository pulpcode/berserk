import type { FastifyInstance } from 'fastify';
import type { PiLab } from '../pi/lab.js';
import { pageCommandPrepareSchema, type CommandInput, type TaskExecutionSummary } from '../contracts/commands.js';
import { identityOf } from './auth.js';

export async function commandRoutes(app: FastifyInstance, lab: PiLab) {
  const service = lab.commands;
  const uuid = { type: 'string', format: 'uuid' };
  const empty = { type: 'object', additionalProperties: false };
  const params = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } };
  app.get<{ Params: { taskId: string } }>('/api/tasks/:taskId/execution-summary', { schema: { params: { type: 'object', additionalProperties: false, required: ['taskId'], properties: { taskId: uuid } }, querystring: empty } }, request => {
    const actor = identityOf(request);
    if (service) return service.summary(actor.seatId, request.params.taskId);
    const task = lab.access!.get(request.params.taskId, actor.seatId);
    return { available: false, readOnly: task.state !== 'active' || task.scenarioInstanceId !== undefined && !lab.scenario?.isWritable(task.scenarioInstanceId), queriedAt: new Date().toISOString(), complete: false, groups: [] } satisfies TaskExecutionSummary;
  });
  if (!service) return;
  app.get<{ Querystring: { taskId: string } }>('/api/commands/availability', { schema: { querystring: { type: 'object', additionalProperties: false, required: ['taskId'], properties: {taskId:uuid} } } }, request => service.availability(identityOf(request).seatId, request.query.taskId));
  app.get<{ Querystring: { taskId: string; clientActionId?: string } }>('/api/commands', { schema: { querystring: {
    type: 'object', additionalProperties: false, required: ['taskId'], properties: { taskId: uuid, clientActionId: uuid },
  } } }, request => service.list(identityOf(request).seatId, request.query.taskId, request.query.clientActionId));
  app.post<{ Body: { workspaceId: string; clientActionId: string; command: CommandInput } }>('/api/commands/prepare', { schema: { querystring: empty, body: pageCommandPrepareSchema } }, request =>
    service.prepare(identityOf(request).seatId, request.body.workspaceId, request.body.command, 'page', request.body.clientActionId));
  app.get<{ Params: { id: string } }>('/api/commands/:id', { schema: { params, querystring: empty } }, request => service.read(identityOf(request).seatId, request.params.id));
  app.get<{ Params: { id: string } }>('/api/commands/:id/execution', { schema: { params, querystring: empty } }, request => service.reconcile(identityOf(request).seatId, request.params.id));
  app.post<{ Params: { id: string }; Body: { confirm: true } }>('/api/commands/:id/commit', { schema: { params, querystring: empty, body: {
    type: 'object', additionalProperties: false, required: ['confirm'], properties: { confirm: { const: true } },
  } } }, request => service.commit(identityOf(request).seatId, request.params.id, 'page'));
  app.post<{ Params: { id: string } }>('/api/commands/:id/cancel', { schema: { params, querystring: empty, body: empty } }, request => service.cancel(identityOf(request).seatId, request.params.id));
  app.post<{ Params: { id: string } }>('/api/commands/:id/reconcile', { schema: { params, querystring: empty, body: empty } }, request => service.reconcile(identityOf(request).seatId, request.params.id));
}
