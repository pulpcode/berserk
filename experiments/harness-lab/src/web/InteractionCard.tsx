import { useEffect, useState } from 'react';
import { CircleHelp, ShieldCheck } from 'lucide-react';
import type { Interaction, InteractionAnswer, InteractionResponse, PublicMessage } from '../contracts/index';

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
const labels: Record<Interaction['status'], string> = { pending: '等待处理', answered: '已回答', skipped: '已跳过', approved: '已确认，继续处理', rejected: '已拒绝', cancelled: '已取消', expired: '已失效' };

export function InteractionCard({ interaction: item, canRespond, submission, respond, query, result }: {
  interaction: Interaction; canRespond: boolean; submission?: InteractionSubmission;
  respond: (item: Interaction, response: InteractionResponse) => Promise<void>;
  query: (item: Interaction) => Promise<void>; result?: PublicMessage;
}) {
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
  const status = pending ? item.kind === 'question' ? '待回答' : '待确认' : item.kind === 'confirmation' && item.status === 'approved' && item.execution ? '已确认' : labels[item.status];
  return <section className="interaction-card" data-interaction-id={item.interactionId} aria-label={item.kind === 'question' ? 'Agent 提问' : '操作确认'}>
    <header>{item.kind === 'question' ? <CircleHelp size={18} aria-hidden="true" /> : <ShieldCheck size={18} aria-hidden="true" />}<strong>{item.kind === 'question' ? '需要你的回答' : '请确认本次操作'}</strong><span className="interaction-status">{status}</span></header>
    {item.kind === 'question' ? <div className="interaction-questions">{item.questions.map((question, index) => {
      const value = draftAnswer(draft, question.id) || { optionIds: [], text: '', custom: false };
      const answer = item.answers?.find(answer => answer.questionId === question.id);
      return <fieldset key={question.id} disabled={disabled || !pending}><legend>{item.questions.length > 1 ? `${index + 1}. ` : ''}{question.prompt}</legend>
        {pending ? <>{question.options?.map(option => <label className="interaction-option" key={option.id}><input type={question.multiSelect ? 'checkbox' : 'radio'} name={`${item.interactionId}:${question.id}`} checked={!value.custom && value.optionIds.includes(option.id)} onChange={event => change(question.id, { ...value, custom: false, optionIds: question.multiSelect ? event.target.checked ? [...value.optionIds, option.id] : value.optionIds.filter(id => id !== option.id) : [option.id] })} /><span>{option.label}{option.description && <small>{option.description}</small>}</span></label>)}
          {Boolean(question.options?.length) && <label className="interaction-option"><input type="radio" name={`${item.interactionId}:${question.id}`} checked={value.custom} onChange={() => change(question.id, { ...value, custom: true, optionIds: [] })} /><span>自定义回答</span></label>}
          {(!question.options?.length || value.custom) && <div className="interaction-text"><label htmlFor={`${item.interactionId}:${question.id}:text`}>{question.options?.length ? '填写自定义回答' : '填写回答'}</label><textarea id={`${item.interactionId}:${question.id}:text`} rows={3} value={value.text} onChange={event => change(question.id, { ...value, custom: true, optionIds: [], text: event.target.value })} /></div>}
        </> : <><ul className="interaction-history-options">{question.options?.map(option => <li key={option.id}>{option.label}{option.description ? ` — ${option.description}` : ''}</li>)}</ul>{answer && <p className="interaction-answer">你的回答：{'text' in answer ? answer.text : answer.optionIds.map(id => question.options?.find(option => option.id === id)?.label || id).join('、')}</p>}</>}
      </fieldset>;
    })}</div> : <div className="interaction-action"><h3>{item.action.title}</h3><p>{item.action.description}</p>{item.action.cwd !== undefined && <p>工作目录：<code>{item.action.cwd}</code></p>}{item.action.command !== undefined && <details open><summary>完整命令</summary><pre tabIndex={0} aria-label="完整命令">{item.action.command}</pre></details>}<p className="interaction-rule">{item.rule.reason}</p>{item.status === 'approved' && <p>{item.execution === 'not_started' ? '未执行：操作在开始前已停止。' : item.execution === 'succeeded' ? '实际执行已完成。' : item.execution === 'failed' ? '实际执行失败，请查看工具结果。' : item.execution === 'unknown' ? '执行结果未确认，请核对后再继续。' : '已授权本次调用，执行结果以工具返回为准。'}</p>}</div>}
    {item.reason && <p className="interaction-reason">{item.reason}</p>}
    {submission?.error && pending && <p className="resource-error" role="alert">{submission.error}</p>}
    {pending && <div className="interaction-actions">{submission?.needsQuery ? <button type="button" disabled={submission.busy} onClick={() => void query(item)}>{submission.busy ? '正在查询…' : '查询最新状态'}</button> : item.kind === 'question' ? <><button type="button" disabled={disabled} onClick={() => void respond(item, { requestId: item.requestId, kind: 'question', action: 'skip' })}>跳过提问</button><button type="button" className="primary-action" disabled={disabled || !complete} onClick={() => void respond(item, { requestId: item.requestId, kind: 'question', action: 'answer', answers })}>{submission?.busy ? '提交中…' : '提交回答'}</button></> : <><button type="button" disabled={disabled} onClick={() => void respond(item, { requestId: item.requestId, kind: 'confirmation', decision: 'reject' })}>拒绝</button><button type="button" className="primary-action" disabled={disabled} onClick={() => void respond(item, { requestId: item.requestId, kind: 'confirmation', decision: 'approve' })}>{submission?.busy ? '提交中…' : '确认执行'}</button></>}</div>}
    {item.kind === 'confirmation' && result?.text && <details className="interaction-result"><summary>{item.kind === 'confirmation' && item.status === 'rejected' ? '拒绝后的工具返回' : result.isError ? '工具返回（未完成）' : '工具返回'}</summary><pre>{result.text}</pre></details>}
  </section>;
}
