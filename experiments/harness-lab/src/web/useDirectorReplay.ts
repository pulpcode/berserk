import { useEffect, useRef, useState } from 'react';
import type { ScenarioDefinitionSummary, ScenarioInstanceDetail, ScenarioInstances, ScenarioMode, ScenarioMutationResult, ScenarioTaskInitialization, ScenarioPreflight } from '../contracts/scenarios';
import { ApiFailure, useApi } from './api';
import { randomUUID } from './random-uuid';

type ReplayStage = 'create' | 'initialize' | 'pause' | 'activate';
type ReplayRequest = {id: string; path: string; body: Record<string, string | number | boolean>};
interface ReplayDraft {
  definitionId: string;
  version: string;
  mode: ScenarioMode;
  previousId: string | null;
  targetId?: string;
  terminateUnsent: boolean;
  stage: ReplayStage;
  request?: ReplayRequest;
  rejected?: boolean;
}
const stageNames: Record<ReplayStage, string> = {create: '创建演示', initialize: '准备演示任务', pause: '锁定当前演示', activate: '核对原处理并启用演示'};
const instancePath = (id: string) => `/api/simulation/instances/${encodeURIComponent(id)}`;

function restore(key: string): ReplayDraft | undefined {
  try {
    const draft: ReplayDraft = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (!draft || !['create', 'initialize', 'pause', 'activate'].includes(draft.stage)
      || !['main_story', 'source_replay'].includes(draft.mode) || typeof draft.definitionId !== 'string'
      || typeof draft.version !== 'string' || typeof draft.terminateUnsent !== 'boolean'
      || !(draft.previousId === null || typeof draft.previousId === 'string')
      || (draft.targetId !== undefined && typeof draft.targetId !== 'string')) return;
    if (draft.request && (typeof draft.request.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(draft.request.id)
      || typeof draft.request.path !== 'string' || !/^\/api\/simulation\/instances(?:\/[a-zA-Z0-9_-]+\/(?:initialize|control|activate))?$/.test(draft.request.path)
      || !draft.request.body || draft.request.body.clientActionId !== draft.request.id)) return;
    return draft;
  } catch { return; }
}

/** A replay checkpoint is saved before each write. Reload only offers explicit continuation. */
export function useDirectorReplay({disabled, completed, changed, failure}: {
  disabled: boolean;
  completed: (instanceId: string) => void;
  changed: () => void;
  failure: (reason: unknown) => void;
}) {
  const {api, storageKey} = useApi();
  const key = storageKey('berserk.scenario-director.replay');
  const [draft, setDraft] = useState<ReplayDraft | undefined>(() => restore(key));
  const [busy, setBusy] = useState('');
  const current = useRef(draft);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function save(value?: ReplayDraft) {
    // Without a durable checkpoint an interrupted multi-system operation cannot be resumed safely.
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
    current.current = value;
    if (mounted.current) setDraft(value);
  }
  async function activeState(expectedId?: string | null) {
    const list = await api<ScenarioInstances>('/api/simulation/instances');
    if (expectedId !== undefined && list.activeInstanceId !== expectedId) throw new Error('当前演示已切换，请核对演示记录。');
    const active = list.activeInstanceId ? await api<ScenarioInstanceDetail>(instancePath(list.activeInstanceId)) : undefined;
    const preflight=list.activeInstanceId?await api<ScenarioPreflight>(`${instancePath(list.activeInstanceId)}/preflight`):undefined;
    if (preflight?.unconfirmedNotifications) throw new Error('当前演示有接收未确认的通知，请先核对接收回执。');
    return {list, active, preflight};
  }
  function request(path: string, body: ReplayRequest['body']): ReplayRequest {
    const id = randomUUID();
    return {id, path, body: {...body, clientActionId: id}};
  }
  async function prepare(value: ReplayDraft): Promise<ReplayRequest | undefined> {
    if (value.stage === 'create') return request('/api/simulation/instances', {definitionId: value.definitionId, version: value.version, mode: value.mode});
    if (!value.targetId) throw new Error('演示准备记录缺少实例，请核对演示记录。');
    if (value.stage === 'initialize') return request(`${instancePath(value.targetId)}/initialize`, {});
    const {list, active, preflight} = await activeState(value.previousId);
    if (preflight?.unsentNotifications && !value.terminateUnsent) throw new Error('当前演示有未发送通知，请先确认处理方式。');
    if (value.stage === 'pause') {
      if (!active || active.instance.paused) return;
      return request(`${instancePath(active.instance.instanceId)}/control`, {action: 'pause', expectedRevision: active.instance.revision});
    }
    const target = await api<ScenarioInstanceDetail>(instancePath(value.targetId));
    if (target.instance.status !== 'prepared') throw new Error('待启用演示状态已变化，请核对演示记录。');
    if (active && !active.instance.paused) throw new Error('当前演示已恢复投放，请先核对再继续准备。');
    return request(`${instancePath(value.targetId)}/activate`, {expectedRevision: target.instance.revision, expectedActiveRevision: list.activeRevision, terminateUnsent: value.terminateUnsent});
  }
  async function recover(value: ReplayDraft, action: ReplayRequest) {
    if (value.stage === 'initialize') {
      const result = await api<ScenarioTaskInitialization>(action.path);
      return result.initialized ? result : undefined;
    }
    try { return await api<ScenarioMutationResult>(`/api/simulation/operations/${encodeURIComponent(action.id)}`); }
    catch (reason) {
      if (reason instanceof ApiFailure && reason.status === 404) return;
      throw reason;
    }
  }
  async function continueDraft(initial: ReplayDraft, checkReceipt: boolean) {
    let value = initial;
    try {
      while (mounted.current) {
        setBusy(stageNames[value.stage]);
        if (value.rejected) value = {...value, request: undefined, rejected: undefined};
        let action = value.request;
        let result: ScenarioMutationResult | ScenarioTaskInitialization | undefined;
        if (action && checkReceipt) result = await recover(value, action);
        if (!action) {
          action = await prepare(value);
          if (!mounted.current) return;
          if (!action) {
            value = {...value, stage: 'activate'};
            save(value);
            continue;
          }
          value = {...value, request: action};
          save(value);
        }
        if (!mounted.current) return;
        if (!result) result = await api<ScenarioMutationResult | ScenarioTaskInitialization>(action.path, action.body);
        if (value.stage === 'initialize') {
          if (!('initialized' in result) || !result.initialized || result.instanceId !== value.targetId) throw new Error('演示任务尚未准备齐全，请核对并继续。');
        } else {
          if (!('operation' in result) || result.operation.id !== action.id
            || result.operation.kind !== (value.stage === 'pause' ? 'pause' : value.stage)
            || (value.stage !== 'create' && result.instance.instanceId !== (value.stage === 'pause' ? value.previousId : value.targetId))) {
            throw new Error('演示操作回执与准备记录不符，请核对后继续。');
          }
        }
        if (value.stage === 'activate') {
          const id = value.targetId!;
          save();
          if (mounted.current) completed(id);
          return;
        }
        const targetId = value.stage === 'create' && 'instance' in result ? result.instance.instanceId : value.targetId;
        const next: ReplayStage = value.stage === 'create' ? 'initialize' : value.stage === 'initialize' ? 'pause' : 'activate';
        value = {...value, targetId, stage: next, request: undefined};
        save(value);
        checkReceipt = false;
      }
    } catch (reason) {
      if (reason instanceof ApiFailure && reason.status >= 400 && reason.status < 500
        && reason.code !== 'SCENARIO_ACTIVATION_PENDING' && ![401, 403].includes(reason.status)) {
        save({...value, rejected: true});
      }
      if (mounted.current) failure(reason);
    } finally {
      running.current = false;
      if (mounted.current) { setBusy(''); changed(); }
    }
  }
  async function start(definition: ScenarioDefinitionSummary, mode: ScenarioMode, terminateUnsent: boolean, existingId?: string) {
    if (disabled || running.current || current.current) return;
    running.current = true;
    setBusy('核对演示');
    try {
      const {list, active} = await activeState();
      if (active?.actions.some(action => action.sendState === 'unsent') && !terminateUnsent) throw new Error('请确认放弃当前演示未发送的通知。');
      if (!mounted.current) return;
      if (existingId) {
        const existing = await api<ScenarioInstanceDetail>(instancePath(existingId));
        if (existing.instance.status !== 'prepared' || existing.instance.definitionId !== definition.id
          || existing.instance.definitionVersion !== definition.version || existing.instance.mode !== mode) throw new Error('待准备演示已变化，请重新查看演示记录。');
      }
      const value: ReplayDraft = {definitionId: definition.id, version: definition.version, mode, terminateUnsent,
        previousId: list.activeInstanceId, targetId: existingId, stage: existingId ? 'initialize' : 'create'};
      save(value);
      await continueDraft(value, false);
    } catch (reason) {
      running.current = false;
      if (mounted.current) { setBusy(''); failure(reason); }
    }
  }
  function resume() {
    if (disabled || running.current || !current.current) return;
    running.current = true;
    void continueDraft(current.current, true);
  }
  function cancel() {
    if (!running.current && (!current.current?.request || current.current.rejected)) save();
  }
  return {draft, busy, start, resume, cancel, canCancel: !busy && (!draft?.request || !!draft.rejected)};
}
