import { useEffect, useState } from 'react';
import { AssignmentAttachments, HandoffFiles } from './HandoffFiles';
import { Check, ChevronDown, CircleAlert, CircleHelp, Clock3, X } from 'lucide-react';
import type { ConfirmationInteraction, Interaction, InteractionAnswer, InteractionResponse, PublicMessage, QuestionInteraction } from '../contracts/index';

type AnswerDraft = Record<string, { optionIds: string[]; text: string; custom: boolean }>;
const draftAnswer = (draft: AnswerDraft, id: string) => Object.hasOwn(draft, id) ? draft[id] : undefined;
const memory = new Map<string, AnswerDraft>();
export const interactionDraftKey = (item: Interaction) => `berserk.answer:${item.sessionId}:${item.requestId}:${item.interactionId}`;
export function clearInteractionDraft(item: Interaction) {
  const key = interactionDraftKey(item); memory.delete(key);
  try { sessionStorage.removeItem(key); } catch { /* In-memory editing remains available. */ }
}
function readDraft(item: Interaction): AnswerDraft {
  const key = interactionDraftKey(item);
  if (memory.has(key)) return memory.get(key)!;
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(key) || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) return Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, AnswerDraft[string]] => {
      const value = entry[1] as Partial<AnswerDraft[string]> | null;
      return Boolean(value && typeof value.text === 'string' && typeof value.custom === 'boolean' && Array.isArray(value.optionIds) && value.optionIds.every(id => typeof id === 'string'));
    }));
  } catch { /* Invalid or unavailable storage starts with an empty answer. */ }
  return {};
}
export interface InteractionSubmission { busy?: boolean; error?: string; needsQuery?: boolean }
const questionLabels: Record<QuestionInteraction['status'], string> = { pending: '待回答', answered: '已回答', skipped: '已跳过', cancelled: '已取消', expired: '已失效' };

interface InteractionCardProps {
  interaction: Interaction; canRespond: boolean; submission?: InteractionSubmission;
  respond: (item: Interaction, response: InteractionResponse) => Promise<void>;
  query: (item: Interaction) => Promise<void>; result?: PublicMessage;
}

export function InteractionCard({ interaction: item, canRespond, submission, respond, query, result }: InteractionCardProps) {
  const [draft, setDraft] = useState(() => item.status === 'pending' ? readDraft(item) : {});
  useEffect(() => { if (item.status !== 'pending') clearInteractionDraft(item); }, [item]);
  const disabled = !canRespond || Boolean(submission?.busy || submission?.needsQuery);
  const change = (id: string, value: AnswerDraft[string]) => {
    const next = { ...draft, [id]: value }; setDraft(next);
    const key = interactionDraftKey(item); memory.set(key, next);
    try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* Preserve the in-memory draft. */ }
  };
  const answers: InteractionAnswer[] = item.kind === 'question' ? item.questions.map(question => {
    const value = draftAnswer(draft, question.id);
    return !question.options?.length || value?.custom ? { questionId: question.id, text: value?.text.trim() || '' } : { questionId: question.id, optionIds: value?.optionIds || [] };
  }) : [];
  const complete = answers.every(answer => 'text' in answer ? Boolean(answer.text) : answer.optionIds.length > 0);
  const pending = item.status === 'pending';
  if (item.kind === 'confirmation') return <ConfirmationCard interaction={item} canRespond={canRespond} submission={submission} respond={respond} query={query} result={result} />;
  const status = questionLabels[item.status];
  return <section className="interaction-card" data-interaction-id={item.interactionId} aria-label="Agent 提问">
    <header><CircleHelp size={18} aria-hidden="true" /><strong>需要你的回答</strong><span className="interaction-status">{status}</span></header>
    <div className="interaction-questions">{item.questions.map((question, index) => {
      const value = draftAnswer(draft, question.id) || { optionIds: [], text: '', custom: false };
      const answer = item.answers?.find(answer => answer.questionId === question.id);
      return <fieldset key={question.id} disabled={disabled || !pending}><legend>{item.questions.length > 1 ? `${index + 1}. ` : ''}{question.prompt}</legend>
        {pending ? <>{question.options?.map(option => <label className="interaction-option" key={option.id}><input type={question.multiSelect ? 'checkbox' : 'radio'} name={`${item.interactionId}:${question.id}`} checked={!value.custom && value.optionIds.includes(option.id)} onChange={event => change(question.id, { ...value, custom: false, optionIds: question.multiSelect ? event.target.checked ? [...value.optionIds, option.id] : value.optionIds.filter(id => id !== option.id) : [option.id] })} /><span>{option.label}{option.description && <small>{option.description}</small>}</span></label>)}
          {Boolean(question.options?.length) && <label className="interaction-option"><input type="radio" name={`${item.interactionId}:${question.id}`} checked={value.custom} onChange={() => change(question.id, { ...value, custom: true, optionIds: [] })} /><span>自定义回答</span></label>}
          {(!question.options?.length || value.custom) && <div className="interaction-text"><label htmlFor={`${item.interactionId}:${question.id}:text`}>{question.options?.length ? '填写自定义回答' : '填写回答'}</label><textarea id={`${item.interactionId}:${question.id}:text`} rows={3} value={value.text} onChange={event => change(question.id, { ...value, custom: true, optionIds: [], text: event.target.value })} /></div>}
        </> : <><ul className="interaction-history-options">{question.options?.map(option => <li key={option.id}>{option.label}{option.description ? ` — ${option.description}` : ''}</li>)}</ul>{answer && <p className="interaction-answer">你的回答：{'text' in answer ? answer.text : answer.optionIds.map(id => question.options?.find(option => option.id === id)?.label || id).join('、')}</p>}</>}
      </fieldset>;
    })}</div>
    {item.reason && <p className="interaction-reason">{item.reason}</p>}
    {submission?.error && pending && <p className="resource-error" role="alert">{submission.error}</p>}
    {pending && <div className="interaction-actions">{submission?.needsQuery ? <button type="button" disabled={submission.busy} onClick={() => void query(item)}>{submission.busy ? '正在查询…' : '查询最新状态'}</button> : <><button type="button" disabled={disabled} onClick={() => void respond(item, { requestId: item.requestId, kind: 'question', action: 'skip' })}>跳过提问</button><button type="button" className="primary-action" disabled={disabled || !complete} onClick={() => void respond(item, { requestId: item.requestId, kind: 'question', action: 'answer', answers })}>{submission?.busy ? '提交中…' : '提交回答'}</button></>}</div>}
  </section>;
}

const confirmationLabels: Record<ConfirmationInteraction['status'], string> = {
  pending: '待确认', approved: '已确认', rejected: '已拒绝', cancelled: '已取消', expired: '已失效',
};
const executionLabels: Record<NonNullable<ConfirmationInteraction['execution']>, string> = {
  succeeded: '执行已完成。', failed: '执行失败，请查看详情。',
  unknown: '执行结果未确认，请核对后再继续。', not_started: '未执行：操作在开始前已停止。',
};
const handoffConfirmLabels = { assign: '确认分派', claim: '确认签收', submit: '确认提交', review: '确认审核' };

function ConfirmationCard({ interaction: item, canRespond, submission, respond, query, result }: Omit<InteractionCardProps, 'interaction'> & { interaction: ConfirmationInteraction }) {
  const pending = item.status === 'pending';
  const command = item.action.command !== undefined;
  const disabled = !canRespond || Boolean(submission?.busy || submission?.needsQuery);
  const status = confirmationLabels[item.status];
  const outcome = item.status === 'approved' ? item.execution ? executionLabels[item.execution] : '执行结果待确认。' : undefined;
  const Icon = item.status === 'approved' && item.execution === 'succeeded' ? Check
    : item.status === 'rejected' || item.status === 'cancelled' ? X
    : command || item.execution === 'failed' || item.execution === 'unknown' ? CircleAlert : Clock3;
  const confirmLabel = item.action.handoff ? handoffConfirmLabels[item.action.handoff.kind] : command ? '允许本次执行' : '确认执行';
  const details = <>
    {item.action.handoff?.kind === 'assign' && <AssignmentAttachments files={item.action.handoff.files} />}
    <p className="confirmation-description">{item.action.description}</p>
    {item.action.handoff && item.action.handoff.kind !== 'assign' && item.action.handoff.files.length > 0 && <HandoffFiles files={item.action.handoff.files} />}
    {item.action.cwd !== undefined && <dl className="confirmation-metadata"><dt>工作目录</dt><dd><code>{item.action.cwd}</code></dd></dl>}
    {command && <div className="confirmation-command"><span>完整命令</span><pre tabIndex={0} aria-label="完整命令">{item.action.command}</pre></div>}
    {item.reason && <p className="interaction-reason">{item.reason}</p>}
  </>;
  return <section className="interaction-card confirmation-card" data-interaction-id={item.interactionId} data-state={item.status} data-command={command} data-execution={item.execution} aria-label="操作确认" aria-busy={submission?.busy || undefined}>
    {pending ? <>
      <header className="confirmation-strip"><Icon size={16} aria-hidden="true" /><span>{status}</span><span className="confirmation-kind">{item.action.handoff ? '工作交接' : command ? '命令执行' : '操作确认'}</span></header>
      <div className="confirmation-body"><h3>{item.action.title}</h3>{details}</div>
      <footer className="confirmation-footer">
        <p className="interaction-rule">{item.rule.reason}</p>
        {submission?.error && <p className="resource-error" role="alert">{submission.error}</p>}
        <div className="interaction-actions">
          {submission?.needsQuery ? <button type="button" disabled={submission.busy} onClick={() => void query(item)}>{submission.busy ? '正在查询…' : '查询最新状态'}</button> : <>
            <button type="button" disabled={disabled} onClick={() => void respond(item, { requestId: item.requestId, kind: 'confirmation', decision: 'reject' })}>拒绝</button>
            <button type="button" className="primary-action" disabled={disabled} onClick={() => void respond(item, { requestId: item.requestId, kind: 'confirmation', decision: 'approve' })}>{submission?.busy ? '提交中…' : confirmLabel}</button>
          </>}
        </div>
      </footer>
    </> : <details className="confirmation-history">
      <summary><Icon size={16} aria-hidden="true" /><span className="confirmation-history-heading"><span className="confirmation-title">{item.action.title}</span>{outcome && <span className="confirmation-outcome">{outcome}</span>}</span><span className="confirmation-decision">{status}</span><ChevronDown className="confirmation-chevron" size={16} aria-hidden="true" /></summary>
      <div className="confirmation-body">{details}<p className="interaction-rule">{item.rule.reason}</p>
        {result?.text && <details className="interaction-result"><summary>{item.status === 'rejected' ? '拒绝后的工具返回' : result.isError ? '工具返回（未完成）' : '工具返回'}</summary><pre tabIndex={0}>{result.text}</pre></details>}
      </div>
    </details>}
  </section>;
}
