import { useEffect, useState } from 'react';
import type { ExpertSummary } from '../contracts/capabilities';
import type { ExpertDefaultChoice, ExpertDefaultSetting } from '../contracts/capability-management';
import { useApi } from './api';
import { sessionAction } from './session-action';
import { LoadingIndicator } from './LoadingIndicator';
import './capability-management.css';

function choiceValue(choice: ExpertDefaultChoice) { return choice.mode === 'expert' ? choice.expertId : choice.mode; }
function defaultChoice(value: string): ExpertDefaultChoice { return value === 'inherit' ? { mode: 'inherit' } : value === 'general' ? { mode: 'general' } : { mode: 'expert', expertId: value }; }

export type ExpertDefaultOption = Pick<ExpertSummary, 'expertId' | 'name' | 'availability'>;

export function ExpertDefaultSettings({ path, title, help, choices }: { path: string; title: string; help: string; choices?: ExpertDefaultOption[] }) {
  const { api, storageKey } = useApi();
  const [setting, setSetting] = useState<ExpertDefaultSetting>();
  const [experts, setExperts] = useState<ExpertDefaultOption[]>([]);
  const [value, setValue] = useState('inherit');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  const [latest, setLatest] = useState<ExpertDefaultSetting>();
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    Promise.all([api<ExpertDefaultSetting>(path), choices ? Promise.resolve(choices) : api<ExpertSummary[]>('/api/capabilities/experts')]).then(([next, choices]) => {
      if (!current) return;
      setSetting(next); setValue(choiceValue(next.choice)); setExperts(choices); setError(''); setLatest(undefined);
    }).catch(error => { if (current) setError(error instanceof Error ? error.message : '默认专家暂时无法读取。'); });
    return () => { current = false; };
  }, [api, path, reload, choices]);
  async function save() {
    if (!setting || working) return;
    setWorking(true); setError(''); setNotice('');
    const body = { expectedRevision: setting.revision, choice: defaultChoice(value) };
    const action = sessionAction(storageKey(`expert-default:${path}`), body);
    try {
      const next = await api<ExpertDefaultSetting>(path, { ...body, clientActionId: action.id }, 'PUT');
      action.complete(); setSetting(next); setValue(choiceValue(next.choice)); setLatest(undefined); setNotice('默认专家已保存，下次新建对话时生效。');
    } catch (error) { setError(error instanceof Error ? error.message : '保存未完成，请核对当前设置后再试。'); }
    finally { setWorking(false); }
  }
  async function readLatest() {
    try { setLatest(await api<ExpertDefaultSetting>(path)); }
    catch (error) { setError(error instanceof Error ? error.message : '读取失败。'); }
  }
  const missing = !['inherit', 'general'].includes(value) && !experts.some(expert => expert.expertId === value);
  return <section className="expert-default-settings" aria-label={title}>
    <h3>{title}</h3><p className="resource-help">{help}</p>
    {!setting && !error && <LoadingIndicator label="正在读取默认专家…" />}
    {setting && <><label>默认专家<select aria-label="默认专家" value={value} disabled={working} onChange={event => { setValue(event.target.value); setNotice(''); }}><option value="inherit">继承下一级设置</option><option value="general">Axon 通用助手</option>{missing && <option value={value}>当前设置的专家不可用</option>}{experts.map(expert => <option key={expert.expertId} value={expert.expertId} disabled={!expert.availability.available}>{expert.name}{!expert.availability.available ? '（不可用）' : ''}</option>)}</select></label>
      {missing && <p className="resource-error" role="status">当前默认专家不可用。新会话会明确提示，不会自动切换到通用助手。</p>}
      <button type="button" className="primary-action" disabled={working || choiceValue(setting.choice) === value} onClick={() => void save()}>{working ? '保存中…' : '保存默认专家'}</button></>}
    {error && <div className="resource-error" role="alert"><p>{error}</p>{setting ? <button type="button" disabled={working} onClick={() => void readLatest()}>查看最新设置</button> : <button type="button" onClick={() => setReload(n => n + 1)}>重新读取</button>}</div>}
    {latest && <div className="expert-default-latest"><p>最新设置：{latest.choice.mode === 'inherit' ? '继承' : latest.choice.mode === 'general' ? 'Axon 通用助手' : experts.find(item => item.expertId === choiceValue(latest.choice))?.name || '指定专家'}</p><button type="button" onClick={() => { setSetting(latest); setValue(choiceValue(latest.choice)); setLatest(undefined); setError(''); }}>放弃本地修改，使用最新设置</button></div>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}

export function ExpertDefaultPreferences() { return <ExpertDefaultSettings path="/api/me/preferences/expert" title="个人默认专家" help="任务明确设置优先于个人偏好；个人继承时使用席位默认，最终回到通用助手。只影响新对话，不改变现有会话。" />; }
export function TaskExpertDefault({ taskId }: { taskId: string }) { return <ExpertDefaultSettings key={taskId} path={`/api/tasks/${encodeURIComponent(taskId)}/expert-default`} title="任务默认专家" help="任务内的新会话优先使用此设置。继承时按个人、席位和通用助手依次解析；用户仍可显式选择其他获准专家。" />; }
