import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppInfo, PublicMessage, SessionSnapshot, SessionSummary, SessionActivity, ActivityOverview, StreamEvent, Workspace, InstructionUpdate } from '../contracts/index';
import { api, sendMessage } from './api';

const DRAFT_KEY = 'berserk.drafts';
const SENT_KEY = 'berserk.submitted';
const READ_KEY = 'berserk.read-results';
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
function initialWorkspace() {
  try { return sessionStorage.getItem('berserk.workspace') || ''; } catch { return ''; }
}
const reason = (error: unknown) => error instanceof Error ? error.message : '连接异常，请稍后查询会话状态。';

// Keep navigation order stable while status and streamed content change.
function mergeById<T extends { id: string }>(previous: T[], incoming: T[]): T[] {
  const updates = new Map(incoming.map(item => [item.id, item]));
  const known = new Set(previous.map(item => item.id));
  return [...incoming.filter(item => !known.has(item.id)), ...previous.map(item => updates.get(item.id) || item)];
}
function activityOf(snapshot: SessionSnapshot, previous?: SessionActivity): SessionActivity {
  const { id, workspaceId, title, updatedAt, active, lastResult, recoveryWarning } = snapshot;
  const sameState = JSON.stringify(active) === JSON.stringify(previous?.active)
    && lastResult?.requestId === previous?.lastResult?.requestId && lastResult?.status === previous?.lastResult?.status;
  return { id, workspaceId, title, updatedAt, active, recoveryWarning,
    lastResult: lastResult ? { requestId: lastResult.requestId, status: lastResult.status } : null,
    statusUpdatedAt: sameState && previous ? previous.statusUpdatedAt : active ? new Date().toISOString() : updatedAt };
}
function sameActivity(a: SessionActivity, b?: SessionActivity) {
  return b && a.id === b.id && a.workspaceId === b.workspaceId && a.title === b.title && a.updatedAt === b.updatedAt
    && a.statusUpdatedAt === b.statusUpdatedAt && a.recoveryWarning === b.recoveryWarning
    && a.active?.requestId === b.active?.requestId && a.active?.status === b.active?.status
    && a.active?.phase === b.active?.phase && a.active?.toolName === b.active?.toolName
    && a.lastResult?.requestId === b.lastResult?.requestId && a.lastResult?.status === b.lastResult?.status;
}

export function useChat() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activities, setActivities] = useState<SessionActivity[]>([]);
  const activitiesRef = useRef(activities);
  const [activityError, setActivityError] = useState('');
  const activityRequest = useRef<Promise<void> | null>(null);
  const overviewLoaded = useRef(false);
  const [readResults, setReadResults] = useState(() => stored(READ_KEY));
  const markRead = useCallback((id: string, requestId: string) => {
    setReadResults(previous => {
      if (previous[id] === requestId) return previous;
      const next = { ...previous, [id]: requestId }; persist(READ_KEY, next); return next;
    });
  }, []);
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
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState(initialWorkspace);
  const workspaceRef = useRef(workspaceId);
  const [selections, setSelections] = useState(() => stored('berserk.selections'));
  const selectionsRef = useRef(selections);
  const selected = selections[workspaceId] || '';
  const draftKey = selected || `workspace:${workspaceId}`;
  const [instructionChanges, setInstructionChanges] = useState<Record<string, InstructionUpdate[]>>({});
  const selectForWorkspace = useCallback((workspace: string, id: string) => {
    selectionsRef.current = { ...selectionsRef.current, [workspace]: id };
    setSelections(selectionsRef.current);
    persist('berserk.selections', selectionsRef.current);
  }, []);
  const selectWorkspace = useCallback((id: string) => {
    workspaceRef.current = id; setWorkspaceId(id);
    try { sessionStorage.setItem('berserk.workspace', id); } catch { /* Keep selection in memory. */ }
  }, []);
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
    setSessions(previous => mergeById(previous, [snapshot]));
    activitiesRef.current = mergeById(activitiesRef.current, [activityOf(snapshot, activitiesRef.current.find(item => item.id === id))]);
    setActivities(activitiesRef.current);
    if (!snapshot.active && snapshot.lastResult) {
      if (snapshot.lastResult.status === 'succeeded') rememberSubmitted(id, '');
      if (snapshot.lastResult.status === 'failed') recover(id);
      if (snapshot.lastResult.status === 'cancelled' && !snapshot.messages.some(message => message.role === 'user' && message.requestId === snapshot.lastResult!.requestId)) recover(id);
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
    } catch (error) { if (revision === (revisions.current[id] || 0)) setReadErrors(previous => ({ ...previous, [id]: reason(error) })); }
  }, [put]);

  const refreshActivity = useCallback((): Promise<void> => {
    if (activityRequest.current) return activityRequest.current;
    const before = { ...revisions.current };
    const request = (async () => {
      try {
        const overview = await api<ActivityOverview>('/api/activity');
        // A slow overview must not roll back a stream or a newer selected-session GET.
        const incoming = overview.sessions.filter(item => {
          const stream = streams.current.get(item.id);
          return (before[item.id] || 0) === (revisions.current[item.id] || 0)
            && (!stream || stream.terminal || (item.active && item.active.requestId === stream.requestId));
        });
        for (const item of incoming) {
          if (!sameActivity(item, activitiesRef.current.find(old => old.id === item.id))) {
            revisions.current[item.id] = (revisions.current[item.id] || 0) + 1;
          }
        }
        activitiesRef.current = mergeById(activitiesRef.current, incoming);
        setActivities(activitiesRef.current);
        setSessions(previous => mergeById(previous, incoming));
        // There is no deletion API. Preserve just-created workspaces/sessions if a GET predates their POST.
        setWorkspaces(previous => [...previous, ...overview.workspaces.filter(item => !previous.some(old => old.id === item.id))]);
        if (!overviewLoaded.current) {
          const workspace = overview.workspaces.some(item => item.id === workspaceRef.current) ? workspaceRef.current : overview.defaultWorkspaceId;
          selectWorkspace(workspace); overviewLoaded.current = true;
        }
        for (const owner of overview.workspaces) {
          const selectedId = selectionsRef.current[owner.id];
          if (!activitiesRef.current.some(item => item.id === selectedId && item.workspaceId === owner.id)) {
            selectForWorkspace(owner.id, activitiesRef.current.find(item => item.workspaceId === owner.id)?.id || '');
          }
        }
        setActivityError('');
      } catch (error) {
        setActivityError(`动态更新失败，显示的是上次获取的状态。${reason(error)}`);
        throw error;
      }
    })();
    activityRequest.current = request;
    void request.finally(() => { if (activityRequest.current === request) activityRequest.current = null; }).catch(() => {});
    return request;
  }, [selectForWorkspace, selectWorkspace]);
  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const [app] = await Promise.all([api<AppInfo>('/api/info'), refreshActivity()]);
      setInfo(app);
      setErrors(previous => ({ ...previous, '': '' }));
    } catch (error) { setErrors(previous => ({ ...previous, '': reason(error) })); }
    finally { setLoading(false); }
  }, [refreshActivity]);
  useEffect(() => { void bootstrap(); }, [bootstrap]);
  useEffect(() => {
    const update = () => { void refreshActivity().catch(() => {}); };
    const interval = window.setInterval(update, 1800);
    window.addEventListener('focus', update);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', update); };
  }, [refreshActivity]);
  useEffect(() => {
    if (!selected) return;
    void refresh(selected);
    const interval = window.setInterval(() => { void refresh(selected); }, 1800);
    return () => window.clearInterval(interval);
  }, [selected, refresh]);

  const createWorkspace = useCallback(async (name: string) => {
    const workspace = await api<Workspace>('/api/workspaces', { name });
    setWorkspaces(previous => previous.some(item => item.id === workspace.id) ? previous : [...previous, workspace]);
    selectWorkspace(workspace.id);
    return workspace;
  }, [selectWorkspace]);

  const create = useCallback(async (): Promise<string | null> => {
    if (creatingRef.current || !workspaceId) return null;
    creatingRef.current = true; setCreating(true);
    try {
      const snapshot = await api<SessionSnapshot>('/api/sessions', { workspaceId });
      put(snapshot); selectForWorkspace(workspaceId, snapshot.id);
      const key = `workspace:${workspaceId}`;
      if (draftsRef.current[key]) { draft(snapshot.id, draftsRef.current[key]); draft(key, ''); }
      return snapshot.id;
    } catch (error) { setErrors(previous => ({ ...previous, [`workspace:${workspaceId}`]: reason(error) })); return null; }
    finally { creatingRef.current = false; setCreating(false); }
  }, [draft, put, selectForWorkspace, workspaceId]);

  const send = useCallback(async () => {
    const text = (draftsRef.current[draftKey] || '').trim();
    if (!text) return;
    const id = selected || await create();
    if (!id || streams.current.has(id) || snapshotsRef.current[id]?.active || activitiesRef.current.find(item => item.id === id)?.active) return;
    const before = snapshotsRef.current[id];
    if (!before) return;
    const token = Symbol();
    const stream = { token, requestId: undefined as string | undefined, terminal: false };
    streams.current.set(id, stream);
    setPending(previous => ({ ...previous, [id]: true }));
    setErrors(previous => ({ ...previous, [id]: '' }));
    rememberSubmitted(id, text);
    if ((draftsRef.current[id] || '').trim() === text) draft(id, '');
    let messages: PublicMessage[] = [...before.messages, { id: 'sending-user', role: 'user', text }];
    let assistantNumber = 0;
    put({ ...before, messages, lastResult: null });
    const receive = (event: StreamEvent) => {
      if (event.sessionId !== id || streams.current.get(id)?.token !== token || stream.terminal) return;
      if (stream.requestId && event.requestId !== stream.requestId) return;
      if (event.type === 'response.started') { stream.requestId = event.requestId; messages = messages.map(message => message.id === 'sending-user' ? { ...message, requestId: event.requestId } : message); setInstructionChanges(previous => ({ ...previous, [id]: [] })); }
      if (event.requestId !== stream.requestId) return;
      const current = snapshotsRef.current[id];
      if (!current) return;
      if (event.type === 'instructions.updated') setInstructionChanges(previous => ({ ...previous, [id]: [...(previous[id] || []), event.change] }));
      if ('snapshot' in event) {
        stream.terminal = true;
        put(event.snapshot);
        setPending(previous => ({ ...previous, [id]: false }));
        return;
      }
      if (event.type === 'text.delta') {
        const last = messages.at(-1);
        if (last?.role === 'assistant') messages = [...messages.slice(0, -1), { ...last, text: last.text + event.delta }];
        else messages = [...messages, { id: `stream-assistant-${assistantNumber++}`, role: 'assistant', requestId: event.requestId, text: event.delta }];
      }
      if (event.type === 'tool.started') messages = [...messages, { id: event.toolCallId, role: 'tool', requestId: event.requestId, toolName: event.toolName, text: '' }];
      if (event.type === 'tool.completed') messages = messages.map(message => message.id === event.toolCallId ? { ...message, text: event.text, isError: event.isError } : message);
      const phase = ['response.started', 'resources.loaded', 'tool.completed'].includes(event.type) ? 'preparing' : event.type === 'tool.started' ? 'tool'
        : event.type === 'text.delta' ? 'generating' : current.active?.phase;
      put({ ...current, messages, active: { requestId: event.requestId, status: current.active?.status === 'stopping' ? 'stopping' : 'responding', phase,
        ...(phase === 'tool' ? { toolName: event.type === 'tool.started' ? event.toolName : current.active?.toolName } : {}) } });
    };
    try {
      await sendMessage(id, text, receive);
      if (!stream.terminal) setErrors(previous => ({ ...previous, [id]: '连接已断开，正在查询会话状态；消息不会重复发送。' }));
    } catch (error) { setErrors(previous => ({ ...previous, [id]: reason(error) })); recover(id); }
    finally {
      if (streams.current.get(id)?.token === token) streams.current.delete(id);
      await refresh(id);
    }
  }, [create, draft, put, recover, refresh, rememberSubmitted, selected, draftKey]);

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

  return { info, sessions: sessions.filter(item => item.workspaceId === workspaceId), snapshots, selected,
    activities, activityError, refreshActivity, markRead,
    unread: Object.fromEntries(activities.map(item => [item.id, Boolean(!item.active && item.lastResult?.status === 'succeeded' && readResults[item.id] !== item.lastResult.requestId)])),
    select: (id: string) => {
      const owner = activitiesRef.current.find(item => item.id === id)?.workspaceId;
      if (owner) { selectForWorkspace(owner, id); selectWorkspace(owner); }
    }, workspaces, workspaceId,
    workspace: workspaces.find(item => item.id === workspaceId), selectWorkspace, createWorkspace,
    loading, creating, create, send, cancel,
    draft: drafts[draftKey] || '', setDraft: (text: string) => draft(draftKey, text),
    submitted: submitted[selected] || '', restoreSubmitted: () => draft(draftKey, submittedRef.current[selected] || ''),
    instructionChanges: snapshots[selected]?.lastResult?.instructionChanges || instructionChanges[selected] || [],
    pending: pending[selected] || false, error: errors[selected] || readErrors[selected] || errors[`workspace:${workspaceId}`] || errors[''] || '', refresh, bootstrap };
}
