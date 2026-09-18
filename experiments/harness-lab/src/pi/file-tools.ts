import { createHash } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import { openSync, closeSync, writeSync, fsyncSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition, createBashToolDefinition, createLsToolDefinition, createFindToolDefinition, defineTool, type SessionManager } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { RequestSandbox } from '../execution/docker.js';
import type { FileService } from '../files/service.js';
import type { FileOutput } from '../contracts/index.js';
import { checkDirectory } from '../resources/files.js';
import { FILE_OUTPUT } from './file-history.js';

/** Pi's accumulator uses a host temporary path. All external forms use our own durable log. */
export function mapBashLogText(text: string, virtualLog: string) {
  const escapedPrefix = join(tmpdir(), 'pi-bash-').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`${escapedPrefix}[a-f0-9]+\\.log`, 'g'), virtualLog)
    .replace(/(?:\/[\w.-]+)+\/pi-bash-[^\s\])"']+\.log/g, virtualLog);
}
export function workspaceFileTools(sandbox: RequestSandbox) {
  return [
    defineTool(createReadToolDefinition('/workspace', { operations: {
      access: path => sandbox.access(path), detectImageMimeType: async () => undefined,
      readFile: async path => {
        const bytes = await sandbox.readFile(path);
        if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || (bytes[0] === 0xff && bytes[1] === 0xd8)) throw new Error('当前模型不支持直接读取图像；可用脚本检查图像元数据或生成交付文件。');
        try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('这是二进制文件，请用脚本和相应库解析，再读取提取的文本。'); }
        if (bytes.includes(0)) throw new Error('这是二进制文件，请用脚本解析。');
        return bytes;
      },
    } })),
    defineTool(createLsToolDefinition('/workspace', { operations: { exists: path => sandbox.exists(path), stat: path => sandbox.stat(path), readdir: path => sandbox.readdir(path) } })),
    defineTool(createFindToolDefinition('/workspace', { operations: { exists: path => sandbox.exists(path), glob: (pattern, cwd, options) => sandbox.glob(pattern, cwd, options) } })),
  ];
}
export function writableFileTools(sandbox: RequestSandbox, options: { logsDir: string; requestId: string; workspaceId: string; sessionId: string; manager: SessionManager; files: FileService; signal: AbortSignal; output: (file: FileOutput) => void }) {
  const bash = createBashToolDefinition('/workspace', { exposeSessionEnvironment: false, operations: { exec: (...args) => sandbox.exec(...args) } });
  return [
    defineTool(createWriteToolDefinition('/workspace', { operations: { writeFile: (path, content) => sandbox.writeFile(path, content), mkdir: (path) => sandbox.mkdir(path) } })),
    defineTool(createEditToolDefinition('/workspace', { operations: { readFile: path => sandbox.readFile(path), writeFile: (path, content) => sandbox.writeFile(path, content), access: path => sandbox.access(path) } })),
    defineTool({ ...bash, promptGuidelines: ['命令在当前席位的隔离容器中执行，工作目录是 /workspace；无网络，不包含模型密钥。'],
      execute: async (...args: Parameters<typeof bash.execute>) => {
        options.signal.throwIfAborted();
        const directory = join(options.logsDir, options.requestId);
        const name = `${createHash('sha256').update(args[0]).digest('hex')}.log`;
        const virtualLog = `/logs/${options.requestId}/${name}`;
        let fd: number;
        try {
          await mkdir(directory, { recursive: true, mode: 0o700 }); await checkDirectory(directory);
          fd = openSync(join(directory, name), 'wx', 0o600);
        } catch { throw new Error('命令日志不可用，尚未启动命令；请检查存储状态。'); }
        let written = 0;
        let logAvailable = true;
        const temporaryLogs = new Set<string>();
        const mapped = <T extends { content: Array<{ type: string; text?: string }>; details?: unknown }>(result: T): T => {
          if (result.details && typeof result.details === 'object' && 'fullOutputPath' in result.details
            && typeof result.details.fullOutputPath === 'string' && dirname(result.details.fullOutputPath) === tmpdir()
            && /^pi-bash-[a-f0-9]{16}\.log$/.test(basename(result.details.fullOutputPath))) temporaryLogs.add(result.details.fullOutputPath);
          return { ...result,
          content: result.content.map(block => block.type === 'text' && block.text ? { ...block, text: mapBashLogText(block.text, virtualLog) } : block),
          ...(result.details && typeof result.details === 'object' && 'fullOutputPath' in result.details
            ? { details: { ...result.details, fullOutputPath: virtualLog } } : {}),
          };
        };
        const perCall = createBashToolDefinition('/workspace', { exposeSessionEnvironment: false, operations: {
          exec: (command, cwd, executionOptions) => sandbox.exec(command, cwd, { ...executionOptions, onData: bytes => {
            try {
              let offset = 0;
              while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
              written += bytes.length;
            } catch { logAvailable = false; throw new Error('命令日志保存失败。'); }
            executionOptions.onData(bytes);
          } }),
        } });
        let result: Awaited<ReturnType<typeof perCall.execute>> | undefined;
        let failure: Error | undefined;
        try { result = mapped(await perCall.execute(args[0], args[1], args[2], update => {
          const result = mapped(update); args[3]?.(result);
        }, args[4])); }
        catch (error) {
          const message = mapBashLogText(error instanceof Error ? error.message : '命令执行失败。', virtualLog);
          failure = new Error(!logAvailable ? '命令日志不可用，本次执行已停止；已写文件可能保留，请检查后继续。'
            : written && !message.includes(virtualLog) ? `${message}\n已保留命令日志：${virtualLog}` : message);
        }
        try { fsyncSync(fd); }
        catch {
          failure = new Error('命令日志保存未完成；操作可能已执行，请检查文件。');
          await sandbox.stop();
        }
        finally {
          closeSync(fd);
          await Promise.all([...temporaryLogs].map(path => unlink(path).catch(() => {})));
        }
        if (failure) throw failure;
        return result!;
      },
    }),
    defineTool({ name: 'file_output', label: '提供文件下载', description: '将当前工作区已生成的普通文件作为交付文件，保存固定下载副本。文件仍保留在工作目录中；请完成内容后调用，成功后网页展示下载卡。',
      parameters: Type.Object({ path: Type.String({ minLength: 1, maxLength: 4096 }) }, { additionalProperties: false }), executionMode: 'sequential',
      execute: async (toolCallId, params, signal) => {
        options.signal.throwIfAborted(); signal?.throwIfAborted();
        const path = params.path.startsWith('/workspace/') ? params.path.slice('/workspace/'.length) : params.path;
        const file = await options.files.publish(options.workspaceId, { sessionId: options.sessionId, requestId: options.requestId, toolCallId, path }, options.signal);
        options.manager.appendCustomEntry(FILE_OUTPUT, file);
        options.output(file);
        return { content: [{ type: 'text', text: `文件已提供下载：${file.name}（${file.size} 字节）。` }], details: { file } };
      },
    }),
  ];
}
