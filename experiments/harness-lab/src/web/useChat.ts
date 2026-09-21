import { useCallback, useEffect, useRef, useState } from 'react';
import type { Interaction, InteractionResponse, AppInfo, PublicMessage, SessionSnapshot, SessionSummary, SessionActivity, ActivityOverview, StreamEvent, Workspace, InstructionUpdate } from '../contracts/index';
import { useApi } from './api';
import { clearInteractionDraft, type InteractionSubmission } from './InteractionCard';
import { useAttachments } from './useAttachments';
import { useComposerSelections, selectionInput } from './useComposerSelections';

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
function initialWorkspace(key: string) {
  try { return sessionStorage.getItem(key) || ''; } catch { return ''; }
}
const reason = (error: unknown) => error instanceof Error ? error.message : '连接异常，请稍后查询会话状态。';

// Keep navigation order stable while status and streamed content change.
function mergeById<T extends { id: string }>(previous: T[], incoming: T[]): T[] {
  const updates = new Map(incoming.map(item => [item.id, item]));
  const known = new Set(previous.map(item => item.id));
  return [...incoming.filter(item => !known.has(item.id)), ...previous.map(item => updates.get(item.id) || item)];
}
function activityOf(snapshot: SessionSnapshot, previous?: SessionActivity): SessionActivity {
  const { id, workspaceId, workItemId, title, updatedAt, active, lastResult, recoveryWarning } = snapshot;
  const sameState = JSON.stringify(active) === JSON.stringify(previous?.active)
    && lastResult?.requestId === previous?.lastResult?.requestId && lastResult?.status === previous?.lastResult?.status;
  return { id, workspaceId, workItemId, title, updatedAt, active, recoveryWarning,
    lastResult: lastResult ? { requestId: lastResult.requestId, status: lastResult.status } : null,
    statusUpdatedAt: sameState && previous ? previous.statusUpdatedAt : active ? new Date().toISOString() : updatedAt };
}
function sameActivity(a: SessionActivity, b?: SessionActivity) {
  return b && a.id === b.id && a.workspaceId === b.workspaceId && a.workItemId === b.workItemId && a.title === b.title && a.updatedAt === b.updatedAt
    && a.statusUpdatedAt === b.statusUpdatedAt && a.recoveryWarning === b.recoveryWarning
    && a.active?.requestId === b.active?.requestId && a.active?.status === b.active?.status
    && a.active?.phase === b.active?.phase && a.active?.toolName === b.active?.toolName
    && a.lastResult?.requestId === b.lastResult?.requestId && a.lastResult?.status === b.lastResult?.status;
}

/** Interaction outcomes only advance; delayed HTTP acknowledgements may omit execution evidence. */
function mergeInteraction(previous: Interaction | undefined, incoming: Interaction): Interaction {
  if (!previous) return incoming;
  if (previous.requestId !== incoming.requestId || previous.toolCallId !== incoming.toolCallId || previous.kind !== incoming.kind) return previous;
  if (previous.status !== 'pending' && previous.status !== incoming.status) return previous;
  if (previous.kind === 'confirmation' && incoming.kind === 'confirmation' && previous.execution && (!incoming.execution || (previous.execution !== 'unknown' && incoming.execution === 'unknown'))) return { ...incoming, execution: previous.execution };
  return incoming;
}

export function useChat() {
  const { api, sendMessage, storageKey } = useApi();
  const DRAFT_KEY = storageKey('berserk.drafts');
  const SENT_KEY = storageKey('berserk.submitted');
  const READ_KEY = storageKey('berserk.read-results');
  const attachments = useAttachments();
  const composerSelections = useComposerSelections();
  const { move: moveSelections, consume: consumeSelections, recover: recoverSelections, clearSubmitted: clearSubmittedSelections } = composerSelections;
  const { recover: recoverAttachments, clearSubmitted: clearSubmittedAttachments, move: moveAttachments, consume: consumeAttachments } = attachments;
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
  }, [READ_KEY]);
  const [snapshots, setSnapshots] = useState<Record<string, SessionSnapshot>>({});
  const snapshotsRef = useRef(snapshots);
  const revisions = useRef<Record<string, number>>({});
  const streams = useRef(new Map<string, { token: symbol; requestId?: string; terminal: boolean }>());
  const interactionLocks = useRef(new Set<string>());
  const [interactionSubmissions, setInteractionSubmissions] = useState<Record<string, InteractionSubmission>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [readErrors, setReadErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState(() => initialWorkspace(storageKey('berserk.workspace')));
  const workspaceRef = useRef(workspaceId);
  const navigationRevision = useRef(0);
  const noteNavigation = useCallback(() => { navigationRevision.current++; }, []);
  const [selections, setSelections] = useState(() => stored(storageKey('berserk.selections')));
  const selectionsRef = useRef(selections);
  const selected = selections[workspaceId] || '';
  const draftKey = selected || `workspace:${workspaceId}`;
  const [instructionChanges, setInstructionChanges] = useState<Record<string, InstructionUpdate[]>>({});
  const selectForWorkspace = useCallback((workspace: string, id: string) => {
    selectionsRef.current = { ...selectionsRef.current, [workspace]: id };
    setSelections(selectionsRef.current);
    persist(storageKey('berserk.selections'), selectionsRef.current);
  }, [storageKey]);
  const selectWorkspace = useCallback((id: string) => {
    noteNavigation();
    workspaceRef.current = id; setWorkspaceId(id);
    try { sessionStorage.setItem(storageKey('berserk.workspace'), id); } catch { /* Keep selection in memory. */ }
  }, [noteNavigation, storageKey]);
  const [drafts, setDrafts] = useState(() => stored(DRAFT_KEY));
  const draftsRef = useRef(drafts);
  const movedDrafts = useRef(new Map<string, string>());
  // New handlers now capture the new draft owner; only the intervening old render needed aliases.
  useEffect(() => { movedDrafts.current.clear(); }, [draftKey]);
  const [submitted, setSubmitted] = useState(() => stored(SENT_KEY));
  const submittedRef = useRef(submitted);

  const draft = useCallback((id: string, text: string) => {
    draftsRef.current = { ...draftsRef.current, [id]: text };
    setDrafts(draftsRef.current);
    persist(DRAFT_KEY, draftsRef.current);
  }, [DRAFT_KEY]);
  const rememberSubmitted = useCallback((id: string, text: string) => {
    submittedRef.current = { ...submittedRef.current, [id]: text };
    setSubmitted(submittedRef.current);
    persist(SENT_KEY, submittedRef.current);
  }, [SENT_KEY]);
  const recover = useCallback((id: string) => {
    recoverAttachments(id);
    const text = submittedRef.current[id];
    recoverSelections(id, !draftsRef.current[id] || draftsRef.current[id] === text);
    if (text && !draftsRef.current[id]) draft(id, text);
  }, [draft, recoverAttachments, recoverSelections]);
  const put = useCallback((snapshot: SessionSnapshot) => {
    const id = snapshot.id;
    const old = snapshotsRef.current[id]?.interactions || [];
    const interactions = (snapshot.interactions || []).filter(item => item.sessionId === id && item.workspaceId === snapshot.workspaceId).map(item => {
      const previous = old.find(entry => entry.interactionId === item.interactionId);
      // A late pending projection cannot reopen an already settled interaction.
      return mergeInteraction(previous, item);
    });
    for (const item of interactions) if (item.status !== 'pending') clearInteractionDraft(item);
    snapshot = { ...snapshot, interactions };
    if (snapshot.active && ['waiting_answer', 'waiting_confirmation'].includes(snapshot.active.phase || '') && !interactions.some(item => item.requestId === snapshot.active!.requestId && item.status === 'pending')) {
      snapshot = { ...snapshot, active: { ...snapshot.active, phase: 'preparing' } };
    }
    revisions.current[id] = (revisions.current[id] || 0) + 1;
    snapshotsRef.current = { ...snapshotsRef.current, [id]: snapshot };
    setSnapshots(snapshotsRef.current);
    setSessions(previous => mergeById(previous, [snapshot]));
    activitiesRef.current = mergeById(activitiesRef.current, [activityOf(snapshot, activitiesRef.current.find(item => item.id === id))]);
    setActivities(activitiesRef.current);
    if (!snapshot.active && snapshot.lastResult) {
      if (snapshot.lastResult.status === 'succeeded') { rememberSubmitted(id, ''); clearSubmittedAttachments(id); clearSubmittedSelections(id); }
      if (snapshot.lastResult.status === 'failed') recover(id);
      const userMessageSaved = snapshot.messages.some(message => message.role === 'user' && message.requestId === snapshot.lastResult!.requestId);
      if (snapshot.lastResult.status === 'cancelled' && !userMessageSaved) recover(id);
      if (snapshot.lastResult.status === 'interrupted') {
        if (userMessageSaved) { rememberSubmitted(id, ''); clearSubmittedAttachments(id); clearSubmittedSelections(id); }
        else recover(id);
      }
    }
  }, [recover, rememberSubmitted, clearSubmittedAttachments, clearSubmittedSelections]);

  const refresh = useCallback(async (id: string) => {
    const revision = revisions.current[id] || 0;
    try {
      const result = await api<SessionSnapshot>(`/api/sessions/${encodeURIComponent(id)}`);
      // A GET started before a newer stream event must not overwrite that event.
      if (revision !== (revisions.current[id] || 0)) return;
      const stream = streams.current.get(id);
      if (stream && !stream.terminal && result.active) {
        const current = snapshotsRef.current[id];
        if (current && result.active.requestId === stream.requestId) put({ ...current, interactions: result.interactions, active: result.active });
        return;
      }
      // Polling may observe completion before the final SSE frame arrives.
      if (stream && !stream.terminal && !result.active) return;
      put(result);
      setPending(previous => ({ ...previous, [id]: false }));
      setReadErrors(previous => ({ ...previous, [id]: '' }));
    } catch (error) { if (revision === (revisions.current[id] || 0)) setReadErrors(previous => ({ ...previous, [id]: reason(error) })); }
  }, [api, put]);

  const applyInteraction = useCallback((item: Interaction) => {
    const current = snapshotsRef.current[item.sessionId];
    if (!current || item.workspaceId !== current.workspaceId) return;
    const previous = current.interactions?.find(entry => entry.interactionId === item.interactionId);
    if (previous && (previous.requestId !== item.requestId || previous.toolCallId !== item.toolCallId || (previous.status !== 'pending' && previous.status !== item.status))) return;
    item = mergeInteraction(previous, item);
    const interactions = [...(current.interactions || []).filter(entry => entry.interactionId !== item.interactionId), item];
    const waiting = interactions.find(entry => entry.requestId === item.requestId && entry.status === 'pending');
    const active = current.active?.requestId === item.requestId && current.active.status !== 'stopping' && (!previous || previous.status === 'pending')
      ? { ...current.active, phase: waiting ? waiting.kind === 'question' ? 'waiting_answer' as const : 'waiting_confirmation' as const : item.status === 'approved' ? 'tool' as const : 'preparing' as const }
      : current.active;
    put({ ...current, active, interactions });
  }, [put]);
  const queryInteraction = useCallback(async (item: Interaction) => {
    const key = item.interactionId;
    if (interactionLocks.current.has(key)) return;
    interactionLocks.current.add(key);
    setInteractionSubmissions(previous => ({ ...previous, [key]: { ...previous[key], busy: true } }));
    try {
      const result = await api<SessionSnapshot>(`/api/sessions/${encodeURIComponent(item.sessionId)}`);
      const latest = result.interactions?.find(entry => entry.interactionId === key && entry.requestId === item.requestId);
      if (!latest || result.id !== item.sessionId || result.workspaceId !== item.workspaceId) throw new Error('未查询到该交互，请刷新会话后核对。');
      applyInteraction(latest);
      setReadErrors(previous => ({ ...previous, [item.sessionId]: '' }));
      setInteractionSubmissions(previous => ({ ...previous, [key]: { error: latest.status === 'pending' ? '尚未收到提交，请核对后手动重试。' : '' } }));
    } catch (error) { setInteractionSubmissions(previous => ({ ...previous, [key]: { needsQuery: true, error: `查询未完成，草稿已保留。${reason(error)}` } })); }
    finally { interactionLocks.current.delete(key); }
  }, [api, applyInteraction]);
  const respondInteraction = useCallback(async (item: Interaction, response: InteractionResponse) => {
    const key = item.interactionId;
    const current = snapshotsRef.current[item.sessionId];
    if (interactionLocks.current.has(key) || interactionSubmissions[key]?.needsQuery || current?.active?.requestId !== item.requestId || current.active.status === 'stopping' || current.interactions?.find(entry => entry.interactionId === key)?.status !== 'pending') return;
    interactionLocks.current.add(key);
    setInteractionSubmissions(previous => ({ ...previous, [key]: { busy: true } }));
    try {
      const result = await api<Interaction>(`/api/sessions/${encodeURIComponent(item.sessionId)}/interactions/${encodeURIComponent(key)}/response`, response);
      if (result.interactionId !== key || result.sessionId !== item.sessionId || result.requestId !== item.requestId || result.kind !== item.kind) throw new Error('返回的交互归属不一致，请查询核对。');
      applyInteraction(result);
      setInteractionSubmissions(previous => ({ ...previous, [key]: {} }));
    } catch (error) {
      setInteractionSubmissions(previous => ({ ...previous, [key]: { needsQuery: true, error: `提交结果需核对，草稿已保留；请先查询最新状态。${reason(error)}` } }));
    } finally { interactionLocks.current.delete(key); }
  }, [api, applyInteraction, interactionSubmissions]);

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
        setWorkspaces(previous => mergeById(previous, overview.workspaces));
        if (!overviewLoaded.current) {
          const workspace = overview.workspaces.some(item => item.id === workspaceRef.current) ? workspaceRef.current : overview.defaultWorkspaceId;
          selectWorkspace(workspace); overviewLoaded.current = true;
        }
        for (const owner of overview.workspaces) {
          const selectedId = selectionsRef.current[owner.id];
          // A creation may appear in polling before POST returns and transfers
          // its workspace draft. Keep that composer owner until create settles.
          if (!selectedId && creatingRef.current === owner.id) continue;
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
  }, [api, selectForWorkspace, selectWorkspace]);
  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const [app] = await Promise.all([api<AppInfo>('/api/info'), refreshActivity()]);
      setInfo(app);
      setErrors(previous => ({ ...previous, '': '' }));
    } catch (error) { setErrors(previous => ({ ...previous, '': reason(error) })); }
    finally { setLoading(false); }
  }, [api, refreshActivity]);
  const refreshInfo = useCallback(async () => { setInfo(await api<AppInfo>('/api/info')); }, [api]);
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
  }, [api, selectWorkspace]);

  const create = useCallback(async (targetWorkspaceId = workspaceId, workItemId?: string): Promise<string | null> => {
    if (creatingRef.current || !targetWorkspaceId) return null;
    const navigation = navigationRevision.current;
    creatingRef.current = targetWorkspaceId; setCreating(true);
    try {
      const snapshot = await api<SessionSnapshot>('/api/sessions', { workspaceId: targetWorkspaceId, ...(workItemId ? { workItemId } : {}) });
      put(snapshot);
      // A delayed creation may populate its project, but must not undo later navigation.
      if (navigationRevision.current === navigation) {
        selectForWorkspace(targetWorkspaceId, snapshot.id);
        selectWorkspace(targetWorkspaceId);
      } else if (!selectionsRef.current[targetWorkspaceId]) selectForWorkspace(targetWorkspaceId, snapshot.id);
      const key = `workspace:${targetWorkspaceId}`;
      movedDrafts.current.set(key, snapshot.id);
      moveAttachments(key, snapshot.id); moveSelections(key, snapshot.id);
      if (draftsRef.current[key]) { draft(snapshot.id, draftsRef.current[key]); draft(key, ''); }
      setErrors(previous => ({ ...previous, [key]: '' }));
      return snapshot.id;
    } catch (error) { setErrors(previous => ({ ...previous, [`workspace:${targetWorkspaceId}`]: reason(error) })); return null; }
    finally { creatingRef.current = null; setCreating(false); }
  }, [workspaceId, api, put, selectForWorkspace, moveAttachments, moveSelections, selectWorkspace, draft]);

  const send = useCallback(async () => {
    const text = (draftsRef.current[draftKey] || '').trim();
    const files = attachments.current(draftKey);
    const picks = composerSelections.current(draftKey);
    if (!text || files.some(file => file.status !== 'ready') || !info?.configured || !info.contextReady) return;
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
    consumeAttachments(id, files); consumeSelections(id, picks);
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
      if (event.type === 'interaction.updated') {
        if (event.interaction.sessionId !== id || event.interaction.requestId !== event.requestId) return;
        applyInteraction(event.interaction); return;
      }
      if (event.type === 'text.delta') {
        const last = messages.at(-1);
        if (last?.role === 'assistant') messages = [...messages.slice(0, -1), { ...last, text: last.text + event.delta }];
        else messages = [...messages, { id: `stream-assistant-${assistantNumber++}`, role: 'assistant', requestId: event.requestId, text: event.delta }];
      }
      if (event.type === 'tool.started') messages = [...messages, { id: event.toolCallId, toolCallId: event.toolCallId, role: 'tool', requestId: event.requestId, toolName: event.toolName, text: '' }];
      if (event.type === 'tool.completed') messages = messages.map(message => message.id === event.toolCallId ? { ...message, text: event.text, isError: event.isError } : message);
      let fileOutputs = current.fileOutputs;
      if (event.type === 'files.output') {
        if (event.file.workspaceId !== current.workspaceId || event.file.sessionId !== id || event.file.requestId !== event.requestId) return;
        fileOutputs = [...(fileOutputs || []).filter(file => file.downloadId !== event.file.downloadId), event.file];
      }
      let subagents = current.subagents;
      if (event.type === 'subagent.updated') {
        const child = event.subagent;
        if (child.parentRequestId !== event.requestId) return;
        const previous = subagents?.find(item => item.subagentId === child.subagentId);
        if (previous && (previous.parentRequestId !== child.parentRequestId || previous.toolCallId !== child.toolCallId || !['running', 'stopping'].includes(previous.status))) return;
        subagents = [...(subagents || []).filter(item => item.subagentId !== child.subagentId), child];
      }
      const phase = event.type === 'subagent.updated' ? ['running', 'stopping'].includes(event.subagent.status) ? 'subagent' : 'preparing' : event.type === 'context.compaction_started'  ? 'compacting' : event.type === 'context.compaction_completed' ? 'generating' : ['response.started', 'resources.loaded', 'tool.completed'].includes(event.type) ? 'preparing' : event.type === 'tool.started' ? 'tool'
        : event.type === 'text.delta' ? 'generating' : current.active?.phase;
      put({ ...current, messages, ...(fileOutputs ? { fileOutputs } : {}), ...(subagents ? { subagents } : {}), ...(event.type === 'context.compaction_completed' ? { latestCompaction: event.compaction } : {}), active: { requestId: event.requestId, status: current.active?.status === 'stopping' ? 'stopping' : 'responding', phase,
        ...(phase === 'tool' ? { toolName: event.type === 'tool.started' ? event.toolName : current.active?.toolName } : {}) } });
    };
    try {
      await sendMessage(id, text, receive, { ...selectionInput(picks), ...(files.length ? { uploadIds: files.filter(file => file.uploadId).map(file => file.uploadId!), fileRefs: files.filter(file => !file.uploadId).map(file => ({ path: file.path! })) } : {}) });
      if (!stream.terminal) setErrors(previous => ({ ...previous, [id]: '连接已断开，正在查询会话状态；消息不会重复发送。' }));
    } catch (error) {
      setErrors(previous => ({ ...previous, [id]: reason(error) }));
      // After admission, a reload/disconnection can interrupt the stream while the
      // server still owns this request. Only its terminal snapshot may restore it.
      if (!stream.requestId) recover(id);
    }
    finally {
      if (streams.current.get(id)?.token === token) streams.current.delete(id);
      await refresh(id);
    }
  }, [draftKey, attachments, composerSelections, consumeSelections, info?.configured, info?.contextReady, selected, create, rememberSubmitted, consumeAttachments, draft, put, applyInteraction, sendMessage, recover, refresh]);

  const cancel = useCallback(async () => {
    const current = snapshotsRef.current[selected];
    if (!current?.active || current.active.status === 'stopping') return;
    const requestId = current.active.requestId;
    put({ ...current, active: { ...current.active, status: 'stopping' } });
    try {
      const result = await api<SessionSnapshot>(`/api/sessions/${encodeURIComponent(selected)}/cancel`, { requestId });
      const latest = snapshotsRef.current[selected];
      if (latest?.active?.requestId === requestId) put({ ...result, messages: latest.messages });
    } catch (error) {
      setErrors(previous => ({ ...previous, [selected]: reason(error) }));
      const latest = snapshotsRef.current[selected];
      if (latest?.active?.requestId === requestId) put({ ...latest, active: { ...latest.active, status: 'responding' } });
    }
  }, [api, put, selected]);

  return { info, refreshInfo, sessions: sessions.filter(item => item.workspaceId === workspaceId), snapshots, selected,
    activities, activityError, refreshActivity, markRead, noteNavigation, adopt: put,
    unread: Object.fromEntries(activities.map(item => [item.id, Boolean(!item.active && item.lastResult?.status === 'succeeded' && readResults[item.id] !== item.lastResult.requestId)])),
    select: (id: string) => {
      const owner = activitiesRef.current.find(item => item.id === id)?.workspaceId;
      if (owner) { selectForWorkspace(owner, id); selectWorkspace(owner); }
    }, workspaces, workspaceId,
    workspace: workspaces.find(item => item.id === workspaceId), selectWorkspace, createWorkspace,
    loading, creating, create, send, cancel, draftKey, attachments, composerSelections,
    resolveDraftOwner: () => movedDrafts.current.get(draftKey) || draftKey,
    setComposerSelection: (kind: 'skill' | 'agent', value?: Parameters<typeof composerSelections.set>[2]) => composerSelections.set(movedDrafts.current.get(draftKey) || draftKey, kind, value),
    interactionSubmissions, respondInteraction, queryInteraction,
    draft: drafts[draftKey] || '',
    // An input event from the previous render can arrive after first-session creation moved its draft.
    setDraft: (text: string) => draft(movedDrafts.current.get(draftKey) || draftKey, text),
    recoverableSelectionDiffers: JSON.stringify(selectionInput(composerSelections.recovery[selected] || {})) !== JSON.stringify(selectionInput(composerSelections.all[draftKey] || {})),
    submitted: submitted[selected] || '', restoreSubmitted: () => { draft(draftKey, submittedRef.current[selected] || ''); composerSelections.restore(draftKey); },
    instructionChanges: snapshots[selected]?.lastResult?.instructionChanges || instructionChanges[selected] || [],
    pending: pending[selected] || false, error: errors[selected] || readErrors[selected] || errors[`workspace:${workspaceId}`] || errors[''] || '', refresh, bootstrap };
}
