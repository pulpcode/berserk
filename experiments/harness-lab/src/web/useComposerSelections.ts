import type { AuthoringIntent } from '../contracts/authoring';
import { useCallback, useRef, useState } from 'react';
import type { AgentInfo, ComposerSelection, SkillInfo } from '../contracts/index';
import { useApi } from './api';
import type { AnnotationSelection } from '../contracts/annotations';
import { isAnnotationSelection } from './annotations/helpers';
import type { ContextRef } from '../contracts/context';
import type { ConnectorReference } from '../contracts/connectors';
import { isRef, refKey } from './situation/evidence';

export interface DraftSelection { connectorRefs?: ConnectorReference[]; authoring?: AuthoringIntent; skill?: SkillInfo; agent?: AgentInfo; contextRefs?: ContextRef[]; annotationRefs?: AnnotationSelection[] }
type SelectionMap = Record<string, DraftSelection>;
function cleanConnectorRefs(refs: unknown[]): ConnectorReference[] {
  const validId = (id: unknown) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(id);
  const selected = new Map<string, ConnectorReference>();
  for (const ref of refs) {
    if (!ref || typeof ref !== 'object') continue;
    const { connectorId, revisionId, name } = ref as ConnectorReference;
    if (!validId(connectorId) || !validId(revisionId) || typeof name !== 'string' || !name.length || name.length > 128) continue;
    if (!selected.has(connectorId)) selected.set(connectorId, { connectorId, revisionId, name });
    if (selected.size === 8) break;
  }
  return [...selected.values()];
}

function hasSelections(value?: DraftSelection): boolean {
  return Boolean(value?.connectorRefs?.length || value?.authoring || value?.skill || value?.agent || value?.contextRefs?.length || value?.annotationRefs?.length);
}
function load(key: string): SelectionMap {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item && typeof item === 'object').map(([id, item]) => {
      const { skill, agent, contextRefs, annotationRefs, authoring, connectorRefs } = item as DraftSelection;
      return [id, {
        // Legacy connectorIds were session preferences and do not opt in the next draft.
        ...(Array.isArray(connectorRefs) ? { connectorRefs: cleanConnectorRefs(connectorRefs) } : {}),
        ...(authoring && ['expert', 'skill'].includes(authoring.kind) && (authoring.targetId === undefined || typeof authoring.targetId === 'string') ? { authoring } : {}),
        ...(Array.isArray(annotationRefs) ? {annotationRefs:annotationRefs.filter(isAnnotationSelection).slice(0,20)} : {}),
        ...(Array.isArray(contextRefs) ? {contextRefs: contextRefs.filter(isRef).slice(0,20)} : {}),
        ...(skill && ['id', 'name', 'description', 'version', 'hash'].every(key => typeof skill[key as keyof SkillInfo] === 'string') ? { skill } : {}),
        ...(agent && ['name', 'description', 'hash'].every(key => typeof agent[key as keyof AgentInfo] === 'string') ? { agent } : {}),
      }];
    }));
  } catch { return {}; }
}
function save(key: string, value: SelectionMap) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep in-memory editing usable. */ } }
export function selectionInput(value: DraftSelection): ComposerSelection {
  return { ...(value.connectorRefs?.length ? { connectorIds: value.connectorRefs.map(ref => ref.connectorId) } : {}), ...(value.authoring?.targetId && value.skill?.id === (value.authoring.kind === 'expert' ? 'expert-manager' : 'skill-creator') ? { authoring: value.authoring } : {}), ...(value.annotationRefs?.length ? {annotationRefs:value.annotationRefs} : {}), ...(value.contextRefs?.length ? {contextRefs:value.contextRefs} : {}), ...(value.skill ? { skill: { id: value.skill.id, hash: value.skill.hash, ...(value.skill.revisionId ? { revisionId: value.skill.revisionId, packageDigest: value.skill.packageDigest } : {}) } } : {}), ...(value.agent ? { agent: { name: value.agent.name, hash: value.agent.hash } } : {}) };
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
    update(old => ({ ...old, [owner]: { ...old[owner], [kind]: value, ...(kind === 'skill' ? { authoring: undefined } : {}) } }));
  }, [update]);
  const setAuthoring = useCallback((owner: string, authoring?: AuthoringIntent) => update(old => ({ ...old, [owner]: { ...old[owner], authoring } })), [update]);
  const setContextRefs = useCallback((owner: string, refs: ContextRef[]) => update(old => ({...old,[owner]:{...old[owner],contextRefs:[...new Map(refs.map(ref=>[refKey(ref),ref])).values()].slice(0,20)}})),[update]);
  const setAnnotationRefs = useCallback((owner:string,refs:AnnotationSelection[])=>update(old=>({...old,[owner]:{...old[owner],annotationRefs:[...new Map(refs.map(ref=>[JSON.stringify(ref),ref])).values()]}})),[update]);
  const setConnectorRefs = useCallback((owner: string, refs: ConnectorReference[]) => update(old => ({ ...old, [owner]: { ...old[owner], connectorRefs: refs.length ? cleanConnectorRefs(refs) : undefined } })), [update]);
  const move = useCallback((from: string, to: string) => update(old => ({ ...old, [to]: { ...old[from], ...old[to] }, [from]: {} })), [update]);
  const clearSubmitted = useCallback((owner: string) => {
    submitted.current = { ...submitted.current, [owner]: {} }; save(sentKey, submitted.current);
    recoverable.current = { ...recoverable.current, [owner]: {} }; save(recoveryKey, recoverable.current); setRecovery(recoverable.current);
  }, [sentKey, recoveryKey, setRecovery]);
  const consume = useCallback((owner: string, value: DraftSelection) => {
    submitted.current = { ...submitted.current, [owner]: value }; save(sentKey, submitted.current);
    recoverable.current = { ...recoverable.current, [owner]: {} }; save(recoveryKey, recoverable.current); setRecovery(recoverable.current);
    update(old => ({ ...old, [owner]: {
      ...(old[owner]?.connectorRefs !== value.connectorRefs ? { connectorRefs: old[owner]?.connectorRefs } : {}),
      ...(old[owner]?.authoring !== value.authoring ? {authoring: old[owner]?.authoring} : {}),
      ...(old[owner]?.annotationRefs !== value.annotationRefs ? {annotationRefs:old[owner]?.annotationRefs} : {}),
      ...(old[owner]?.contextRefs !== value.contextRefs ? {contextRefs:old[owner]?.contextRefs} : {}),
      ...(old[owner]?.skill !== value.skill ? { skill: old[owner]?.skill } : {}),
      ...(old[owner]?.agent !== value.agent ? { agent: old[owner]?.agent } : {}),
    } }));
  }, [sentKey, recoveryKey, update, setRecovery]);
  const recover = useCallback((owner: string, allowAutomatic: boolean) => {
    const value = submitted.current[owner];
    if (!hasSelections(value)) return;
    // Restore automatically only into empty slots; keep the original choice for
    // the existing explicit recovery action when a newer draft already exists.
    recoverable.current = { ...recoverable.current, [owner]: value }; save(recoveryKey, recoverable.current); setRecovery(recoverable.current);
    if (allowAutomatic) update(old => ({ ...old, [owner]: hasSelections(old[owner]) ? old[owner] : { ...value } }));
    submitted.current = { ...submitted.current, [owner]: {} }; save(sentKey, submitted.current);
  }, [recoveryKey, sentKey, update, setRecovery]);
  const restore = useCallback((owner: string) => {
    const recovered = recoverable.current[owner];
    update(old => ({ ...old, [owner]: { ...(hasSelections(recovered) ? recovered : submitted.current[owner]) } }));
  }, [update]);
  return { all, recovery, set, setAuthoring, setContextRefs, setAnnotationRefs, setConnectorRefs, move, consume, recover, restore, clearSubmitted, current: (owner: string) => current.current[owner] || {} };
}
