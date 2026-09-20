import { useCallback, useRef, useState } from 'react';
import type { AgentInfo, ComposerSelection, SkillInfo } from '../contracts/index';
import { useApi } from './api';

export interface DraftSelection { skill?: SkillInfo; agent?: AgentInfo }
type SelectionMap = Record<string, DraftSelection>;
function load(key: string): SelectionMap {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item && typeof item === 'object').map(([id, item]) => {
      const { skill, agent } = item as DraftSelection;
      return [id, {
        ...(skill && ['id', 'name', 'description', 'version', 'hash'].every(key => typeof skill[key as keyof SkillInfo] === 'string') ? { skill } : {}),
        ...(agent && ['name', 'description', 'hash'].every(key => typeof agent[key as keyof AgentInfo] === 'string') ? { agent } : {}),
      }];
    }));
  } catch { return {}; }
}
function save(key: string, value: SelectionMap) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep in-memory editing usable. */ } }
export function selectionInput(value: DraftSelection): ComposerSelection {
  return { ...(value.skill ? { skill: { id: value.skill.id, hash: value.skill.hash } } : {}), ...(value.agent ? { agent: { name: value.agent.name, hash: value.agent.hash } } : {}) };
}
export function useComposerSelections() {
  const { storageKey } = useApi();
  const key = storageKey('axon.composer-selections');
  const sentKey = storageKey('axon.submitted-selections');
  const recoveryKey = storageKey('axon.recoverable-selections');
  const [all, setAll] = useState(() => load(key));
  const current = useRef(all);
  const submitted = useRef(load(sentKey));
  const [recovery, setRecovery] = useState(() => load(recoveryKey));
  const recoverable = useRef(recovery);
  const update = useCallback((fn: (value: SelectionMap) => SelectionMap) => {
    current.current = fn(current.current); setAll(current.current); save(key, current.current);
  }, [key, setAll]);
  const set = useCallback((owner: string, kind: 'skill' | 'agent', value?: SkillInfo | AgentInfo) => {
    update(old => ({ ...old, [owner]: { ...old[owner], [kind]: value } }));
  }, [update]);
  const move = useCallback((from: string, to: string) => update(old => ({ ...old, [to]: { ...old[from], ...old[to] }, [from]: {} })), [update]);
  const clearSubmitted = useCallback((owner: string) => {
    submitted.current = { ...submitted.current, [owner]: {} }; save(sentKey, submitted.current);
    recoverable.current = { ...recoverable.current, [owner]: {} }; save(recoveryKey, recoverable.current); setRecovery(recoverable.current);
  }, [sentKey, recoveryKey, setRecovery]);
  const consume = useCallback((owner: string, value: DraftSelection) => {
    submitted.current = { ...submitted.current, [owner]: value }; save(sentKey, submitted.current);
    recoverable.current = { ...recoverable.current, [owner]: {} }; save(recoveryKey, recoverable.current); setRecovery(recoverable.current);
    update(old => ({ ...old, [owner]: {
      ...(old[owner]?.skill !== value.skill ? { skill: old[owner]?.skill } : {}),
      ...(old[owner]?.agent !== value.agent ? { agent: old[owner]?.agent } : {}),
    } }));
  }, [sentKey, recoveryKey, update, setRecovery]);
  const recover = useCallback((owner: string, allowAutomatic: boolean) => {
    const value = submitted.current[owner];
    if (!value?.skill && !value?.agent) return;
    // Restore automatically only into empty slots; keep the original choice for
    // the existing explicit recovery action when a newer draft already exists.
    recoverable.current = { ...recoverable.current, [owner]: value }; save(recoveryKey, recoverable.current); setRecovery(recoverable.current);
    if (allowAutomatic) update(old => ({ ...old, [owner]: old[owner]?.skill || old[owner]?.agent ? old[owner] : { ...value, ...old[owner] } }));
    submitted.current = { ...submitted.current, [owner]: {} }; save(sentKey, submitted.current);
  }, [recoveryKey, sentKey, update, setRecovery]);
  const restore = useCallback((owner: string) => {
    const recovered = recoverable.current[owner];
    update(old => ({ ...old, [owner]: recovered?.skill || recovered?.agent ? recovered : submitted.current[owner] || {} }));
  }, [update]);
  return { all, recovery, set, move, consume, recover, restore, clearSubmitted, current: (owner: string) => current.current[owner] || {} };
}
