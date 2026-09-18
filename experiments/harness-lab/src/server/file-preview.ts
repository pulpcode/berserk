import { extname } from 'node:path';
import { RequestError } from '../contracts/errors.js';

const unavailable = () => new RequestError('FILE_PREVIEW_UNAVAILABLE', '此文件暂不支持在线预览，请下载查看。', 415);
function dimensions(width: number, height: number) {
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16_000_000) throw unavailable();
}
/** Browser preview accepts only bounded PNG/JPEG images, never active SVG/HTML. */
export function previewType(name: string, bytes: Buffer): string {
  const extension = extname(name).toLowerCase();
  if (extension === '.png') {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR') throw unavailable();
    dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    return 'image/png';
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw unavailable();
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) throw unavailable();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) throw unavailable();
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) throw unavailable();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8) throw unavailable();
        dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
        return 'image/jpeg';
      }
      offset += length;
    }
    throw unavailable();
  }
  if (!['.txt', '.md', '.csv', '.json', '.py', '.js', '.ts', '.tsx', '.jsx', '.sh', '.yaml', '.yml', '.toml', '.xml', '.html', '.svg', '.css', '.log'].includes(extension) || bytes.length > 1024 * 1024) throw unavailable();
  try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if ([...text].some(char => char.charCodeAt(0) < 32 && !['\n', '\r', '\t'].includes(char))) throw unavailable(); } catch { throw unavailable(); }
  return 'text/plain; charset=utf-8';
}
