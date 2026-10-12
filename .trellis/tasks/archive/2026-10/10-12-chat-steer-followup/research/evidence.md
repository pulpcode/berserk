# Evidence and implementation constraints

Reviewed 2026-10-12; planning only. Existing conversation already contains decision history, so no historical session search is needed.

## Current application

- `experiments/harness-lab/src/web/main.tsx:172`: `canSend` requires `!busy`.
- `experiments/harness-lab/src/web/useChat.ts:412`: one stream per session; active/background work blocks ordinary send. Local SSE reducer only inserts its initial user message; later text deltas can merge into the last assistant message. Native queued-user events need explicit projection.
- `experiments/harness-lab/src/server/app.ts:145`: ordinary messages start a request and retain POST SSE for its lifetime. No intake-only endpoint exists.
- `experiments/harness-lab/src/pi/lab.ts:947`: start synchronously reserves `record.active`; a second start is rejected.
- `lab.ts:988`–`1018`: resource snapshot, files, selections, sandbox and session constructed for one active request.
- `lab.ts:1067`: one `await session.prompt(...)`; native follow-ups can extend this same invocation.
- `lab.ts:1097`–`1117`: session disposal and single result record when prompt settles. `requestId` is the host run boundary, not every Pi assistant/tool turn.
- `.trellis/spec/backend/harness-lab.md`: client disconnect does not cancel work; one process owns the data directory; fresh sessions per request; captured instructions fixed across model calls.
- `.trellis/spec/frontend/harness-lab.md`: one compact composer, authenticated per-owner drafts and IME behavior; use web/random-uuid.ts on HTTP origins.
- `.trellis/spec/backend/hitl.md`: exact request-local interaction answers and approvals must not be bypassed with free-text steering.

## Pi 0.85.1 public behavior

Installed under `experiments/harness-lab/node_modules/@earendil-works/pi-coding-agent`.

- README.md:222: Enter steer, Alt+Enter follow-up, Escape restore queued text, Alt+Up retrieve queue; one-at-a-time default.
- dist/core/agent-session.js:1016,1033: public wrappers enqueue user messages and maintain text queues.
- dist/core/agent-session.js:363: queued text projection removes by `indexOf(messageText)` at message_start, checking steering first. This text-only display projection does not establish browser submission identity when identical text appears in both channels. The core queue stores separate message objects with push/drain and does NOT deduplicate identical content. Do not confuse a display-correlation limitation with message-execution loss.
- dist/core/agent-session.js:388: native persistence happens on message_end after listener notification. An observed event alone is not proof of successful disk persistence.
- dist/core/agent-session.js:1195: clearQueue clears both queues; abort is separate.
- nested pi-agent-core/dist/agent-loop.js:82–175: steering is polled around model/tool iterations; follow-ups after the inner work loop drains; agent_end only after both queues drain. No application-defined Codex turn ID provided here.
- nested pi-agent-core/dist/agent.js: public steer/followUp enqueue full AgentMessage objects; public queue clearing. Verify whether this lower public interface plus a monotonic unique message timestamp can provide intake correlation while retaining AgentSession history/compaction behavior. Never use private fields or patch dependency code.

## Official Codex reference (visual/interaction reference only)

https://learn.chatgpt.com/docs/prompting#steering-and-queuing

Queued messages above composer; desktop follow-up default configurable; CLI Enter steer / Tab queue. Our proposed Web Ctrl/Cmd+Enter preserves native Tab focus. Exact Codex colors or private UI implementation are not a requirement.

## Mandatory technical spike before UI implementation

Use deterministic real Pi with fake provider, no credentials/network. Prove: same text across both channels correlates correctly; acceptance vs final empty-queue read cannot silently lose input; stop/drain settles against queue takeback; no user event duplication around compaction/retry; SDK follow-up shares one host request and captured resources. If public interfaces cannot satisfy these, return to design review with the concrete gap rather than inventing a second scheduler or persistent Run model.

## Review preview

Current preview: /Users/lau/.codex/visualizations/2026/10/11/01a12a10-087c-78f1-b6fd-03738eb616b4/axon-queue-composer.html
User screenshot overrides the earlier card-based mock. Local browser checks covered Steer state, delete/undo, takeback, requeue and 375px overflow (none), with no page JS errors. This proves only mock interaction, not Pi/backend behavior.
