import { createContext, useContext } from 'react';
import type { ApiError, StreamEvent, ComposerSelection } from '../contracts/index';

export class ApiFailure extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); }
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
export async function sendMessage(sessionId: string, text: string, onEvent: (event: StreamEvent) => void, attachments?: ComposerSelection & { uploadIds?: string[]; fileRefs?: { path: string }[] }, apiRoot = '/api'): Promise<void> {
  const response = await checkResponse(await fetch(`${apiRoot}/sessions/${encodeURIComponent(sessionId)}/messages`, {
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
export function createApiClient(seatId?: string) {
  const root = seatId ? `/api/test-seats/${encodeURIComponent(seatId)}` : '/api';
  const url = (path: string) => path === '/api/info' || path.startsWith('/api/test-seats/') ? path : path.replace(/^\/api(?=\/|$)/, root);
  return {
    seatId,
    url,
    domId: (id: string) => seatId ? `${id}-${seatId}` : id,
    storageKey: (key: string) => seatId ? `${key}:seat:${seatId}` : key,
    api: <T,>(path: string, body?: object, method?: 'POST' | 'PUT') => api<T>(url(path), body, method),
    sendMessage: (sessionId: string, text: string, receive: (event: StreamEvent) => void, attachments?: ComposerSelection & { uploadIds?: string[]; fileRefs?: { path: string }[] }) => sendMessage(sessionId, text, receive, attachments, root),
  };
}
export const ApiContext = createContext(createApiClient());
export const useApi = () => useContext(ApiContext);
