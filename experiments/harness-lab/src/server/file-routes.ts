import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import type { FileService } from '../files/service.js';
import { RequestError } from '../contracts/errors.js';
import { previewType } from './file-preview.js';

const uuid = { type: 'string', format: 'uuid' };
const params = (key?: string) => ({ type: 'object', properties: { id: uuid, ...(key ? { [key]: uuid } : {}) }, required: ['id', ...(key ? [key] : [])], additionalProperties: false });
const emptyQuery = { type: 'object', additionalProperties: false };
const disposition = (name: string) => `attachment; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16)}`)}`;

export async function fileRoutes(app: FastifyInstance, files: FileService, maxFileBytes: number) {
  app.post<{ Params: { id: string }; Body: { name: string; size: number } }>('/api/workspaces/:id/uploads', {
    schema: { params: params(), querystring: emptyQuery, body: { type: 'object', required: ['name', 'size'], additionalProperties: false,
      properties: { name: { type: 'string', minLength: 1, maxLength: 255 }, size: { type: 'integer', minimum: 0, maximum: maxFileBytes } } } },
  }, async (request, reply) => reply.code(201).send(await files.createUpload(request.params.id, request.body)));
  await app.register(async streaming => {
    streaming.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload));
    streaming.put<{ Params: { id: string; uploadId: string }; Body: Readable }>('/api/workspaces/:id/uploads/:uploadId/content', {
      bodyLimit: maxFileBytes, schema: { params: params('uploadId'), querystring: emptyQuery },
    }, async request => {
      if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/octet-stream' || !(request.body instanceof Readable)) throw new RequestError('INVALID_CONTENT_TYPE', '文件上传需要 application/octet-stream 字节流。', 415);
      const abort = new AbortController();
      const disconnected = () => abort.abort();
      request.raw.once('aborted', disconnected);
      try { return await files.receiveUpload(request.params.id, request.params.uploadId, request.body, abort.signal); }
      finally { request.raw.removeListener('aborted', disconnected); }
    });
  });
  app.get<{ Params: { id: string; uploadId: string } }>('/api/workspaces/:id/uploads/:uploadId', { schema: { params: params('uploadId'), querystring: emptyQuery } }, request => files.getUpload(request.params.id, request.params.uploadId));
  app.delete<{ Params: { id: string; uploadId: string } }>('/api/workspaces/:id/uploads/:uploadId', { schema: { params: params('uploadId'), querystring: emptyQuery } }, request => files.cancelUpload(request.params.id, request.params.uploadId));
  app.get<{ Params: { id: string }; Querystring: { path: string; hash: string } }>('/api/workspaces/:id/files/status', {
    schema: { params: params(), querystring: { type: 'object', required: ['path', 'hash'], additionalProperties: false, properties: {
      path: { type: 'string', minLength: 1, maxLength: 4096 }, hash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    } } },
  }, async request => {
    try {
      const [file] = await files.resolveInputs(request.params.id, { fileRefs: [{ path: request.query.path }] });
      return { state: file.hash === request.query.hash ? 'current' : 'changed', file };
    } catch (error) {
      if (error instanceof RequestError && error.code === 'FILE_NOT_FOUND') return { state: 'missing' };
      throw error;
    }
  });
  app.get<{ Params: { id: string }; Querystring: { path?: string; search?: string; offset?: string; limit?: string } }>('/api/workspaces/:id/files', {
    schema: { params: params(), querystring: { type: 'object', additionalProperties: false, properties: {
      path: { type: 'string', maxLength: 4096 }, search: { type: 'string', maxLength: 255 }, offset: { type: 'string', pattern: '^\\d{1,8}$' }, limit: { type: 'string', pattern: '^\\d{1,3}$' },
    } } },
  }, request => files.list(request.params.id, { path: request.query.path, search: request.query.search,
    ...(request.query.offset === undefined ? {} : { offset: Number(request.query.offset) }), ...(request.query.limit === undefined ? {} : { limit: Number(request.query.limit) }) }));
  app.get<{ Params: { id: string }; Querystring: { path: string; preview?: string } }>('/api/workspaces/:id/files/content', {
    schema: { params: params(), querystring: { type: 'object', required: ['path'], additionalProperties: false, properties: { path: { type: 'string', minLength: 1, maxLength: 4096 }, preview: { type: 'string', enum: ['1'] } } } },
  }, async (request, reply) => {
    const content = await files.openContent(request.params.id, request.query.path);
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
    if (!request.query.preview) return reply.header('Content-Disposition', disposition(content.name)).type('application/octet-stream').send(content.stream);
    if (content.size > 10 * 1024 * 1024) { content.stream.destroy(); throw new RequestError('FILE_PREVIEW_UNAVAILABLE', '文件较大，请下载查看。', 415); }
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of content.stream) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > 10 * 1024 * 1024) { content.stream.destroy(); throw new RequestError('FILE_PREVIEW_UNAVAILABLE', '文件较大，请下载查看。', 415); } chunks.push(buffer); }
    const bytes = Buffer.concat(chunks);
    return reply.type(previewType(content.name, bytes)).send(bytes);
  });
  app.get<{ Params: { id: string; downloadId: string } }>('/api/workspaces/:id/downloads/:downloadId', { schema: { params: params('downloadId'), querystring: emptyQuery } }, async (request, reply) => {
    const content = await files.openDownload(request.params.id, request.params.downloadId);
    return reply.header('Content-Disposition', disposition(content.name)).header('Content-Security-Policy', "default-src 'none'; sandbox").type('application/octet-stream').send(content.stream);
  });
}
