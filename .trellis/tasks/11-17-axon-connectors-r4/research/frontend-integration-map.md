# Research: R4 frontend integration map

- Query: Map the existing capability center, management/detail forms, composer selections, authenticated routing and browser fixtures onto the R4 connector UI without adding another chat page or deciding the open personal-credential scope.
- Scope: internal; WorkBuddy observations supplied by the parent session are identified separately below.
- Date: 2026-11-17

## Findings

### 1. Source files and existing ownership

Product `src/`, `tests/` and configuration paths in this document are relative to `experiments/harness-lab/`; `.trellis/` paths are relative to the repository root.

| File | Existing responsibility / R4 relevance |
| --- | --- |
| `src/web/CapabilityCenter.tsx` | Expert/Skill/Connector tabs, shared search, cards, current administrator probe, explicit detail and management entry. Connector tab is currently an honest empty state. |
| `src/web/capabilities.css` | Existing desktop card grid, toolbar/search styling, concise labels and detail dimensions; container queries already use actual panel width. |
| `src/web/Resources.tsx` | Shared native `Panel` dialog, Escape and focus restoration; project resources remain workspace instructions/Skills rather than a separate connector inventory. |
| `src/web/CapabilityManagement.tsx` | Existing expert management, immutable draft baseline, tool allowlist, use-policy, lifecycle, history and optional trial surfaces. |
| `src/web/SkillLibrary.tsx` | Contains both `SkillLibrary` **and** `SkillManagement`; public detail/staging and administrator editing are separate flows. There is no separate `SkillManagement.tsx`. |
| `src/web/ComposerReferences.tsx` | Original add menu, scoped asynchronous picker, search, keyboard controls, removable chips and resolved historical selections. |
| `src/web/useComposerSelections.ts` | Draft/submitted/recoverable selection state, guarded sessionStorage loading, ownership transfer to the first session and failure recovery. |
| `src/web/useChat.ts` | Original session creation, first-send draft transfer, send transport, stream/request guards, manual recovery and text/attachment ownership. |
| `src/web/main.tsx` | Shared application shell, administrator-private adapter, task/workspace selection, original composer and library-to-chat staging callbacks. |
| `src/web/api.ts`, `src/web/Seats.tsx` | Immutable authenticated client, CSRF/view headers, request abort, view-scoped storage and logout/cross-tab invalidation. |
| `src/web/ModelSettings.tsx` | Existing write-only secret field pattern: blank input, configured metadata and conflict-preserving local form state. Reuse the pattern, not its model-setting permission. |
| `src/web/InteractionCard.tsx`, `src/contracts/interactions.ts` | Shared question/confirmation union and original pending/history UI; actual generic `action.parameters` are currently not rendered. |
| `src/web/ChatMessage.tsx`, `src/web/processGroups.ts` | Original tool-result/details rendering and process grouping; unknown tools deliberately receive generic labels. |
| `src/contracts/index.ts` | `ComposerSelection`, `LoadedComposerSelection`, `PublicMessage.selections`, `resources.loaded` and `WorkspaceResources` shared DTO boundaries. |
| `src/contracts/access.ts` | Business `Identity` versus seatless `AdministratorIdentity`; no administrator business seat. |
| `src/server/app.ts`, `src/server/auth.ts` | Account-auth route admission and business-seat-scoped registration boundaries. |
| `src/server/capability-management-routes.ts`, `src/server/skill-routes.ts`, `src/server/capability-authorization.ts` | Existing management actor derivation, service-level current-administrator checks, safe ordinary catalogs and scoped defaults. |

### 2. Capability center and original dialog/form integration

Concrete code patterns:

- `CapabilityCenter({ workspaces, fixedWorkspaceId, initialExpertId, create, applySkill, domId, canCollaborate = true, administration = false, authoring })` is at `src/web/CapabilityCenter.tsx:36`. The union already has `connectors` at line32 and the toolbar already provides `搜索连接器` through the tab-sensitive search at line100. Replace the empty content at line117 with a connector library; another main page or top-level navigation is unnecessary.
- Its tab keyboard handling already supports Left/Right/Home/End (`CapabilityCenter.tsx:96`); `chooseTab` clears the query at line87. Search currently matches actual name/description at lines88–91. Retain these mechanics and use actual connection names/descriptions.
- Distinguish the two existing flags. `administration` selects the management expert catalog for the independent administrator view (`CapabilityCenter.tsx:61`), while `administrator` is a current server-returned capability used to show management actions (`:68`, `:101`). A business account with an explicit administrator grant must not be confused with the seatless `personalOnly` view; neither flag grants connector use.
- `Panel({ title, children, close, className, dismissOnBackdrop = false })` at `Resources.tsx:7` owns a native `<dialog>`, calls `showModal`, closes on native cancel, restores the originating connected element on cleanup and accepts a guarded close callback. Use it for connection details, adding/editing MCP and entering a personal credential. Keep secret inputs local to the mounted form, never in the draft-selection hook.
- Cards already use semantic article/button structure and explicit detail actions (`CapabilityCenter.tsx:111`, `SkillLibrary.tsx:65`). `capabilities.css:17` provides the grid; container widths below950 and540 change columns (`:32`). Extend these styles locally; retain desktop1060/1440 acceptance and normal narrow desktop panels.
- `CapabilityManagement(... initialExpertId ...)` at line17 and `SkillManagement({ skillId, initialTab, expectedDraftDigest, ... })` in `SkillLibrary.tsx:122` demonstrate direct selected-object opening. Clicking a connector card should open that exact connection; opening details must not create another object or run discovery.

Suggested R4 interaction shape, derived from the supplied v0.2 sections3,5,6 and10:

1. Keep the existing Connector tab and search. Show concrete named connections in the existing card grid. A card needs its name, actual purpose/description, meaningful availability/credential state and one appropriate detail/use/manage action; avoid repeated process subtitles.
2. Administrators see `添加 MCP 连接`. Existing business adapters expose `查看配置/管理` and no same-kind add action. Adding generic MCP goes directly to a normal labelled form for name, address, actually supported authentication and the relevant credential ownership; no mandatory definition → instance → scope wizard.
3. Saving configuration, explicit `测试连接/刷新工具`, choosing opened tools/use eligibility and explicit enablement are distinct actions/states. Page opening/searching/detail reads do not probe every connection, call models or invoke business tools. A failed discovery can coexist with saved unopened configuration; no fabricated tool list.
4. Detail uses the existing `Panel`. Keep concise configuration/credential metadata, an expandable **actual** discovered-tool list with enabled count, use scope and operation history. Configuration saved, credential available and latest protocol/call outcome need separate factual labels instead of one universal “已连接”.
5. A regular user gets only the authorized catalog and use/detail actions. For an administrator-approved service requiring that user's own credential, show a narrow `配置本人凭证/替换本人凭证` form for that existing target. No editable target URL, arbitrary header name, use-policy editor or arbitrary MCP creation appears there. A shared detail can expose the user's own credential status and safe actor label without revealing anyone else's credentials.
6. Do not show OAuth account-link actions unless that complete flow exists. Existing business source selection, task binding and expert selection remain untouched. Do not copy WorkBuddy's local stdio/raw-JSON installation UI.

WorkBuddy evidence supplied by parent (not independently re-observed here): its Expert/Skill/Connector tabs, search plus custom-connector button, card grid, modal connection list, enabled-tool counts and expanded real tool names are useful layout/interaction references. Its Add MCP raw JSON/local `mcp.json` flow is outside the authorized R4 remote-MCP form scope. No WorkBuddy data was changed.

### 3. Administrator scope, ordinary policy and personal credential forms

- Existing expert use policy is a real revisioned contract: `UsePolicy` at `CapabilityManagement.tsx:148` submits `{ expectedRevision, mode, seatIds, clientActionId }` and preserves local choices on conflict (`:154–162`). Skill policy keeps a separate viewed baseline in `SkillLibrary.tsx:165`, submits it at line184, and explicitly adopts separately read latest policy at line201. GET/discovery polling must not silently advance a connector policy/configuration baseline either.
- Existing policy vocabulary (`none | all | seats`) describes business-seat use. It is not enough by itself to express the R4 requirement that administrator personal MCP use needs explicit eligibility. Reuse the controls and revision/conflict pattern, but let the connector authority design supply the actual supported subjects. Do not treat `all` as an implicit administrator grant or add the account storage scope to business-seat choices.
- `ModelSettings.tsx:10` initializes `apiKey: ''`; line81 sends it only when a new value is present; line104 renders a password input and configured/not-configured metadata; line118 reads only “已配置，不显示密钥”. This is the closest existing form pattern for write-only R4 credentials. The reusable `Panel`, labelled field, local value, pending guard, error/status and success clearing are sufficient; the model-specific save semantics and authorization must not be reused for connector credentials.
- Personal secrets must not enter `sessionStorage`, localStorage, URL query parameters, session actions, chat text, model inputs or debug/browser captures. `sessionAction` persists `JSON.stringify(input)` as an object key in sessionStorage for idempotency (`session-action.ts:7`, `:16`); a secret-containing mutation must **not** naively pass its complete payload there. Design the safe credential mutation/receipt behavior at the owning service boundary.
- Credential form should start empty every time and show only safe metadata supplied by the server. A credential's existence is not proof of a successful connection or business use. On a lost response, present an uncertain outcome and reconcile safe status; do not automatically replay a potentially committed mutation.
- Personal credential applicability to the user's participating public tasks remains an explicit pending product decision. This document neither grants it nor hardcodes personal-space-only UI as a final decision. The form's service target/ownership can be designed independently; scope-specific availability/empty/error messages must follow the approved rule.

### 4. Original composer: multiselect, retention and draft ownership

Current signatures and state flow:

```text
CapabilityCenter.applySkill(workspaceId, skill)
  -> main.applyLibrarySkill(workspaceId, skill)
  -> current existing session OR workspace:<id> draft selection
  -> original chat view; preserves text/files; no send

useChat draftKey = selectedSessionId || workspace:<workspaceId>
  -> useComposerSelections (draft/submitted/recoverable)
  -> first session create: move selections + attachments + text
  -> selectionInput(picks)
  -> original sendMessage(..., ComposerSelection + file refs)
  -> host-resolved resources.loaded / native history projection
```

- `DraftSelection` is at `useComposerSelections.ts:10`; its existing slots are authoring, one Skill, one Agent, context refs and annotation refs. `ComposerSelection`/`LoadedComposerSelection` at `contracts/index.ts:215` likewise have no connector field. Extend the original boundary once using backend-owned safe identifiers; do not submit URL, secret or model-selected hidden account data from chips.
- `ComposerReferences` at line40 takes `scope`, `workspaceId`, `enabled`, controlled text/textarea, current selection and callbacks. `Mode`/`Option` at lines9–11 and add menu at line193 are existing picker extension points. A connector multiselect can live in this menu/list path and reuse search/keyboard/error/loading behavior while retaining the textarea. Existing option selection at line145 is single-choice and closes immediately, so multiselect needs deliberate checkbox/selected semantics and an explicit finish/close behavior; do not fake multiple selection with a one-choice ARIA listbox.
- The picker keys requests by scope/workspace/mode/query (`ComposerReferences.tsx:66`), ignores obsolete results (`:77–95`), closes outside focus (`:96`) and restores the caret only to the matching controlled-text commit (`:52`). Preserve these races/IME/focus protections. Add a scoped, accessible removable chip per selected connection; wrap collections instead of clipping a one-line row.
- `useChat.ts:115` owns draft keys. First creation transfers selectors and attachments at lines423–429, and `resolveDraftOwner` at line572 covers an input event arriving after that transfer. Connector selections must move with this existing owner change, including choosing before first send, and must not copy to another workspace/session.
- **Retention gap:** `useComposerSelections.consume` at line56 consumes per-message inputs and normally clears matching Skill/Agent/context values. R4 explicitly retains user-chosen connections in the current session. Do not copy this clearing behavior unchanged. Keep a safe session-retained connection-selection slot through settlement and compose its fixed request selection at send time; do not grow it into account/task/seat/background defaults. The exact server persistence/selection mutation contract belongs to the R4 backend design, not this UI research.
- Cover **all** selection transitions, not just visible chips: `load`, `selectionInput`, setters/deduplication, `move`, consume-retention, recoverability tests and `restore` in `useComposerSelections.ts`; `hasDraft`/prepare at `useChat.ts:554`; `richDraft` and queued-input classification at `main.tsx:227`; method/space destination guards at `main.tsx:457`, `:485`, `:493`; directory-to-original-chat staging equivalent to `applyLibrarySkill` at `main.tsx:560`.
- Busy state already disables picker selection/removal but preserves editable next-message text (`main.tsx:698`, `ComposerReferences.tsx:188`). R4 connection changes must wait for request completion/stop settlement, including a selection triggered from the capability center. `applyLibrarySkill` already checks the target session's current `active` projection and navigation revision before applying (`main.tsx:564–567`). Reuse that pattern without changing the current expert or creating a session.
- A retained selection alone should not silently disable the existing plain-text input queue forever. Distinguish a safe unchanged session preference from a new rich draft mutation. A queued addition remains attached to the running request's already fixed connection/auth subject; it must not introduce a new connector or approval scope.
- `selectionInput` must keep explicit selection separate from operation approval. A target chosen by native question/confirmation must be host-verifiable. Automatically resolving the only eligible connection is request-local and must not be written as a permanent browser preference or expanded when new candidates appear.

### 5. Current authentication view and server-route seams

- `createApiClient` in `api.ts:64` captures one auth session, sends CSRF and `x-axon-view`, aborts requests on dispose, and invalidates on current-login errors (`:78`). `storageKey` defaults to `:login:<viewId>` (`:91`); the stable `user-preference` branch is explicitly for non-sensitive visual preferences, not connection credentials or authorization.
- `Seats.tsx:47` clears private `axon.*`/`berserk.*` state on identity changes and line66 mounts the immutable client; logout/cross-tab changes invalidate the old application. Connector controls must always use `useApi`, preserve this current-auth view and ignore stale completions after remount. Do not introduce a global fetch client or globally stored secret.
- `AccountIdentity` is a discriminated business/admin union (`contracts/access.ts:17–26`). `main.tsx:77` adapts the seatless administrator to existing **private** workspace controls; its local `canCollaborate: true` at line82 enables own personal chat only. It is not business authority. `personalOnly` suppresses map/context/information hooks at lines114–120 and business surfaces at lines647–652.
- Management registration is intentionally outside the shared business-seat hook (`server/app.ts:94–109`). `capabilityManagementRoutes` derives `ManagementActor` from `accountIdentityOf` and checks `requireCapabilityAdministrator` (`:26–31`). `skillRoutes` already separates management actor from ordinary catalog principal (`:29–36`). A connector management route should fit the same account-auth seam; a normal catalog/personal-credential route must derive the current account, never browser-supplied user/seat authority.
- **Explicit admission gap:** `server/auth.ts:64–69` currently allows seatless administrators to access capability paths only for `access|library|experts|skills` (plus private task/workspace/session families and `/api/admin/`). Any new ordinary connector catalog or own-credential path requires an explicit safe admission update. Simply mounting a visible connector tab or putting its route under the business-seat hook will fail or accidentally broaden authority.
- Preserve test-seat compatibility intentionally. `api.ts:84` rewrites `/api` to `/api/test-seats/<id>` only without formal auth. Existing ordinary Skill detail/catalog routes have explicit test-mode peers (`server/app.ts:142`), while admin routes are unavailable there. Do not infer that a newly chosen connector endpoint automatically exists in both modes.

### 6. Original questions, confirmation and tool results

- Reuse `ComposerInteractionCard`/`InteractionCard`; keep native interaction ownership and historical placement. `contracts/interactions.ts:31` already has `action.title`, `description`, `parameters` and optional specialized metadata. Selecting one/many connectors or answering a target question is not approval of later calls.
- **Visibility gap:** `ConfirmationDetails` at `InteractionCard.tsx:149–158` renders description and known handoff/authoring/command fields, but does not render generic `action.parameters`. For R4's per-call confirmation to show the actual target, safe account label, tool and external parameters, the original component needs an actual safe rendering path (or a complete host-generated reviewable description). Merely filling `parameters` would leave them invisible. Keep the same confirmation component and explicit action, not a second card system.
- `ChatMessage.tsx:46` already renders tool outcomes with failure/missing-result states and inert text. `processGroups.ts:22` uses “调用工具” for unknown names. Supply safe source/account/tool display evidence through the original host projection and tool detail area; do not guess a connection by parsing model prose or a tool-name prefix. Native/history provenance must stay readable after rename/disable or changing the current selection.
- Retain actual failure, partial/unknown result and no-fallback semantics. Approval alone is not completion (`InteractionCard.tsx:166`); an unavailable A must not silently become B or be described as an empty successful query.

### 7. Meaningful browser/test reuse

The existing Playwright setup defaults to desktop1440×960 and retained failure traces (`playwright.config.ts:5–12`). Browser fixtures use isolated temp data and real application/service/Pi logic; provider transport is deterministic. These tests are not live-model/MCP acceptance.

| Existing fixture/test | Reuse for R4 |
| --- | --- |
| `tests/e2e/capabilities.spec.ts:147` | Connector tab keyboard navigation, shared search, empty/grid states, concise chrome, zero session creation/model calls on browse and1060/1440 screenshots. Update the currently explicit empty-placeholder assertion only when real fixture data exists. |
| `tests/e2e/administrator.spec.ts:13` | Separate business + seatless admin accounts, real auth, captured read/write paths; `businessRequests` at line54 asserts no business mounts/API calls. Cover exact selected connector management, no business grants, revocation and private-only chat. |
| `tests/e2e/skills.spec.ts:14`, `:49` | Authorized regular-user library → existing chat staging with unchanged text/files and zero model calls; management conflict baselines at line63; lost-create-response receipt behavior. |
| `tests/e2e/capability-management.spec.ts:54` | Two browser pages/admin edits, local form preservation on409, explicit checks and no model calls for management. Reuse for connection config/policy CAS conflicts without converting trials into a gate. |
| `tests/e2e/references.spec.ts:10`, `:150`, `:201`, `:225`, `:286` | Request payload capture, controllable delayed catalog/create/reply responses; refresh/seat/workspace isolation, first-session transfer, failure recovery, busy input, IME and stale picker suppression. Extend at desktop widths; do not add phone acceptance. |
| `tests/e2e/authoring.spec.ts:15` | Real local API listener + streaming Pi flow, provider tool calls, browser-side write observation, original confirmation and draft cancellation; useful when `app.inject` buffering would hide pending live MCP confirmations. Existing fixed port4310 needs serial/distinct-port handling if copied into concurrent new suites. |
| `tests/e2e/hitl.spec.ts:286`, `:437`, `:528`, `:603` | Generic confirmation, uncertain decision query-before-retry, accepted-stream failure with retained independent draft, and multiple same-name confirmations without false execution association. |
| `tests/web/api.test.ts`, `tests/web/composer-interaction.test.ts`, `tests/web/process-groups.test.ts`, `tests/web/chat-tool-presentation.test.ts` | Existing focused assertions for transport/current view, native composer cards and neutral tool/history semantics. Extend only for actual new behavior. |

Minimum meaningful new browser evidence should assert:

- Admin browse/cancel/save/discover/open tools/enable are distinct, with no discovery/network call before explicit action; built-in single-instance cards cannot add duplicates.
- Ordinary user cannot edit URL/policy or add arbitrary MCP; own-credential UI shows only safe metadata and never writes secrets to browser storage, chat payloads or incidental logs. Verify two accounts in separate browser contexts, not two tabs pretending to be simultaneous identities.
- Two named connections with overlapping tool names remain distinct in cards/chips, actual confirmation and historical tool outcomes. Multiselect survives same-view refresh/first send/settlement, never leaks to another session/workspace/login and never broadcasts a write.
- New catalog candidate, revoked eligibility, removed tool, stale connection revision, unavailable A and failed credential update remain factual; no automatic fallback or automatic replay.
- Selecting/removing connection chips preserves textarea, selected model, attachments and expert. Changes are disabled while a request/confirmation is active and become possible after settlement. Explicit recovery preserves newer independent input.
- Pending confirmation visibly shows actual target/account/tool/parameters; answering a target question does not execute; refusal/stop/expired approval prevents the call; unknown execution result is not labelled success.
- Manual screenshot inspection and keyboard/focus checks at desktop1060/1440 cover cards, long names, multiple chips, tool disclosure and forms. Existing source labels and split panes remain contained without a new page or mobile scope.

### 8. Related specs, local references and versions

- `.trellis/spec/frontend/index.md`: desktop-only target and required package contracts.
- `.trellis/spec/frontend/harness-lab.md:122`: picker, state ownership and no implicit send; `:261` native question/confirmation semantics; `:278` authenticated client/view; `:290` shared administrator/capability presentation; `:443` Skill management/staging/policy baselines; `:459` concise forms/chrome; `:476` one creation entry and original shared draft flow.
- `.trellis/spec/backend/capabilities.md`: immutable expert identity/bindings, no automatic new tools and compact composer identity.
- `.trellis/spec/backend/capabilities-r2.md`: administrator/ordinary authority, draft CAS, lifecycle, optional trials and native service reuse.
- `.trellis/spec/backend/capabilities-r3.md`: safe ordinary Skill DTO and on-demand request-fixed package behavior.
- `.trellis/spec/backend/authoring-r3a.md`: original chat confirmations and request-scoped management methods; connector selection must not flow into authoring/trial/readonly children automatically.
- `.trellis/spec/backend/task-access.md`: seatless account/private-space boundary, current authentication checks and no business authority from system administration.
- Supplied task source: `research/Axon_R4_Connectors_MCP_Plan_v0.2.md`, especially sections3,5–8 and10; its personal-credential scope is not a final answer to the pending public-task question.
- Local UI skill search: `python3 .agents/skills/ui-ux-pro-max/scripts/search.py 'multi select chip collection desktop' --domain ux -n 3` returned the relevant `Layout / Chip Collection Reflow` guidance: wrap chip collections or provide an operable overflow disclosure. No new visual system is needed.
- Local package manifest currently records React19.3.0, TypeScript5.9.3, Playwright1.63.0, Pi0.85.1. These are repository observations, not externally verified latest versions. No external protocol/SDK research was performed in this topic; that is assigned elsewhere.

## Caveats / Not Found

- Research only: no product/spec edits, implementation, migrations, browser runs or test execution were performed. This file is a code-backed integration map and test plan, not R4 acceptance evidence.
- No connector UI/selection/credential DTO or API currently exists in the inspected frontend contracts. Suggested component/dataflow extension points do not define new endpoint names, storage tables, SDK abstractions or secret-handling contracts.
- The pending decision on personal credentials in participating public tasks is intentionally unresolved. Availability, selection and credential scope enforcement must reflect the approved decision before implementation.
- Existing specs contain historical phone-width examples, an older first-conversation description and the explicitly deferred connector placeholder. Apply the current desktop-only target and later shared-draft/current task requirements; do not use old examples to broaden this research into mobile work or restore the former NewSession dialog.
- Full backend callers, network/secret storage, MCP SDK compatibility and tool namespace/runtime design are owned by the other R4 research topics. This document identifies only their required frontend/account-route seams.
