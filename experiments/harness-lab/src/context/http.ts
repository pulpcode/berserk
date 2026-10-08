import { RequestError } from '../contracts/errors.js';

export interface ContextHttpOptions { timeoutMs?: number; maxBytes?: number; fetch?: typeof fetch }
const sourceErrors: Record<string, {message: string; status: number}> = {
  INVALID_ARGUMENT: {message: '来源不接受本次查询参数。', status: 400},
  UNSUPPORTED_FILTER: {message: '来源不支持本次过滤条件。', status: 400},
  INVALID_CURSOR: {message: '分页游标无效，请重新查询第一页。', status: 400},
  INVALID_CHANGE_CURSOR: {message: '变化位置无效，请重新查询当前状态。', status: 400},
  UNAUTHORIZED: {message: '来源查询凭证无效，请联系维护人员。', status: 502},
  FORBIDDEN: {message: '来源拒绝本次查询。', status: 403},
  NOT_FOUND: {message: '指定报告或修订不存在。', status: 404},
  CURSOR_STALE: {message: '资料已更新，分页游标失效，请重新查询第一页。', status: 409},
  UNAVAILABLE: {message: '业务资料来源暂不可用。', status: 503},
};
/** Fixed host URL only. Never forward source messages, credentials, redirect targets or partial bodies. */
export async function readContextJson(url: URL, token: string, signal?: AbortSignal, options: ContextHttpOptions = {}): Promise<unknown> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const cancelled = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', cancelled, {once: true});
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 15_000);
  const maxBytes = options.maxBytes ?? 256 * 1024;
  try {
    const response = await (options.fetch ?? fetch)(url, {headers: {Authorization: `Bearer ${token}`, Accept: 'application/json'}, redirect: 'manual', signal: controller.signal});
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new RequestError('CONTEXT_INVALID_RESPONSE', '来源返回了不允许的重定向。', 502); }
    const length = response.headers.get('content-length');
    if (length !== null && Number(length) > maxBytes) { await response.body?.cancel(); throw new RequestError('CONTEXT_RESPONSE_TOO_LARGE', '来源响应超过 256 KiB，未读取部分资料。', 502); }
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) { await response.body?.cancel(); throw new RequestError('CONTEXT_INVALID_RESPONSE', '来源未返回 JSON 数据。', 502); }
    const chunks: Uint8Array[] = []; let size = 0;
    const reader = response.body?.getReader();
    if (!reader) throw new RequestError('CONTEXT_INVALID_RESPONSE', '来源未返回查询正文。', 502);
    try {
      for (;;) {
        const {done, value} = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new RequestError('CONTEXT_RESPONSE_TOO_LARGE', '来源响应超过 256 KiB，未读取部分资料。', 502); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let data: unknown;
    try { data = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))); }
    catch { throw new RequestError('CONTEXT_INVALID_RESPONSE', '来源返回了无效 JSON 数据。', 502); }
    if (!response.ok) {
      const code = data && typeof data === 'object' && 'error' in data && data.error && typeof data.error === 'object' && 'code' in data.error ? String(data.error.code) : '';
      const error = sourceErrors[code];
      throw new RequestError(error ? `CONTEXT_${code}` : 'CONTEXT_UNAVAILABLE', error?.message ?? '业务资料来源查询失败。', error?.status ?? 503);
    }
    return data;
  } catch (error) {
    signal?.throwIfAborted();
    if (timedOut) throw new RequestError('CONTEXT_TIMEOUT', '业务资料查询超时。', 504);
    if (error instanceof RequestError) throw error;
    throw new RequestError('CONTEXT_UNAVAILABLE', '业务资料来源暂不可用。', 503);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancelled); }
}
