# Harness Lab Frontend Contract

## 1. Scope / Trigger

Read when changing `experiments/harness-lab/src/web`. The React conversation UI includes W01-1 chat behavior and W01-2/S2a workspace selection, instruction editing, fixed Skill viewing, plus W01-3 compaction status/readonly summary details, W01-4 role-aware child-task cards and W01-5 file uploads, browsing and download cards. Keep conversation central; business task trees, persistent Runs and business artifact states remain outside this increment. W01-6 adds the request-local interactions below.

## 2. Signatures

- `api<T>(path, body?, method?)` handles direct JSON responses with `ApiFailure` errors; explicit PUT is used for instruction edits.
- `sendMessage(sessionId, text, receive)` consumes POST SSE without implicit retry.
- `useChat` owns workspace/session selection, snapshots, independent drafts, pending streams, submitted-text recovery, cancellation and global activity polling/read markers.
- `WorkspaceNavigation` groups sessions by workspace; `ActivityOverview` filters global summaries without fetching conversation bodies.
- `useInstructions` owns workspace-keyed editor state, GET/PUT lifecycle, comparison text and manual conflict resolution.
- `Resources` renders current instructions/source metadata/fixed Skills in a modal panel.
- `Panel` uses a native modal dialog, keyboard dismissal and focus restoration.

`src/contracts/index.ts` owns public types. The browser must not import Pi, parse native JSONL, derive resource paths or infer writable scope from instruction text.

## 3. Contracts

### Workspaces, sessions and streams

Fetch workspace choices and all-session navigation metadata from `/api/activity`; source metadata comes from the selected workspace's resources endpoint. `/api/info` does not own a global source catalog. Every session has a fixed `workspaceId`; navigating to another workspace does not move sessions or cancel execution. Selecting a session resolves its workspace from the owned summary. Preserve the most recently selected session per workspace. An empty workspace can create a session explicitly or when its first message is sent.

Poll global activity about every 1800 ms with one request in flight; refresh on window focus. Retain the last result and explicitly report stale status on failure. Merge by ID, retain existing navigation order, and preserve locally created records when an older GET arrives. Workspace POST and polling can observe the same creation in either order: deduplicate IDs. Guard summaries using per-session revisions captured before GET; an active local stream accepts only its own request's active summary, never an old terminal result. Summary changes invalidate older detail GETs. Compare semantic fields rather than JSON property order to avoid false revisions. Summary metadata must never replace the stored conversation body.

Group collapse retains active/attention counts; global filters are all, active, and attention (failed, recovery warning or unread success). Store last viewed successful request ID per session under `berserk.read-results` in sessionStorage. Completion alone does not imply read: require visible foreground chat, loaded snapshot and summary agreeing on a successful request ID, no active request, no covering dialog/drawer and scroll within 32 px of the bottom. Polling the activity view never marks read. Reading position/follow-bottom is session-keyed in memory and survives navigation through other sessions or the activity view.

Key chat snapshots, drafts, errors and streams by session ID. Use a workspace-specific draft key before its first session exists. Capture the workspace/session before asynchronous creation or sending; if selection changes while creation is pending, the original message and any newer draft remain in their original workspace. Do not transfer the eventual reply into the selected view.

Accept stream events only for their captured session ID, request ID and local stream token. Reject events after a terminal frame. Terminal snapshots are authoritative. Clear pending on the terminal frame itself; a failing follow-up GET must not keep a completed request stuck as responding. Guard GET results with snapshot revisions so older responses cannot overwrite newer stream events. Poll selected-session snapshots to recover status after refresh/disconnection; never implicitly replay POST.

Persist drafts, submitted text and selection in sessionStorage. Storage exceptions must leave in-memory editing usable. Preserve the pending submitted text separately from a user's next draft. Restore failed submissions only when doing so does not overwrite new input; offer explicit recovery when both exist. Cancellation during preparation also restores submitted text if no user message for that request reached native history. Cancellation after a message is recorded does not imply that the user message or file effects were undone.

### Project entry points and model settings

The UI calls workspaces projects; API/storage ownership remains `workspaceId`. Global New Conversation opens a project-select dialog and creates only after confirmation. A group's plus button directly calls `create(targetWorkspaceId)`, including folded groups. Capture a navigation revision before POST; completion enters the new session only when the user has not navigated since. Preserve later selections and keep the result/draft in the captured target project. Entering All Activity must also invalidate pending creation navigation. Surface cross-project creation failures in the visible page; only focus a successfully created conversation if the user has not navigated and no modal covers it. Never create on opening/cancelling the picker.

Successful unread results use an accessible blue dot (`有新回复未读`); successful read and ordinary idle sessions have no visible status text. Keep active, stopping, failed and recovery indicators. New-session/settings dialogs also block mark-read while covering the chat.

`ModelSettings` uses GET/PUT `/api/settings/model` and refreshes `/api/info` after save. The centered settings dialog has a single Models section. API keys are write-only password fields, initially blank, never copied from GET or persisted in browser storage. Empty key retains the current secret only when provider/endpoint stay unchanged; destination changes require an explicit key. Clear key after successful save and destroy it on close. Preserve form edits on failures; version conflict or uncertain save requires manually viewing fresh configuration before explicit retry. Do not automatically replay PUT. Respect native-dialog Escape, focus restoration and narrow layouts.

### Compaction and model capacity

Model settings edit C/M and optional advanced R/K with preset/explicit/unknown sources. On identity changes clear obsolete parameter values; absent C/M leaves contextReady=false, disables sending and keeps the draft. Unknown capacity is separate from a configured API key. New limits show actual output capability and optional run/idle/request timers, never old tool-count budgets.

`RequestState.phase=compacting` and session/request-scoped context.compaction_started/completed drive chat and global navigation status. Stopping wins over phase. A completed summary is not a completed reply and never sets a blue dot. Continue waiting for the normal terminal event after automatic recovery; ignore stale events using existing request guards.

`CompactionPanel` fetches GET /api/sessions/:id/compactions/:compactionId only. The latestCompaction entry provides a session-level readonly shortcut, including after reload. Keep original messages/tool bodies intact, distinguish estimates from actual usage, and show unknown metadata without inventing it. The summary dialog blocks mark-read and follows existing focus/375px behavior.

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

“项目资料” is an on-demand panel for current editable instructions, readonly common text, source metadata and the two fixed Skills. Show save success as effective on the next send. A chat's `instructions.updated`/terminal results can display actual saved effects, including cancellation, or an explicit need to inspect current files when the outcome is uncertain.

Per-request instruction/Skill snapshots and usage remain backend diagnostic records. Do not expose a “查看本轮资料” button or a per-request diagnostic panel in normal, failed, cancelled or legacy conversations. Message rendering and terminal notices contain no fallback debug entry. The session-level latest-compaction panel remains available separately.

### Workspace files and attachments (W01-5)

useAttachments keeps uploads/references keyed by the originating session or workspace draft key. Capture ownership before every async operation; moving a new-project draft into its first session must also move pending results/cancellation by stable attachment ID. Persist completed and submitted refs, not File objects or model credentials. Refresh marks interrupted uploads for manual recovery. Never silently drop a failed/pending attachment and send the remaining text.

POST upload metadata then PUT raw bytes using XHR progress; uncertain response queries its upload ID before explicit retry. A completed upload is already an ordinary file. Removing its chip removes only the message reference; incomplete cancellation uses the scoped DELETE route and checks completion races. Both composer plus/dragdrop and the files panel use this lifecycle. Empty text with attachments requests the user's goal. File reference sends do not copy bodies into chat.

FilesPanel uses captured workspace IDs, directory navigation, filename search, pagination, refresh, previews and attachment/download actions. Keep folder paths server-provided and URLs encoded. PNG/JPEG previews use fetched blob URLs revoked on unmount; Markdown disables external images/links and raw HTML; HTML/SVG appear as code. Errors preserve context and offer download. Follow the existing modal focus/Escape contract and full-screen 375px layout.

files.output SSE and terminal snapshots carry validated FileOutput metadata; render FileOutputCard with its downloadId, never fabricate a card from model prose or a path. Keep cards in their owning request and merge under existing stream guards. These links are fixed bytes. HistoricalFile checks files/status only when clicked and labels current/changed/missing before offering a current-file download; missing refs do not gain a same-name substitute. No per-poll filesystem hashing or raw hash display. Files dialogs cover the chat for unread tracking. No extra user-facing debugging controls.

### Interaction and accessibility

Enter sends only outside IME composition; Shift+Enter inserts a newline. During a reply keep the composer editable for the next draft but disallow submission until the request settles. Stop uses the exact active request ID and remains stopping until settlement. If an active summary arrives before the matching conversation snapshot, show reading/busy state and disable Stop until snapshot request ID matches; the current cancel path depends on that snapshot. Stop disappearing alone does not imply the send form is ready: loaded conversation, configuration and settled request are all required. Refresh, comparison viewing, discard and history viewing perform GET/local state changes only.

Use semantic labelled controls, visible focus, a polite status region, reduced-motion support and the narrow-screen sidebar drawer. Resource dialogs support Escape and restore focus to the originating control when it still exists. Ctrl/⌘+S saves instructions only outside IME composition and with a valid save/merge state. Show conflict comparison columns vertically on narrow screens without page overflow.

Render model Markdown without raw HTML execution. Enable GFM through remark-gfm, retain table/header/cell semantics and wrap wide tables in a named, keyboard-scrollable region. Keep busy, stopping, failed and recovery-required states understandable without exposing internal paths or JSON in the main chat.

For bash results, the executor's exact cancellation response (optionally followed by its archived /logs reference) renders as “命令已停止” without failure styling, including existing native history. Keep the original body and isError unchanged. Do not infer individual tool cancellation from the whole request status or substring matches: nonzero exits, timeouts and cleanup failures still render as failures.

### Subagent cards

`SubagentCard` renders actual role/description/task and public phase/result/error inside the owning parent request. Anchor by toolCallId, fall back to the owning request boundary, and deduplicate its generic tool result. Merge snapshot and subagent.updated by subagentId under the existing session/request/stream revision guards; parent terminal snapshots remain authoritative. Child success updates only its card, not parent completion or unread markers. Parent stopping takes precedence until all work settles; use the existing cancel endpoint.

Use native details/summary with keyboard access, safe Markdown and contained wide tables. Keep cards collapsed initially; preserve per-session drafts, focus and reading position. Refresh/reconnect only reloads snapshots; never POST to replay a child. Do not render internal reasoning, paths, hashes, raw JSON, resource-debug buttons, standalone child chat or a separate child Stop. Child history errors show interrupted/recovery state, not a success card. `tests/e2e/chat.spec.ts` covers role-specific cards, cancellation, terminal failures, refresh/switch and narrow layout.

## 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Model settings conflict or uncertain save | Keep edits, GET latest for review, then explicit PUT; no automatic retry |
| Cross-project create fails or settles after navigation | Visible error on failure; later project/view choice wins |
| Initial API/configuration failure | Actionable message; drafts preserved; no send until configured/loaded |
| Unknown contextWindow/maxOutputTokens | Keep draft, disable send and point to model settings |
| Summary started/completed | Show compacting / continue response; only normal response completion may mark unread |
| Active request | Editable next draft, send blocked, exact-request Stop available |
| Workspace/session switch during execution | Work continues in its original scope; independent drafts/replies |
| SSE terminal followed by failed GET | Terminal snapshot remains authoritative; no stuck pending state |
| Disconnection without terminal evidence | Query state, no implicit message retry |
| Stale event/GET/Skill response | Ignore without replacing newer or differently scoped state |
| Global activity GET fails | Retain previous summaries with explicit stale-status notice; no implicit POST |
| Workspace POST settles after overview already included it | Keep exactly one workspace group |
| Completion arrives while reading earlier messages/activity view | Preserve reading position and unread marker until actually viewed |
| Active summary arrives before matching conversation snapshot | Show loading and disable Stop; enable after the matching snapshot arrives |
| Preparation failure/early cancellation | Preserve/recover unrecorded submitted text without overwriting a newer draft |
| Instruction version conflict | Keep draft; fetch readonly comparison; explicit manual merge or discard |
| Comparison GET failure | Keep draft and existing comparison; show retry |
| Repeated conflict/uncertain PUT result | Keep edits; require fresh successful read before merge retry |
| Recovery warning in native history | Show explanation and allow a new session; do not auto-resume |

## 5. Good / Base / Bad Cases

Good: A streams in workspace 1 while the user switches to workspace 2, edits its own draft and returns to A with the correct stream and next draft intact. Agent edits to the shared workspace instruction produce a conflict in a stale editor; the draft and latest file remain separately visible until manual merge.

Base: create/select a workspace, send an ordinary message, view a readonly Skill or latest compaction on demand, refresh without sending again.

Bad: append every delta to the selected chat, silently replace an instruction draft after GET, claim Stop rolled back a saved file, lose a preflight-failed input or expose backend diagnostic records as a routine chat action.

## 6. Tests Required

Run `npm run typecheck`, `npm run lint`, `npm run test:e2e` and `npm run build` after relevant code changes. Browser tests use a deterministic HTTP service; they are UI evidence, not proof of real-model compliance.

Assert IME behavior, chat/sessionStorage failures, draft isolation, same/cross-workspace switching during streams, first-session creation races, exact-request cancellation, late events, polling after refresh and no implicit POST. Cover terminal SSE followed by failed GET and failures/cancellation before any persisted message, including draft restoration and absence of per-request diagnostic actions.

Navigation tests cover unopened-session progress without fetching its body, folded-group counts, all/running/attention filters, unread across refresh, failed status refresh and recovery, late overview versus newer SSE, stable ordering, creation deduplication, scroll/draft restoration and narrow-screen navigation.

Settings/creation tests cover picker cancellation without POST, explicit target and folded-group plus, delayed creation versus session/activity navigation, mobile focus, settings read retry/save/conflict/busy/persistence feedback, blank-key retention and new-destination key requirements. Assert API keys are absent from browser storage and cleared after save/close; covered chats remain unread.

Compaction tests cover lifecycle SSE, stop during compaction, foreign/late events, history detail GET without POST, latest summary after reload, no blue dot for summary alone, unknown-capacity draft retention and narrow advanced settings.

Editor tests must assert actual GET/PUT counts and payload hashes: preserve edits on conflict, view latest without rebasing, manual merge success, repeated conflicts, comparison read failure, uncertain saves, explicit discard without PUT, stale responses after switching, clearing/saving and keyboard/IME behavior. Include fixed Skill viewing; historical snapshot correctness is tested at the backend API boundary.

Verify actual tool details, semantic Markdown tables, mobile overflow/scrollability, native dialogs, Escape and focus restoration. Use real Web → API → Pi → provider validation separately for instruction effects, natural-language file edits and actual Skill/source use.

## 7. Wrong vs Correct

Wrong: use the currently selected workspace inside an old network callback.

Correct: capture the owner when starting the operation and update state keyed by that owner; selection determines only what is visible.

Wrong: overwrite `draft` and `base` when the conflict comparison arrives, then retry the old text.

Correct: retain `draft`/`base`, store `latest` separately and use its hash only for the explicit manual-merge action.

Wrong: leave pending true until a follow-up GET succeeds, even after receiving a terminal SSE snapshot.

Correct: settle local pending state when the terminal event arrives and retain its authoritative snapshot if later status queries fail.

Wrong: mark every successful result seen in global polling as read, or overwrite its current phase from a GET started before a newer stream event.

Correct: retain request-keyed read markers until the matching reply is visible at the bottom, and reject stale summaries using captured revisions.

Wrong: close a settings dialog and retain its secret in sessionStorage, or silently resend after a version conflict.

Correct: unmount write-only secret state; show latest redacted configuration separately and require a manual save.

### Web questions and operation confirmation (W01-6)

`InteractionCard` renders the shared question/confirmation union at its exact tool position. Keep question answers separate from approvals; never auto-submit options or parse ordinary text as authorization. Plain text questions and full original commands/cwd are inert. Approved is not succeeded; show actual tool evidence and distinguish not-started/unknown outcomes. Navigation phases waiting_answer/waiting_confirmation enter attention without marking a new reply unread.

`useChat` owns response POST, query-before-manual-retry and session/request guards. Failed or uncertain submissions preserve input and require GET before retry; never implicitly replay POST. Merge terminal interactions monotonically so late pending snapshots cannot reopen controls. Per-tab sessionStorage drafts use session/request/interaction IDs; switching/refresh retain them and a terminal result clears them. Closing the tab does not promise draft recovery. Model-supplied question IDs may be `constructor` or `__proto__`: use own-property lookup, not inherited object fields, when reading draft dictionaries.

Keep original chat drafts, focus and stop controls while ordinary message sending is disabled. No Enter/IME implicit answer or approval, no global modal. Errors are associated with their card. Test stale responses, multiple tabs, custom and multi-select answers, skip, stop and narrow layout in addition to normal submission.

Once `response.started` has supplied a requestId, an SSE read error (including page reload) is not proof that the message was rejected. Do not restore submitted text into the composer on that error alone. Keep recovery text separate; use the authoritative snapshot to handle actual failure/cancellation and preserve a newer draft. Test accepted AskUser → stream failure → reload with an empty composer and an independent new draft.
