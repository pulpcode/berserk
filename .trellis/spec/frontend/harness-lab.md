# Harness Lab Frontend Contract

## 1. Scope / Trigger

Read when changing `experiments/harness-lab/src/web`. W01-1 is a React conversation UI with a session sidebar and chat pane. Run inspectors, confirmations, artifacts, Memory/Skill editors and business dashboards are later work.

## 2. Signatures

`api<T>(path, body?)` handles JSON GET/POST. `sendMessage(id, text, receive)` consumes POST SSE without implicit retries. `useChat` owns snapshots, selection, independent drafts, pending streams and cancellation. `src/contracts/index.ts` is the shared type owner.

## 3. Contracts

Key snapshots, drafts, errors and stream tokens by session ID. Accept stream events only for the owning session and request. Terminal snapshots are authoritative. Stale GET responses cannot overwrite newer stream updates. Switching tabs never cancels server execution or copies an old stream into the newly selected conversation.

Persist drafts and selection in sessionStorage; storage failures must leave in-memory editing usable. Enter sends only outside IME composition; Shift+Enter inserts a newline. During a response keep the composer editable for the next draft, but prevent submission until the active request settles.

Refresh performs GET only. Poll server snapshots to observe work accepted by the still-running server. Never retry a POST automatically. Use native semantic controls, labels, visible focus, a polite status region, reduced motion, and a narrow-screen session drawer. Render model Markdown without raw HTML execution. Enable GFM tables through remark-gfm, retain table/header/cell semantics, and put wide tables in a keyboard-scrollable container so they cannot overflow the mobile page.

## 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| API/config failure | Visible actionable message, preserve draft |
| Busy | Disable send, preserve next draft |
| Cancel | Send exact requestId, show stopping until settled |
| Disconnect | Query state, no resend |
| Stale event or GET | Ignore; never overwrite a newer request |
| Recovery warning | Show explanation and allow new session |

## 5. Good / Base / Bad Cases

Good: type draft B while A runs, switch sessions, return to A with its stream and B draft intact.
Base: create a session and receive a streamed plain answer.
Bad: IME Enter sends prematurely, page refresh repeats the last command, or a failed input erases a newer draft.

## 6. Tests Required

`npm run test:e2e` uses a deterministic HTTP test service and browser to verify IME, drafts, session switching during streams, cancellation settlement, late events, refresh without POST, errors, tool details, semantic Markdown tables and mobile overflow/focus. This is UI evidence, not real-model acceptance. Build and type-check before delivery.

## 7. Wrong vs Correct

Wrong: append every arriving delta into the selected chat.

Correct: bind each stream to its captured session and request, use a stream token to reject old events, and replace temporary messages with the terminal server snapshot.
