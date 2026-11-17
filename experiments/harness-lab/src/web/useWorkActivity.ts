import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SessionActivity } from '../contracts';
import { isWorkActivityResponse, isWorkActivityView, type WorkActivityResponse, type WorkActivityView } from '../contracts/work-activity';
import { ApiFailure, checkResponse, useApi } from './api';

export function useWorkActivityPreference() {
  const { storageKey } = useApi();
  const key = storageKey('berserk.work-activity');
  const [enabled, setEnabled] = useState(() => {
    try { return sessionStorage.getItem(key) !== 'off'; } catch { return true; }
  });
  const change = useCallback((value: boolean) => {
    setEnabled(value);
    try { sessionStorage.setItem(key, value ? 'on' : 'off'); } catch { /* Preference stays in memory. */ }
  }, [key]);
  return { enabled, change };
}

interface Input {
  sessionId: string; modelId: string; identityActive: boolean; visible: boolean; enabled: boolean;
  activities: SessionActivity[];
}
interface Entry {
  view?: WorkActivityView; response?: WorkActivityResponse; attempted?: string;
  ignored: Set<string>; pending?: AbortController; error?: string; runKey?: string;
}
interface Projection {
  owner: string; sessionId: string; view?: WorkActivityView; response?: WorkActivityResponse;
  ignored: Set<string>; analyzing: boolean; error?: string;
}
const denied = (error: unknown) => error instanceof ApiFailure && [401, 403, 404].includes(error.status);
const errorText = (error: unknown) => error instanceof Error ? error.message : '工作识别暂时不可用。';
const runningKey = (activity?: SessionActivity) => activity?.active ? `request:${activity.active.requestId}` : activity?.backgroundJob ? `background:${activity.backgroundJob.id}` : undefined;
const activityKeyOf = (activity?: SessionActivity) => `${activity?.active?.requestId || ''}:${activity?.lastResult?.requestId || ''}:${activity?.lastResult?.status || ''}:${activity?.backgroundJob?.id || ''}:${activity?.backgroundJob?.status || ''}`;

/** Mounted above navigation: only the selected view is rendered, each session owns its in-flight analysis. */
export function useWorkActivity(input: Input) {
  const { request, url, storageKey } = useApi();
  const owner = storageKey('berserk.work-activity-cache');
  const latest = useRef(input);
  useLayoutEffect(() => { latest.current = input; });
  const cache = useRef(new Map<string, Entry>());
  const identity = useRef(owner);
  const epoch = useRef(0);
  const validated = useRef<{ owner: string; sessionId: string; version: string } | undefined>(undefined);
  const [projection, setProjection] = useState<Projection>();
  const [revision, setRevision] = useState(0);
  const scope = `${owner}:${input.sessionId}:${input.visible}:${input.identityActive}`;
  const [renderedScope, setRenderedScope] = useState(scope);
  if (renderedScope !== scope) { setRenderedScope(scope); setProjection(undefined); }
  const selected = input.activities.find(item => item.id === input.sessionId);
  const activityKey = activityKeyOf(selected);

  const publish = useCallback((sessionId: string, entry?: Entry, error?: string) => {
    const current = latest.current;
    if (identity.current === owner && current.identityActive && current.visible && current.sessionId === sessionId) {
      if (entry && (validated.current?.owner !== owner || validated.current.sessionId !== sessionId || validated.current.version !== entry.view?.version)) return;
      setProjection({ owner, sessionId, view: entry?.view, response: entry?.response,
        ignored: new Set(entry?.ignored), analyzing: Boolean(entry?.pending), error: error || entry?.error });
    }
  }, [owner]);
  const clear = useCallback(() => {
    epoch.current++;
    validated.current = undefined;
    for (const entry of cache.current.values()) entry.pending?.abort();
    cache.current.clear(); setProjection(undefined);
  }, []);

  useLayoutEffect(() => {
    if (identity.current !== owner || !input.identityActive) clear();
    identity.current = owner;
    for (const [id, entry] of cache.current) {
      const activity = input.activities.find(item => item.id === id);
      const runKey = runningKey(activity);
      // Invalidate on a new run, including a previous failed turn's receipts. Repeated updates preserve fresh facts.
      if ((runKey && entry.runKey !== runKey) || (entry.view?.source && activity?.lastResult
        && activity.lastResult.requestId !== entry.view.source.sourceRequestId)) {
        entry.pending?.abort();
        const empty: Entry = { ignored: new Set(), runKey }; cache.current.set(id, empty);
        if (id === input.sessionId) { validated.current = undefined; publish(id); }
      }
    }
  }, [owner, input.identityActive, input.activities, input.sessionId, clear, publish]);

  useEffect(() => {
    if (input.enabled) return;
    for (const [id, entry] of cache.current) {
      entry.pending?.abort();
      const facts: Entry = { view: entry.view, ignored: new Set(), runKey: entry.runKey }; cache.current.set(id, facts); publish(id, facts);
    }
  }, [input.enabled, publish]);
  useEffect(() => {
    const entries = cache.current;
    return () => { for (const entry of entries.values()) entry.pending?.abort(); entries.clear(); };
  }, []);

  const read = useCallback(async (sessionId: string, signal: AbortSignal) => {
    const value: unknown = await request(url(`/api/sessions/${encodeURIComponent(sessionId)}/work-activity-analysis`), { cache: 'no-store', signal })
      .then(checkResponse).then(response => response.json());
    if (!isWorkActivityView(value)) throw new Error('工作识别数据格式无效。');
    return value;
  }, [request, url]);

  const analyze = useCallback((sessionId: string, entry: Entry, view: WorkActivityView) => {
    if (!view.source || !view.canAnalyze || entry.pending || entry.attempted === view.version) return;
    const controller = new AbortController(), generation = epoch.current;
    entry.pending = controller; entry.attempted = view.version; entry.error = undefined;
    const valid = () => generation === epoch.current && identity.current === owner && latest.current.identityActive
      && latest.current.enabled && cache.current.get(sessionId) === entry && entry.pending === controller && !controller.signal.aborted;
    publish(sessionId, entry);
    void request(url(`/api/sessions/${encodeURIComponent(sessionId)}/work-activity-analysis`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ ...view.source, version: view.version }),
    }).then(checkResponse).then(response => response.json() as Promise<unknown>).then(value => {
      if (!valid()) return;
      if (!isWorkActivityResponse(value) || value.version !== view.version
        || value.source.sourceRequestId !== view.source!.sourceRequestId || value.source.finalMessageId !== view.source!.finalMessageId) {
        throw new Error('工作识别结果已失效，请重新识别。');
      }
      if (entry.view?.version !== view.version) return;
      entry.response = value; entry.error = value.status === 'unavailable' ? value.reason || '工作识别暂时不可用。' : undefined;
    }).catch(error => {
      if (!valid()) return;
      if (denied(error)) { cache.current.delete(sessionId); publish(sessionId, undefined, errorText(error)); }
      else entry.error = errorText(error);
    }).finally(() => {
      if (entry.pending !== controller) return;
      entry.pending = undefined;
      if (generation === epoch.current && cache.current.get(sessionId) === entry) publish(sessionId, entry);
    });
  }, [owner, request, url, publish]);

  // Navigation must first re-authorize the cached view. Typing and focus in the composer are irrelevant.
  useLayoutEffect(() => { validated.current = undefined; }, [owner, input.sessionId, input.visible, input.identityActive]);
  useEffect(() => {
    if (!input.identityActive || !input.visible || !input.sessionId) return;
    const sessionId = input.sessionId, generation = epoch.current, controller = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending || controller.signal.aborted || document.visibilityState === 'hidden') return;
      pending = true;
      const observedActivity = latest.current.activities.find(item => item.id === sessionId);
      const observedKey = activityKeyOf(observedActivity);
      const unchangedActivity = () => observedKey === activityKeyOf(latest.current.activities.find(item => item.id === sessionId));
      try {
        const view = await read(sessionId, controller.signal);
        if (controller.signal.aborted || generation !== epoch.current || identity.current !== owner || !unchangedActivity()) return;
        let entry = cache.current.get(sessionId);
        if (!entry) { entry = { ignored: new Set() }; cache.current.set(sessionId, entry); }
        if (entry.view?.version !== view.version) {
          entry.pending?.abort(); entry.pending = undefined; entry.response = undefined; entry.ignored.clear(); entry.error = undefined;
        }
        entry.view = view;
        entry.runKey = runningKey(observedActivity);
        validated.current = { owner, sessionId, version: view.version }; publish(sessionId, entry);
        if (latest.current.enabled && view.canAnalyze) analyze(sessionId, entry, view);
      } catch (error) {
        if (controller.signal.aborted || generation !== epoch.current || !unchangedActivity()) return;
        validated.current = undefined;
        if (denied(error)) { cache.current.get(sessionId)?.pending?.abort(); cache.current.delete(sessionId); }
        publish(sessionId, undefined, errorText(error));
      } finally { pending = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    const focus = () => { validated.current = undefined; setProjection(undefined); void load(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [owner, input.identityActive, input.visible, input.sessionId, input.enabled, input.modelId, activityKey, revision, read, analyze, publish]);

  const current = projection?.owner === owner && projection.sessionId === input.sessionId && input.identityActive ? projection : undefined;
  return {
    view: current?.view, response: current?.response, ignored: current?.ignored || new Set<string>(),
    loading: Boolean(input.sessionId && !current), analyzing: Boolean(current?.analyzing), error: current?.error || '',
    retry: () => { const existing = cache.current.get(input.sessionId); if (existing) { existing.attempted = undefined; existing.error = undefined; } setRevision(value => value + 1); },
    ignore: (id: string) => { const entry = cache.current.get(input.sessionId); if (entry) { entry.ignored.add(id); publish(input.sessionId, entry); } },
  };
}
