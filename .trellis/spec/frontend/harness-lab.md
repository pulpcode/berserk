# Harness Lab Frontend Contract

## 1. Scope / Trigger

Read when changing `experiments/harness-lab/src/web`. The React conversation UI includes W01-1 chat behavior and W01-2/S2a workspace selection, instruction editing, fixed Skill viewing, plus W01-3 compaction status/readonly summary details, W01-4 role-aware child-task cards and W01-5 file uploads, browsing and download cards. Keep conversation central; persistent Runs and general file lifecycle states remain outside scope. W01-6 adds request-local interactions; W01-8 adds concrete work handoffs described below.

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

Poll global activity about every 1800 ms with one request in flight; refresh on window focus. Retain the last result and explicitly report stale status on failure. Task-catalog and activity polling failures share one Chinese status notice above the main content, including the information view; never render read errors as sidebar navigation. Preserve loaded navigation and drafts, clear the notice after successful reads, and expose manual read-only retry after five seconds of failure. Normalize fetch transport errors without misclassifying intentional aborts or business failures; reconnect must never replay POST/PUT operations. Merge by ID, retain existing navigation order, and preserve locally created records when an older GET arrives. Workspace POST and polling can observe the same creation in either order: deduplicate IDs. Guard summaries using per-session revisions captured before GET; an active local stream accepts only its own request's active summary, never an old terminal result. Summary changes invalidate older detail GETs. Compare semantic fields rather than JSON property order to avoid false revisions. Summary metadata must never replace the stored conversation body.

Group collapse retains active/attention counts; global filters are all, active, and attention (failed, recovery warning or unread success). Store last viewed successful request ID per session under `berserk.read-results` in sessionStorage. Completion alone does not imply read: require visible foreground chat, loaded snapshot and summary agreeing on a successful request ID, no active request, no covering dialog/drawer and scroll within 32 px of the bottom. Polling the activity view never marks read. Reading position/follow-bottom is session-keyed in memory and survives navigation through other sessions or the activity view.

Key chat snapshots, drafts, errors and streams by session ID. Use a workspace-specific draft key before its first session exists. Capture the workspace/session before asynchronous creation or sending; if selection changes while creation is pending, the original message and any newer draft remain in their original workspace. Do not transfer the eventual reply into the selected view. When first-session creation moves a workspace draft, late input callbacks from the preceding render must resolve that recorded move and write to the new session; otherwise text can become stranded under the old workspace key.

Accept stream events only for their captured session ID, request ID and local stream token. Reject events after a terminal frame. Terminal snapshots are authoritative. Clear pending on the terminal frame itself; a failing follow-up GET must not keep a completed request stuck as responding. Guard GET results with snapshot revisions so older responses cannot overwrite newer stream events. Poll selected-session snapshots to recover status after refresh/disconnection; never implicitly replay POST.

Persist drafts, submitted text and selection in sessionStorage. Storage exceptions must leave in-memory editing usable. Preserve the pending submitted text separately from a user's next draft. Restore failed submissions only when doing so does not overwrite new input; offer explicit recovery when both exist. Cancellation during preparation also restores submitted text if no user message for that request reached native history. Cancellation after a message is recorded does not imply that the user message or file effects were undone.

### Project entry points and model settings

The UI calls workspaces projects; API/storage ownership remains `workspaceId`. Global New Conversation opens a project-select dialog and creates only after confirmation. A group's plus button directly calls `create(targetWorkspaceId)`, including folded groups. Capture a navigation revision before POST; completion enters the new session only when the user has not navigated since. Preserve later selections and keep the result/draft in the captured target project. Entering All Activity must also invalidate pending creation navigation. Surface cross-project creation failures in the visible page; only focus a successfully created conversation if the user has not navigated and no modal covers it. Never create on opening/cancelling the picker. While creation is pending for a project, activity may list the new session before POST returns, but must not auto-select it: the composer still belongs to the project draft until creation moves that draft to the session. Test this ordering explicitly so the handoff cannot overwrite input typed during creation.

Successful unread results use an accessible blue dot (`有新回复未读`); successful read and ordinary idle sessions have no visible status text. Keep active, stopping, failed, interrupted and recovery indicators. New-session/settings dialogs also block mark-read while covering the chat.

`ModelCatalogSettings` mounts only for model managers (or explicit legacy test mode). The settings Models section lists configured profiles and offers Add Model; `ModelSettings` edits the default through GET/PUT `/api/settings/model`, creates through POST `/api/settings/models`, and edits another profile through PUT `/api/settings/models/:id`. Configuration GET/PUT/POST endpoints require `manageModelSettings` in formal mode. Ordinary seats see Account in settings without fetching configuration endpoints. The settings entry remains in the sidebar footer; account identity and logout remain inside settings.

Every seat selects a model with the input-toolbar `ModelPicker`, using only safe GET `/api/models` metadata. A selection is per conversation, not a global or seat-wide configuration change. PUT `/api/sessions/:id/model` returns the authoritative snapshot; keep responses attached to the captured session, preserve drafts, block selection during active/queued work, and ignore polling responses that predate a pending selection. Selection errors never automatically resubmit PUT; re-read the current session to resolve an uncertain result. Workspace drafts may stage a model ID in seat-partitioned sessionStorage and pass it when creating the first session. Existing conversations restore `modelId` from server snapshots after reload/restart. Disable unconfigured/incomplete choices and base sending on the selected model's readiness, not `/api/info`'s system default. Keep the model selector usable on narrow screens, and keep server addresses and keys out of selection metadata.

Switching settings sections preserves the model draft; switching the managed profile with unsaved edits requires a discard confirmation. API keys are write-only password fields, initially blank, never copied from GET or persisted in browser storage. Empty key retains the current secret only when provider/endpoint stay unchanged; new profiles and changed destinations require an explicit key. Clear key after successful save and destroy it on close. Preserve form edits on failures; version conflicts or uncertain saves require manually viewing the latest configuration/catalog before an explicit retry. Respect native-dialog Escape, focus restoration and narrow layouts.

### Shared button styling

`src/web/styles.css` owns the `--control-*` sizing, radius, typography, spacing and interaction tokens. Ordinary actions use the base `button` style (40px desktop, 44px narrow/coarse-pointer); use `primary-action` for confirmation, `danger-action` for discarding edits, and `icon-button` for icon-only controls, including dialog/drawer close buttons. Compact controls declare matching width, height and minimum height. Keep cards, navigation rows, tabs and inline links in their existing semantic families rather than giving every button identical layout.

Feature containers may define layout, but must not redefine ordinary-action colors, radius or typography. Primary hover stays dark with white text; disabled controls do not acquire hover feedback. Exclude the mobile sidebar scrim from action hover/active styling. The collapsed sidebar keeps usable icon entries and a single Logo/expand control that reveals the expand glyph on hover or keyboard focus without changing bounds.

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

The upper-right project tools group holds adjacent icon-only “项目文件” and “项目资料” buttons, with accessible labels, hover titles, expanded states and shared touch-target sizes. Do not reserve sidebar space for project resources or its helper copy. Both use the existing modal panels and restore focus to their header trigger; on narrow screens they are reachable without opening the sidebar.

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

### Composer references (W01-9)

`ComposerReferences` keeps the existing textarea and adds a scoped picker plus removable chips: `@` first shows the categories “项目文件或文件夹” and “子 Agent”; only entering a category fetches and displays its file or role candidates. Child lists offer a return-to-categories control. Direct `/` Skills remain unchanged. Directories are navigation targets, not sendable references. The add menu uses the same selection paths. A selection is not a send, tool call or delegation result. Require a user goal; submit only file paths and Skill/role IDs with hashes. Render actual child execution through `SubagentCard`.

Before bootstrap establishes the initial workspace/session, disable composer editing and add/upload actions (`composerReady = !chat.loading && Boolean(chat.workspaceId)`). Otherwise text can be written to an empty workspace key and disappear when bootstrap selects a session. This gate must not include active-request state: editing the next draft during execution remains available.

`useComposerSelections` owns per-seat, per-session/workspace draft and submitted selections in sessionStorage. Move new-session selections with the existing text/attachment draft. Completion must not erase edits made during a request. Failed preparation restores recoverable inputs without overwriting a newer draft; explicit recovery must recover the original selections as well as text. Candidate requests retain scope and query generation; late responses cannot populate another workspace or seat.

Use current-directory browsing, path/name filters and existing pagination, not recursive search. Shared file references deduplicate with completed uploads before the common count. Removing a chip does not delete a file. Selected Skill details show the current matching hash before send; historical `SelectionHistory` shows the resolved body actually saved in `PublicMessage.selections`.

Recognize an actively typed standalone trigger fragment only; pasted email/path/code remains ordinary text. Enter selects a visible candidate before it can send, Escape closes without deleting text, and IME composition never selects or sends. Preserve the active trigger through composition and filter after committing Chinese text. Menu and typed entry share these contracts. Keep focus restoration, visible errors and contained 375px layout.

`tests/e2e/references.spec.ts` uses the real local API/Pi with a deterministic provider to check selection, no implicit model calls, drafts and async races, failure recovery, IME, pagination/deduplication and responsive rendering. Real model delegation is verified separately by `probe:references`.

### Chat process presentation (W01-10)

Chat replies do not render a repeated avatar or Axon name above the content. Keep the sidebar product identity and accessible message labels.

Reuse `conversationItems` ownership and deduplication, then group only contiguous ordinary process items within one request. Do not move user messages, questions/confirmations, errors, interrupted/unknown results or downloadable files into a fold. A successful `turns` entry plus a visible same-request `finalMessageId` is required for automatic folding; missing evidence keeps process expanded. Final answers remain visible and pure chat has no empty process control. Tool/Agents counts describe actual grouped items, never an inferred overall success.

Scope manual fold choices to seat/session/request/stable segment identity. Preserve them through stream updates and navigation. Automatic folding must not hide focused controls or disturb reading above the bottom; keep the segment open when uncertain. Expanding/viewing process is local UI work and never invokes a model or replays tools. Use compact tool rows, safe Markdown and neutral unknown-tool labels; do not expose internal reasoning or main/subagent hierarchy.

When a valid persisted file output matches the exact request and tool call, keep its download card and deduplicate the missing generic `file_output` result, as before. An actual tool error still stays visible beside a matching file card; absent matching output evidence, the unknown-result notice remains visible.

### Agents process cards

`SubagentCard` renders actual role/description/task and public phase/result/error inside the owning parent request. Anchor by requestId plus toolCallId, fall back to the owning request boundary, and deduplicate its generic tool result. Merge snapshot and subagent.updated by subagentId under the existing session/request/stream revision guards; parent terminal snapshots remain authoritative. Child success updates only its card, not parent completion or unread markers. Parent stopping takes precedence until all work settles; use the existing cancel endpoint.

Use native details/summary with keyboard access, safe Markdown and contained wide tables. Keep cards collapsed initially; preserve per-session drafts, focus and reading position. Refresh/reconnect only reloads snapshots; never POST to replay a child. Do not render internal reasoning, paths, hashes, raw JSON, resource-debug buttons, standalone child chat or a separate child Stop. Child history errors show interrupted/recovery state, not a success card. `tests/e2e/chat.spec.ts` covers role-specific cards, cancellation, terminal failures, refresh/switch and narrow layout.

### Interrupted conversations (W01-7)

An interrupted lastResult shows “已中断” and attention navigation, not an active spinner or unread reply. With no recoveryWarning, explicit sending remains available; GET/reconnect never submits automatically. A `resultMissing` tool message shows “未收到执行结果，无法确认是否已执行”, not success, failure or rollback. It is a display projection only. Match tool, child and file cards within their request, because toolCallId can repeat in later requests.

After interruption, a submitted user message already present in the snapshot clears its submitted backup rather than returning to the composer. Unpersisted input retains explicit recovery; preserve any newer draft and attachment selections. Old question/confirmation cards remain expired or show their saved decision/unknown effect, with no active controls. Hard recoveryWarning still blocks sending.

User-facing role selectors are named `Agents`; internal `agent` fields and subagent delegation retain their meaning. Desktop browsers are the product target: prioritize desktop window resizing and keyboard/mouse use; existing responsive CSS may stay, but phone-specific design and validation are not new requirements.

Composer visual contract: keep one compact input surface with wrapping selection chips and the existing textarea autosizing. Do not show an idle readiness slogan. Category choices are concise rows; secondary headers retain back/close actions and agent read-only context. Ready file chips retain non-root paths and renamed originals visibly so touch users can distinguish files. Scope compact attachment styling to the composer; the Files panel keeps its full metadata and upload/error controls.

### Test seats and work handoff (W01-8)

`Seats` reads public `/api/info`; optional `testSeats` and `defaultSeatId` enable the test selector. Absence keeps single-seat URLs and storage keys. This selector is a test identity, not login. Each visited seat retains a mounted App with its own immutable `ApiContext`; inactive seats remain hidden/inert so pending streams, uploads, caches and independent drafts keep their original owner. Never mutate a global selected-seat HTTP client. Only visible seats mark replies read or update scroll positions. Shared model information refreshes when entering a seat.

`useApi` provides scoped JSON/SSE calls, `url()` for binary fetch/XHR/native download links, `storageKey()` and `domId()`. All business requests use `/api/test-seats/:seatId/...`; only bootstrap `/api/info` is unscoped. Cache, draft, instruction-editor, attachment and read-marker storage is seat-partitioned; test-seat selection uses per-tab sessionStorage. Interaction answer drafts retain their globally unique session/request/interaction keys. DOM landmarks, skip links and focus targets must also distinguish retained seat subtrees.

`WorkInbox` preserves the existing project/chat navigation and adds work lists, assignment, detail, explicit claim, file submission and review. “全部” keeps completed work reachable by either party; reading a detail never claims or approves it. New or explicitly bound idle same-project sessions can carry `workItemId`; chat displays the work title through `LinkedWork`. Binding never moves an unrelated conversation or injects another seat's chat history. Business counts and assistant unread dots remain separate.

Assignment and submission choose ordinary workspace paths through `WorkFilePicker`; assignment allows configured multiple inputs, submission selects one file. `HandoffFiles` renders only authorized fixed file references for preview/download and explicit same-project import. Inline Markdown disables raw HTML, external images and active links; only supported image types become revoked-on-cleanup blob URLs. Direct downloads keep the captured seat scope. Import offers an optional alternate path; no overwrite action exists.

Page prepare saves the exact input and `clientActionId` before POST. Known operation IDs use GET `/work-actions/:id`; lost prepare responses use GET `/work-actions?clientActionId=...`. Failure or uncertain completion retains drafts and requires explicit query; never automatically replay commit. A successful receipt remains authoritative when chat delivery or detail refresh fails. Cancel explicitly abandons a prepared page action; closing its panel does not cancel. Reload queries the stored preparation instead of re-submitting it. Delayed receipt/detail responses cannot override later navigation.

The confirmation shows host-produced title/description and fixed file copies; it never re-reads mutable workspace paths. Agent confirmations reuse `InteractionCard.action.handoff`, including the same fixed-file component. Page forms cannot confirm an Agent preparation. Pending operation, per-project assignment, per-work submission choice and return-reason drafts persist separately; model secrets do not.

New Agent calls display `work_item_action` as “工作交接”; keep old prepare/commit display names for historical messages. The single call waits in the existing card and then returns its receipt. Approved remains distinct from actual execution success; no extra success state/card is added.

For `assign`, both confirmation entrances show `本次附件：N 个` from actual `files` before the long description, reusing `AssignmentAttachments` / `HandoffFiles`. With zero files show `本次未附文件；在工作说明中写路径不会自动交接文件。`, preserving the existing approval/rejection/cancellation controls. Never infer attachment count from prose or show this assignment warning for claim/submit/review. Work detail always shows `输入资料（N 个）`, with `本次分派未附文件` when empty. Preview/download reads existing fixed copies and creates no new handoff copy. Browser tests cover both entrances, misleading prose, refresh and non-assignment compatibility.

Native dialogs preserve Escape and focus restoration, including a visible replacement trigger when opening assignment has navigated away from its original button. At 375px the selected work detail replaces the list with an explicit back button. Inputs and long filenames wrap without page overflow. The `@` file chooser remains deferred. See [backend task handoff](../backend/task-handoff.md) for payloads and effect boundaries.

`tests/e2e/handoff.spec.ts` exercises the real local API/Pi session/SQLite/file-copy implementation with only the provider mocked: two-seat return/resubmit closure, immutable bytes, completed-work lookup, lost commit query after reload, per-seat drafts/late replies/XHR/tabs and mobile focus. It does not count as live provider or Docker evidence.

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
| Interrupted lastResult without recoveryWarning | Show interruption, allow explicit new message; no auto-submit or invented result |

## 5. Good / Base / Bad Cases

Good: A streams in workspace 1 while the user switches to workspace 2, edits its own draft and returns to A with the correct stream and next draft intact. Agent edits to the shared workspace instruction produce a conflict in a stale editor; the draft and latest file remain separately visible until manual merge.

Base: create/select a workspace, send an ordinary message, view a readonly Skill or latest compaction on demand, refresh without sending again.

Bad: append every delta to the selected chat, silently replace an instruction draft after GET, claim Stop rolled back a saved file, lose a preflight-failed input or expose backend diagnostic records as a routine chat action.

## 6. Tests Required

For a deployment built from a source archive, include `public/` alongside source and build configuration. Before replacing `dist/`, verify that its public asset paths and bytes match `public/`. After deployment, fetch the app icon, wordmark and favicon through the served URLs and check image MIME and bytes as well as status. A successful Vite build or index/JS health check does not prove public assets were packaged; a source-only archive caused missing production logos on 2026-09-23.

Run `npm run typecheck`, `npm run lint`, `npm run test:e2e` and `npm run build` after relevant code changes. Browser tests use a deterministic HTTP service; they are UI evidence, not proof of real-model compliance.

`tests/e2e/recovery.spec.ts` covers interrupted status, missing results, draft/attachment retention, explicit send and request-scoped subagent/file cards even when tool IDs repeat. `hitl.spec.ts` covers expired old cards alongside fresh interactions. Assert request counts; opening or refreshing must never send a message.

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


### Authenticated task entry

Formal `Seats` first queries `/api/auth/session`; failures never fall back to test identity. Login mounts exactly one App keyed by opaque viewId, with an immutable authenticated API client. Origin/CSRF/view headers cover JSON, SSE, binary previews and XHR uploads; logout/unmount aborts client connections and pending XHR without cancelling accepted server jobs. Existing test-seat trees exist only after an explicit `mode=test` response.

SessionStorage keys for drafts/selections/read state are view-scoped; logout warns that unsent content will clear. BroadcastChannel invalidates other same-origin tabs and focus revalidates identity. Server checks remain authoritative even before the other tab receives the event. Late results cannot update the new App. Independent simultaneous accounts require separate browser storage contexts.

Task sidebar groups public and seat-private metadata. Task descriptions do not provision a workspace; a row plus or global new conversation lazily prepares the current seat's directory. Task panels use revision CAS, keep text on conflict and show latest text separately before manual merge. Unknown creation results must be queried by clientActionId before retry. The sidebar lists active tasks only; archived metadata and selected archived history remain readable, with new work disabled and host-enforced. Do not expose private tasks in cross-seat assignment selectors. The sidebar footer has one Settings entry for every seat. Account identity and logout live inside settings; only authorized seats see model management.

### Information center navigation and job observation

`/information` retains the existing sidebar and mounted App/useChat; changing the right-hand page must not clear drafts, selection or streams. Do not require a Back to Workspace button. Default to the jobs board; preserve explicit tab/id deep links. Query state includes source/search, board/list view and independent column offsets. Browser history, reload and closing a detail preserve the originating location; polling never takes focus.

`InformationJobColumn` queries `/api/information/jobs?statuses=...` independently for queued/running/succeeded and the combined failed/interrupted/cancelled column. Use returned counts and pages, not a partition of a global first page. The list retains ordinary status filtering. `InformationDrawer` displays existing input, result, tool evidence, exact-job deliveries and authorized actions; Escape closes and restores visible card focus. Sidebar navigation remains accessible while the covered board is inert.

Display succeeded as execution completed, not task achieved. Both event rows and detail history associate delivery with `jobId`; a later failed reprocess must not inherit a prior successful delivery label. Native `commandPolicies` supplies command/cwd/reason and separate execution evidence; Web does not parse JSONL or infer execution from a started event. Other-seat analysis never exposes private detail or conversation links. Do not render private download cards using preprocessing service paths; use the existing file endpoint appropriate to the owner.

`useInformationQuery` keys results and errors by request path. Clearing or changing the selected detail must not render the previous body's content or error. An undefined path is inactive; optional comparison alone must not match an undefined error and then dereference it.

Tests cover independent board paging/counts, source/search, detail deep link/reload/back/forward/Escape/focus, old delivery versus failed reprocess, read-only operations, and navigating away from a streaming conversation while preserving its next draft. Screenshots target the existing desktop layout; no mobile product scope is added.

### Task catalog and personal spaces

Formal navigation labels public TaskSpaces as “工作任务” and private TaskSpaces as “个人空间”. The sidebar lists active entries only; omit catalog search and archived-inclusion controls, while retaining catalog failure/retry feedback. Each group has an independent native disclosure button (`aria-expanded` and `aria-controls`); folding only hides its list and never changes selection or creates work. Creation lives in the corresponding group header. On desktop with a fine hover pointer, the disclosure chevron appears only on header hover or keyboard-visible focus (reserve its space to avoid shifting the label); its labeled plus appears on header hover or keyboard focus; keep it directly visible on touch/narrow layouts and as an accessible icon entry when the whole sidebar is collapsed. The icon rail keeps workspace entries available regardless of group folds and restores those folds when expanded. Sidebar group labels, workspace names and session titles share 14px/20px regular text; distinguish labels with muted color and spacing rather than a font-size ladder. Align workspace/session text, omit the session tree border and repeated chat icon, and share the folder/disclosure icon slot (folder at rest, chevron on row hover or keyboard focus; visible chevron on touch). Keep the separate accessible enter/disclosure controls and the rail folder icon. Desktop workspace/session rows are 34px/32px minimum; touch rows retain 44px targets. The legacy test-mode project action likewise lives in its group header, not the global action area.

The existing `createPublicTask` capability governs creation, editing, archive and reopen for every public task's metadata. Show those actions only to authorized seats, including for tasks created by another seat. Personal-space actions remain owner-only. Match the authoritative AccessStore check; never grant access to another seat's workspace files or conversation history through task-management rights. Detail dialogs use task/space wording and remain read-only without the applicable capability.
