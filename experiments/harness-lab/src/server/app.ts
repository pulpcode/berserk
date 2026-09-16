import Fastify, { type FastifyError } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PiLab } from '../pi/lab.js';
import { RequestError } from '../contracts/errors.js';

export async function createApp(lab: PiLab, serveWeb = false) {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
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
  app.get('/api/sessions', async () => lab.list());
  app.post('/api/sessions', async () => lab.createSession());
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
