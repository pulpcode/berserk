# Web Interaction Contract

## 1. Scope / Trigger

Read when changing W01-6 question tools, operation gates, command policy, interaction history, response routes or their Web consumers. These are request-local interactions, not business approvals or persistent Runs. W01-7 allows new requests after interruption but does not reconstruct old waits. Reuse Pi 0.85.1 public extension/tool APIs and the existing Docker execution service. Root commit messages remain primarily Chinese.

## 2. Signatures

- `PiLab.respondInteraction(sessionId, interactionId, input: unknown): Interaction` resolves or acknowledges the exact interaction.
- `POST /api/sessions/:id/interactions/:interactionId/response` returns the authoritative `Interaction`; it does not await subsequent model/tool work.
- `GET /api/sessions/:id` includes `interactions`; POST message SSE emits `interaction.updated {interaction}` with session/request IDs.
- `evaluateCommand(command, cwd='/workspace'): CommandDecision` returns `{decision, ruleId, reason, version}`; parser/engine faults throw, never return allow.
- `interactionHistory(entries, workspaceId, sessionId, activeRequestId?, seatId?)` owns strict replay and restart projections. Consumers must not independently cast native entries.

## 3. Contracts

Shared DTOs live in `src/contracts/interactions.ts`. Question responses are `{requestId,kind:'question',action:'answer',answers}` or `action:'skip'`; confirmation responses are `{requestId,kind:'confirmation',decision:'approve'|'reject'}`. Question answers use exactly one of `{questionId,optionIds}` and `{questionId,text}`. An answer never authorizes an operation. Additional authority/answer fields are rejected.

Fixed `extensionFactories` register `ask_user` while `noExtensions=true` prevents automatic discovery. Explicit main-agent tools must include it; readonly children have no interactive tools. SDK extensions are trusted host code, never uploaded file scripts. Optional `LAB_HITL_DEMO_ENABLED=true` registers the local confirmation probe; default false. No new default deadline or tool-count limit.

Compose existing `beforeToolCall`; evaluate the final validated arguments, save policy/interaction before waiting, and recheck abort/parameter identity before executing. Pi `tool_execution_start` is not evidence that execution began. A hook exception can become an ordinary tool error; infrastructure faults must also trigger the host terminal path so the model cannot continue. Preserve the supported original `afterToolCall` hook; do not mutate event objects to inject results.

If the original result hook fails after a policy-controlled tool executed, stop the request while preserving its actual result and execution metadata. Pi otherwise replaces that evidence with an unmarked hook error; do not project it as an operation that never started. Replay must reject execution evidence attached to a rejected or cancelled confirmation.

Only one interaction waits per request. Append and claim the first valid response synchronously, then resolve its Promise; duplicate same responses acknowledge, changed responses conflict. Stop invalidates pending waits and cleans listeners. Do not await `session.abort()` inside its own event pipeline. Browser disconnect does not cancel. Waiting keeps the existing AgentSession/container; configured whole-request deadlines include waiting.

Native JSONL entries `berserk.interaction.requested.v1`, `berserk.interaction.resolved.v1` retain questions/decisions and fixed seat/request/tool ownership. `berserk.command-policy.v1` records the rule decision against the preceding actual tool call, including blocked calls; this uses the existing native history, not a separate ledger. Executed results can carry policy details through public `afterToolCall`. Interaction records are not injected into model context: the real AskUser tool result supplies answers exactly once.

Restart projects unresolved pending entries as expired and does not rebuild waiting tasks. Approval without execution evidence is unknown. Evidence that a tool was blocked before execution is distinct from actual tool failure. Preserve recovery warnings and old histories; never delete entries to make an old parser accept them.

Pending uniqueness is request-scoped: an old interrupted request's pending entry cannot block a new request's interaction. Match terminal evidence by its requestId, including a later preflight failure without a resource entry. Submitting any response to an old interrupted request returns 409, even if the same response was saved before interruption. Normal completed-response idempotence remains. A later successful request never turns an old unknown execution into success.

The Bash policy uses locked tree-sitter/grammar versions and a bounded literal subset. Rules inspect command chains before any part executes; deny beats ask, which beats allow. Unsupported syntax asks; parser or policy infrastructure failures terminate. Decoding strings must not execute expansions. Environment wrappers/assignments, nested substitutions and tree-sitter's backslash-newline fragments need regression coverage. Retain the original command for execution and display. Ordinary Python/Node file bodies and arbitrary executable internals are not audited; allow is not a read-only guarantee. Approval never changes Docker mounts, networking, user or capabilities.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Unknown interaction/session | 404; no effect |
| Wrong kind, malformed/extra fields, unknown question/option, incomplete answers | 400; keep valid wait |
| Stale request, conflicting answer/decision, cancelled/expired interaction | 409; no continuation |
| Identical accepted response outside an interrupted request | Return existing record; no replay |
| Response to an old interrupted request, including saved approval | 409; new work needs a fresh interaction |
| Persistence, extension loading or policy infrastructure failure | Fail request; do not fabricate answers or allow execution |
| Unsupported Bash syntax | ask with explicit review reason; no partial chain execution |
| Recognized prohibited environment command | deny; no approval button |

## 5. Good / Base / Bad Cases

- Good: AskUser selects a format, then the same Pi request writes the requested file; later an independent command approval is required.
- Base: refresh while waiting, query the same interaction, explicitly answer once; other sessions continue.
- Bad: infer authorization from AGENTS.md, an AskUser option labelled "approve", a previous approval, or a submitted replacement command.

## 6. Tests Required

`tests/execution/command-policy.test.ts` covers parsing and precedence without running dangerous inputs. Pi integration covers extension activation, wait/stop ordering, duplicate/cross-kind responses, persistence failures, native result linkage and restart without replay. Browser tests cover draft retention, navigation/attention, explicit submit, GET-before-retry and narrow layouts. `probe:hitl` verifies real Pi/provider/Docker question-to-file and approve/reject/stop effects in an independent data directory. Run full typecheck, lint, unit tests, browser regression and build before reporting completion.

## 7. Wrong vs Correct

Wrong: treat a thrown hook exception as guaranteed request termination, or mutate a progress event to fabricate persisted result metadata. Correct: use the existing host stop path and public native custom entries for decision evidence; use supported result hooks only where they run.

Wrong: allow `env -- MODE=test sudo ls` because the first token is env, or mark an approved-but-blocked call as an executed failure. Correct: parse supported wrappers and exact arguments, take the strongest decision, and derive execution status from actual native evidence.
