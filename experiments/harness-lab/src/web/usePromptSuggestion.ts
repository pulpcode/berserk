import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { SessionSnapshot } from '../contracts/index';
import { isPromptSuggestionResponse } from '../contracts/prompt-suggestions';
import { ApiFailure, checkResponse, useApi } from './api';
import { matchesPromptSuggestion, promptSuggestionSource } from './prompt-suggestion';

export function usePromptSuggestionPreference() {
  const { storageKey } = useApi();
  const key = storageKey('berserk.prompt-suggestions');
  const [enabled, setEnabled] = useState(() => {
    try { return sessionStorage.getItem(key) !== 'off'; } catch { return true; }
  });
  const change = useCallback((value: boolean) => {
    setEnabled(value);
    try { sessionStorage.setItem(key, value ? 'on' : 'off'); } catch { /* Keep the in-memory preference usable. */ }
  }, [key]);
  return { enabled, change };
}

interface SuggestionInput {
  sessionId: string; modelId: string; snapshot?: SessionSnapshot;
  completed?: { sessionId: string; requestId: string };
  identityActive: boolean; active: boolean; ready: boolean; blocked: boolean; enabled: boolean; invalidated: boolean;
  draft: string; setDraft: (text: string) => void; textarea: RefObject<HTMLTextAreaElement | null>;
}

interface CachedSuggestion {
  owner: string; sessionId: string; sourceRequestId: string; finalMessageId: string; text: string;
}

export function usePromptSuggestion(input: SuggestionInput) {
  const { request, url, storageKey } = useApi();
  const owner = storageKey('berserk.prompt-suggestion-cache');
  const latest = useRef(input);
  useLayoutEffect(() => { latest.current = input; });
  // This hook lives in BusinessApp, above its conversation and business views.
  const cache = useRef(new Map<string, CachedSuggestion>());
  const previousOwner = useRef(owner);
  const previousScope = useRef(`${input.sessionId}:${input.modelId}`);
  const previousView = useRef({ sessionId: input.sessionId, active: input.active });
  const observedCompletion = useRef(input.completed);
  const pending = useRef<AbortController | undefined>(undefined);
  const restoring = useRef<AbortController | undefined>(undefined);
  const candidateRef = useRef<CachedSuggestion | undefined>(undefined);
  const [candidate, setCandidate] = useState<CachedSuggestion>();
  const [composing, setComposing] = useState(false);
  const composingRef = useRef(false);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const [announcement, setAnnouncement] = useState('');
  const source = useMemo(() => promptSuggestionSource(input.snapshot, input.modelId), [input.snapshot, input.modelId]);

  const cancelPending = useCallback(() => {
    const controller = pending.current; pending.current = undefined;
    controller?.abort();
  }, []);
  const cancelRestore = useCallback(() => {
    restoring.current?.abort(); restoring.current = undefined;
  }, []);
  const hideCurrent = useCallback(() => {
    candidateRef.current = undefined; setCandidate(undefined); setAnnouncement('');
  }, []);
  const dismiss = useCallback(() => {
    cancelPending(); cancelRestore(); cache.current.delete(latest.current.sessionId); hideCurrent();
  }, [cancelPending, cancelRestore, hideCurrent]);

  useEffect(() => {
    const entries = cache.current;
    const change = () => { if (document.visibilityState !== 'visible') cancelPending(); setVisible(document.visibilityState === 'visible'); };
    document.addEventListener('visibilitychange', change);
    return () => { document.removeEventListener('visibilitychange', change); cancelPending(); cancelRestore(); entries.clear(); };
  }, [cancelPending, cancelRestore]);

  useLayoutEffect(() => {
    const scope = `${input.sessionId}:${input.modelId}`;
    const viewChanged = previousView.current.sessionId !== input.sessionId || previousView.current.active !== input.active;
    const ownerChanged = previousOwner.current !== owner;
    if (ownerChanged || !input.identityActive || !input.enabled) {
      cancelPending(); cancelRestore(); cache.current.clear(); hideCurrent();
    }
    previousOwner.current = owner;
    if (previousScope.current !== scope || viewChanged) cancelPending();
    if (previousView.current.sessionId !== input.sessionId) { composingRef.current = false; setComposing(false); }
    previousScope.current = scope;
    previousView.current = { sessionId: input.sessionId, active: input.active };
    if (viewChanged) { cancelRestore(); hideCurrent(); }

    const entry = cache.current.get(input.sessionId);
    if (input.invalidated || (entry && input.snapshot && !matchesPromptSuggestion(input.snapshot, entry))) dismiss();

    if (viewChanged && input.active && input.identityActive && input.enabled && !input.invalidated) {
      const cached = cache.current.get(input.sessionId);
      if (cached) {
        // Reuse the authorized GET; navigation restores text, never a model request.
        const controller = new AbortController(); restoring.current = controller;
        void request(url(`/api/sessions/${encodeURIComponent(input.sessionId)}`), { cache: 'no-store', signal: controller.signal })
          .then(checkResponse).then(response => response.json() as Promise<SessionSnapshot>).then(snapshot => {
            const current = latest.current;
            if (restoring.current !== controller || controller.signal.aborted || previousOwner.current !== owner
              || !current.identityActive || !current.active || !current.enabled || current.sessionId !== cached.sessionId
              || cache.current.get(cached.sessionId) !== cached) return;
            if (snapshot.id !== cached.sessionId || !matchesPromptSuggestion(snapshot, cached)) { dismiss(); return; }
            candidateRef.current = cached; setCandidate(cached);
          }).catch(error => {
            if (restoring.current === controller && error instanceof ApiFailure && [401, 403, 404].includes(error.status)) dismiss();
          }).finally(() => { if (restoring.current === controller) restoring.current = undefined; });
      }
    }

    if (input.draft.length || composing || input.blocked || !visible || !input.ready || !input.active) cancelPending();
    // Only a newly observed foreground terminal notification can generate. History/focus/clearing never does.
    if (observedCompletion.current === input.completed) return;
    observedCompletion.current = input.completed;
    if (!source || !input.completed || input.completed.sessionId !== input.sessionId || input.completed.requestId !== source.sourceRequestId
      || !input.identityActive || !input.active || !visible || !input.ready || input.blocked || !input.enabled || input.draft.length || composing
      || document.querySelector('dialog[open]')) return;
    cancelPending();
    const controller = new AbortController(); pending.current = controller;
    const sessionId = input.sessionId;
    void request(url(`/api/sessions/${encodeURIComponent(sessionId)}/prompt-suggestion`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(source), signal: controller.signal,
    }).then(checkResponse).then(response => response.json() as Promise<unknown>).then(value => {
      if (pending.current !== controller || controller.signal.aborted || previousOwner.current !== owner) return;
      pending.current = undefined;
      const current = latest.current, currentSource = promptSuggestionSource(current.snapshot, current.modelId);
      if (!isPromptSuggestionResponse(value) || !value.text || current.sessionId !== sessionId
        || currentSource?.sourceRequestId !== value.sourceRequestId || currentSource.finalMessageId !== value.finalMessageId
        || current.modelId !== value.modelId || current.draft.length || !current.enabled || !current.identityActive || !current.active || !current.ready
        || current.blocked || composingRef.current || document.visibilityState !== 'visible' || document.querySelector('dialog[open]')) return;
      const entry: CachedSuggestion = { owner, sessionId, sourceRequestId: value.sourceRequestId, finalMessageId: value.finalMessageId, text: value.text };
      cache.current.set(sessionId, entry); candidateRef.current = entry; setCandidate(entry); setAnnouncement('有下一步建议，可按 Tab 采纳。');
    }).catch(() => { if (pending.current === controller) pending.current = undefined; });
  }, [owner, input.identityActive, input.sessionId, input.modelId, input.completed, input.active, input.ready, input.blocked, input.enabled, input.invalidated,
    input.snapshot, input.draft, source, composing, visible, cancelPending, cancelRestore, hideCurrent, dismiss, request, url]);

  const text = candidate?.owner === owner && candidate.sessionId === input.sessionId && matchesPromptSuggestion(input.snapshot, candidate)
    && input.identityActive && input.active && visible && input.ready && !input.blocked && !input.invalidated
    && input.enabled && input.draft.length === 0 && !composing ? candidate.text : undefined;

  const accept = () => {
    const current = latest.current, value = candidateRef.current;
    if (!value?.text || value.owner !== owner || current.sessionId !== value.sessionId || cache.current.get(value.sessionId) !== value
      || !matchesPromptSuggestion(current.snapshot, value) || !current.enabled || !current.identityActive || !current.active || !current.ready
      || current.blocked || current.invalidated || current.draft.length || current.textarea.current?.value !== '' || composingRef.current
      || document.visibilityState !== 'visible' || document.querySelector('dialog[open]')) return false;
    current.setDraft(value.text);
    requestAnimationFrame(() => {
      if (previousOwner.current !== owner || !latest.current.identityActive || !latest.current.active || latest.current.sessionId !== current.sessionId) return;
      const editor = current.textarea.current;
      editor?.focus(); editor?.setSelectionRange(editor.value.length, editor.value.length);
    });
    return true;
  };
  return { text, announcement, accept, dismiss, edit: cancelPending,
    startComposition: () => { composingRef.current = true; cancelPending(); setComposing(true); },
    endComposition: () => { composingRef.current = false; setComposing(false); },
  };
}
