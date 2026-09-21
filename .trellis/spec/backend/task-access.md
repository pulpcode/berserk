# Task and Seat Access Contract

## 1. Scope / Trigger

Read for authentication, task metadata, workspace access or account provisioning. This increment supersedes the anonymous entry assumptions in W01-8 for formal mode. Keep one PiLab/data root; no event bus, detached jobs, personnel handover or second chat store.

## 2. Signatures

- `loadConfig`: defaults `LAB_AUTH_MODE=login`; requires `LAB_SESSION_SECRET` (32+ chars); `LAB_SESSION_HOURS` defaults 8. Explicit `test` permits legacy test routes on isolated data only; it cannot open a formal schema-v2 data root.
- `/api/auth/session` returns `AuthSession`; `/login {username,password}` rotates cookie, CSRF and viewId; `/logout` revokes the authenticated session and rotates to one anonymous session before notifying other browser tabs, avoiding competing anonymous cookies.
- `/api/tasks` GET lists authorized metadata; `?clientActionId=uuid` queries this user's creation result. POST takes `{title,goal,visibility,clientActionId}`. PUT `/:id` takes `{title,goal,revision}`. POST `/:id/archive|reopen` takes `{revision}`; `/:id/workspace {}` lazily prepares this seat's workspace.
- `AccessStore` uses the collaboration SQLite connection. Schema v2 adds accounts, seats, auth_sessions, task_spaces, task_actions; Pi JSONL remains history authority. Missing v2 tables fail, never silently recreate them.
- `access:admin account|disable|reset --data-dir ABS --service-stopped`: offline only. Password input is TTY-hidden, not argv. `reset --backup-dir ABS` moves the entire data root without overwriting a backup, copies only model settings to the new root.

## 3. Contracts

Official `@fastify/cookie@11.1.2` / `@fastify/session@11.1.3`, opaque signed HttpOnly SameSite=strict cookie, SQLite store and absolute expiry. HTTP secure=false is permitted only behind the existing loopback Host/Origin enforcement. No public registration or default password. Node scrypt uses random salt, N=131072/r=8/p=1 and constant-time comparison. Login attempts are limited by source and account, with at most two concurrent password derivations. Reset/disable revokes existing sessions.

Only bootstrap/auth, static resources and minimal health are anonymous. Mutations require trusted Origin plus matching CSRF; business mutations also require `x-axon-view` matching the authenticated browser view. This marker conveys no authority. Read calls supplying it reject stale identities. SSE closes after login invalidation while accepted work continues under its captured seat. Invalid login does not cancel an Agent request.

Public TaskSpace metadata is visible to enabled seats; private metadata only to ownerSeatId. Account and seat are separate; private tasks belong to the seat. `createPublicTask` allows creation, not managing another task. `manageModelSettings` controls shared model writes. Ownership and public/private type are immutable. Existing WorkItem participant checks remain in force; cross-seat assignment requires an active public task and enabled receiver.

WorkspaceStore retains task×seat paths and native session bindings, reads current task titles from AccessStore and checks task visibility on get. Empty formal indexes have no default workspace until actual work begins. Listing public task metadata creates no workspace. Workspaces are prepared idempotently after catalog creation; failures can be retried without another task.

Task archive uses synchronous admission counters for requests and writes, including upload, instructions, handoff copy/import and session preparation. Different sessions may run concurrently. Reject archive while any admission, live preparation or unfinished WorkItem remains. Archived history remains readable; reopening permits new work. Task metadata edits use revision CAS and record the last modifying user alongside the current result. Creation deduplicates userId+clientActionId; changed payload conflicts.

Resource snapshots/native resource records optionally include the current task id/title/goal/visibility, validated by the history decoder. Pi compaction, native history, tools and cancellation are unchanged. Task text never expands tool permission. Current model input is captured once per request.

Historical experiment projects need not be migrated. Formal startup rejects unregistered workspaces; it never publishes old data or assigns it to the first account. Backup and clean initialization are explicit, offline and tested. All persisted seat IDs (including disabled accounts) remain valid for historical handoff validation; only enabled seats are new recipients. The parent Agent receives current enabled seat id/name pairs from AccessStore on every request; testSeats is only the explicit test-mode fallback. Never derive the formal model-facing seat directory from disabled test configuration or existing work items.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Anonymous business read/write | 401 AUTH_REQUIRED |
| Missing Origin/CSRF | 403 CSRF_REJECTED |
| Old browser view with a different login | 409 IDENTITY_CHANGED |
| Foreign private task/workspace/session | 404; no content |
| Missing public-create/model-write capability | 403 FORBIDDEN |
| Archived new work | 409 TASK_ARCHIVED |
| Revision/create payload mismatch, archive busy | 409 TASK_CONFLICT |
| Missing accounts, secret or catalog mapping | Explicit startup failure; no anonymous fallback |

## 5. Good / Base / Bad Cases

Base: login, create a private task, then create its first conversation.
Good: A establishes public metadata; B reads it and creates its own empty workspace; only explicit handoff shares fixed files.
Bad: treating public metadata as permission to read all workspace contents, or accepting a browser seatId as identity.

## 6. Tests Required

`tests/access.test.ts` covers login/CSRF/stale view, permissions, private IDs, lazy creation, native context, idempotency/CAS, archive admission, handoff participant rights, expiry/revocation, restart and backup initialization. Existing collaboration/Pi/file/HITL tests remain required. `tests/e2e/access.spec.ts` covers login/task navigation/independent identities and cross-tab logout. `probe:access` is separate live provider/Docker evidence.

## 7. Wrong vs Correct

Wrong: keep an account's mounted App hidden after logout, or keep a unique enabled-seat list as the validity set for all historical business records.
Correct: unmount and abort the old client, reject stale writes on the host; preserve disabled seats as historical owners while preventing new login/assignment.
