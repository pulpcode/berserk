# Scenario Run Isolation

## 1. Scope / Trigger

Read with [Scenario Director](scenario-director.md) when changing scenario ingress, task ownership, native Agent scope, continuous analysis or replay activation. The reviewed v0.4 design is under the scenario-demo task. Only one run is active. History is read-only; replay always creates a new instance. Restoring historical execution is deferred.

SIM-TASK-002 is intentionally unresolved: do not add a hidden browser run marker, bind an unsourced manual task to the current run, add a business-seat run selector, or disable that existing entry as an implicit substitute. Existing ordinary unbound records retain their original behavior. Known source/task parents provide confirmed ownership; the unresolved path is not a completed isolation claim.

## 2. Signatures

- Scenario ingress adds optional protocol field `scenarioInstanceId`; it is mandatory for configured scenario-clock sources and forbidden for unrelated sources. Source authentication still determines `sourceId`.
- Authenticated source control reads `GET /control/instances/:id/notifications/:sourceMessageId` and `/provenance`. Provenance contains full persisted task definitions, notifications and actions, including records outside the director's latest-20 detail window.
- `ScenarioScope` synchronizes the authenticated source active pointer and checks writable ownership. Existing `.activation.json` is the durable pending-operation record, not a second active pointer.
- `TaskSpace`, `BackgroundEvent`, `BackgroundJob`, continuous partitions and `ContextPrincipal` carry internal optional ownership. Business task API projections omit `scenarioInstanceId` and expose `readOnly?: boolean` without changing the original task state.
- `ContextService.query(tool,input,principal,signal?,readOnly=false)` uses internal `x-axon-scenario-instance` metadata for owned clocked sources. Models cannot supply that header or a run query argument.
- Browser context reads optionally accept `?taskId=<authorized existing task>` to inherit an established parent. The host alone permits fixed read-only historical map reads; Agent execution retains lifecycle gates. Global read-only map browsing keeps its current-source semantics and creates no task association.
- Director-only `GET /api/simulation/instances/:id/preflight` returns queued/running/foreground request counts and complete unsent/unconfirmed notification counts.

## 3. Contracts

Verify ingress against the full saved source notification: identity, owner, source system and original content must agree. Deduplication preserves the original receipt; changed content or owner conflicts. Late ended-run data is audit-only and cannot create analysis, deliveries or current lists. An unmatched legacy event from a known scenario source is not ordinary current input.

A replay persists its immutable activation request before closing old/new admission gates. It cancels old queued work, requests cooperative cancellation of native foreground/background requests and waits for actual terminal evidence. A timeout remains pending; explicit same-request recovery is required. Native success winning the cancellation race remains success under the old owner; closing prevents new publication or delivery. Ordinary unrelated work is unaffected. Only then may the source CAS freeze A and activate B; confirmation opens B. Restart reconstructs closed admission from the pending record before scheduling. Source must be available before host startup; unavailable or conflicting provenance fails closed.

Ended-run tasks with unfinished work remain truthful and read-only. Archive only records eligible under existing busy/unfinished-work rules. Never mark work completed, delete records, or bypass the generic archive guard to allow replay. Bound writes fail closed if the scope service is absent. Prepared/ended tasks leave current business candidates and workbench; direct authorized history remains readable.

Agent tools capture the originating task/job owner. Task candidate search, direct reads, cursor hashes, source HTTP, resources, spatial reads and final task-version checks must retain that owner. Re-check admission after asynchronous work. Continuous analysis partitions native session, input queue, batches, task coverage and published baseline by both configuration epoch and run; neither global active tasks nor a shared configuration session may replace that partition.

Preserve original source payload hashes, creation receipts and native Pi JSONL. Legacy binding requires exact saved host creation receipts and full authenticated source provenance; no regex/prefix/latest-window guesses. Control prefixes may be removed in a business content projection after verified binding; original bytes remain available to integrity checks. Necessary opaque references and snapshot clocks remain valid evidence. Do not label a transformed projection as verbatim original text.

## 4. Validation / Error Matrix

| Condition | Required result |
| --- | --- |
| Missing/mismatched scenario ingress ownership | Reject; no receipt/job silently assigned to current run |
| Duplicate exact notice | Original receipt, no second queue item |
| A data arriving while B active | A audit record, no B analysis/inbox/current candidate |
| Bound write after A gate closes | Read-only conflict, no new effect |
| Agent source snapshot owner differs | `CONTEXT_TIME_BASIS_CONFLICT`; no mixed result |
| Cross-owner task read | Same task-not-found boundary as an unauthorized task |
| Missing active scope service for bound records | Fail closed; never convert to ordinary business |
| Pending native stop or uncertain notification | Retain operation; B is not announced active |
| Legacy provenance/content disagreement | Preserve records and fail closed; no payload rewrite |
| Reload / server restart | Read original receipt; never automatically replay a model/send request |

## 5. Good / Base / Bad Cases

Base: director prepares B's three tasks with B's explicit identity; an A job can only query A's authorized tasks and facts. Good: cancel is requested while A runs; B remains prepared until A's actual terminal state, and late A evidence stays under A. Bad: route by equal task names, archive incomplete work as completed, or let a global unbound query repair a missing model owner.

## 6. Tests Required

Use deterministic local HTTP/SQLite and native fake providers, not paid models. Cover `mock-scenarios`, `scenario-scope`, `scenario-run-isolation-integration`, `context-scenario-scope`, `task-context`, continuous discovery/coverage, pending activation restart, resources/spatial and director access tests. Assert original receipt/hash/history preservation, stop-request versus terminal distinction, queued cancellation, native-success race, late input, fixed task map scope and full notification windows. Run typecheck, lint/boundaries, build, full Vitest and affected desktop Playwright. A13 unsourced creation remains deferred; deterministic execution tests do not prove real-model reasoning.

## 7. Wrong vs Correct

Wrong: send “switch to B” to the model and ask it to ignore A, or change a pending operation ID after a timeout. Correct: keep host-owned immutable lineage and admission gates, recover the same recorded operation, and start B with separate native context only after old effects are settled.
