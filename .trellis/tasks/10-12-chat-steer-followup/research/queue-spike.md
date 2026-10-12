# Pi 0.85.1 queue integration evidence (2026-10-12)

Implemented tests: `experiments/harness-lab/tests/pi/message-intake.test.ts` and `message-intake-lab.test.ts`; overflow coverage in `compaction.test.ts`, API coverage in `server.test.ts` / `seat-api.test.ts`.

## Public API feasibility

- `session.agent.steer(message)` / `followUp(message)` retain separate user message objects even for identical text. Native `message_end` retains the same object identity. The intake projection correlates by object reference, never content or a hidden ID added to model text; each receipt still carries the browser submissionId.
- Native AgentSession remains subscribed and owns persistence, retry and compaction. The host subscribes to public Agent events after the Session listener, so consumption events follow native message persistence.
- Native `clearAllQueues()` does NOT remove a message already drained into the execution loop before `prepareNextTurn`. A regression explicitly demonstrates that it still reaches the next provider request. Therefore unconditional clear/requeue is unsafe.
- Safe mutation window: close admission on awaited native `turn_end` before the core queue read; reopen on the next assistant `message_start`, after all claimed user messages have been persisted. Retain the closed window throughout preparation/compaction. Within an open window, clear plus requeue occurs synchronously with no await. Native loop cannot interleave a drain. HTTP operations in a sealed window receive a conflict/unavailable response and keep client text.
- Stop closes admission and clears native queues immediately; wait for native settlement before returning never-consumed inputs. Already-claimed messages can still receive user events on the abort path, so restore only receipts that remain pending after settlement. Real tests verify a claimed message is not restored while a second, undrained item is restored.

## Discovered error-continuation behavior and minimal adaptation

Native AgentSession `_handlePostAgentRun()` falls back to `agent.hasQueuedMessages()` even after a permanent provider failure. A real 401 test initially demonstrated that an accepted Follow-up was consumed after failure, starting a second provider request. This is contrary to the approved failure behavior.

At error/aborted/length `turn_end`, the host clears its pending native queues and marks the projection temporarily parked. A native recovery `agent_start` or a subsequent assistant `message_start` restores those same pending messages to native queues. Real Pi also continues after truncated tool output within the same native run, with no new `agent_start`; the added regression verifies one native run and exactly one subsequent input consumption. The host never calls prompt/continue to start recovery. If Pi does not recover, normal settlement returns the unconsumed content. Tests cover permanent failure, native 503 retry, native context-overflow compaction recovery, truncated-tool continuation within one native run, and abort after dequeue. This extra flag addresses an observed gap, not speculative scheduling.

## Endpoint contract

- `POST /api/sessions/:id/inputs`: pure text + submissionId + expectedRequestId + mode; response `{receipt,queue}`. Exact submission retries read existing results before checking the current active request. Different content with the same ID conflicts.
- `GET /api/sessions/:id/inputs/:submissionId`: exact receipt lookup; null is unknown, not a safe-to-resend verdict.
- `POST /api/sessions/:id/inputs/:submissionId/actions`: actionId + expectedRequestId + pendingRevision + action (steer/delete/takeback/undo). All queue mutations require current revision and an open mutation window. Taking back already-returned content does not mutate native queues and can acknowledge an old revision or old request while a newer request is active.
- Snapshot `inputQueue` and SSE `input.queue` expose pending/returned content. SSE `input.consumed` separates the next user turn before assistant output. Initial attachments/Skill selections are only projected on the first user message in a host request, not every Follow-up.
- Receipts are volatile, bounded to 256 submissions per run (completed receipts from prior runs are removed at the next bind); outstanding content is bounded to 32 items and 32,000 text characters. Actions have 1,024 receipts per run. Lookup after forgotten/restarted state is unknown. Unreturned content survives later runs in this process.
- Per-channel FIFO is preserved when rebuilding native queues. Converting to guidance or undoing deletion joins that channel's tail. Mixed modes retain Pi priority rather than a false global FIFO guarantee.

## Validation at implementation checkpoint

- All `tests/pi` plus `tests/server.test.ts` and `tests/seat-api.test.ts`: 27 files / 316 tests passed before the final additional FIFO case.
- `npm run typecheck` and `npm run lint`: passed at that checkpoint.
- Additional final FIFO regression is run with native/module and request integration suites after the change.
- No credentials/network/provider API calls; real Pi sessions, fake provider streams only. No dependency patches or private field access. No deployment or Git commit.
