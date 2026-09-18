import { describe, expect, it } from 'vitest';
import { previewType } from '../src/server/file-preview.js';
describe('inert bounded file previews',()=>{
  it('serves uploaded instructions and active markup as text, never same-origin executable content',()=>{
    expect(previewType('AGENTS.md',Buffer.from('# instructions'))).toBe('text/plain; charset=utf-8');
    expect(previewType('attack.svg',Buffer.from('<svg onload="alert(1)"></svg>'))).toBe('text/plain; charset=utf-8');
    expect(previewType('attack.html',Buffer.from('<iframe src="https://example.com"></iframe>'))).toBe('text/plain; charset=utf-8');
  });
  it('rejects malformed/binary UTF8, unsupported formats and oversized text',()=>{
    for (const [name,bytes] of [['file.txt',Buffer.from([0xff,0xfe])],['file.txt',Buffer.from('a\0b')],['file.pdf',Buffer.from('%PDF')],['file.txt',Buffer.alloc(1024*1024+1,97)]] as const) expect(()=>previewType(name,bytes)).toThrow();
  });
  it('rejects truncated JPEG frame headers and excessive image dimensions',()=>{
    expect(()=>previewType('file.jpg',Buffer.from([0xff,0xd8,0xff,0xc0,0,20]))).toThrow();
    const jpeg=Buffer.from([0xff,0xd8,0xff,0xc0,0,8,8,0xff,0xff,0xff,0xff,1]);
    expect(()=>previewType('file.jpeg',jpeg)).toThrow();
  });
});
