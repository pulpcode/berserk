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

Authentication-only schema v5 remains usable without background configuration. Background schema v6 includes handling. Opening an existing background database must validate and complete its migration even when background execution is disabled; do not leave an unversioned partial migration. Preserve existing task links, records and file ownership. Missing current-version tables or required columns are corruption, not an invitation to recreate them.

Existing delivered records migrate to `legacy` without a fictitious operator. First successful new delivery creates `pending` in the delivery transaction. A retry does not reset handling. New analysis deliveries are independent; multiple task links do not multiply one delivery. Opening or reading an item, a successful model run and delivery completion never imply human completion.

Handling changes and receipts share one transaction. Same user/action and identical payload return the original receipt; different payload or stale revision conflicts. Current source/content/recipient authorization is rechecked even for receipt queries and retries. Other seats cannot mark this seat's items.

Work perspective keeps original transitions: submitted is following for assignee and actionable for creator; completed is done. Only creator reviews. Overview returns public-task summaries (title, parties, state, time and submission count), never goals, review bodies, file paths or private conversation IDs. Overview permission does not grant participant operations.

Apply authorization and all filters before counts, ordering and pagination. Aggregate complete authorized module results before paging; never concatenate each module's first page. Errors produce unknown counts and explicit section errors. UI retains stale failed-section rows, identifies them and disables incomplete pagination. Unavailable optional approval support is distinct from a failed enabled module.

Formal default navigation is `/work`; old `/inbox` and `/information` links normalize with replace semantics. Conversation links remain explicit. Retain the existing activity stream, draft ownership and prepared handoff state. Sidebar indicators are spinner (running), blue dot (unread), amber dot (waiting); errors are red, and accessible descriptions remain. No repeated status text in conversation rows.

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

## 7. Wrong vs Correct

Wrong: `completed = delivery.status === 'delivered'`; combine unread conversations with actionable business counts.
Correct: use `handling.state` for explicit human handling; show conversation reminders separately and preserve original work acceptance state.
