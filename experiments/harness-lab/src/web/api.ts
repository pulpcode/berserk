import { createContext, useContext } from 'react';
import type { AuthSession } from '../contracts/access';
import type { ApiError, StreamEvent, ComposerSelection } from '../contracts/index';

export class ApiFailure extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); }
}

// Keep transport failures separate from HTTP rejections: a failed write may already have committed.
export class NetworkFailure extends Error {
  readonly code = 'NETWORK_ERROR';
  constructor() { super('暂时无法连接服务，请稍后重试。'); }
}

export function isConnectionFailure(error: unknown): boolean {
  return error instanceof NetworkFailure || (error instanceof ApiFailure && [502, 503, 504].includes(error.status));
}

export async function checkResponse(response: Response): Promise<Response> {
  if (response.ok) return response;
  const body = await response.json().catch(() => null) as ApiError | null;
  throw new ApiFailure(body?.error?.message || `请求未完成（${response.status}）`, body?.error?.code || 'HTTP_ERROR', response.status);
}

export async function api<T>(path: string, body?: object, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
  const response = await fetch(path, body === undefined ? { cache: 'no-store' } : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  await checkResponse(response);
  return response.json() as Promise<T>;
}

// A disconnected response never retries the POST: the server may still be working.
export async function sendMessage(sessionId: string, text: string, onEvent: (event: StreamEvent) => void, attachments?: ComposerSelection & { uploadIds?: string[]; fileRefs?: { path: string }[] }, apiRoot = '/api', transport: typeof fetch = fetch): Promise<void> {
  const response = await checkResponse(await transport(`${apiRoot}/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, ...attachments }),
  }));
  if (!response.body) throw new Error('连接未返回消息流，请查询会话状态。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const dispatch = (frame: string) => {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (data) onEvent(JSON.parse(data) as StreamEvent);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        dispatch(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
      if (done) {
        if (buffer.trim()) dispatch(buffer);
        break;
      }
    }
  } finally { reader.releaseLock(); }
}

/** Each mounted seat owns an immutable client. Async callbacks never read the current selector. */
export function createApiClient(seatId?: string, auth?: AuthSession, invalid?: () => void) {
  const controller = new AbortController();
  const headers: Record<string,string> = auth ? { 'x-csrf-token':auth.csrf!, 'x-axon-view':auth.viewId! } : {};
  const request: typeof fetch = async (input,init) => {
    controller.signal.throwIfAborted();
    const signal = init?.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal;
    let response: Response;
    try {
      response = await fetch(input, {...init, headers: {...Object.fromEntries(new Headers(init?.headers)), ...headers}, signal});
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof TypeError) throw new NetworkFailure();
      throw error;
    }
    if(auth && (response.status===401 || response.status===409)) {
      const body=await response.clone().json().catch(()=>null) as ApiError|null;
      if(response.status===401 || body?.error.code==='IDENTITY_CHANGED') {invalid?.(); throw new ApiFailure('登录已变化，请重新进入。','IDENTITY_CHANGED',401);}
    }
    controller.signal.throwIfAborted(); return response;
  };
  const root = seatId && !auth ? `/api/test-seats/${encodeURIComponent(seatId)}` : '/api';
  const url = (path: string) => path === '/api/info' || path.startsWith('/api/test-seats/') ? path : path.replace(/^\/api(?=\/|$)/, root);
  return {
    seatId, headers, request, dispose: () => controller.abort(),
    url,
    domId: (id: string) => seatId ? `${id}-${seatId}` : id,
    storageKey: (key: string) => auth ? `${key}:login:${auth.viewId}` : seatId ? `${key}:seat:${seatId}` : key,
    api: async <T,>(path: string, body?: object, method: 'POST' | 'PUT' = 'POST'): Promise<T> => {
      const response=await checkResponse(await request(url(path),body===undefined ? {cache:'no-store'} : {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
      return response.json() as Promise<T>;
    },
    sendMessage: (sessionId: string, text: string, receive: (event: StreamEvent) => void, attachments?: ComposerSelection & { uploadIds?: string[]; fileRefs?: { path: string }[] }) => sendMessage(sessionId, text, receive, attachments, root, request),
  };
}
export const ApiContext = createContext(createApiClient());
export const useApi = () => useContext(ApiContext);
