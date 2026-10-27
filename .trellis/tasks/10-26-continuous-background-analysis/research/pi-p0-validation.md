# Pi P0 validation

Date: 2026-10-26. Installed/public SDK and package pins: `@earendil-works/pi-coding-agent` / `pi-ai` 0.85.1. All tests use isolated temporary data and replace only provider streaming; native AgentSession, SessionManager, tool loop and JSONL remain real. No live model or production data was accessed.

## Decision

Healthy rounds reuse the epoch's native session and create distinct request IDs. Manual recovery creates a fresh native session and reads only host-authorized published references through `analysis_current_read`, including successful original query results. It does not replay incomplete tools or manufacture a recovery summary. Original failed/unpublished history remains immutable and readable as execution evidence.

The public SDK exposes `branch`, `branchWithSummary`, and `createBranchedSession`. Branching is not selected: our host evidence and result projections validate a single selected request branch; adding branch selection/fork binding would expand the recovery mechanism without a demonstrated need. A fresh native session is already an approved alternative. This is a scope choice, not a claim that Pi branching is broken.

## Evidence

- `npm test -- --maxWorkers=1 tests/pi/continuous-p0.test.ts`: 3 passed. Checks actual second-request provider payload contains first native user and assistant, reopening preserves exact first `finalMessageId`, intermediate statements remain separate from the final answer, later unpublished answer does not replace the fixed first request, and explicit fresh-session recovery after failed/cancelled requests excludes abandoned content without changing the original log or replaying model calls.
- `npm test -- --maxWorkers=1 tests/pi/background-runner.test.ts`: 21 passed. Existing service-mode tests verify native overflow compaction, unchanged default summary context (no service instructions injected), original raw-source JSONL preservation and restart, cancellation, corruption fail-closed, and native-result verification.
- `npm test -- --maxWorkers=1 tests/pi/recovery.test.ts tests/pi/continuous-p0.test.ts`: 15 passed. Includes original native-log prefixes at resource/user/tool-call/tool-result boundaries, interrupted projections, repeated interruptions, unchanged bytes on reads, no synthetic tool-result repair, no automatic replay, and strict invalid-terminal rejection. These prefix tests do not claim actual SIGKILL or live-provider validation.

## P2 integration boundary

The existing service runner is extended with a continuous epoch/session directory and stable epoch resource identity. Each job reads its exact persisted request result, even after later native requests. A separate strict tool allowlist excludes Bash, file mutations/outputs, AskUser, instructions mutation, map writes, legacy task-assessment/supplementary delivery and subagents. Task observation maps are request-scoped and passed into the host change-record callback; the backend owns activity/revision/input authorization and atomic publication. No additional model repair call is introduced.

At this P0 checkpoint, adapter/backend/live integration remained pending. Those later results are recorded below and in ../implementation-report.md.

## P2 deterministic results

- `npm test -- --maxWorkers=1 tests/pi/continuous-p0.test.ts tests/pi/continuous-runner.test.ts tests/pi/background-runner.test.ts tests/pi/recovery.test.ts`: **46 passed, 4 files**. The continuous runner's 10 tests cover shared healthy sessions and exact request rereads; strict registered tools; omitted/failed recording without a forced model repair; interrupted native tails and fresh recovery; request-local successful task revision observations; original HTTP query results delivered through the history tool; native default overflow compaction while old request and raw-source evidence remain intact; and fixed attachment read/list/find via public Pi operations.
- Fixed-file reads expose only the current batch's allowlisted FileRefs, verify size and SHA-256, reject symlinks, mutated bytes, binary content and files over 1 MiB. Directory listing uses only authorized manifest names. No shell/container/file mutation is registered. Tests confirm arbitrary host paths and old batch files are rejected and rejected bytes do not reach the next model call.
- Focused ESLint for the changed Pi files, adapter boundary and new tests passed. A full typecheck was run to detect adapter contract drift; final repository-wide status belongs to the integrating parent (other workers own the remaining non-Pi diagnostics).
- A local loopback HTTP server needed sandbox escalation for the actual context query fixture; execution was authorized. No outbound provider call or live-model semantic claim is included.

The history reader limit is aligned to the backend's 50 rounds per page and 256 KiB response bound. The backend additionally projects immutable original incoming event/task-revision inputs and successful readonly source/file evidence; current final conclusions and intermediate processing statements remain separate fields. These backend publication/permission surfaces require their own integration tests.

Attachment evidence follow-up: successful native `read` output now carries the fixed FileRef (path/name/size/hash) and requested offset/limit before the unchanged native content. This preserves attribution when historical tool-call arguments are not included in the public projection. ASCII PDF and image bytes are explicitly rejected as unsupported readonly binary parsing. The final focused continuous-runner suite passed 12/12, including provenance and both binary-format cases; focused ESLint passed again. Earlier 46-case Pi regression remains the baseline before these two added cases.

Final integration follow-up: bounded exact evidence index/slice schema and native two-slice reconstruction expanded continuous-runner to 13 passing tests. Parent final targeted run passed 34/34 across continuous-runner, continuous backend, legacy crash, and actual continuous SIGKILL. Real-provider semantic outcomes and retained limitations are reported separately in live-semantic-review.md.
