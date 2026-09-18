import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export interface DockerCommandOptions {
  input?: Buffer;
  onData?: (data: Buffer) => void;
  maxBytes?: number;
  timeoutMs?: number;
}
export interface DockerCommandResult { code: number; stdout: Buffer; stderr: Buffer }
export type DockerRunner = (args: string[], options?: DockerCommandOptions) => Promise<DockerCommandResult>;

/** Runs Docker's control client only. User shell text is always an argument to container exec. */
export const runDocker: DockerRunner = (args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn('docker', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: Object.fromEntries(['PATH', 'HOME', 'DOCKER_CONFIG', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']
      .flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]])),
  });
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  let failure: Error | undefined, bytes = 0;
  const timer = options.timeoutMs ? setTimeout(() => {
    failure = new Error('执行环境控制操作超时，需核对容器清理状态。');
    child.kill('SIGKILL');
  }, options.timeoutMs) : undefined;
  const receive = (chunk: Buffer, error: boolean) => {
    if (failure) return;
    bytes += chunk.length;
    if (bytes > (options.maxBytes ?? (options.onData ? 100 * 1024 * 1024 : 1024 * 1024))) {
      failure = new Error('文件或命令输出超过读取上限，请使用脚本分块处理。');
      child.kill('SIGKILL');
      return;
    }
    if (options.onData) {
      try { options.onData(chunk); } catch { failure = new Error('命令输出接收失败。'); child.kill('SIGKILL'); }
    } else {
      (error ? stderr : stdout).push(chunk);
    }
  };
  child.stdout.on('data', (chunk: Buffer) => receive(chunk, false));
  child.stderr.on('data', (chunk: Buffer) => receive(chunk, true));
  child.stdin.on('error', () => { /* Exit status reports an early-close failure. */ });
  child.on('error', () => { failure = new Error('Docker 不可用，文件执行已关闭。'); });
  child.on('close', code => {
    if (timer) clearTimeout(timer);
    if (failure) reject(failure);
    else resolve({ code: code ?? 137, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
  });
  child.stdin.end(options.input);
});

export interface ExecutionOptions {
  instanceId: string;
  image?: string;
  enabled?: boolean;
  cpus?: number;
  memoryMiB?: number;
  pidsLimit?: number;
  maxReadBytes?: number;
  maxOutputBytes?: number;
  uid?: number;
  gid?: number;
}
export interface SandboxScope {
  requestId: string;
  workspaceDir: string;
  /** Workspace executions directory, so previous /logs/<requestId>/ references remain readable. */
  logsDir: string;
  signal?: AbortSignal;
}
export interface BashExecutionOptions {
  onData: (data: Buffer) => void;
  signal?: AbortSignal;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

const unavailable = '执行环境不可用，请检查 Docker 和文件处理镜像；普通对话仍可使用。';
const label = 'io.berserk.harness.instance';
const validId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;

export class DockerExecutionService {
  readonly options: Required<ExecutionOptions>;
  readonly owner: string;
  private state: { available: boolean; reason?: string } = { available: false, reason: unavailable };
  private readonly sandboxes = new Set<RequestSandbox>();
  constructor(options: ExecutionOptions, readonly runner: DockerRunner = runDocker) {
    const uid = options.uid ?? process.getuid?.() ?? 1000;
    const gid = options.gid ?? process.getgid?.() ?? 1000;
    this.options = { image: 'berserk-file-runtime:w01-5', enabled: true, cpus: 2, memoryMiB: 1024,
      pidsLimit: 128, maxReadBytes: 100 * 1024 * 1024, maxOutputBytes: 100 * 1024 * 1024,
      uid: uid === 0 ? 1000 : uid, gid: gid === 0 ? 1000 : gid, ...options };
    if (!this.options.instanceId || !/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]*$/.test(this.options.image)
      || !Number.isFinite(this.options.cpus) || this.options.cpus <= 0
      || ![this.options.memoryMiB, this.options.pidsLimit, this.options.maxReadBytes, this.options.maxOutputBytes, this.options.uid, this.options.gid].every(n => Number.isSafeInteger(n) && n > 0)) {
      throw new Error('执行环境配置无效。');
    }
    this.owner = createHash('sha256').update(options.instanceId).digest('hex').slice(0, 24);
  }
  status() { return { ...this.state }; }
  async initialize(): Promise<{ available: boolean; reason?: string }> {
    if (this.sandboxes.size) throw new Error('不能在活动请求期间重新初始化执行环境。');
    if (!this.options.enabled) return this.state = { available: false, reason: '文件执行尚未启用。' };
    try {
      const info = await this.runner(['info', '--format', '{{.OSType}}'], { timeoutMs: 15_000 });
      if (info.code || info.stdout.toString().trim() !== 'linux') throw new Error(unavailable);
      const old = await this.runner(['ps', '-aq', '--filter', `label=${label}=${this.owner}`], { timeoutMs: 15_000 });
      if (old.code) throw new Error(unavailable);
      for (const id of old.stdout.toString().trim().split(/\s+/).filter(Boolean)) {
        if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error(unavailable);
        await this.remove(id);
      }
      const image = await this.runner(['image', 'inspect', this.options.image, '--format', '{{.Id}}'], { timeoutMs: 15_000 });
      if (image.code) throw new Error(unavailable);
      this.state = { available: true };
    } catch { this.state = { available: false, reason: unavailable }; }
    return this.status();
  }
  create(scope: SandboxScope): RequestSandbox {
    if (!validId.test(scope.requestId)) throw new Error('请求标识无效。');
    const sandbox = new RequestSandbox(this, scope, () => this.sandboxes.delete(sandbox));
    this.sandboxes.add(sandbox);
    return sandbox;
  }
  markUnavailable() { this.state = { available: false, reason: '执行环境未能确认清理完成，文件执行已关闭。' }; }
  async remove(name: string): Promise<void> {
    const result = await this.runner(['rm', '--force', name], { timeoutMs: 30_000 });
    // A second stop can observe an already-removed container. Verify absence independently.
    if (result.code) {
      const filter = /^[a-f0-9]{12,64}$/.test(name) ? `id=${name}` : `name=^/${name}$`;
      const remaining = await this.runner(['ps', '-aq', '--no-trunc', '--filter', filter], { timeoutMs: 15_000 });
      if (remaining.code || remaining.stdout.toString().trim()) throw new Error('无法确认执行环境已停止。');
    }
  }
  async close(): Promise<void> {
    const results = await Promise.allSettled([...this.sandboxes].map(sandbox => sandbox.close()));
    if (results.some(result => result.status === 'rejected')) throw new Error('执行环境清理失败，请核对残留容器。');
  }
}

export class RequestSandbox {
  readonly cwd = '/workspace';
  readonly name: string;
  private starting?: Promise<void>;
  private closing?: Promise<void>;
  private stopped = false;
  private started = false;
  private readonly inFlight = new Set<Promise<unknown>>();
  private readonly abort = () => { void this.stop().catch(() => { this.service.markUnavailable(); }); };
  constructor(private readonly service: DockerExecutionService, readonly scope: SandboxScope, private readonly release: () => void) {
    this.name = `berserk-${service.owner}-${scope.requestId}`;
    scope.signal?.addEventListener('abort', this.abort, { once: true });
    if (scope.signal?.aborted) this.stopped = true;
  }
  private assertActive() {
    if (this.stopped || this.scope.signal?.aborted) throw new Error('本次文件执行已停止；已保存文件不会回滚。');
    if (!this.service.status().available) throw new Error(this.service.status().reason ?? unavailable);
  }
  private async ensureStarted() {
    this.assertActive();
    this.starting ??= this.start();
    await this.starting;
    this.assertActive();
  }
  private async start() {
    const roots = await Promise.all([this.scope.workspaceDir, this.scope.logsDir].map(async path => {
      if (!isAbsolute(path) || path.includes(',') || /[\r\n\0]/.test(path)) throw new Error('执行目录配置无效。');
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('执行目录必须是受控的实际目录。');
      return realpath(path);
    }));
    this.assertActive();
    const { image, cpus, memoryMiB, pidsLimit, uid, gid } = this.service.options;
    const args = ['run', '--detach', '--pull=never', '--name', this.name, '--label', `${label}=${this.service.owner}`,
      '--label', `io.berserk.harness.request=${this.scope.requestId}`, '--network=none', '--read-only', '--init',
      '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--user', `${uid}:${gid}`,
      '--cpus', String(cpus), '--memory', `${memoryMiB}m`, '--memory-swap', `${memoryMiB}m`, '--pids-limit', String(pidsLimit),
      '--tmpfs', '/tmp:rw,nosuid,nodev,size=268435456,mode=1777', '--workdir', '/workspace',
      '--mount', `type=bind,src=${roots[0]},dst=/workspace`, '--mount', `type=bind,src=${roots[1]},dst=/logs,readonly`,
      '--env', 'HOME=/tmp', '--env', 'LANG=C.UTF-8', '--env', 'PYTHONDONTWRITEBYTECODE=1', '--env', 'MPLCONFIGDIR=/tmp/matplotlib',
      image, 'sleep', 'infinity'];
    try {
      const result = await this.service.runner(args, { timeoutMs: 30_000 });
      if (result.code) throw new Error(unavailable);
      this.started = true;
    } catch {
      try { await this.service.remove(this.name); } catch { this.service.markUnavailable(); }
      throw new Error(unavailable);
    }
  }
  private track<T>(operation: Promise<T>): Promise<T> {
    this.inFlight.add(operation);
    void operation.finally(() => this.inFlight.delete(operation)).catch(() => {});
    return operation;
  }
  private async helper(operation: string, path: string, input?: Buffer, extra: string[] = []): Promise<Buffer> {
    await this.ensureStarted();
    this.assertActive();
    let result: DockerCommandResult;
    try {
      result = await this.track(this.service.runner(['exec', '-i', this.name, 'python', '-I', '/opt/berserk/files.py', operation, path,
        String(this.service.options.maxReadBytes), ...extra], { input, maxBytes: this.service.options.maxReadBytes + 1024, timeoutMs: 30_000 }));
    } catch (error) { await this.stop(); throw error; }
    this.assertActive();
    if (result.code >= 128) { await this.stop(); throw new Error('文件执行异常，执行环境已清理。'); }
    // Expected file errors do not destroy a healthy sandbox; the Agent can fix the path and retry.
    if (result.code) throw new Error(result.stderr.toString().trim() || '文件操作失败。');
    return result.stdout;
  }
  readFile = (path: string): Promise<Buffer> => this.helper('read', path);
  access = async (path: string): Promise<void> => { await this.helper('stat', path); };
  writeFile = async (path: string, content: string): Promise<void> => { await this.helper('write', path, Buffer.from(content)); };
  mkdir = async (path: string): Promise<void> => { await this.helper('mkdir', path); };
  exists = async (path: string): Promise<boolean> => (await this.helper('exists', path)).toString() === 'true';
  stat = async (path: string): Promise<{ isDirectory: () => boolean }> => {
    const result: { directory: boolean } = JSON.parse((await this.helper('stat', path)).toString());
    return { isDirectory: () => result.directory };
  };
  readdir = async (path: string): Promise<string[]> => JSON.parse((await this.helper('ls', path)).toString());
  glob = async (pattern: string, cwd: string, options: { ignore: string[]; limit: number }): Promise<string[]> =>
    JSON.parse((await this.helper('find', cwd, undefined, [pattern, JSON.stringify(options)])).toString());
  detectImageMimeType = async (path: string): Promise<string | null> => {
    const data = (await this.helper('image', path)).toString();
    return data || null;
  };
  exec = async (command: string, cwd: string, options: BashExecutionOptions): Promise<{ exitCode: number | null }> => {
    if (cwd !== '/workspace') throw new Error('命令工作目录必须为 /workspace。');
    if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout <= 0)) throw new Error('命令超时参数无效。');
    await this.ensureStarted();
    this.assertActive();
    const abort = () => { void this.stop().catch(() => this.service.markUnavailable()); };
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      if (options.signal?.aborted) { await this.stop(); throw new Error('命令已取消。'); }
      // Never forward env: it originates in Pi's host process, which contains model credentials.
      const result = await this.track(this.service.runner(['exec', '-i', this.name, 'python', '-I', '/opt/berserk/command.py',
        String(options.timeout ?? 0)], { input: Buffer.from(command), onData: options.onData, maxBytes: this.service.options.maxOutputBytes }));
      if (options.signal?.aborted || this.stopped) { await this.stop(); throw new Error('命令已取消；已保存文件不会回滚。'); }
      if (result.code >= 128) { await this.stop(); throw new Error('命令执行异常，执行环境已清理；已保存文件保留。'); }
      if (result.code === 124 && options.timeout !== undefined) throw new Error(`命令超过 ${options.timeout} 秒并已停止。`);
      return { exitCode: result.code };
    } catch (error) {
      // A transport failure may leave docker exec children running. Destroy the exact request scope.
      if (!(error instanceof Error && error.message.startsWith('命令超过'))) await this.stop();
      throw error;
    } finally { options.signal?.removeEventListener('abort', abort); }
  };
  stop(): Promise<void> { return this.close(); }
  close(): Promise<void> {
    this.stopped = true;
    this.scope.signal?.removeEventListener('abort', this.abort);
    this.closing ??= (async () => {
      try {
        if (this.starting) await this.starting.catch(() => {});
        if (this.started) await this.service.remove(this.name);
        await Promise.allSettled([...this.inFlight]);
        this.release();
      } catch { this.service.markUnavailable(); throw new Error('无法确认本次执行已停止，请核对执行环境。'); }
    })();
    return this.closing;
  }
}
