import { useState } from 'react';
import { Cpu, ListChecks, LogOut, UserRound, SlidersHorizontal } from 'lucide-react';
import { isBusinessIdentity, type AccountIdentity } from '../contracts/access';
import { ModelCatalogSettings } from './ModelCatalogSettings';
import { Panel } from './Resources';
import { ExpertDefaultPreferences } from './ExpertDefaults';
import { ModelDefaultPreferences } from './ModelDefaultPreferences';
import { LoadingIndicator } from './LoadingIndicator';
import { useApi } from './api';
import { informationError, useInformationQuery } from './information-ui';
import type { BackgroundQueueStatus } from '../contracts/background';
import type { ModelChoices } from '../contracts/index';
import type { ModelPreferenceControl } from './useModelPreference';

const queuePath = '/api/information/queue';

function BackgroundQueueSettings() {
  const { api } = useApi();
  const queue = useInformationQuery<BackgroundQueueStatus | null>(queuePath, true);
  const [saved, setSaved] = useState<BackgroundQueueStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const status = queue.data && saved && saved.revision > queue.data.revision ? saved : queue.data;

  async function changeQueue() {
    if (!status || busy) return;
    setBusy(true);
    setError('');
    try {
      setSaved(await api<BackgroundQueueStatus>(queuePath, {enabled: !status.enabled, revision: status.revision}, 'PUT'));
    } catch (reason) { setError(informationError(reason)); }
    finally { queue.refresh(); setBusy(false); }
  }

  return <section className="settings-content" aria-labelledby="background-queue-title">
    <div className="settings-heading"><h3 id="background-queue-title">后台作业</h3><p>暂停后，全实例停止领取新作业，正在运行的作业继续执行。</p></div>
    {status && <div className="information-controls">
      <span role="status">后台作业领取{status.enabled ? '已启用' : '已暂停'}</span>
      <button type="button" disabled={busy || !!queue.error} onClick={() => void changeQueue()}>{status.enabled ? '暂停领取后台作业' : '恢复领取后台作业'}</button>
    </div>}
    {status?.blockedReason && <p className="information-queue-notice" role="status">{status.blockedReason}</p>}
    {status === null && <p className="resource-help">当前服务未配置后台作业。</p>}
    {status === undefined && !queue.error && <LoadingIndicator label="正在读取队列状态…" />}
    {(queue.error || error) && <p className="resource-error" role="alert">{queue.error || error}</p>}
  </section>;
}

export function SettingsPanel({ identity, logout, logoutError, close, saved, suggestions, workActivity, models, modelPreference }: {
  workActivity?: { enabled: boolean; change: (enabled: boolean) => void };
  suggestions?: { enabled: boolean; change: (enabled: boolean) => void };
  models?: ModelChoices; modelPreference?: ModelPreferenceControl;
  identity?: AccountIdentity; logout?: () => void; logoutError?: string; close: () => void; saved: () => Promise<void>;
}) {
  const administrator = identity?.role === 'administrator';
  const modelAllowed = !identity || administrator;
  const [section, setSection] = useState<'model' | 'account' | 'preferences' | 'background'>(identity ? 'account' : 'model');
  return <Panel title="设置" className="settings-panel" close={close}>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分类">
        {identity && <button type="button" aria-current={section === 'account' ? 'page' : undefined} onClick={() => setSection('account')}><UserRound size={17} aria-hidden="true" />账户</button>}
        {(modelPreference || suggestions || workActivity || identity?.canCollaborate !== false && identity) && <button type="button" aria-current={section === 'preferences' ? 'page' : undefined} onClick={() => setSection('preferences')}><SlidersHorizontal size={17} aria-hidden="true" />个人偏好</button>}
        {modelAllowed && <button type="button" aria-current={section === 'model' ? 'page' : undefined} onClick={() => setSection('model')}><Cpu size={17} aria-hidden="true" />模型管理</button>}
        {administrator && <button type="button" aria-current={section === 'background' ? 'page' : undefined} onClick={() => setSection('background')}><ListChecks size={17} aria-hidden="true" />后台作业</button>}
      </nav>
      {modelAllowed && <div className="settings-model-section" hidden={section !== 'model'}><ModelCatalogSettings saved={saved} /></div>}
      {administrator && section === 'background' && <BackgroundQueueSettings />}
      {section === 'preferences' && <section className="settings-content">
        {modelPreference && <ModelDefaultPreferences models={models} control={modelPreference} />}
        {suggestions && <div className="prompt-suggestion-preference"><h3>输入建议</h3>
          <label><input type="checkbox" checked={suggestions.enabled} onChange={event => suggestions.change(event.target.checked)} />显示下一步输入建议</label>
          <p>回复结束后，在空输入框中提供建议，按 Tab 采纳后自行发送。会产生额外模型用量；开关仅保留在本次登录的当前标签页。</p>
        </div>}
        {workActivity && <div className="prompt-suggestion-preference"><h3>工作识别</h3>
          <label><input type="checkbox" checked={workActivity.enabled} onChange={event => workActivity.change(event.target.checked)} />识别本对话工作</label>
          <p>打开工作面板后，根据最近对话识别正在处理的工作。会产生额外模型用量；识别结果仅保留在当前标签页内存中。</p>
        </div>}
        {identity && identity.canCollaborate !== false && <ExpertDefaultPreferences />}
      </section>}
      {identity && section === 'account' && <section className="settings-content account-settings-content" aria-labelledby="account-settings-title">
        <div className="settings-heading"><h3 id="account-settings-title">账户</h3><p>当前登录的账户信息。</p></div>
        <dl className="settings-account-details">
          <dt>显示名称</dt><dd>{identity.displayName}</dd>
          <dt>用户名</dt><dd>{identity.username}</dd>
          <dt>席位</dt><dd>{isBusinessIdentity(identity) ? identity.seatName : '管理员席'}</dd>
        </dl>
        {logoutError && <p className="resource-error" role="alert">{logoutError}</p>}
        {logout && <button type="button" className="danger-action settings-logout" onClick={logout}><LogOut size={16} aria-hidden="true" />退出登录</button>}
      </section>}
    </div>
  </Panel>;
}
