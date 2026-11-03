import { join, matchesGlob, posix } from 'node:path';
import { createReadToolDefinition, createLsToolDefinition, createFindToolDefinition, defineTool } from '@earendil-works/pi-coding-agent';
import { RequestError } from '../contracts/errors.js';
import type { FileRef } from '../contracts/index.js';
import { hashContent, readControlled, stateError } from '../resources/files.js';

/** Native readonly tools over this batch's fixed files; no shell, container or directory discovery. */
export function continuousFileTools(directory: string, files: FileRef[], authorize: () => void) {
  const allowed = new Map<string, FileRef>(files.map(file => {
    if (!file.path || file.path !== posix.basename(file.path) || file.name !== file.path || file.path.includes('\\')) throw stateError();
    return [`/workspace/${file.path}`, structuredClone(file)] as const;
  }));
  const exists = (path: string) => { authorize(); return path === '/workspace' || allowed.has(path); };
  const requireFile = (path: string) => {
    authorize(); const file = allowed.get(path);
    if (!file) throw new Error('仅可读取本批已授权的固定附件。');
    return file;
  };
  const requireRoot = (path: string) => { authorize(); if (path !== '/workspace') throw new Error('仅可列出本批已授权的固定附件。'); };
  const read = createReadToolDefinition('/workspace', {operations: {
      access: async path => {requireFile(path);}, detectImageMimeType: async () => undefined,
      readFile: async path => {
        const file = requireFile(path);
        let text: string;
        try { text = (await readControlled(join(directory, 'files', file.path), 1024 * 1024))!; }
        catch (error) {
          if (error instanceof RequestError && error.code === 'RESOURCE_LOAD_FAILED') throw new Error('附件无法读取为 UTF-8 文本；当前只读研判不支持直接解析 PDF、图像或其他二进制文件。');
          throw error;
        }
        authorize();
        if (Buffer.byteLength(text) !== file.size || hashContent(text) !== file.hash) throw new Error('附件内容与本批固定引用不一致，未返回内容。');
        if (text.includes('\0') || text.startsWith('%PDF-')) throw new Error('当前只读研判不支持解析此二进制附件，请提供可读取的文本资料。');
        return Buffer.from(text);
      },
  }});
  return [
    defineTool({...read, description: '读取本批已授权的固定文本附件（单文件最多1 MiB），使用 /workspace/ 下的登记路径。支持原生 offset/limit 分页；二进制和超限文件明确报错，不运行解析脚本。',
      execute: async (...args: Parameters<typeof read.execute>) => {
        const file = requireFile(posix.resolve('/workspace', args[1].path));
        const result = await read.execute(...args);
        authorize();
        return {...result, content: [{type: 'text' as const, text: `固定附件引用：${JSON.stringify({...file, offset: args[1].offset ?? 1, limit: args[1].limit})}`}, ...result.content]};
      },
    }),
    defineTool(createLsToolDefinition('/workspace', {operations: {exists,
      stat: path => {if (!exists(path)) throw new Error('附件不存在。'); return {isDirectory: () => path === '/workspace'};},
      readdir: path => {requireRoot(path); return [...allowed.values()].map(file => file.path);},
    }})),
    defineTool(createFindToolDefinition('/workspace', {operations: {exists,
      glob: (pattern, cwd, options) => {requireRoot(cwd); return [...allowed.values()].filter(file => matchesGlob(file.path, pattern)).slice(0, options.limit).map(file => `/workspace/${file.path}`);},
    }})),
  ];
}
