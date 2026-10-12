import { isDeepStrictEqual } from 'node:util';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { InputAction, InputQueueState, InputReceipt, InputResult, InputSubmission } from '../contracts/index.js';
import { RequestError } from '../contracts/errors.js';

type Message = Parameters<AgentSession['agent']['steer']>[0];
interface Entry { receipt: InputReceipt; original: InputSubmission; message: Message; sequence: number }
const conflict = (message = '消息状态已变化，请刷新后重试。') => new RequestError('INPUT_CONFLICT', message, 409);

/** Receipt projection only. Pi's queues remain the sole execution scheduler. */
export class MessageIntake {
  private entries = new Map<string, Entry>();
  private actions = new Map<string, { signature: string; submissionId: string }>();
  private revision = 0;
  private sequence = 0;
  private timestamp = Date.now();
  private run?: { id: string; session: AgentSession; open: boolean; stopped: boolean; parked: boolean; reason: () => string | undefined; changed: () => void; consumed: (receipt: InputReceipt) => void; unsubscribe: () => void };

  bind(id: string, session: AgentSession, reason: () => string | undefined, changed: () => void, consumed: (receipt: InputReceipt) => void) {
    // Preserve unreturned content across runs; old terminal receipts may be forgotten.
    for (const [key, entry] of this.entries) if (!['pending', 'returned'].includes(entry.receipt.status)) this.entries.delete(key);
    this.actions.clear();
    session.agent.steeringMode = 'one-at-a-time'; session.agent.followUpMode = 'one-at-a-time';
    const run = {id, session, open: false, stopped: false, parked: false, reason, changed, consumed, unsubscribe: () => {}};
    this.run = run;
    // AgentSession's earlier listener persists message_end before this listener runs.
    // turn_end is awaited by the core before its queue drain; reopening on assistant
    // start guarantees drained users have already been delivered and persisted.
    run.unsubscribe = session.agent.subscribe(event => {
      if (this.run !== run) return;
      if (event.type === 'turn_end' || event.type === 'agent_end') { run.open = false; this.notify(); }
      if (event.type === 'turn_end' && event.message.role === 'assistant' && ['error', 'aborted', 'length'].includes(event.message.stopReason)) {
        // AgentSession otherwise uses any remaining queue to continue after even
        // a permanent provider error. Let only Pi's own recovery start another run.
        run.session.agent.clearAllQueues(); run.parked = true;
      }
      // Truncated tool output can continue within the same native run, without
      // another agent_start. Restore only when Pi actually resumes its loop.
      if ((event.type === 'agent_start' || (event.type === 'message_start' && event.message.role === 'assistant')) && run.parked && !run.stopped) {
        run.parked = false;
        for (const entry of this.ordered()) if (entry.receipt.requestId === id && entry.receipt.status === 'pending') run.session.agent[entry.receipt.mode](entry.message);
      }
      if (event.type === 'message_start' && event.message.role === 'assistant' && !run.stopped) { run.open = true; this.notify(); }
      if (event.type === 'message_end' && event.message.role === 'user') {
        const entry = [...this.entries.values()].find(item => item.receipt.requestId === id && item.message === event.message);
        if (entry?.receipt.status === 'pending') {
          entry.receipt.status = 'consumed'; this.revision++; consumed({...entry.receipt}); this.notify();
        }
      }
    });
    this.revision++; this.notify();
  }

  state(): InputQueueState {
    const run = this.run;
    const reason = !run ? '当前回复已结束。' : run.stopped ? '正在停止，请稍候。' : run.reason() ?? (!run.open ? '正在准备下一步，请稍候。' : undefined);
    return { ...(run ? {requestId: run.id} : {}), revision: this.revision, available: !reason,
      ...(reason ? {reason} : {}), items: [...this.entries.values()].filter(item => item.receipt.status === 'pending' || item.receipt.status === 'returned').map(item => ({...item.receipt})) };
  }

  lookup(id: string): InputResult { return {receipt: this.entries.has(id) ? {...this.entries.get(id)!.receipt} : null, queue: this.state()}; }

  submit(input: InputSubmission): InputResult {
    const previous = this.entries.get(input.submissionId);
    if (previous) {
      if (!isDeepStrictEqual(previous.original, input)) throw conflict('同一发送标识不能用于不同内容。');
      return this.lookup(input.submissionId);
    }
    this.checkWritable(input.expectedRequestId);
    if (!input.text.trim() || input.text.length > 16000) throw new RequestError('INVALID_INPUT', '请输入不超过 16000 字的消息。');
    if (this.entries.size >= 256) throw conflict('本轮追加消息过多，请等待回复结束。');
    this.checkCapacity(input.text);
    const message: Message = {role: 'user', content: [{type: 'text', text: input.text}], timestamp: this.timestamp = Math.max(Date.now(), this.timestamp + 1)};
    const receipt: InputReceipt = {submissionId: input.submissionId, requestId: input.expectedRequestId, mode: input.mode, text: input.text, status: 'pending'};
    this.entries.set(input.submissionId, {receipt, original: {...input}, message, sequence: ++this.sequence});
    this.run!.session.agent[input.mode](message);
    this.revision++; this.notify(); return this.lookup(input.submissionId);
  }

  act(id: string, action: InputAction): InputResult {
    const signature = JSON.stringify([id, action.expectedRequestId, action.pendingRevision, action.action]); const previous = this.actions.get(action.actionId);
    if (previous) { if (previous.signature !== signature) throw conflict('操作标识已用于其他操作。'); return this.lookup(previous.submissionId); }
    const entry = this.entries.get(id);
    if (!entry || entry.receipt.requestId !== action.expectedRequestId) throw conflict('消息接收记录不可用，请核对当前对话。');
    if (action.pendingRevision !== this.revision && !(action.action === 'takeback' && entry.receipt.status === 'returned')) throw conflict();
    if (this.actions.size >= 1024) throw conflict('本轮操作次数过多，请等待回复结束。');
    const receipt = entry.receipt;
    if (action.action === 'undo') {
      if (receipt.status !== 'deleted') throw conflict();
      this.checkCapacity(receipt.text);
      if (this.run?.id === receipt.requestId && !this.run.stopped) {
        this.checkWritable(receipt.requestId); receipt.status = 'pending'; entry.sequence = ++this.sequence; this.run.session.agent[receipt.mode](entry.message);
      } else receipt.status = 'returned';
    } else if (action.action === 'takeback' && receipt.status === 'returned') {
      receipt.status = 'takenBack';
    } else {
      this.checkWritable(receipt.requestId);
      if (receipt.status !== 'pending') throw conflict('这条消息已开始处理，不能再修改。');
      if (action.action === 'steer') { if (receipt.mode !== 'steer') entry.sequence = ++this.sequence; receipt.mode = 'steer'; }
      else receipt.status = action.action === 'delete' ? 'deleted' : 'takenBack';
      // No await here: the native loop cannot drain between clear and requeue.
      this.run!.session.agent.clearAllQueues();
      for (const item of this.ordered()) if (item.receipt.status === 'pending' && item.receipt.requestId === this.run!.id) this.run!.session.agent[item.receipt.mode](item.message);
    }
    this.actions.set(action.actionId, {signature, submissionId: id});
    this.revision++; this.notify(); return this.lookup(id);
  }

  stop() {
    if (!this.run) return;
    this.run.stopped = true; this.run.open = false;
    this.run.session.agent.clearAllQueues(); this.revision++; this.notify();
  }

  finish() {
    const run = this.run; if (!run) return;
    run.unsubscribe(); run.session.agent.clearAllQueues();
    for (const item of this.entries.values()) if (item.receipt.requestId === run.id && item.receipt.status === 'pending') item.receipt.status = 'returned';
    this.run = undefined; this.revision++; run.changed();
  }

  private ordered() { return [...this.entries.values()].sort((a, b) => a.sequence - b.sequence); }
  private notify() { this.run?.changed(); }
  private checkWritable(id: string) {
    if (this.run?.id !== id) throw conflict('刚才的回复已结束，请作为新消息发送。');
    const state = this.state(); if (!state.available) throw new RequestError('INPUT_UNAVAILABLE', state.reason!, 409);
  }
  private checkCapacity(text: string) {
    const pending = [...this.entries.values()].filter(item => ['pending', 'returned'].includes(item.receipt.status));
    if (pending.length >= 32 || pending.reduce((sum, item) => sum + item.receipt.text.length, text.length) > 32000) throw conflict('待处理内容过多，请先处理或取回已有消息。');
  }
}
