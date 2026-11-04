# Unified Workbench and Work Overview

## 1. Scope / Trigger

Read when changing inbox handling, work projections, overview permissions or navigation. Pi remains the conversation authority; existing WorkItem and delivery records remain the business authority. The workbench is a read projection, not a second workflow engine.

## 2. Signatures

- Formal `GET /api/workbench/items`: `bucket=actionable|following|done|all`, optional `kind=work|information|delivery_review`, `taskId`, `search`, `offset`, `limit` (1–200). Returns items, counts, section availability and pagination.
- `GET /api/work-overview/items` and `/:id`: explicit `viewWorkOverview` required. List supports task, seat, original work state and title filters.
- `GET /api/inbox/:id/handling?clientActionId=...` reads current handling and optional prior receipt. `PUT` takes `{state:pending|completed, revision, clientActionId}`; never accepts a seat authority field.
- `inbox_handling` is keyed by original delivery ID, with state, revision, update time and optional user ID. Original `background_actions` stores `inbox_handle` receipts.
- `access:admin account --view-work-overview` explicitly grants the seat capability. It defaults off and is unrelated to task management or source grants.

## 3. Contracts

Authentication-only migration stage v7 remains usable without background configuration. Background stage v8 includes both handling and supplementary delivery reviews. Conversation annotations advance the integrated application to v9/v10 respectively, without enabling background execution when its configuration is absent; see [Map annotations](map-annotations.md). Legacy v5 has two historical branch layouts (authentication-only or reviews); migration identifies the complete required structure rather than treating an absent table as permission to rebuild it. Legacy v6 handling data and v5 review decisions retain their state and receipts. Opening an existing background database must validate and complete its migration even when background execution is disabled; do not leave an unversioned partial migration. Preserve existing task links, records and file ownership. Missing current-version tables or required columns are corruption, not an invitation to recreate them.

Existing delivered records migrate to `legacy` without a fictitious operator. First successful new delivery creates `pending` in the delivery transaction. A retry does not reset handling. New analysis deliveries are independent; multiple task links do not multiply one delivery. Opening or reading an item, a successful model run and delivery completion never imply human completion.

Handling changes and receipts share one transaction. Same user/action and identical payload return the original receipt; different payload or stale revision conflicts. Current source/content/recipient authorization is rechecked even for receipt queries and retries. Other seats cannot mark this seat's items.

Work perspective keeps original transitions: submitted is following for assignee and actionable for creator; completed is done. Only creator reviews. Overview returns public-task summaries (title, parties, state, time and submission count), never goals, review bodies, file paths or private conversation IDs. Overview permission does not grant participant operations.

Apply authorization and all filters before counts, ordering and pagination. Aggregate complete authorized module results before paging; never concatenate each module's first page. Errors produce unknown counts and explicit section errors. UI retains stale failed-section rows, identifies them and disables incomplete pagination. Unavailable optional approval support is distinct from a failed enabled module. When reviews are configured, only the explicitly configured reviewer with current source manage permission receives actionable/completed review projections, and each record is checked against its frozen job scope. A changed current Profile must not hide an older still-authorized review. The workbench and overview reuse the original review ID, decision endpoint and receipt.

Formal default navigation is `/work`; old `/inbox` and `/information` links normalize with replace semantics. Conversation links remain explicit. Creating a legacy test-mode project clears the preceding session URL so reload restores the newly selected project instead of reopening the old conversation. Retain the existing activity stream, draft ownership and prepared handoff state. Sidebar indicators are spinner (running), blue dot (unread), amber dot (waiting); errors are red, and accessible descriptions remain. No repeated status text in conversation rows.

The desktop workbench has one page heading and no repeated context title or introductory paragraph. Its status filters and type/task/search fields share a left edge. Type/task/search labels sit to the left of their controls and align vertically at the center; wrap complete field groups when desktop space narrows. Keep the empty detail pane as a selection prompt, without a nested bordered card or assignment form.

Workbench and work overview page headers share the `work-page-header` layout and 24px title style. The overview heading has no extra sidebar menu or leading icon. Omit introductory descriptions from work-summary and assessment-record lists; retain authorization, errors and operational guidance in business details.

All overview filter toolbars keep labels beside their input/select controls, with centered alignment, an 8px field gap and 24px between groups. Wrap whole groups when desktop space narrows; do not apply filter density to detail/edit forms.

Seat work has two presentations: the default paginated list and an ID-based seat swimlane. `workView=list|flow` is independent of the jobs tab's existing `view=board|list`; missing/invalid workView means list. View changes preserve task/seat/state/search and the remembered list offset; filter changes reset offset and the diagram context. Local refresh and the labeled list/swimlane toggle belong beside the work filters, with no repeated count or arrow-instruction paragraph.

The list requests 25 items. The swimlane makes one authorized `GET /api/work-overview/items?offset=0&limit=200` using the same filters. Render a complete diagram only when total is a nonnegative safe integer at most 200, offset is zero, item count equals total, and work IDs are unique. Over 200 requires narrower filters or the list; an incomplete/duplicate response is an error, never a partial diagram. Do not concatenate changing pages or treat the current list page as the full graph.

Each work remains independent: creator-seat origin, assignee-seat work node, and a fixed creator-to-assignee arrow regardless of submission/review state. Rows use seat IDs; duplicate names do not merge identities, and reverse/self assignments remain distinguishable. Node titles and original state labels are readable; position does not imply dependencies or timing. SVG connections and HTML buttons form a local read-only projection, without a general workflow editor or business writes. Keep seat headers horizontally anchored while their rows follow vertical pan/zoom; focused work nodes reveal beyond the header overlay. Compact 32px zoom/fit controls float inside the canvas; plain wheel/trackpad pan, Ctrl/Meta+wheel pointer-centered zoom, blank-space dragging, keyboard pan, and focus-to-node reveal preserve access across desktop panes. Normalize wheel delta modes; Shift+wheel pans horizontally. Releasing the zoom modifier must restore panning without changing scale. Consume only handled canvas gestures; wheel over floating controls or outside the canvas and modified keyboard/browser shortcuts retain native behavior.

Opening an overview summary reuses the existing permission boundary and hides the retained canvas. Returning restores its view/filter/page/camera and the trigger's focus, with a visible fallback when the trigger is no longer present. Poll only the active presentation on visible pages and retain camera on normal refresh. Normal read errors may show the last result for the same scope with a stale notice; a 401/403/404 from list or summary discards both presentation caches and summary data. The query instance's discard generation also rejects already-pending responses, so an old successful read cannot restore data after a denial. Identity/capability changes reset the work component; inactive or obsolete requests must not fill another scope.

Assignment starts from the workbench header. `WorkInboxHandle.assign(trigger)` opens the existing assignment Panel, which selects the project before showing the workspace-keyed draft and file picker. Opening, changing projects or cancelling must not prepare/commit work or call a model. Preserve separate drafts per workspace, the current type filter and the existing explicit preparation/confirmation steps; closing returns focus to the triggering button. No available project yields an explicit explanation rather than an inert disabled action in the detail pane.

Work-handoff list status badges use the existing per-seat `WorkbenchItem.bucket`: `actionable` is amber (including creator-side acceptance), `following` is blue, and completed/history states are neutral. Keep type text separate and neutral, retain explicit status labels, and leave the selected-row accent independent. Never infer the badge color from creator/assignee direction alone. Narrow desktop list panes may wrap the status group without squeezing the title to one-character lines.

When the workbench type filter is `work`, omit the repeated work-handoff type text inside each handoff row while retaining its status badge. Restore the type text for the all-types filter.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| No authenticated identity | 401 |
| No explicit overview capability | 403 |
| Foreign/private work or unavailable recipient information | 404 without content |
| Stale handling revision or reused action with changed input | 409, retain user context and re-read |
| Invalid state, pagination or extra authority fields | 400 |
| One read section fails | Explicit error/unknown count; no fabricated empty result |
| Current schema missing required structure | Startup failure; preserve data |

## 5. Good / Base / Bad Cases

Base: no background configuration; formal work handoff and traditional test-seat chat continue to work.
Good: A and B receive the same analysis. A marks its delivery handled; B remains pending. A later analysis creates separate pending deliveries. An authorized observer sees only public work summaries.
Bad: marking a delivery handled on open, treating an observer as a work participant, or replaying a mutation when a network response is uncertain.

## 6. Tests Required

Run typecheck, lint, unit/integration, build and browser suites. Cover auth-only reopen/first background enable, legacy migration and corruption, transaction receipts and revision conflicts, cross-seat denial, full-source paging and duplicate task associations, permission-filtered counts and partial failure. Browser checks cover old links, formal root, retained drafts/preparations, explicit handling/reopen, overview access and icon-only sidebar states.

Seat-work presentation regressions cover deterministic ID-based layouts, reverse/self work, duplicate names, 0/25/26/200/201-item boundaries, duplicate/incomplete responses, workView history compatibility, shared filters, stale/denied reads, summary return camera/focus, and zoom-then-wheel-pan without changing scale. Assert real work identity and direction, never CSS snapshots alone.

## 7. Wrong vs Correct

Wrong: `completed = delivery.status === 'delivered'`; combine unread conversations with actionable business counts.
Correct: use `handling.state` for explicit human handling; show conversation reminders separately and preserve original work acceptance state.
