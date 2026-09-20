import type { FastifyReply } from 'fastify';
import type { OpenFile } from '../files/service.js';
import { RequestError } from '../contracts/errors.js';
import { previewType } from './file-preview.js';

export async function sendFile(reply: FastifyReply, content: OpenFile, preview = false) {
  reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
  if (!preview) {
    const name = encodeURIComponent(content.name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16)}`);
    return reply.header('Content-Disposition', `attachment; filename*=UTF-8''${name}`).type('application/octet-stream').send(content.stream);
  }
  const limit = 10 * 1024 * 1024;
  const tooLarge = () => new RequestError('FILE_PREVIEW_UNAVAILABLE', '文件较大，请下载查看。', 415);
  if (content.size > limit) { content.stream.destroy(); throw tooLarge(); }
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of content.stream) {
    const buffer = Buffer.from(chunk); size += buffer.length;
    if (size > limit) { content.stream.destroy(); throw tooLarge(); }
    chunks.push(buffer);
  }
  const bytes = Buffer.concat(chunks);
  return reply.type(previewType(content.name, bytes)).send(bytes);
}
