import type { FastifyInstance } from 'fastify';
import type { PiLab } from '../pi/lab.js';
import { RequestError } from '../contracts/errors.js';
import { pageHandoffImportSchema, pageWorkPrepareSchema, type PageWorkPrepareInput } from '../contracts/collaboration.js';
import type { apiScope } from './seat-scope.js';
import { sendFile } from './file-response.js';

export async function collaborationRoutes(app: FastifyInstance, lab: PiLab, scope: ReturnType<typeof apiScope>) {
  if (!lab.collaboration) return;
  const service = lab.collaboration;
  const empty = { type: 'object', additionalProperties: false };
  const uuid = { type: 'string', format: 'uuid' };
  const params = scope.params({ id: uuid });
  app.get(`${scope.base}/work-items`, { schema: { querystring: empty } }, request => service.list({ seatId: scope.seat(request) }));
  app.get<{ Params: { id: string } }>(`${scope.base}/work-items/:id`, { schema: { params, querystring: empty } }, request => service.read({ seatId: scope.seat(request) }, request.params.id));
  app.post<{ Body: PageWorkPrepareInput }>(`${scope.base}/work-items/prepare`, { schema: { body: pageWorkPrepareSchema, querystring: empty } }, request => {
    const { clientActionId, ...input } = request.body;
    return service.prepare({ seatId: scope.seat(request) }, input, { source: 'page', clientActionId });
  });
  app.get<{ Querystring: { clientActionId: string } }>(`${scope.base}/work-actions`, { schema: { querystring: { type: 'object', required: ['clientActionId'], additionalProperties: false, properties: { clientActionId: { type: 'string', minLength: 1, maxLength: 128 } } } } }, request => service.findPageAction({ seatId: scope.seat(request) }, request.query.clientActionId));
  app.get<{ Params: { id: string } }>(`${scope.base}/work-actions/:id`, { schema: { params, querystring: empty } }, request => service.getAction({ seatId: scope.seat(request) }, request.params.id));
  app.post<{ Params: { id: string }; Body: { confirm: true } }>(`${scope.base}/work-actions/:id/commit`, { schema: { params, querystring: empty,
    body: { type: 'object', required: ['confirm'], additionalProperties: false, properties: { confirm: { const: true } } } } }, request => service.commitPage({ seatId: scope.seat(request) }, request.params.id));
  app.post<{ Params: { id: string } }>(`${scope.base}/work-actions/:id/cancel`, { schema: { params, querystring: empty, body: empty }, preValidation: async request => { request.body ??= {}; } }, request => service.cancelPage({ seatId: scope.seat(request) }, request.params.id));
  app.get<{ Params: { id: string }; Querystring: { preview?: string } }>(`${scope.base}/handoff-files/:id`, { schema: { params, querystring: { type: 'object', additionalProperties: false, properties: { preview: { type: 'string', enum: ['1'] } } } } }, async (request, reply) => sendFile(reply, await service.openFile({ seatId: scope.seat(request) }, request.params.id), !!request.query.preview));
  app.post<{ Params: { id: string }; Body: { workspaceId: string; path?: string } }>(`${scope.base}/handoff-files/:id/import`, { schema: { params, querystring: empty, body: pageHandoffImportSchema } }, request => service.importFile({ seatId: scope.seat(request) }, request.params.id, request.body.workspaceId, request.body.path));
  app.post<{ Params: { id: string }; Body: { workItemId: string } }>(`${scope.base}/sessions/:id/work-item`, { schema: { params, querystring: empty, body: { type: 'object', required: ['workItemId'], additionalProperties: false, properties: { workItemId: uuid } } } }, request => {
    if (!request.body.workItemId) throw new RequestError('INVALID_INPUT', '请选择关联工作。');
    return lab.bindWorkItem(request.params.id, request.body.workItemId, scope.seat(request));
  });
}
