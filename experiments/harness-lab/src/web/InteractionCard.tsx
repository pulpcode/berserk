import { messageAuthoringReceipt } from './authoring-receipt';
import type { AuthoringCandidate, AuthoringReceipt } from '../contracts/authoring';
import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type RefObject } from 'react';
import { AssignmentAttachments, HandoffFiles } from './HandoffFiles';
import { Check, ChevronDown, CircleAlert, CircleHelp, Clock3, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { ConfirmationInteraction, Interaction, InteractionAnswer, InteractionQuestion, InteractionResponse, PublicMessage, QuestionInteraction, SessionSnapshot } from '../contracts/index';

type AnswerDraft = Record<string, { optionIds: string[]; text: string; custom: boolean; skipped?: boolean }>;
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
      return Boolean(value && (value.skipped === undefined || typeof value.skipped === 'boolean') && typeof value.text === 'string' && typeof value.custom === 'boolean' && Array.isArray(value.optionIds) && value.optionIds.every(id => typeof id === 'string'));
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
    if (value?.skipped) return { questionId: question.id, skipped: true };
    return !question.options?.length || value?.custom ? { questionId: question.id, text: value?.text.trim() || '' } : { questionId: question.id, optionIds: value?.optionIds || [] };
  });
  const complete = answers.every(answer => 'skipped' in answer || ('text' in answer ? Boolean(answer.text) : answer.optionIds.length > 0));
  return { answers, complete };
}

function answerText(question: InteractionQuestion, answer: InteractionAnswer): string {
  return 'skipped' in answer ? '已跳过' : 'text' in answer ? answer.text : answer.optionIds.map(id => question.options?.find(option => option.id === id)?.label || id).join('、');
}

/** Inline answer grows within its row; composition never advances the question. */
function QuestionFields({ item, question, value, disabled, change, next }: {
  item: QuestionInteraction; question: InteractionQuestion; value: AnswerDraft[string]; disabled: boolean;
  change: (id: string, value: AnswerDraft[string]) => void; next: () => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const input = field.current;
    if (input) { input.style.height = '0px'; input.style.height = `${Math.min(160, input.scrollHeight)}px`; }
  }, [value.text, question.id]);
  return <fieldset disabled={disabled}><legend>{question.prompt}</legend>
    {question.options?.map(option => <label className="interaction-option" key={option.id}><input type={question.multiSelect ? 'checkbox' : 'radio'} name={`${item.interactionId}:${question.id}`} checked={!value.custom && !value.skipped && value.optionIds.includes(option.id)} onChange={event => {
      change(question.id, { ...value, skipped: false, custom: false, text: '', optionIds: question.multiSelect ? event.target.checked ? [...value.optionIds, option.id] : value.optionIds.filter(id => id !== option.id) : [option.id] });
      if (!question.multiSelect) next();
    }} /><span>{option.label}{option.description && <small>{option.description}</small>}</span></label>)}
    <div className="interaction-inline-answer"><textarea ref={field} aria-label="自定义回答" placeholder="输入你的答案…" rows={1} value={value.text} onFocus={() => { if (!value.custom) change(question.id, { ...value, custom: true, skipped: false, optionIds: [] }); }} onChange={event => change(question.id, { custom: true, skipped: false, optionIds: [], text: event.target.value })} onKeyDown={event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); if (value.text.trim()) next(); }
    }} /></div>
  </fieldset>;
}

export interface InteractionCardProps {
  openAuthoring?: (receipt: AuthoringReceipt) => void; interaction: Interaction; canRespond: boolean; submission?: InteractionSubmission;
  respond: Respond; query: Query; result?: PublicMessage;
  /** The owning request is currently executing this interaction's tool. */
  executing?: boolean;
}

/** Message-flow rendering: pending items are a status pointer only; the composer owns the form. */
export function InteractionCard({ interaction: item, result, executing, openAuthoring }: InteractionCardProps) {
  if (item.status === 'pending') {
    const question = item.kind === 'question';
    return <section className="interaction-card interaction-pointer" data-interaction-id={item.interactionId} data-state="pending" aria-label={question ? '提问状态' : '确认状态'}>
      {question ? <CircleHelp size={16} aria-hidden="true" /> : <Clock3 size={16} aria-hidden="true" />}<span>{question ? '提问 · 等待回答' : '确认 · 等待确认'}</span>
    </section>;
  }
  if (item.kind === 'confirmation') return <ConfirmationHistory item={item} result={result} executing={executing} openAuthoring={openAuthoring} />;
  return <section className="interaction-card question-card question-history" data-interaction-id={item.interactionId} data-state={item.status} aria-label="回答记录">
    {item.status === 'answered' ? <div className="qa-bubble">{item.questions.map(question => {
      const answer = item.answers?.find(entry => entry.questionId === question.id);
      return <div className="qa-record" key={question.id}><p className="qa-question">{question.prompt}</p><p className="qa-answer">{answer ? answerText(question, answer) : '未记录回答'}</p></div>;
    })}</div> : <p className="interaction-ended">提问 · {questionLabels[item.status]}</p>}
    <details className="interaction-history-options"><summary>原始提问</summary>{item.questions.map(question => <div key={question.id}><p>{question.prompt}</p>{question.options?.length ? <ul>{question.options.map(option => <li key={option.id}>{option.label}{option.description ? ` — ${option.description}` : ''}</li>)}</ul> : null}</div>)}</details>
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
  if (item.action.authoring) return '确认保存草稿';
  if (isExternalCommand(item)) return '确认下达';
  if (item.action.handoff) return handoffConfirmLabels[item.action.handoff.kind];
  return item.action.command !== undefined ? '允许本次执行' : '确认执行';
}

function CandidateContents({ candidate }: { candidate: AuthoringCandidate }) {
  if (candidate.kind === 'expert') return <dl className="authoring-candidate-fields">{Object.entries(candidate.content).map(([key, value]) => <div key={key}><dt>{{name:'名称',description:'简介',instructions:'专业指令',skillIds:'原有技能引用',skillRefs:'固定技能引用',allowedTools:'工具范围'}[key] || key}</dt><dd><pre tabIndex={0}>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre></dd></div>)}</dl>;
  return <>{candidate.files.map(file => {
    let content: string;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(file.contentBase64), value => value.charCodeAt(0))); }
    catch { content = '文件无法显示为文本，请取消本次保存并核对内容。'; }
    return <section key={file.path}><h4>{file.path}</h4><pre tabIndex={0}>{content}</pre></section>;
  })}{Object.keys(candidate.requirements).length > 0 && <section><h4>已有环境声明</h4><pre>{JSON.stringify(candidate.requirements, null, 2)}</pre></section>}</>;
}

function candidateChanges(candidate: AuthoringCandidate, before?: AuthoringCandidate): string[] {
  if (candidate.kind === 'expert') return Object.keys(candidate.content).filter(key => !before || before.kind !== 'expert' || JSON.stringify(candidate.content[key as keyof typeof candidate.content]) !== JSON.stringify(before.content[key as keyof typeof before.content])).map(key => ({ name: '名称', description: '简介', instructions: '专业指令', skillIds: '原有技能引用', skillRefs: '固定技能引用', allowedTools: '工具范围' }[key] || key));
  const previous = new Map(before?.kind === 'skill' ? before.files.map(file => [file.path, file.contentBase64]) : []);
  const current = new Map(candidate.files.map(file => [file.path, file.contentBase64]));
  return [...candidate.files.filter(file => previous.get(file.path) !== file.contentBase64).map(file => `${previous.has(file.path) ? '修改' : '新增'}：${file.path}`), ...[...previous.keys()].filter(path => !current.has(path)).map(path => `删除：${path}`)];
}

function ConfirmationDetails({ item }: { item: ConfirmationInteraction }) {
  return <>
    {item.action.handoff?.kind === 'assign' && <AssignmentAttachments files={item.action.handoff.files} />}
    <p className="confirmation-description">{item.action.description}</p>
    {item.action.authoring && <div className="authoring-confirmation"><dl className="confirmation-metadata"><dt>保存目标</dt><dd>{item.action.authoring.proposal.targetId || `新建${item.action.authoring.proposal.candidate.kind === 'expert' ? '专家' : '技能'}`}</dd><dt>当前基线</dt><dd>{item.action.authoring.proposal.baseline ? `草稿 ${item.action.authoring.proposal.baseline.draftRevision} · ${item.action.authoring.proposal.baseline.digest}` : '新建草稿'}</dd></dl><p>本次变更：{candidateChanges(item.action.authoring.proposal.candidate, item.action.authoring.proposal.before).join('、') || '内容未变化'}</p>{item.action.authoring.proposal.before && <details><summary>保存前的完整内容</summary><CandidateContents candidate={item.action.authoring.proposal.before} /></details>}<details><summary>查看完整候选</summary><CandidateContents candidate={item.action.authoring.proposal.candidate} /></details></div>}
    {item.action.handoff && item.action.handoff.kind !== 'assign' && item.action.handoff.files.length > 0 && <HandoffFiles files={item.action.handoff.files} />}
    {item.action.cwd !== undefined && <dl className="confirmation-metadata"><dt>工作目录</dt><dd><code>{item.action.cwd}</code></dd></dl>}
    {item.action.command !== undefined && <div className="confirmation-command"><span>完整命令</span><pre tabIndex={0} aria-label="完整命令">{item.action.command}</pre></div>}
    {item.reason && <p className="interaction-reason">{item.reason}</p>}
  </>;
}

function ConfirmationHistory({ item, result, executing, openAuthoring }: { openAuthoring?: (receipt: AuthoringReceipt) => void; item: ConfirmationInteraction; result?: PublicMessage; executing?: boolean }) {
  const receipt = item.status === 'approved' && item.execution === 'succeeded' ? messageAuthoringReceipt(result) : undefined;
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
      <summary><Icon size={16} aria-hidden="true" /><span className="confirmation-history-heading"><span className="confirmation-title">{item.action.command ?? item.action.title}</span>{outcome && <span className="confirmation-outcome">{outcome}</span>}</span><span className="confirmation-decision">{status}</span><ChevronDown className="confirmation-chevron" size={16} aria-hidden="true" /></summary>
      <div className="confirmation-body">{command && <h3>{item.action.title}</h3>}<ConfirmationDetails item={item} />{item.rule.reason !== item.action.description && item.rule.reason !== item.reason && <p className="interaction-rule">{item.rule.reason}</p>}
        {receipt && openAuthoring && <button type="button" onClick={() => openAuthoring(receipt)}>查看{receipt.kind === 'expert' ? '专家' : '技能'}详情</button>}{result?.text && <details className="interaction-result"><summary>{item.status === 'rejected' ? '拒绝后的工具返回' : result.isError ? '工具返回（未完成）' : '工具返回'}</summary><pre tabIndex={0}>{result.text}</pre></details>}
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
  const advance = () => setPage(current => Math.min(current + 1, total - 1));
  const value = (question && draftAnswer(draft, question.id)) || { optionIds: [], text: '', custom: false };
  return <section ref={section} tabIndex={-1} {...focusHandlers} className="interaction-card question-card composer-interaction" data-interaction-id={item.interactionId} data-state="pending" aria-label="Agent 提问" aria-busy={submission?.busy || undefined}>
    <header className="composer-interaction-header">
      <span className="interaction-collapsed-title">{collapsed ? question?.prompt : "提问"}</span>
      <button type="button" className="icon-button interaction-collapse" aria-expanded={!collapsed} aria-label={collapsed ? '展开提问' : '收起提问'} title={collapsed ? '展开提问' : '收起提问'} onClick={() => setCollapsed(value => !value)}><ChevronDown size={16} aria-hidden="true" /></button>
    </header>
    {!collapsed && question && <>
      <div className="composer-interaction-body">
        {item.reason && <p className="interaction-reason">{item.reason}</p>}
        <div className="interaction-questions"><QuestionFields item={item} question={question} value={value} disabled={busy} change={change} next={advance} /></div>
      </div>
      <footer className="composer-interaction-footer">
        {submission?.error && <p className="resource-error" role="alert">{submission.error}</p>}
        <div className="question-navigation">
          <div className="question-pager"><button type="button" className="icon-button" aria-label="上一题" disabled={busy || pageIndex === 0} onClick={() => setPage(pageIndex - 1)}><ChevronLeft size={16} /></button><span>{pageIndex + 1} / {total}</span><button type="button" className="icon-button" aria-label="后一题" disabled={busy || pageIndex === total - 1} onClick={advance}><ChevronRight size={16} /></button></div>
          <div className="interaction-actions">
            {submission?.needsQuery ? <button type="button" disabled={submission.busy} onClick={() => void query(item)}>{submission.busy ? '正在查询…' : '查询最新状态'}</button> : <>
              <button type="button" disabled={busy} onClick={() => { change(question.id, { optionIds: [], text: '', custom: false, skipped: true }); advance(); }}>跳过本题</button>
              {complete ? <button type="button" className="primary-action" disabled={busy} onClick={() => void respond(item, { requestId: item.requestId, kind: 'question', action: 'answer', answers })}>{submission?.busy ? '提交中…' : '提交回答'}</button> : <button type="button" className="primary-action" disabled={busy || !(value.skipped || (value.custom || !question.options?.length ? value.text.trim() : value.optionIds.length))} onClick={() => { const missing = answers.findIndex(answer => !('skipped' in answer) && ('text' in answer ? !answer.text : !answer.optionIds.length)); if (pageIndex === total - 1 && missing >= 0) setPage(missing); else advance(); }}>下一题</button>}
            </>}
          </div>
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
      {item.rule.reason !== item.action.description && item.rule.reason !== item.reason && <p className="interaction-rule">{item.rule.reason}</p>}
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
