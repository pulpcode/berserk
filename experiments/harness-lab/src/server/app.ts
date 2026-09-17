import Fastify, { type FastifyError } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PiLab } from '../pi/lab.js';
import { RequestError } from '../contracts/errors.js';
import type { ModelSettingsUpdate } from '../contracts/index.js';

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
  const params = { type: 'object', properties: { id: { type: 'string', pattern: '^[0-9a-f-]{36}$' } }, required: ['id'], additionalProperties: false };
  app.get('/api/info', async () => lab.info());
  const settingsQuery = { type: 'object', additionalProperties: false };
  app.get('/api/settings/model', { schema: { querystring: settingsQuery } }, async () => lab.modelSettings());
  app.put<{ Body: ModelSettingsUpdate }>('/api/settings/model', { schema: {
    querystring: settingsQuery,
    body: { type: 'object', additionalProperties: false, required: ['provider', 'model', 'baseUrl', 'expectedVersion'], properties: {
      provider: { type: 'string', minLength: 1, maxLength: 80 }, model: { type: 'string', minLength: 1, maxLength: 200 },
      baseUrl: { type: 'string', minLength: 1, maxLength: 2048 }, expectedVersion: { type: 'string', format: 'uuid' },
      apiKey: { type: 'string', maxLength: 4096 },
    } },
  } }, async request => lab.updateModelSettings(request.body));
  const uuid = { type: 'string', format: 'uuid' };
  const workspaceBody = { type: 'object', properties: { workspaceId: uuid }, additionalProperties: false };
  app.get('/api/workspaces', async () => lab.workspaces.list());
  app.get('/api/activity', { schema: { querystring: { type: 'object', additionalProperties: false } } }, async () => lab.activity());
  app.post<{ Body: { name: string } }>('/api/workspaces', { schema: { body: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 60 } }, required: ['name'], additionalProperties: false } } }, async (request, reply) => reply.code(201).send(await lab.workspaces.create(request.body.name)));
  app.get<{ Querystring: { workspaceId?: string } }>('/api/sessions', { schema: { querystring: workspaceBody } }, async request => lab.list(request.query.workspaceId));
  app.post<{ Body: { workspaceId?: string } }>('/api/sessions', { schema: { body: workspaceBody }, preValidation: async request => { request.body ??= {}; } }, async request => lab.createSession(request.body.workspaceId));
  app.get<{ Params: { id: string } }>('/api/workspaces/:id/resources', { schema: { params } }, async request => lab.resources.info(request.params.id));
  const resourceParams = (key: string) => ({ type: 'object', properties: { id: uuid, [key]: { type: 'string', minLength: 1, maxLength: 80 } }, required: ['id', key], additionalProperties: false });
  app.get<{ Params: { id: string; fileId: string } }>('/api/workspaces/:id/instructions/:fileId', { schema: { params: resourceParams('fileId') } }, async request => lab.resources.readInstruction(request.params.id, request.params.fileId));
  app.put<{ Params: { id: string; fileId: string }; Body: { content: string; expectedHash: string | null } }>('/api/workspaces/:id/instructions/:fileId', {
    schema: { params: resourceParams('fileId'), body: { type: 'object', properties: { content: { type: 'string' }, expectedHash: { anyOf: [{ type: 'string', pattern: '^[0-9a-f]{64}$' }, { type: 'null' }] } }, required: ['content', 'expectedHash'], additionalProperties: false } },
  }, async request => lab.resources.updateInstruction(request.params.id, request.params.fileId, request.body.content, request.body.expectedHash));
  app.get<{ Params: { id: string; skillId: string } }>('/api/workspaces/:id/skills/:skillId', { schema: { params: resourceParams('skillId') } }, async request => lab.resources.readSkill(request.params.id, request.params.skillId));
  app.get<{ Params: { id: string; requestId: string } }>('/api/sessions/:id/requests/:requestId/resources', { schema: { params: { type: 'object', properties: { id: uuid, requestId: uuid }, required: ['id', 'requestId'], additionalProperties: false } } }, async request => lab.getRequestResources(request.params.id, request.params.requestId));
  app.get<{ Params: { id: string } }>('/api/sessions/:id', { schema: { params } }, async request => lab.get(request.params.id));
  app.post<{ Params: { id: string }; Body: { requestId: string } }>('/api/sessions/:id/cancel', {
    schema: { params, body: { type: 'object', properties: { requestId: { type: 'string', format: 'uuid' } }, required: ['requestId'], additionalProperties: false } },
  }, async request => lab.cancel(request.params.id, request.body.requestId));
  app.post<{ Params: { id: string }; Body: { text: string } }>('/api/sessions/:id/messages', {
    schema: { params, body: { type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength: 16000 } }, required: ['text'], additionalProperties: false } },
  }, async (request, reply) => {
    const text = request.body.text.trim();
    if (!text) throw new RequestError('EMPTY_MESSAGE', '请输入消息。');
    const execution = lab.start(request.params.id, text);
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
  if (serveWeb && existsSync(resolve('dist/index.html'))) {
    await app.register(fastifyStatic, { root: resolve('dist'), wildcard: true, list: false });
  }
  app.addHook('onClose', () => lab.close());
  return app;
}
