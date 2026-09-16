import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppInfo, PublicMessage, SessionSnapshot, SessionSummary, StreamEvent } from '../contracts/index';
import { api, sendMessage } from './api';

const DRAFT_KEY = 'berserk.drafts';
const SENT_KEY = 'berserk.submitted';
function stored(key: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch { return {}; }
}
function persist(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* In-memory drafts remain usable when storage is unavailable. */ }
}
function initialSelection() {
  try { return sessionStorage.getItem('berserk.selected') || ''; } catch { return ''; }
}
const reason = (error: unknown) => error instanceof Error ? error.message : '连接异常，请稍后查询会话状态。';

export function useChat() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, SessionSnapshot>>({});
  const snapshotsRef = useRef(snapshots);
  const revisions = useRef<Record<string, number>>({});
  const streams = useRef(new Map<string, { token: symbol; requestId?: string; terminal: boolean }>());
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [readErrors, setReadErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [selected, setSelected] = useState(initialSelection);
  const [drafts, setDrafts] = useState(() => stored(DRAFT_KEY));
  const draftsRef = useRef(drafts);
  const [submitted, setSubmitted] = useState(() => stored(SENT_KEY));
  const submittedRef = useRef(submitted);

  const draft = useCallback((id: string, text: string) => {
    draftsRef.current = { ...draftsRef.current, [id]: text };
    setDrafts(draftsRef.current);
    persist(DRAFT_KEY, draftsRef.current);
  }, []);
  const rememberSubmitted = useCallback((id: string, text: string) => {
    submittedRef.current = { ...submittedRef.current, [id]: text };
    setSubmitted(submittedRef.current);
    persist(SENT_KEY, submittedRef.current);
  }, []);
  const recover = useCallback((id: string) => {
    const text = submittedRef.current[id];
    if (text && !draftsRef.current[id]) draft(id, text);
  }, [draft]);
  const put = useCallback((snapshot: SessionSnapshot) => {
    const id = snapshot.id;
    revisions.current[id] = (revisions.current[id] || 0) + 1;
    snapshotsRef.current = { ...snapshotsRef.current, [id]: snapshot };
    setSnapshots(snapshotsRef.current);
    setSessions(previous => [snapshot, ...previous.filter(item => item.id !== id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    if (!snapshot.active && snapshot.lastResult) {
      if (snapshot.lastResult.status === 'succeeded') rememberSubmitted(id, '');
      if (snapshot.lastResult.status === 'failed') recover(id);
    }
  }, [recover, rememberSubmitted]);

  const refresh = useCallback(async (id: string) => {
    const revision = revisions.current[id] || 0;
    try {
      const result = await api<SessionSnapshot>(`/api/sessions/${encodeURIComponent(id)}`);
      // A GET started before a newer stream event must not overwrite that event.
      if (revision !== (revisions.current[id] || 0)) return;
      const stream = streams.current.get(id);
      if (stream && !stream.terminal && result.active) return;
      // Polling may observe completion before the final SSE frame arrives.
      if (stream && !stream.terminal && !result.active) return;
      put(result);
      setPending(previous => ({ ...previous, [id]: false }));
      setReadErrors(previous => ({ ...previous, [id]: '' }));
    } catch (error) { setReadErrors(previous => ({ ...previous, [id]: reason(error) })); }
  }, [put]);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const [app, list] = await Promise.all([api<AppInfo>('/api/info'), api<SessionSummary[]>('/api/sessions')]);
      setInfo(app); setSessions(list);
      setSelected(previous => list.some(item => item.id === previous) ? previous : list[0]?.id || '');
      setErrors(previous => ({ ...previous, '': '' }));
    } catch (error) { setErrors(previous => ({ ...previous, '': reason(error) })); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void bootstrap(); }, [bootstrap]);
  useEffect(() => {
    try { sessionStorage.setItem('berserk.selected', selected); } catch { /* Selection remains in memory. */ }
    if (!selected) return;
    void refresh(selected);
    const interval = window.setInterval(() => { void refresh(selected); }, 1800);
    return () => window.clearInterval(interval);
  }, [selected, refresh]);

  const create = useCallback(async (): Promise<string | null> => {
    if (creatingRef.current) return null;
    creatingRef.current = true; setCreating(true);
    try {
      const snapshot = await api<SessionSnapshot>('/api/sessions', {});
      put(snapshot); setSelected(snapshot.id);
      if (draftsRef.current['']) { draft(snapshot.id, draftsRef.current['']); draft('', ''); }
      return snapshot.id;
    } catch (error) { setErrors(previous => ({ ...previous, '': reason(error) })); return null; }
    finally { creatingRef.current = false; setCreating(false); }
  }, [draft, put]);

  const send = useCallback(async () => {
    const text = (draftsRef.current[selected] || '').trim();
    if (!text) return;
    const id = selected || await create();
    if (!id || streams.current.has(id) || snapshotsRef.current[id]?.active) return;
    const before = snapshotsRef.current[id];
    if (!before) return;
    const token = Symbol();
    const stream = { token, requestId: undefined as string | undefined, terminal: false };
    streams.current.set(id, stream);
    setPending(previous => ({ ...previous, [id]: true }));
    setErrors(previous => ({ ...previous, [id]: '' }));
    rememberSubmitted(id, text); draft(id, '');
    let messages: PublicMessage[] = [...before.messages, { id: 'sending-user', role: 'user', text }];
    let assistantNumber = 0;
    put({ ...before, messages, lastResult: null });
    const receive = (event: StreamEvent) => {
      if (event.sessionId !== id || streams.current.get(id)?.token !== token || stream.terminal) return;
      if (event.type === 'response.started') stream.requestId = event.requestId;
      if (event.requestId !== stream.requestId) return;
      const current = snapshotsRef.current[id];
      if (!current) return;
      if ('snapshot' in event) {
        stream.terminal = true;
        put(event.snapshot);
        return;
      }
      if (event.type === 'text.delta') {
        const last = messages.at(-1);
        if (last?.role === 'assistant') messages = [...messages.slice(0, -1), { ...last, text: last.text + event.delta }];
        else messages = [...messages, { id: `stream-assistant-${assistantNumber++}`, role: 'assistant', text: event.delta }];
      }
      if (event.type === 'tool.started') messages = [...messages, { id: event.toolCallId, role: 'tool', toolName: event.toolName, text: '' }];
      if (event.type === 'tool.completed') messages = messages.map(message => message.id === event.toolCallId ? { ...message, text: event.text, isError: event.isError } : message);
      put({ ...current, messages, active: { requestId: event.requestId, status: current.active?.status === 'stopping' ? 'stopping' : 'responding' } });
    };
    try {
      await sendMessage(id, text, receive);
      if (!stream.terminal) setErrors(previous => ({ ...previous, [id]: '连接已断开，正在查询会话状态；消息不会重复发送。' }));
    } catch (error) { setErrors(previous => ({ ...previous, [id]: reason(error) })); recover(id); }
    finally {
      if (streams.current.get(id)?.token === token) streams.current.delete(id);
      await refresh(id);
    }
  }, [create, draft, put, recover, refresh, rememberSubmitted, selected]);

  const cancel = useCallback(async () => {
    const current = snapshotsRef.current[selected];
    if (!current?.active || current.active.status === 'stopping') return;
    const requestId = current.active.requestId;
    put({ ...current, active: { requestId, status: 'stopping' } });
    try {
      const result = await api<SessionSnapshot>(`/api/sessions/${encodeURIComponent(selected)}/cancel`, { requestId });
      const latest = snapshotsRef.current[selected];
      if (latest?.active?.requestId === requestId) put({ ...result, messages: latest.messages });
    } catch (error) {
      setErrors(previous => ({ ...previous, [selected]: reason(error) }));
      const latest = snapshotsRef.current[selected];
      if (latest?.active?.requestId === requestId) put({ ...latest, active: { requestId, status: 'responding' } });
    }
  }, [put, selected]);

  return { info, sessions, snapshots, selected, select: setSelected, loading, creating, create, send, cancel,
    draft: drafts[selected] || '', setDraft: (text: string) => draft(selected, text),
    submitted: submitted[selected] || '', restoreSubmitted: () => draft(selected, submittedRef.current[selected] || ''),
    pending: pending[selected] || false, error: errors[selected] || readErrors[selected] || errors[''] || '', refresh, bootstrap };
}
