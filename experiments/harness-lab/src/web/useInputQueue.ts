import { useCallback, useEffect, useRef, useState } from 'react';
import type { InputMode, InputReceipt, InputQueueState, InputResult, SessionSnapshot } from '../contracts/index';
import { randomUUID } from './random-uuid';
import { ApiFailure, useApi } from './api';

type Result = InputResult;
type Operation = { sessionId: string; submissionId: string; text: string; draftVersion?: string; kind: 'submit' | 'steer' | 'delete' | 'takeback' | 'undo' };
const message = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请查询最新状态。';
function read<T>(key: string, fallback: T): T { try { return JSON.parse(sessionStorage.getItem(key) || 'null') as T || fallback; } catch { return fallback; } }

/** UI acknowledgements only; Pi remains the owner of pending message scheduling. */
export function useInputQueue({ snapshots, apply, getDraft, getDraftVersion, setDraft }: {
  snapshots: Record<string, SessionSnapshot>; apply: (id: string, queue: InputQueueState) => void;
  getDraft: (id: string) => string; getDraftVersion: (id: string) => string; setDraft: (id: string, text: string) => void;
}) {
  const { api, storageKey } = useApi();
  const key = storageKey('berserk.input-operations');
  const restoredKey = storageKey('berserk.restored-inputs');
  const [operations, setOperations] = useState<Record<string, Operation>>(() => read(key, {}));
  const operationsRef = useRef(operations);
  const restored = useRef<Record<string, boolean>>(read(restoredKey, {}));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<Record<string, boolean>>({});
  const locks = useRef(new Set<string>());
  const acknowledgements = useRef(new Set<string>());
  const [deleted, setDeleted] = useState<Record<string, InputReceipt>>({});
  useEffect(() => {
    if (!Object.keys(deleted).length) return;
    const timer = window.setTimeout(() => setDeleted({}), 6000);
    return () => window.clearTimeout(timer);
  }, [deleted]);
  const latest = useRef(snapshots); latest.current = snapshots;
  const remember = useCallback((id: string, operation?: Operation) => {
    const next = { ...operationsRef.current }; if (operation) next[id] = operation; else delete next[id];
    operationsRef.current = next; setOperations(next);
    try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* Memory still prevents automatic replay. */ }
  }, [key]);
  const restore = useCallback((id: string, receipt: InputReceipt) => {
    if (restored.current[receipt.submissionId]) return;
    const text = getDraft(id);
    setDraft(id, text ? `${text}\n\n${receipt.text}` : receipt.text);
    restored.current[receipt.submissionId] = true;
    try { sessionStorage.setItem(restoredKey, JSON.stringify(restored.current)); } catch { /* Keep in memory. */ }
  }, [getDraft, setDraft, restoredKey]);
  const resolve = useCallback((op: Operation, result: Result) => {
    apply(op.sessionId, result.queue);
    if (!result.receipt) { setErrors(old => ({ ...old, [op.sessionId]: '未查到接收记录，结果仍不确定。草稿已保留，请核对对话后再决定是否重新发送。' })); return; }
    const receipt = result.receipt;
    if (op.kind === 'submit' && op.draftVersion === getDraftVersion(op.sessionId) && getDraft(op.sessionId).trim() === op.text) setDraft(op.sessionId, '');
    if (op.kind === 'takeback' && receipt.status === 'takenBack') restore(op.sessionId, receipt);
    if (receipt.status === 'returned') restore(op.sessionId, receipt);
    if (receipt.status === 'deleted') setDeleted(old => ({ ...old, [op.sessionId]: receipt }));
    else setDeleted(old => { const next = { ...old }; delete next[op.sessionId]; return next; });
    remember(op.sessionId);
    setErrors(old => ({ ...old, [op.sessionId]: '' }));
  }, [apply, getDraft, getDraftVersion, remember, restore, setDraft]);
  const run = useCallback(async (op: Operation, path: string, body?: object) => {
    const id = op.sessionId;
    if (locks.current.has(id)) return;
    locks.current.add(id); setWorking(old => ({ ...old, [id]: true }));
    if (body) remember(id, op);
    setErrors(old => ({ ...old, [id]: '' }));
    try { resolve(op, await api<Result>(path, body)); }
    catch (error) {
      const rejected = error instanceof ApiFailure && error.status >= 400 && error.status < 500;
      if (rejected && body) remember(id);
      setErrors(old => ({ ...old, [id]: `${rejected ? '' : '结果需核对；不会自动重发。'}${message(error)}` }));
    } finally { locks.current.delete(id); setWorking(old => ({ ...old, [id]: false })); }
  }, [api, remember, resolve]);
  const submit = useCallback((id: string, mode: InputMode) => {
    const queue = latest.current[id]?.inputQueue;
    const text = getDraft(id).trim();
    if (!text || !queue?.available || !queue.requestId || operationsRef.current[id] || locks.current.has(id)) return;
    const submissionId = randomUUID();
    return run({ sessionId: id, submissionId, text, draftVersion: getDraftVersion(id), kind: 'submit' }, `/api/sessions/${encodeURIComponent(id)}/inputs`, { submissionId, expectedRequestId: queue.requestId, mode, text });
  }, [getDraft, getDraftVersion, run]);
  const act = useCallback((id: string, receipt: InputReceipt, action: 'steer' | 'delete' | 'takeback' | 'undo') => {
    const queue = latest.current[id]?.inputQueue;
    if (!queue || operationsRef.current[id] || locks.current.has(id)) return;
    return run({ sessionId: id, submissionId: receipt.submissionId, text: receipt.text, kind: action }, `/api/sessions/${encodeURIComponent(id)}/inputs/${encodeURIComponent(receipt.submissionId)}/actions`, {
      actionId: randomUUID(), expectedRequestId: receipt.requestId, pendingRevision: queue.revision, action,
    });
  }, [run]);
  const query = useCallback((id: string) => {
    const op = operationsRef.current[id];
    if (op) return run(op, `/api/sessions/${encodeURIComponent(id)}/inputs/${encodeURIComponent(op.submissionId)}`);
  }, [run]);
  // Terminal snapshots restore only messages Pi never emitted. Never replace a newer draft.
  useEffect(() => {
    for (const snapshot of Object.values(snapshots)) {
      for (const item of snapshot.inputQueue?.items || []) if (item.status === 'returned') {
        // An uncertain submission must resolve before clearing its preserved original draft.
        if (operationsRef.current[snapshot.id]?.submissionId === item.submissionId) continue;
        restore(snapshot.id, item);
        if (acknowledgements.current.has(item.submissionId)) continue;
        acknowledgements.current.add(item.submissionId);
        // Taking back a returned item only acknowledges recovery; it cannot alter native execution.
        void api<Result>(`/api/sessions/${encodeURIComponent(snapshot.id)}/inputs/${encodeURIComponent(item.submissionId)}/actions`, {
          actionId: randomUUID(), expectedRequestId: item.requestId, pendingRevision: snapshot.inputQueue!.revision, action: 'takeback',
        }).then(result => apply(snapshot.id, result.queue)).catch(() => { /* A later reload may acknowledge again; the draft is already recovered. */ });
      }
    }
  }, [snapshots, restore, api, apply]);
  return { submit, act, query, errors, working, operations, deleted,
    dismiss: (id: string) => { remember(id); setErrors(old => ({ ...old, [id]: '' })); } };
}
