import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type RefObject } from 'react';
import { AssignmentAttachments, HandoffFiles } from './HandoffFiles';
import { Check, ChevronDown, CircleAlert, CircleHelp, Clock3, X } from 'lucide-react';
import type { ConfirmationInteraction, Interaction, InteractionAnswer, InteractionQuestion, InteractionResponse, PublicMessage, QuestionInteraction, SessionSnapshot } from '../contracts/index';

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
type Respond = (item: Interaction, response: InteractionResponse) => Promise<void>;
type Query = (item: Interaction) => Promise<void>;
const questionLabels: Record<QuestionInteraction['status'], string> = { pending: '待回答', answered: '已回答', skipped: '已跳过', cancelled: '已取消', expired: '已失效' };

/** The one pending interaction the composer area currently handles, in original record order. */
export function currentInteraction(snapshot: SessionSnapshot | undefined): Interaction | undefined {
  const active = snapshot?.active;
  if (!snapshot || !active || active.status === 'stopping') return undefined;
  return (snapshot.interactions || []).find(item => item.status === 'pending' && item.requestId === active.requestId);
}

function useAnswerDraft(item: QuestionInteraction) {
  const [draft, setDraft] = useState<AnswerDraft>(() => item.status === 'pending' ? readDraft(item) : {});
  useEffect(() => { if (item.status !== 'pending') clearInteractionDraft(item); }, [item]);
  const change = (id: string, value: AnswerDraft[string]) => {
    const next = { ...draft, [id]: value }; setDraft(next);
    const key = interactionDraftKey(item); memory.set(key, next);
    try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* Preserve the in-memory draft. */ }
  };
  return { draft, change };
}

function answerDraftOf(item: QuestionInteraction, draft: AnswerDraft) {
  const answers: InteractionAnswer[] = item.questions.map(question => {
    const value = draftAnswer(draft, question.id);
    return !question.options?.length || value?.custom ? { questionId: question.id, text: value?.text.trim() || '' } : { questionId: question.id, optionIds: value?.optionIds || [] };
  });
  const complete = answers.every(answer => 'text' in answer ? Boolean(answer.text) : answer.optionIds.length > 0);
  return { answers, complete };
}

function answerText(question: InteractionQuestion, answer: InteractionAnswer): string {
  return 'text' in answer ? answer.text : answer.optionIds.map(id => question.options?.find(option => option.id === id)?.label || id).join('、');
}

/** One editable question; pagination keeps the rest of the group mounted elsewhere. */
function QuestionFields({ item, question, index, total, value, disabled, change }: {
  item: QuestionInteraction; question: InteractionQuestion; index: number; total: number;
  value: AnswerDraft[string]; disabled: boolean; change: (id: string, value: AnswerDraft[string]) => void;
}) {
  return <fieldset disabled={disabled}><legend>{total > 1 ? `${index + 1}. ` : ''}{question.prompt}</legend>
    {question.options?.map(option => <label className="interaction-option" key={option.id}><input type={question.multiSelect ? 'checkbox' : 'radio'} name={`${item.interactionId}:${question.id}`} checked={!value.custom && value.optionIds.includes(option.id)} onChange={event => change(question.id, { ...value, custom: false, optionIds: question.multiSelect ? event.target.checked ? [...value.optionIds, option.id] : value.optionIds.filter(id => id !== option.id) : [option.id] })} /><span>{option.label}{option.description && <small>{option.description}</small>}</span></label>)}
    {Boolean(question.options?.length) && <label className="interaction-option"><input type="radio" name={`${item.interactionId}:${question.id}`} checked={value.custom} onChange={() => change(question.id, { ...value, custom: true, optionIds: [] })} /><span>自定义回答</span></label>}
    {(!question.options?.length || value.custom) && <div className="interaction-text"><label htmlFor={`${item.interactionId}:${question.id}:text`}>{question.options?.length ? '填写自定义回答' : '填写回答'}</label><textarea id={`${item.interactionId}:${question.id}:text`} rows={3} value={value.text} onChange={event => change(question.id, { ...value, custom: true, optionIds: [], text: event.target.value })} /></div>}
  </fieldset>;
}

export interface InteractionCardProps {
  interaction: Interaction; canRespond: boolean; submission?: InteractionSubmission;
  respond: Respond; query: Query; result?: PublicMessage;
  /** The owning request is currently executing this interaction's tool. */
  executing?: boolean;
}

/** Message-flow rendering: pending items are a status pointer only; the composer owns the form. */
export function InteractionCard({ interaction: item, canRespond, result, executing }: InteractionCardProps) {
  if (item.status === 'pending') {
    const question = item.kind === 'question';
    return <section className="interaction-card interaction-pointer" data-interaction-id={item.interactionId} data-state="pending" aria-label={question ? '提问状态' : '确认状态'}>
      <header>{question ? <CircleHelp size={18} aria-hidden="true" /> : <Clock3 size={18} aria-hidden="true" />}<strong>{question ? '需要你的回答' : '需要你的确认'}</strong><span className="interaction-status">{canRespond ? '请在下方输入区处理' : '等待处理'}</span></header>
      <p className="interaction-pointer-summary">{question ? item.questions.length > 1 ? `共 ${item.questions.length} 个问题` : item.questions[0]?.prompt || '' : item.action.title}</p>
    </section>;
  }
  if (item.kind === 'confirmation') return <ConfirmationHistory item={item} result={result} executing={executing} />;
  return <section className="interaction-card question-card" data-interaction-id={item.interactionId} data-state={item.status} aria-label="回答记录">
    <header><CircleHelp size={18} aria-hidden="true" /><strong>回答记录</strong><span className="interaction-status">{questionLabels[item.status]}</span></header>
    <div className="interaction-questions">{item.questions.map((question, index) => {
      const answer = item.answers?.find(entry => entry.questionId === question.id);
      return <div className="qa-record" key={question.id}>
        <p className="qa-question">{item.questions.length > 1 ? `${index + 1}. ` : ''}{question.prompt}</p>
        {answer && <p className="qa-answer">{answerText(question, answer)}</p>}
        {question.options?.length ? <details className="interaction-history-options"><summary>查看全部选项</summary><ul>{question.options.map(option => <li key={option.id}>{option.label}{option.description ? ` — ${option.description}` : ''}</li>)}</ul></details> : null}
      </div>;
    })}</div>
    {item.reason && <p className="interaction-reason">{item.reason}</p>}
  </section>;
}

const confirmationLabels: Record<ConfirmationInteraction['status'], string> = {
  pending: '待确认', approved: '已确认', rejected: '已拒绝', cancelled: '已取消', expired: '已失效',
};
const executionLabels: Record<NonNullable<ConfirmationInteraction['execution']>, string> = {
  succeeded: '执行已完成。', failed: '执行失败，请查看详情。',
  unknown: '执行结果未确认，请核对后再继续。', not_started: '未执行：操作在开始前已停止。',
};
const commandExecutionLabels: Record<NonNullable<ConfirmationInteraction['execution']>, string> = {
  succeeded: '外部系统已接收。', failed: '本次下达未完成，请查看结果。',
  not_started: '本次指令未下达。', unknown: '接收结果待核对。',
};
const handoffConfirmLabels = { assign: '确认分派', claim: '确认签收', submit: '确认提交', review: '确认审核' };
const isExternalCommand = (item: ConfirmationInteraction) => item.toolName === 'simulation_command_send';
function confirmActionLabel(item: ConfirmationInteraction): string {
  if (isExternalCommand(item)) return '确认下达';
  if (item.action.handoff) return handoffConfirmLabels[item.action.handoff.kind];
  return item.action.command !== undefined ? '允许本次执行' : '确认执行';
}

function ConfirmationDetails({ item }: { item: ConfirmationInteraction }) {
  return <>
    {item.action.handoff?.kind === 'assign' && <AssignmentAttachments files={item.action.handoff.files} />}
    <p className="confirmation-description">{item.action.description}</p>
    {item.action.handoff && item.action.handoff.kind !== 'assign' && item.action.handoff.files.length > 0 && <HandoffFiles files={item.action.handoff.files} />}
    {item.action.cwd !== undefined && <dl className="confirmation-metadata"><dt>工作目录</dt><dd><code>{item.action.cwd}</code></dd></dl>}
    {item.action.command !== undefined && <div className="confirmation-command"><span>完整命令</span><pre tabIndex={0} aria-label="完整命令">{item.action.command}</pre></div>}
    {item.reason && <p className="interaction-reason">{item.reason}</p>}
  </>;
}

function ConfirmationHistory({ item, result, executing }: { item: ConfirmationInteraction; result?: PublicMessage; executing?: boolean }) {
  const command = item.action.command !== undefined;
  const externalCommand = isExternalCommand(item);
  const status = confirmationLabels[item.status];
  const outcome = item.status === 'approved'
    ? item.execution ? (externalCommand ? commandExecutionLabels : executionLabels)[item.execution]
      : executing ? '正在执行…' : externalCommand ? '接收结果待核对。' : '执行结果待确认。'
    : undefined;
  const Icon = item.status === 'approved' && item.execution === 'succeeded' ? Check
    : item.status === 'rejected' || item.status === 'cancelled' ? X
    : command || item.execution === 'failed' || item.execution === 'unknown' ? CircleAlert : Clock3;
  return <section className="interaction-card confirmation-card" data-interaction-id={item.interactionId} data-state={item.status} data-command={command} data-execution={item.execution} aria-label="操作确认">
    <details className="confirmation-history">
      <summary><Icon size={16} aria-hidden="true" /><span className="confirmation-history-heading"><span className="confirmation-title">{item.action.title}</span>{outcome && <span className="confirmation-outcome">{outcome}</span>}</span><span className="confirmation-decision">{status}</span><ChevronDown className="confirmation-chevron" size={16} aria-hidden="true" /></summary>
      <div className="confirmation-body"><ConfirmationDetails item={item} /><p className="interaction-rule">{item.rule.reason}</p>
        {result?.text && <details className="interaction-result"><summary>{item.status === 'rejected' ? '拒绝后的工具返回' : result.isError ? '工具返回（未完成）' : '工具返回'}</summary><pre tabIndex={0}>{result.text}</pre></details>}
      </div>
    </details>
  </section>;
}

interface ComposerCardProps {
  interaction: Interaction; submission?: InteractionSubmission; respond: Respond; query: Query;
  /** The hidden composer textarea, used to hand focus back after the card. */
  composerInput: RefObject<HTMLTextAreaElement | null>;
  /** Whether focus was anywhere inside the composer dock when this card appeared. */
  dockFocus: RefObject<boolean>;
  focusScope: RefObject<string>;
}

/** The current interaction occupying the composer area; text/attachments/queue stay intact behind it. */
export function ComposerInteractionCard({ interaction: item, submission, respond, query, composerInput, dockFocus, focusScope }: ComposerCardProps) {
  const section = useRef<HTMLElement>(null);
  const focusInside = useRef(false);
  // A card replacing a focused composer gives that focus a visible landing spot.
  useLayoutEffect(() => {
    if (dockFocus.current) {
      focusInside.current = true;
      section.current?.focus();
    }
  }, [item.interactionId, dockFocus]);
  // Composer focus returns only when the user actually followed the card and no
  // successor card or other element has taken it in the meantime.
  useLayoutEffect(() => { const owner = focusScope.current; return () => {
    if (!focusInside.current) return;
    requestAnimationFrame(() => {
      const focused = document.activeElement;
      if ((!focused || focused === document.body) && focusScope.current === owner && composerInput.current?.isConnected && composerInput.current.getClientRects().length) composerInput.current.focus();
    });
  }; }, [composerInput, focusScope]);
  const focusHandlers = {
    onFocusCapture: () => { focusInside.current = true; },
    // A disabled or unmounted control blurs with no target; only a real outside landing leaves the card.
    onBlurCapture: (event: FocusEvent<HTMLElement>) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) focusInside.current = false; },
  };
  return item.kind === 'question'
    ? <ComposerQuestion item={item} submission={submission} respond={respond} query={query} section={section} focusHandlers={focusHandlers} />
    : <ComposerConfirmation item={item} submission={submission} respond={respond} query={query} section={section} focusHandlers={focusHandlers} />;
}

interface VariantProps {
  submission?: InteractionSubmission; respond: Respond; query: Query;
  section: RefObject<HTMLElement | null>;
  focusHandlers: { onFocusCapture: () => void; onBlurCapture: (event: FocusEvent<HTMLElement>) => void };
}

function ComposerQuestion({ item, submission, respond, query, section, focusHandlers }: VariantProps & { item: QuestionInteraction }) {
  const { draft, change } = useAnswerDraft(item);
  const [page, setPage] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const { answers, complete } = answerDraftOf(item, draft);
  const busy = Boolean(submission?.busy || submission?.needsQuery);
  const total = item.questions.length;
  const pageIndex = Math.min(page, total - 1);
  const question = item.questions[pageIndex];
  const value = (question && draftAnswer(draft, question.id)) || { optionIds: [], text: '', custom: false };
  return <section ref={section} tabIndex={-1} {...focusHandlers} className="interaction-card question-card composer-interaction" data-interaction-id={item.interactionId} data-state="pending" aria-label="Agent 提问" aria-busy={submission?.busy || undefined}>
    <header className="composer-interaction-header">
      <CircleHelp size={16} aria-hidden="true" /><strong>需要你的回答</strong>
      {total > 1 && <span className="interaction-page">第 {pageIndex + 1} / {total} 题</span>}
      <span className="interaction-status">{questionLabels[item.status]}</span>
      <button type="button" className="icon-button interaction-collapse" aria-expanded={!collapsed} aria-label={collapsed ? '展开提问' : '收起提问'} title={collapsed ? '展开提问' : '收起提问'} onClick={() => setCollapsed(value => !value)}><ChevronDown size={16} aria-hidden="true" /></button>
    </header>
    {!collapsed && question && <>
      <div className="composer-interaction-body">
        {item.reason && <p className="interaction-reason">{item.reason}</p>}
        <div className="interaction-questions"><QuestionFields item={item} question={question} index={pageIndex} total={total} value={value} disabled={busy} change={change} /></div>
      </div>
      <footer className="composer-interaction-footer">
        {submission?.error && <p className="resource-error" role="alert">{submission.error}</p>}
        <div className="interaction-actions">
          {submission?.needsQuery ? <button type="button" disabled={submission.busy} onClick={() => void query(item)}>{submission.busy ? '正在查询…' : '查询最新状态'}</button> : <>
            <button type="button" disabled={busy} onClick={() => void respond(item, { requestId: item.requestId, kind: 'question', action: 'skip' })}>跳过提问</button>
            {pageIndex > 0 && <button type="button" disabled={busy} onClick={() => setPage(pageIndex - 1)}>上一题</button>}
            {pageIndex < total - 1 && <button type="button" disabled={busy} onClick={() => setPage(pageIndex + 1)}>下一题</button>}
            <button type="button" className="primary-action" disabled={busy || !complete} onClick={() => void respond(item, { requestId: item.requestId, kind: 'question', action: 'answer', answers })}>{submission?.busy ? '提交中…' : '提交回答'}</button>
          </>}
        </div>
      </footer>
    </>}
  </section>;
}

function ComposerConfirmation({ item, submission, respond, query, section, focusHandlers }: VariantProps & { item: ConfirmationInteraction }) {
  const command = item.action.command !== undefined;
  const busy = Boolean(submission?.busy || submission?.needsQuery);
  const Icon = command ? CircleAlert : Clock3;
  return <section ref={section} tabIndex={-1} {...focusHandlers} className="interaction-card confirmation-card composer-interaction" data-interaction-id={item.interactionId} data-state="pending" data-command={command} aria-label="操作确认" aria-busy={submission?.busy || undefined}>
    <header className="confirmation-strip"><Icon size={16} aria-hidden="true" /><span>{confirmationLabels[item.status]}</span><span className="confirmation-kind">{item.action.handoff ? '工作交接' : command ? '命令执行' : '操作确认'}</span></header>
    <div className="confirmation-body"><h3>{item.action.title}</h3><ConfirmationDetails item={item} /></div>
    <footer className="confirmation-footer">
      <p className="interaction-rule">{item.rule.reason}</p>
      {submission?.error && <p className="resource-error" role="alert">{submission.error}</p>}
      <div className="interaction-actions">
        {submission?.needsQuery ? <button type="button" disabled={submission.busy} onClick={() => void query(item)}>{submission.busy ? '正在查询…' : '查询最新状态'}</button> : <>
          <button type="button" disabled={busy} onClick={() => void respond(item, { requestId: item.requestId, kind: 'confirmation', decision: 'reject' })}>拒绝</button>
          <button type="button" className="primary-action" disabled={busy} onClick={() => void respond(item, { requestId: item.requestId, kind: 'confirmation', decision: 'approve' })}>{submission?.busy ? '提交中…' : confirmActionLabel(item)}</button>
        </>}
      </div>
    </footer>
  </section>;
}
