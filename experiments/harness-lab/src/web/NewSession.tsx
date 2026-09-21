import { useRef, useState } from 'react';
import { Folder } from 'lucide-react';
import type { Workspace } from '../contracts/index';
import { Panel } from './Resources';

export function NewSession({ workspaces, workspaceId, create, close }: {
  workspaces: Workspace[]; workspaceId: string; create: (workspaceId: string) => Promise<string | null>; close: () => void;
}) {
  const [target, setTarget] = useState(workspaces.some(w=>w.id===workspaceId)?workspaceId:workspaces[0]?.id || '');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  async function submit() {
    if (pending.current || !target) return;
    pending.current = true; setCreating(true); setError('');
    try {
      if (await create(target)) close();
      else setError('对话创建未完成，请核对项目中的会话后重试。');
    } catch { setError('对话创建未完成，请核对项目中的会话后重试。'); }
    finally { pending.current = false; setCreating(false); }
  }
  return <Panel title="新建对话" className="new-session-panel" close={close}>
    <form className="workspace-form new-session-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label htmlFor="new-session-project">选择项目</label>
      <div className="project-select"><Folder size={17} aria-hidden="true" /><select id="new-session-project" value={target} onChange={event => setTarget(event.target.value)} disabled={creating} required>{workspaces.map(workspace => <option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}</select></div>
      <p className="resource-help">新对话将使用这个项目的指令和资料。</p>
      {error && <p className="resource-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" onClick={close}>取消</button><button className="primary-action" type="submit" disabled={creating || !target}>{creating ? '创建中…' : '创建对话'}</button></div>
    </form>
  </Panel>;
}
