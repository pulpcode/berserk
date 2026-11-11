import { LoadingIndicator } from './LoadingIndicator';
import { useRef, useState, type ReactNode } from 'react';
import { ArrowUp, ChevronDown, Pencil } from 'lucide-react';
import type { Identity, TaskSpace } from '../contracts/access';
import type { ModelChoices } from '../contracts/index';
import { useApi } from './api';
import { InformationText } from './information-ui';
import { TaskContextSummary } from './TaskContextEditor';
import { ModelPicker } from './ModelPicker';
import { TaskCommands, type TaskCommandsHandle } from './TaskCommands';
import { TaskExecutionProgress, TaskWorkProgress } from './TaskProgress';

export function TaskHome({ taskId, task, identity, edit, assessment, draft, setDraft, models, modelId, chooseModel, modelsError, refreshModels, busy, error, start, visible = true, seats = [], openWork = () => {} }: {
  visible?: boolean; seats?: Array<{id:string;name:string}>; openWork?: (id: string) => void;
  assessment?: ReactNode; taskId: string; task?: TaskSpace; identity: Identity; edit: () => void;
  draft: string; setDraft: (text: string) => void; models?: ModelChoices; modelId: string; chooseModel: (id: string) => void;
  modelsError: string; refreshModels: () => void; busy: boolean; error: string; start: () => void;
}) {
  const { storageKey, domId } = useApi();
  const commands = useRef<TaskCommandsHandle>(null);
  const preference = storageKey(`berserk.task-description:${taskId}`);
  const [collapsed, setCollapsed] = useState(() => { try { return sessionStorage.getItem(preference) !== 'expanded'; } catch { return true; } });
  const [full, setFull] = useState(false);
  const descriptionId = domId(`task-description-${taskId}`);
  const model = models?.models.find(item => item.id === modelId);
  const ready = Boolean(task && task.state === 'active' && !task.readOnly && model?.configured && model.contextReady && !modelsError);
  const longDescription = Boolean(task && (task.goal.length > 180 || task.goal.split('\n').length > 4 || task.context));
  const preview = task?.goal.split('\n').slice(0, 4).join('\n').slice(0, 180);
  const canCollaborate=identity.canCollaborate!==false;
  const editable = canCollaborate && task && !task.readOnly && (task.visibility === 'public' ? identity.createPublicTask : task.ownerSeatId === identity.seatId);
  function toggle() {
    const next = !collapsed; setCollapsed(next);
    try { sessionStorage.setItem(preference, next ? 'collapsed' : 'expanded'); } catch { /* Keep the disclosure usable without storage. */ }
  }
  return <div className="task-home">
    <section className="task-description">
      <header className="task-description-heading"><h2><button onClick={toggle} aria-expanded={!collapsed} aria-controls={descriptionId}><ChevronDown size={17} aria-hidden="true" className={collapsed ? 'is-collapsed' : ''} />目标与说明</button></h2>{editable && <button onClick={edit}><Pencil size={14} aria-hidden="true" />编辑说明</button>}</header>
      {collapsed && <div className="task-goal-preview"><InformationText>{task?.goal ? task.goal.split('\n').find(line => line.trim())?.slice(0, 180) || task.goal.slice(0, 180) : '暂无说明'}</InformationText></div>}
      <div id={descriptionId} hidden={collapsed}>
        {task ? <><div id={`${descriptionId}-text`} className={`task-description-body${full ? '' : ' is-preview'}`}><InformationText>{(full || !longDescription ? task.goal : `${preview}${preview !== task.goal ? '…' : ''}`) || '暂无说明，可先提出问题或补充任务目标。'}</InformationText>{(full || !longDescription) && <TaskContextSummary context={task.context} />}</div>{longDescription && <button className="task-description-more" aria-expanded={full} aria-controls={`${descriptionId}-text`} onClick={() => setFull(value => !value)}>{full ? '收起全文' : '展开全文'}</button>}</> : <LoadingIndicator label="正在读取任务说明…" />}
      </div>
    </section>
    {assessment}
    {canCollaborate && task && <TaskWorkProgress task={task} identity={identity} visible={visible} seats={seats} openWork={openWork} />}
    {task && <TaskExecutionProgress taskId={task.id} visible={visible} openCommand={id => commands.current?.open(id)} />}
    {identity.canIssueCommands && task && <TaskCommands key={task.id} task={task} visible={visible} control={commands} />}
    {canCollaborate?<form className="task-home-composer" onSubmit={event => { event.preventDefault(); if (ready && !busy && draft.trim()) start(); }} aria-busy={busy}>
      <h2>新建对话</h2>
      <label className="task-composer-label" htmlFor={domId(`task-question-${taskId}`)}>问题或工作要求</label>
      <textarea id={domId(`task-question-${taskId}`)} rows={2} placeholder="围绕这个任务，开始新的对话…" value={draft} disabled={busy || !task || task.state === 'archived' || task.readOnly} onChange={event => setDraft(event.target.value)} />
      <div className="task-home-composer-actions"><ModelPicker models={models} value={modelId} disabled={Boolean(busy || task?.state === 'archived' || task?.readOnly)} saving={false} choose={chooseModel} /><button type="submit" className="primary-action" disabled={!ready || busy || !draft.trim()}><ArrowUp size={16} aria-hidden="true" />{busy ? '正在准备对话…' : '发送并开始对话'}</button></div>
      {task?.readOnly ? <p className="resource-help">此任务只读，可以查看说明和历史对话。</p> : task?.state === 'archived' ? <p className="resource-help">此任务已归档，可以查看说明和历史对话；重新打开后可继续开展工作。</p> : !models ? !modelsError && <LoadingIndicator label="正在读取可用模型…" /> : !model?.configured || !model.contextReady ? <p className="resource-help">请选择已配置且参数完整的模型后开始对话。</p> : null}
      {modelsError && <p className="resource-error" role="alert">{modelsError}<button type="button" onClick={refreshModels}>重新读取模型</button></p>}
      {error && <p className="resource-error" role="alert">{error}</p>}
    </form>:<p className="resource-help">只读核对任务说明；业务办理由业务席位完成。</p>}
  </div>;
}
