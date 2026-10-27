import { useState, type ReactNode } from 'react';
import { ArrowUp, ChevronDown, Pencil } from 'lucide-react';
import type { Identity, TaskSpace } from '../contracts/access';
import type { ModelChoices } from '../contracts/index';
import { useApi } from './api';
import { InformationText } from './information-ui';
import { TaskContextSummary } from './TaskContextEditor';
import { ModelPicker } from './ModelPicker';

export function TaskHome({ taskId, task, identity, edit, assessment, draft, setDraft, models, modelId, chooseModel, modelsError, refreshModels, busy, error, start }: {
  assessment?: ReactNode; taskId: string; task?: TaskSpace; identity: Identity; edit: () => void;
  draft: string; setDraft: (text: string) => void; models?: ModelChoices; modelId: string; chooseModel: (id: string) => void;
  modelsError: string; refreshModels: () => void; busy: boolean; error: string; start: () => void;
}) {
  const { storageKey, domId } = useApi();
  const preference = storageKey(`berserk.task-description:${taskId}`);
  const [collapsed, setCollapsed] = useState(() => { try { return sessionStorage.getItem(preference) === 'collapsed'; } catch { return false; } });
  const [full, setFull] = useState(false);
  const descriptionId = domId(`task-description-${taskId}`);
  const model = models?.models.find(item => item.id === modelId);
  const ready = Boolean(task && task.state === 'active' && model?.configured && model.contextReady && !modelsError);
  const longDescription = Boolean(task && (task.goal.length > 180 || task.goal.split('\n').length > 4 || task.context));
  const preview = task?.goal.split('\n').slice(0, 4).join('\n').slice(0, 180);
  const editable = task && (task.visibility === 'public' ? identity.createPublicTask : task.ownerSeatId === identity.seatId);
  function toggle() {
    const next = !collapsed; setCollapsed(next);
    try { sessionStorage.setItem(preference, next ? 'collapsed' : 'expanded'); } catch { /* Keep the disclosure usable without storage. */ }
  }
  return <div className="task-home">
    <section className="task-description">
      <header className="task-description-heading"><h2><button onClick={toggle} aria-expanded={!collapsed} aria-controls={descriptionId}><ChevronDown size={17} aria-hidden="true" className={collapsed ? 'is-collapsed' : ''} />目标与说明</button></h2>{editable && <button onClick={edit}><Pencil size={14} aria-hidden="true" />编辑说明</button>}</header>
      <div id={descriptionId} hidden={collapsed}>
        {task ? <><div id={`${descriptionId}-text`} className={`task-description-body${full ? '' : ' is-preview'}`}><InformationText>{(full || !longDescription ? task.goal : `${preview}${preview !== task.goal ? '…' : ''}`) || '暂无说明，可先提出问题或补充任务目标。'}</InformationText>{(full || !longDescription) && <TaskContextSummary context={task.context} />}</div>{longDescription && <button className="task-description-more" aria-expanded={full} aria-controls={`${descriptionId}-text`} onClick={() => setFull(value => !value)}>{full ? '收起全文' : '展开全文'}</button>}</> : <p role="status">正在读取任务说明…</p>}
      </div>
    </section>
    {assessment}
    <form className="task-home-composer" onSubmit={event => { event.preventDefault(); if (ready && !busy && draft.trim()) start(); }} aria-busy={busy}>
      <h2>新建对话</h2><p>围绕{task?.visibility === 'private' ? '这个空间' : '这个任务'}，你想先处理什么？</p>
      <label htmlFor={domId(`task-question-${taskId}`)}>问题或工作要求</label>
      <textarea id={domId(`task-question-${taskId}`)} rows={4} placeholder="例如：梳理当前进展，列出下一步需要解决的问题…" value={draft} disabled={busy || !task || task.state === 'archived'} onChange={event => setDraft(event.target.value)} />
      <div className="task-home-composer-actions"><ModelPicker models={models} value={modelId} disabled={busy || task?.state === 'archived'} saving={false} choose={chooseModel} /><button type="submit" className="primary-action" disabled={!ready || busy || !draft.trim()}><ArrowUp size={16} aria-hidden="true" />{busy ? '正在准备对话…' : '发送并开始对话'}</button></div>
      {task?.state === 'archived' ? <p className="resource-help">此任务已归档，可以查看说明和历史对话；重新打开后可继续开展工作。</p> : !models ? <p role="status">正在读取可用模型…</p> : !model?.configured || !model.contextReady ? <p className="resource-help">请选择已配置且参数完整的模型后开始对话。</p> : null}
      {modelsError && <p className="resource-error" role="alert">{modelsError}<button type="button" onClick={refreshModels}>重新读取模型</button></p>}
      {error && <p className="resource-error" role="alert">{error}</p>}
    </form>
  </div>;
}
