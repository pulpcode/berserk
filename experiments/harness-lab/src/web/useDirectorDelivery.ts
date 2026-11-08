import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ScenarioAction, ScenarioInstanceDetail, ScenarioMutationResult, ScenarioPreview, ScenarioStepSummary } from '../contracts/scenarios';
import { useApi } from './api';

interface DeliveryOptions {
  detail?: ScenarioInstanceDetail;
  steps: ScenarioStepSummary[];
  blocked: boolean;
  apply: (step: ScenarioStepSummary) => Promise<ScenarioMutationResult | undefined>;
  working: (label: string) => void;
  notice: (text: string) => void;
  failure: (reason: unknown) => void;
  refresh: () => void;
}

export function useDirectorDelivery({detail, steps, blocked, apply, working, notice, failure, refresh}: DeliveryOptions) {
  const {api, storageKey} = useApi();
  // Keep the event list in place while refreshing. An older poll must never re-enable delivery.
  const latest = useRef(detail);
  useLayoutEffect(() => { latest.current = detail; }, [detail]);
  const [awaitingRead, setAwaitingRead] = useState<{
    previous?: ScenarioInstanceDetail; instanceId: string; revision: number; acceptedIds: string[];
  }>();
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [checkedId, setCheckedId] = useState('');
  const [uncertainId, setUncertainId] = useState('');
  const instance = detail?.instance;
  const syncing = !!awaitingRead && awaitingRead.instanceId === instance?.instanceId && (
    detail === awaitingRead.previous || instance.revision < awaitingRead.revision ||
    awaitingRead.acceptedIds.some(id => !detail?.actions.some(action => action.id === id && action.sendState === 'accepted'))
  );
  const waiting = detail?.actions.find(action => action.sendState !== 'accepted');
  const step = waiting ? steps.find(item => item.id === waiting.stepId) : detail?.timeline ? steps.find(item => item.state === 'pending') : steps[instance?.stepIndex ?? 0];
  const remaining = waiting ? detail!.actions.filter(action => action.stepId === waiting.stepId && action.sendState !== 'accepted') : [];
  const receiptKey = (id: string) => storageKey('berserk.scenario-director.receipt.' + id);

  function markSending(id: string, pending: boolean) {
    setUncertainId(pending ? id : '');
    try {
      if (pending) sessionStorage.setItem(receiptKey(id), '1');
      else sessionStorage.removeItem(receiptKey(id));
    } catch { /* Keep the in-memory guard when browser storage is unavailable. */ }
  }
  function needsReceipt(action: ScenarioAction) {
    if (action.id === uncertainId) return true;
    if (action.sendState === 'unconfirmed' && action.id !== checkedId) return true;
    try { return sessionStorage.getItem(receiptKey(action.id)) === '1'; }
    catch { return false; }
  }
  const checkFirst = !!waiting && needsReceipt(waiting);
  async function deliver() {
    if (!instance || !step || blocked || syncing || running.current || instance.status !== 'active' || (instance.paused && !checkFirst)) return;
    running.current = true;
    working(checkFirst ? '核对接收回执' : '投放事件');
    notice('');
    let revision = instance.revision;
    const acceptedIds: string[] = [];
    try {
      if (checkFirst && waiting) {
        const receipt = await api<ScenarioAction>('/api/simulation/actions/' + encodeURIComponent(waiting.id));
        if (receipt.id !== waiting.id || receipt.instanceId !== instance.instanceId) throw new Error('通知回执与本轮不符。');
        if (receipt.sendState === 'accepted') acceptedIds.push(receipt.id);
        markSending(waiting.id, false);
        setCheckedId(waiting.id);
        notice(receipt.sendState === 'accepted' ? '已确认接收。' : '已核对，通知尚无接收回执。');
        return;
      }
      let actions = remaining;
      if (!waiting) {
        const preview = await api<ScenarioPreview>(`/api/simulation/instances/${encodeURIComponent(instance.instanceId)}/preview`, {expectedRevision: instance.revision});
        if (!mounted.current) return;
        if (!preview.canApply || preview.instance.instanceId !== instance.instanceId || preview.instance.revision !== instance.revision || preview.step?.id !== step.id) {
          throw new Error(preview.reason || '下一事件已变化，请核对最新状态。');
        }
        const result = await apply(step);
        if (!result || !mounted.current) return;
        revision = result.instance.revision;
        actions = result.actions;
        const expectedStepIndex = instance.stepIndex + (step.kind === 'execution' ? 0 : 1);
        if (result.instance.instanceId !== instance.instanceId || result.instance.stepIndex !== expectedStepIndex ||
          actions.length !== preview.step.messageCount || actions.some(action => action.instanceId !== instance.instanceId || action.stepId !== step.id)) {
          throw new Error('本步通知与操作回执不符，请刷新核对。');
        }
      }
      for (const action of actions) {
        if (!mounted.current) return;
        if (action.sendState === 'accepted') continue;
        if (needsReceipt(action)) throw new Error('请先核对当前通知的接收回执。');
        setCheckedId('');
        markSending(action.id, true);
        const result = await api<ScenarioAction>(`/api/simulation/actions/${encodeURIComponent(action.id)}/send`, {});
        if (result.id !== action.id || result.sendState !== 'accepted') {
          throw new Error(result.error || '通知接收未确认，请先核对回执。');
        }
        acceptedIds.push(result.id);
        markSending(action.id, false);
      }
      notice(`已投放 · ${step.title}`);
    } catch (reason) {
      failure(reason);
    } finally {
      running.current = false;
      if (mounted.current) {
        setAwaitingRead({previous: latest.current, instanceId: instance.instanceId, revision, acceptedIds});
        working('');
        refresh();
      }
    }
  }
  return {step, waiting, remaining, checkFirst, syncing, deliver};
}
