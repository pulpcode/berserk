# Harness Lab Frontend Contract

## 1. Scope / Trigger

Read when changing `experiments/harness-lab/src/web`. The React conversation UI includes W01-1 chat behavior and W01-2/S2a workspace selection, instruction editing, fixed Skill viewing and per-request resource details. Keep conversation central; business task trees, Runs, operation approvals, artifact management and arbitrary file access are outside this increment.

## 2. Signatures

- `api<T>(path, body?, method?)` handles direct JSON responses with `ApiFailure` errors; explicit PUT is used for instruction edits.
- `sendMessage(sessionId, text, receive)` consumes POST SSE without implicit retry.
- `useChat` owns workspace/session selection, snapshots, independent drafts, pending streams, submitted-text recovery and cancellation.
- `useInstructions` owns workspace-keyed editor state, GET/PUT lifecycle, comparison text and manual conflict resolution.
- `Resources` renders current instructions/source metadata/fixed Skills in a modal panel.
- `RequestResources({sessionId, requestId?, close})` fetches historical loaded content or explains missing evidence.
- `Panel` uses a native modal dialog, keyboard dismissal and focus restoration.

`src/contracts/index.ts` owns public types. The browser must not import Pi, parse native JSONL, derive resource paths or infer writable scope from instruction text.

## 3. Contracts

### Workspaces, sessions and streams

Fetch workspace choices from `/api/workspaces`; sessions and source metadata come from the selected workspace's endpoints. `/api/info` no longer owns a global source catalog. Every session has a fixed `workspaceId`; changing the selector does not move sessions or cancel execution. Preserve the most recently selected session per workspace. An empty workspace can create a session explicitly or when its first message is sent.

Key chat snapshots, drafts, errors and streams by session ID. Use a workspace-specific draft key before its first session exists. Capture the workspace/session before asynchronous creation or sending; if selection changes while creation is pending, the original message and any newer draft remain in their original workspace. Do not transfer the eventual reply into the selected view.

Accept stream events only for their captured session ID, request ID and local stream token. Reject events after a terminal frame. Terminal snapshots are authoritative. Clear pending on the terminal frame itself; a failing follow-up GET must not keep a completed request stuck as responding. Guard GET results with snapshot revisions so older responses cannot overwrite newer stream events. Poll selected-session snapshots to recover status after refresh/disconnection; never implicitly replay POST.

Persist drafts, submitted text and selection in sessionStorage. Storage exceptions must leave in-memory editing usable. Preserve the pending submitted text separately from a user's next draft. Restore failed submissions only when doing so does not overwrite new input; offer explicit recovery when both exist. Cancellation during preparation also restores submitted text if no user message for that request reached native history. Cancellation after a message is recorded does not imply that the user message or file effects were undone.

### Instruction editor and conflicts

Fetch `common` as readonly and `workspace` as editable; resources are keyed by workspace ID. An editor keeps distinct `draft`, `base`, optional `latest`, `review` and `canMerge` state. Do not rebase a draft merely because a GET returned a different version. Opening a panel or refreshing may fetch comparison content but must preserve unsaved edits.

A normal save sends the captured draft with its base hash:

```ts
await api<InstructionUpdate>(path, {
  content: editor.draft,
  expectedHash: editor.base.hash,
}, 'PUT');
```

A 409 `INSTRUCTION_CONFLICT` preserves the draft and reports that the save failed because the file changed. “查看最新内容” performs GET and displays a separate readonly comparison; it does not replace the draft or automatically retry PUT. Only explicit “合并后保存” uses the hash of the latest successfully viewed content. The user decides the merged text.

A renewed conflict or uncertain save invalidates merge eligibility until another successful read. Keep the old comparison visible if a read fails. “放弃草稿，使用最新内容” requires already-read comparison content and explicitly replaces draft and base together; this is a local change with no PUT. Clearing content edits only the draft until Save is clicked. No forced-overwrite action exists.

Keep the textarea usable during a save: success rebases to the submitted content/hash while preserving any edits typed since submission. Prevent concurrent saves and invalidate reads that started before the save, so a late GET cannot restore stale comparison state. Server errors/disconnection preserve the draft; an uncertain result requires reading current content before a manual retry. Do not automatically resend.

Instruction editor state and asynchronous responses remain attached to the originating workspace. Skill requests use a token to ignore older or unmounted responses. A stale response cannot replace a newer Skill view or another workspace's editor.

### Current resources versus historical evidence

“工作区资料” is an on-demand panel for current editable instructions, readonly common text, source metadata and the two fixed Skills. Show save success as effective on the next send. A chat's `instructions.updated`/terminal results can display actual saved effects, including cancellation, or an explicit need to inspect current files when the outcome is uncertain.

“查看本轮资料” opens the historical request endpoint using the owning session and request ID. Show the actual loaded texts/hashes and read Skill versions/body, readonly. Keep hash strings inside details rather than the main conversation. Old messages without request IDs explain that the request was not recorded; `unavailable` responses must not be filled from current files.

The details action normally belongs to assistant messages. When a request has a user message but no assistant text, expose it on that user message. When the latest terminal request has no persisted message, expose the action with its terminal status area. Preparation/provider failures must not make existing resource evidence inaccessible. A request without a resource record still opens an explicit unavailable explanation.

### Interaction and accessibility

Enter sends only outside IME composition; Shift+Enter inserts a newline. During a reply keep the composer editable for the next draft but disallow submission until the request settles. Stop uses the exact active request ID and remains stopping until settlement. Refresh, comparison viewing, discard and history viewing perform GET/local state changes only.

Use semantic labelled controls, visible focus, a polite status region, reduced-motion support and the narrow-screen sidebar drawer. Resource dialogs support Escape and restore focus to the originating control when it still exists. Ctrl/⌘+S saves instructions only outside IME composition and with a valid save/merge state. Show conflict comparison columns vertically on narrow screens without page overflow.

Render model Markdown without raw HTML execution. Enable GFM through remark-gfm, retain table/header/cell semantics and wrap wide tables in a named, keyboard-scrollable region. Keep busy, stopping, failed and recovery-required states understandable without exposing internal paths or JSON in the main chat.

## 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Initial API/configuration failure | Actionable message; drafts preserved; no send until configured/loaded |
| Active request | Editable next draft, send blocked, exact-request Stop available |
| Workspace/session switch during execution | Work continues in its original scope; independent drafts/replies |
| SSE terminal followed by failed GET | Terminal snapshot remains authoritative; no stuck pending state |
| Disconnection without terminal evidence | Query state, no implicit message retry |
| Stale event/GET/Skill response | Ignore without replacing newer or differently scoped state |
| Preparation failure/early cancellation | Preserve/recover unrecorded submitted text without overwriting a newer draft |
| Instruction version conflict | Keep draft; fetch readonly comparison; explicit manual merge or discard |
| Comparison GET failure | Keep draft and existing comparison; show retry |
| Repeated conflict/uncertain PUT result | Keep edits; require fresh successful read before merge retry |
| Recovery warning in native history | Show explanation and allow a new session; do not auto-resume |
| Missing historical request evidence | Show unavailable/legacy explanation, never current text as historical text |

## 5. Good / Base / Bad Cases

Good: A streams in workspace 1 while the user switches to workspace 2, edits its own draft and returns to A with the correct stream and next draft intact. Agent edits to the shared workspace instruction produce a conflict in a stale editor; the draft and latest file remain separately visible until manual merge.

Base: create/select a workspace, send an ordinary message, view a readonly Skill or loaded request details on demand, refresh without sending again.

Bad: append every delta to the selected chat, silently replace an instruction draft after GET, claim Stop rolled back a saved file, lose a preflight-failed input, or hide request details because no assistant text was produced.

## 6. Tests Required

Run `npm run typecheck`, `npm run lint`, `npm run test:e2e` and `npm run build` after relevant code changes. Browser tests use a deterministic HTTP service; they are UI evidence, not proof of real-model compliance.

Assert IME behavior, chat/sessionStorage failures, draft isolation, same/cross-workspace switching during streams, first-session creation races, exact-request cancellation, late events, polling after refresh and no implicit POST. Cover terminal SSE followed by failed GET and failures/cancellation before any persisted message, including draft restoration and accessible historical details.

Editor tests must assert actual GET/PUT counts and payload hashes: preserve edits on conflict, view latest without rebasing, manual merge success, repeated conflicts, comparison read failure, uncertain saves, explicit discard without PUT, stale responses after switching, clearing/saving and keyboard/IME behavior. Include fixed Skill viewing and historical snapshot contents independent of current files.

Verify actual tool details, semantic Markdown tables, mobile overflow/scrollability, native dialogs, Escape and focus restoration. Use real Web → API → Pi → provider validation separately for instruction effects, natural-language file edits and actual Skill/source use.

## 7. Wrong vs Correct

Wrong: use the currently selected workspace inside an old network callback.

Correct: capture the owner when starting the operation and update state keyed by that owner; selection determines only what is visible.

Wrong: overwrite `draft` and `base` when the conflict comparison arrives, then retry the old text.

Correct: retain `draft`/`base`, store `latest` separately and use its hash only for the explicit manual-merge action.

Wrong: leave pending true until a follow-up GET succeeds, even after receiving a terminal SSE snapshot.

Correct: settle local pending state when the terminal event arrives and retain its authoritative snapshot if later status queries fail.
