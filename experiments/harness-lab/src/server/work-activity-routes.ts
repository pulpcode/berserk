import type { FastifyInstance } from 'fastify';
import type { PiLab } from '../pi/lab.js';
import { workActivityRequestSchema, type WorkActivityRequest } from '../contracts/work-activity.js';
import { RequestError } from '../contracts/errors.js';
import { workspaceIdentityOf } from './auth.js';
import type { apiScope } from './seat-scope.js';

export async function workActivityRoutes(app: FastifyInstance, lab: PiLab, scope: ReturnType<typeof apiScope>) {
  const params = scope.params({ id: { type: 'string', format: 'uuid' } });
  const querystring = { type: 'object', additionalProperties: false };
  const path = `${scope.base}/sessions/:id/work-activity-analysis`;
  app.get<{ Params: { id: string } }>(path, { schema: { params, querystring } }, request =>
    lab.workActivity(request.params.id, scope.seat(request), lab.access ? workspaceIdentityOf(request).userId : undefined));
  app.post<{ Params: { id: string }; Body: WorkActivityRequest }>(path, { schema: { params, querystring, body: workActivityRequestSchema } }, async (request, reply) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.raw.once('aborted', abort); reply.raw.once('close', abort);
    try {
      return await lab.analyzeWorkActivity(request.params.id, request.body, scope.seat(request), {
        signal: controller.signal, userId: lab.access ? workspaceIdentityOf(request).userId : undefined,
        assertIdentity: () => { if (request.authValid && !request.authValid()) throw new RequestError('AUTH_REQUIRED', '登录已失效。', 401); },
      });
    } finally { request.raw.removeListener('aborted', abort); reply.raw.removeListener('close', abort); }
  });
}
