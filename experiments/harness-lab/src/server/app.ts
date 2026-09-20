import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PiLab } from '../pi/lab.js';
import { RequestError } from '../contracts/errors.js';
import type { ComposerSelection, ModelSettingsUpdate } from '../contracts/index.js';
import { fileRoutes } from './file-routes.js';
import { apiScope } from './seat-scope.js';
import { collaborationRoutes } from './collaboration-routes.js';

export async function createApp(lab: PiLab, serveWeb = false) {
  const app = Fastify({ logger: false, bodyLimit: 128 * 1024, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host?.split(':')[0];
    if (host !== '127.0.0.1' && host !== 'localhost') {
      return reply.code(403).send({ error: { code: 'LOCAL_ONLY', message: '仅允许本地访问。' } });
    }
    const origin = request.headers.origin;
    if (origin && ![`http://127.0.0.1:${lab.config.port}`, `http://localhost:${lab.config.port}`, 'http://127.0.0.1:5173', 'http://localhost:5173'].includes(origin)) {
      return reply.code(403).send({ error: { code: 'ORIGIN_REJECTED', message: '请求来源不受信任。' } });
    }
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
  });
  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    if (error instanceof RequestError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    if (error.validation || error.statusCode === 400 || error.statusCode === 413 || error.statusCode === 415) {
      return reply.code(error.statusCode || 400).send({ error: { code: 'INVALID_INPUT', message: '请求格式不正确或内容过长。' } });
    }
    return reply.code(500).send({ error: { code: 'SERVER_ERROR', message: '服务暂时无法处理请求，请稍后重试。' } });
  });
  app.get('/api/info', async () => lab.info());
  await app.register(async scoped => {
    const scope = apiScope(lab.config);
    scoped.addHook('onRequest', async request => { scope.seat(request); });
    await registerApi(scoped, lab, scope);
  });
  if (serveWeb && existsSync(resolve('dist/index.html'))) {
    await app.register(fastifyStatic, { root: resolve('dist'), wildcard: true, list: false });
  }
  app.addHook('onClose', () => lab.close());
  return app;
}

async function registerApi(app: FastifyInstance, lab: PiLab, scope: ReturnType<typeof apiScope>) {
  const params = scope.params({ id: { type: 'string', pattern: '^[0-9a-f-]{36}$' } });
  await fileRoutes(app, lab.files, lab.config.fileLimits?.maxFileBytes ?? 100 * 1024 * 1024, scope);
  await collaborationRoutes(app, lab, scope);
  const settingsQuery = { type: 'object', additionalProperties: false };
  app.get(`${scope.base}/settings/model`, { schema: { querystring: settingsQuery } }, async () => lab.modelSettings());
  app.put<{ Body: ModelSettingsUpdate }>(`${scope.base}/settings/model`, { schema: {
    querystring: settingsQuery,
    body: { type: 'object', additionalProperties: false, required: ['provider', 'model', 'baseUrl', 'expectedVersion'], properties: {
      provider: { type: 'string', minLength: 1, maxLength: 80 }, model: { type: 'string', minLength: 1, maxLength: 200 },
      baseUrl: { type: 'string', minLength: 1, maxLength: 2048 }, expectedVersion: { type: 'string', format: 'uuid' },
      apiKey: { type: 'string', maxLength: 4096 },
      contextWindow: { type: 'integer', minimum: 8192, maximum: 2000000 },
      maxOutputTokens: { type: 'integer', minimum: 1, maximum: 2000000 },
      compactionReserveTokens: { type: 'integer', minimum: 1, maximum: 2000000 },
      compactionKeepRecentTokens: { type: 'integer', minimum: 1, maximum: 2000000 },
    } },
  } }, async request => lab.updateModelSettings(request.body));
  const uuid = { type: 'string', format: 'uuid' };
  const workspaceBody = { type: 'object', properties: { workspaceId: uuid }, additionalProperties: false };
  app.get(`${scope.base}/workspaces`, async request => lab.workspaces.list(scope.seat(request)));
  app.get(`${scope.base}/activity`, { schema: { querystring: { type: 'object', additionalProperties: false } } }, async request => lab.activity(scope.seat(request)));
  app.post<{ Body: { name: string } }>(`${scope.base}/workspaces`, { schema: { body: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 60 } }, required: ['name'], additionalProperties: false } } }, async (request, reply) => reply.code(201).send(await lab.workspaces.create(request.body.name, undefined, scope.seat(request))));
  app.get<{ Querystring: { workspaceId?: string } }>(`${scope.base}/sessions`, { schema: { querystring: workspaceBody } }, async request => lab.list(request.query.workspaceId, scope.seat(request)));
  app.post<{ Body: { workspaceId?: string; workItemId?: string } }>(`${scope.base}/sessions`, { schema: { body: { ...workspaceBody, properties: { ...workspaceBody.properties, workItemId: uuid } } }, preValidation: async request => { request.body ??= {}; } }, async request => lab.createSession(request.body.workspaceId, scope.seat(request), request.body.workItemId));
  app.get<{ Params: { id: string } }>(`${scope.base}/workspaces/:id/resources`, { schema: { params } }, async request => lab.resources.info(request.params.id, scope.seat(request)));
  app.get<{ Params: { id: string } }>(`${scope.base}/workspaces/:id/agents`, { schema: { params, querystring: settingsQuery } }, async request => lab.agents(request.params.id, scope.seat(request)));
  const resourceParams = (key: string) => scope.params({ id: uuid, [key]: { type: 'string', minLength: 1, maxLength: 80 } });
  app.get<{ Params: { id: string; fileId: string } }>(`${scope.base}/workspaces/:id/instructions/:fileId`, { schema: { params: resourceParams('fileId') } }, async request => lab.resources.readInstruction(request.params.id, request.params.fileId, scope.seat(request)));
  app.put<{ Params: { id: string; fileId: string }; Body: { content: string; expectedHash: string | null } }>(`${scope.base}/workspaces/:id/instructions/:fileId`, {
    schema: { params: resourceParams('fileId'), body: { type: 'object', properties: { content: { type: 'string' }, expectedHash: { anyOf: [{ type: 'string', pattern: '^[0-9a-f]{64}$' }, { type: 'null' }] } }, required: ['content', 'expectedHash'], additionalProperties: false } },
  }, async request => lab.resources.updateInstruction(request.params.id, request.params.fileId, request.body.content, request.body.expectedHash, undefined, scope.seat(request)));
  app.get<{ Params: { id: string; skillId: string } }>(`${scope.base}/workspaces/:id/skills/:skillId`, { schema: { params: resourceParams('skillId') } }, async request => lab.resources.readSkill(request.params.id, request.params.skillId, scope.seat(request)));
  app.get<{ Params: { id: string; requestId: string } }>(`${scope.base}/sessions/:id/requests/:requestId/resources`, { schema: { params: scope.params({ id: uuid, requestId: uuid }) } }, async request => lab.getRequestResources(request.params.id, request.params.requestId, scope.seat(request)));
  app.get<{ Params: { id: string; compactionId: string } }>(`${scope.base}/sessions/:id/compactions/:compactionId`, { schema: { querystring: settingsQuery, params: resourceParams('compactionId') } }, async request => lab.getCompaction(request.params.id, request.params.compactionId, scope.seat(request)));
  app.get<{ Params: { id: string } }>(`${scope.base}/sessions/:id`, { schema: { params } }, async request => lab.get(request.params.id, scope.seat(request)));
  app.post<{ Params: { id: string; interactionId: string }; Body: unknown }>(`${scope.base}/sessions/:id/interactions/:interactionId/response`, {
    schema: { params: resourceParams('interactionId'), querystring: settingsQuery },
  }, async request => lab.respondInteraction(request.params.id, request.params.interactionId, request.body, scope.seat(request)));
  app.post<{ Params: { id: string }; Body: { requestId: string } }>(`${scope.base}/sessions/:id/cancel`, {
    schema: { params, body: { type: 'object', properties: { requestId: { type: 'string', format: 'uuid' } }, required: ['requestId'], additionalProperties: false } },
  }, async request => lab.cancel(request.params.id, request.body.requestId, scope.seat(request)));
  app.post<{ Params: { id: string }; Body: ComposerSelection & { text: string; uploadIds?: string[]; fileRefs?: { path: string }[] } }>(`${scope.base}/sessions/:id/messages`, {
    schema: { params, body: { type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength: 16000 },
      uploadIds: { type: 'array', maxItems: 100, items: uuid },
      fileRefs: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: 'string', minLength: 1, maxLength: 4096 } } } },
      skill: { type: 'object', additionalProperties: false, required: ['id', 'hash'], properties: { id: { type: 'string', minLength: 1, maxLength: 80 }, hash: { type: 'string', pattern: '^[0-9a-f]{64}$' } } },
      agent: { type: 'object', additionalProperties: false, required: ['name', 'hash'], properties: { name: { type: 'string', pattern: '^[a-z][a-z0-9_-]*$', maxLength: 256 }, hash: { type: 'string', pattern: '^[0-9a-f]{64}$' } } },
    }, required: ['text'], additionalProperties: false } },
  }, async (request, reply) => {
    const text = request.body.text.trim();
    if (!text) throw new RequestError('EMPTY_MESSAGE', '请输入消息。');
    const execution = lab.start(request.params.id, text, { uploadIds: request.body.uploadIds, fileRefs: request.body.fileRefs, skill: request.body.skill, agent: request.body.agent }, scope.seat(request));
    reply.hijack();
    const stream = reply.raw;
    stream.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    const heartbeat = setInterval(() => { if (!stream.destroyed) stream.write(': keepalive\n\n'); }, 15000);
    const work = execution.run(event => {
      if (stream.destroyed || stream.writableEnded) return;
      if (stream.writableLength > 256 * 1024) { stream.destroy(); return; }
      stream.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    void work.finally(() => { clearInterval(heartbeat); if (!stream.destroyed) stream.end(); });
    return reply;
  });
}
