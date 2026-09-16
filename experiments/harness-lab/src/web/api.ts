import type { ApiError, StreamEvent } from '../contracts/index';

export class ApiFailure extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); }
}

async function checkResponse(response: Response): Promise<Response> {
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
export async function sendMessage(sessionId: string, text: string, onEvent: (event: StreamEvent) => void): Promise<void> {
  const response = await checkResponse(await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
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
