import { useState } from 'react';
import { Cpu, LogOut, UserRound, SlidersHorizontal } from 'lucide-react';
import { isBusinessIdentity, type AccountIdentity } from '../contracts/access';
import { ModelCatalogSettings } from './ModelCatalogSettings';
import { Panel } from './Resources';
import { ExpertDefaultPreferences } from './ExpertDefaults';

export function SettingsPanel({ identity, logout, logoutError, close, saved, suggestions, workActivity }: {
  workActivity?: { enabled: boolean; change: (enabled: boolean) => void };
  suggestions?: { enabled: boolean; change: (enabled: boolean) => void };
  identity?: AccountIdentity; logout?: () => void; logoutError?: string; close: () => void; saved: () => Promise<void>;
}) {
  const modelAllowed = !identity || identity.role === 'administrator';
  const [section, setSection] = useState<'model' | 'account' | 'preferences'>(modelAllowed ? 'model' : 'account');
  return <Panel title="设置" className="settings-panel" close={close}>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分类">
        {identity && <button type="button" aria-current={section === 'account' ? 'page' : undefined} onClick={() => setSection('account')}><UserRound size={17} aria-hidden="true" />账户</button>}
        {(suggestions || workActivity || identity?.canCollaborate !== false && identity) && <button type="button" aria-current={section === 'preferences' ? 'page' : undefined} onClick={() => setSection('preferences')}><SlidersHorizontal size={17} aria-hidden="true" />个人偏好</button>}
        {modelAllowed && <button type="button" aria-current={section === 'model' ? 'page' : undefined} onClick={() => setSection('model')}><Cpu size={17} aria-hidden="true" />模型管理</button>}
      </nav>
      {modelAllowed && <div className="settings-model-section" hidden={section !== 'model'}><ModelCatalogSettings saved={saved} /></div>}
      {section === 'preferences' && <section className="settings-content">
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
          {isBusinessIdentity(identity) ? <><dt>席位</dt><dd>{identity.seatName}</dd></> : <><dt>身份</dt><dd>管理员</dd></>}
        </dl>
        {logoutError && <p className="resource-error" role="alert">{logoutError}</p>}
        {logout && <button type="button" className="danger-action settings-logout" onClick={logout}><LogOut size={16} aria-hidden="true" />退出登录</button>}
      </section>}
    </div>
  </Panel>;
}
