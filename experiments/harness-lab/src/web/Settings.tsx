import { useState } from 'react';
import { Cpu, LogOut, UserRound } from 'lucide-react';
import type { Identity } from '../contracts/access';
import { ModelCatalogSettings } from './ModelCatalogSettings';
import { Panel } from './Resources';

export function SettingsPanel({ identity, logout, logoutError, close, saved }: {
  identity?: Identity; logout?: () => void; logoutError?: string; close: () => void; saved: () => Promise<void>;
}) {
  const modelAllowed = !identity || identity.manageModelSettings;
  const [section, setSection] = useState<'model' | 'account'>(modelAllowed ? 'model' : 'account');
  return <Panel title="设置" className="settings-panel" close={close}>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分类">
        {modelAllowed && <button type="button" aria-current={section === 'model' ? 'page' : undefined} onClick={() => setSection('model')}><Cpu size={17} aria-hidden="true" />模型</button>}
        {identity && <button type="button" aria-current={section === 'account' ? 'page' : undefined} onClick={() => setSection('account')}><UserRound size={17} aria-hidden="true" />账户</button>}
      </nav>
      {modelAllowed && <div className="settings-model-section" hidden={section !== 'model'}><ModelCatalogSettings saved={saved} /></div>}
      {identity && section === 'account' && <section className="settings-content account-settings-content" aria-labelledby="account-settings-title">
        <div className="settings-heading"><h3 id="account-settings-title">账户</h3><p>当前登录的账户与席位。</p></div>
        <dl className="settings-account-details">
          <dt>显示名称</dt><dd>{identity.displayName}</dd>
          <dt>用户名</dt><dd>{identity.username}</dd>
          <dt>席位</dt><dd>{identity.seatName}</dd>
        </dl>
        {logoutError && <p className="resource-error" role="alert">{logoutError}</p>}
        {logout && <button type="button" className="danger-action settings-logout" onClick={logout}><LogOut size={16} aria-hidden="true" />退出登录</button>}
      </section>}
    </div>
  </Panel>;
}
