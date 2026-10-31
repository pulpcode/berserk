# Agent Scenario Validation

## 1. Scope / Trigger

Read when changing the synthetic end-to-end probe joining source queries, conversation annotations, ordinary files and seat handoffs. This validates existing capabilities; it does not add a business workflow engine or make model reasoning authoritative.

## 2. Signatures

- In `experiments/harness-lab`, `npm run probe:agent-framework -- [--runs 1|2|3] [--port 4331] [--prepare-only]` uses `scripts/probe-agent-framework.ts`.
- `node --import tsx --env-file-if-exists=.env.local scripts/probe-agent-framework-observations.ts` observes ambiguous edits and unavailable sources; `AGENT_OBSERVATIONS_PORT` defaults to 4338.
- `AGENT_FRAMEWORK_REVISION` optionally identifies an archived source baseline without `.git`; otherwise probe metadata attempts Git and explicitly falls back to `unknown`. The probe records its script and fixture hashes separately.
- Existing model configuration and execution configuration remain unchanged. The full scenario requires the real configured Docker runtime. Every trial creates fresh formal identities and data through `startMapTrial`.

## 3. Contracts

Main scenarios use synthetic overall/planning seats, source facts and files. Do not open existing production data or send work to real recipients. Each repeat starts independently. Business prompts and fixtures must not contain the evaluator's expected conclusions; the separate review checklist is never loaded into the workspace or model input. Facts may be queried normally. Conclusions produced by a preceding Agent turn and handed off as a work goal are actual workflow evidence, not an independent blind-discovery trial.

The driver may confirm only the exact synthetic work action expected by that step. Check its real prepared receipt: action source/status/kind, task, actor, creator and assignee; then check assignment input bytes, submission filename, or current review submission and decision. A second confirmation, unexpected question or arbitrary Bash confirmation stops the step; never approve all interactions. Record scripted confirmations as scripted confirmations, not human review.

Keep actual prompts, provider JSON bodies without headers/credentials, native responses, business receipts, fixed annotation publications and saved file bytes. Existing native Pi history remains authoritative; evidence files are test outputs only. Preserve failed preparations and model runs. Do not synthesize successful tool results or silently change prompts until a trial passes.

`protocol_completed` means structural checks finished, while `semanticReview` remains `pending_review`. Inspect actual source geometry, version provenance, claims and files before judging business correctness. A syntactically valid estimated polygon can pass geometry validation while failing a scenario requiring source-provided positions. A zero-result keyword search is not proof that the source contains no relevant reports.

Binding a receiving session already materializes input files. Do not require a redundant model `handoff_import_file` call. The probe obtains an idempotent page-import receipt for the real path, then compares the receiving original's bytes. Check both ordinary v1/v2 files against their fixed submitted copies; keep old publications and files unchanged.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Missing Docker or credentials in a full run | Explicit failure before the model main flow; not a passing or skipped scenario |
| `--prepare-only` | Accounts/materials/API preparation only; no claim of live-model success |
| Unexpected/mismatched confirmation or question | Record interaction, stop dependent work, no automatic answer or approval |
| Failed request or structural assertion | Preserve evidence and incomplete run; never replace it with a successful retry |
| Successful tools but incorrect business claims or geometry | Semantic failure, even if `protocol_completed` |
| One session cannot see another session's follow-up authorization | Do not infer unauthorized behavior from absent private conversation evidence |
| Archived source lacks Git metadata | Use supplied revision or explicit unknown plus hashes; do not abort prepared business fixtures |

## 5. Good / Base / Bad Cases

Base: publish without adoption, submit a fixed file containing the publication ID, update sources, revise and explicitly adopt the second publication.

Good: three independent runs preserve their failures and identify model errors separately from working isolation and receipt mechanisms.

Bad: counting file existence as semantic success, calling scripted acceptance independent review, or changing runtime prompts between repetitions without declaring a new experimental condition.

## 6. Tests Required

- `tests/probe-agent-framework.test.ts`: allowed confirmation types and wrong task, actor, counterpart, revision, file and submission denial.
- `tests/agent-framework-boundaries.test.ts`: one formal identity, two conversations, fixed baseline, live source update, independent draft changes and task × seat ordinary file sharing.
- Reuse annotation/access/source/Pi and desktop tests for their existing mechanisms. Do not claim deterministic providers prove live reasoning.
- Keep live-provider, Docker, API, desktop and fault observations separate. State unexecuted variants and whether actual compaction occurred. Bytes are not tokens.

`scripts/probe-map-query-cases.ts` and `probe-map-query-scope.ts` supply frozen readonly fixtures and scheduled entries for query-contract validation. The reviewed schedule fixes three repetitions, separates business completion from tool-path coverage and controlled interpretation, and refuses overwriting an entry's evidence directory. New cases must stay outside product prompts, Skills and runtime workspaces. Controlled interpretations use genuine service/tool output and explicitly driver-issued SDK history, with no subsequent callable tools; they are prompted diagnostics, not autonomous-query evidence. Tests inspect the actual provider payload for exact result delivery, absent hidden fixture fields and unchanged model parameters. Report missing outputs, preparation faults, factual errors, omissions, redundant reads and self-recovery separately; never rerun failures into apparent success or claim three repetitions establish general reliability.

A natural case must make its intended data ownership discoverable from the actual model-visible task/session context, not only from hidden fixture preparation. If a question omits whether it concerns source situation or conversation annotations while the task points elsewhere, record routing ambiguity and business non-completion separately; do not silently clarify and rerun. For result-field experiments, record whether the model actually received the experimental field. Also score the entire visible answer: a correct requested count can coexist with an incorrect unsolicited whole-document or current-version claim.

## 7. Wrong vs Correct

Wrong: infer the imported path from whether the model happened to call an import tool, or declare the whole chain passed because its last work item is completed.

Correct: inspect the actual import receipt and saved bytes; compare source geometry and statements independently; report task completion receipts and semantic quality as separate results.


## R3 task-local live diagnostics

**Scope / trigger.** The spatial task's `r3-20261022` runner compares frozen Skill bodies, using the existing HTTP/Pi runtime. It is a diagnostic runner, not a new product loop or proof of the 90% acceptance threshold.

**Signatures.** From `experiments/harness-lab`, run `node --import tsx --env-file=<existing-config> ../../.trellis/tasks/10-15-agent-map-spatial/r3-20261022/live.ts run <new-absolute-.local/spatial-r3/batch> [port]`. `resume` requires the same frozen source, schedule and synthetic day, skips every previously started entry, and rejects incomplete accounting. Create the parent directory first. Configuration is read without copying or printing secrets; the runner fixes the reviewed model parameters independently of the current product default.

**Contracts.** `runs.json` records planned entries and statuses; `attempts.json` and raw provider SSE establish actual requests and usage; `review.json` contains visible messages, tool evidence, interactions and before/after state. Preserve all original reviews and their hashes before adjudication. `recorded`, host `succeeded`, a successful tool and a model `stop` are not semantic passes. Compare exact frozen changed-body bytes in actual provider input: a selected original counterpart is not exposure to the candidate, and later loading cannot justify an earlier decision.

**Validation / error matrix.** Numeric per-entry request/tool/time thresholds are warnings for this approved protocol. Check the plan budget and completion reserve before a new entry; allow a progressing current entry to finish, recording any overrun. A provider timeout, HTTP failure, missing usage or source drift retains the original failure and stops further paid requests rather than silently retrying. A single entry crossing midnight may finish with timestamps retained; stop before starting the next entry. Protocol and quota choices belong to the reviewed batch, not global product policy.

**Good / base / bad cases.** Good: exact planned user responses use the real interaction API and retain observed pending, answer, skip, cancellation and cleanup separately. Base: an ordinary text question safely waits but never exercises the planned API path; report that coverage limit separately from wrong selection. Bad: count cleanup cancellation as a user choice, count a future-action offer after a completed task as blocking clarification, or claim an unloaded candidate caused a group score difference. An unrequested extra query can be an instruction-following issue even if the frozen scoring formula has no separate read-scope gate; disclose the gap without retroactively changing the formula.

**Tests required.** `r3-20261022/live.test.ts` checks budget/cache accounting, more than 24 provider requests without numerical cutoff, failure retention without a second paid request, fresh HTTP runs and resume without repetition, actual answer/skip/cancel/unanswered paths, and a fixed-result save through a real version conflict. Run its scoped TypeScript check and repo-root ESLint. Keep model-quality review separate from these deterministic tests.

**Wrong vs correct.** Wrong: compare differently worded/background historical trials as identical controls, or report group membership as evidence that changed instructions were used. Correct: check reuse eligibility against actual prompts/context/loading and retained evidence, report each body/loading condition separately, and add paired comparisons only for cases with verified candidate delivery. Agent reviews remain Agent reviews, not independent human calibration.

## R7 Agent Plan result-grounding diagnostics

**Scope / trigger.** The task-local `r7-20261023` batch compares the current integrated baseline with two changed Skill bodies, using six explicit-loading development cases per group. It is not automatic-discovery or holdout acceptance.

**Signatures.** Run `node --import tsx --env-file=.env.local ../../.trellis/tasks/10-15-agent-map-spatial/r7-20261023/live.ts run <new-absolute-.local/spatial-r7/batch> [port]` from `experiments/harness-lab`. Frozen `LLM_BASE_URL` is `https://ark.cn-beijing.volces.com/api/plan/v3`, `LLM_MODEL` is `deepseek-v4.1-flash`; credentials are never recorded. Historical runners retain their original provider/model constraints.

**Contracts.** Archive baseline `af13107`; the B runtime changes only the two controlled Skill bodies, preserving catalog metadata, backend and tool schemas. The evaluation transport sets `thinking.type=disabled` identically in A/B; save both original Pi input and actual wire input/hash. This is an evaluation adapter, not evidence of complete native product compatibility. A Plan endpoint does not prove subscription deduction: optional excess postpaid and delayed account usage must be verified separately.

**Validation / errors.** Reject other endpoints/models before transport; record actual response model and usage. After provider failure, missing usage or source drift, preserve evidence and refuse subsequent external retries, including host-requested retries. Numeric limits are checked before new trials; the active progressing trial can finish. Never rerun a failed slot automatically. Freeze scoring and fixtures before live requests.

**Cases.** Good: provide an actual source line matching a polygon edge when asking the existing measure tool for that edge length. Base: a correct classification plus an unsolicited wrong width is core-pass but strict-fail. Bad: require unsupported edge selection, then blame the model; or count only the final answer after an earlier visible misstatement.

**Tests required.** Mock the native HTTP/Pi loop for all 12 slots and real conflict recovery; assert exact selected body at each user turn, A/B-only Skill differences, wire request compatibility, failure/retry guards and no evidence overwrite. Use an independent distance oracle and inspect actual state changes. Offline aggregation tests validate gating only; full semantic judgments still require evidence review, explicitly labeled Agent review unless a human actually reviewed.

**Wrong vs correct.** Wrong: `HTTP 200` or a successful tool proves factual correctness. Correct: separately review core completion, process facts, final facts, actual effects and boundaries, retain ambiguous/incomplete entries in the planned denominator, and preserve original evidence and scores.

## Annotation integration evaluator revisions

The task-local `10-26-agent-plotting-integration/evaluation-v2` keeps the original `evaluation/` and live evidence unchanged. Restore historical runs from their recorded commit and dependency hashes; never rerun an old driver against changed product/Skill files and label it the old baseline. Revised offline adjudication is a separate result, not a new model score.

`assessEnding(text)` returns `finished`, `needs_reply`, or `needs_review`. This is a conservative protocol heuristic, not semantic acceptance. Conditional wording alone cannot establish an optional invitation; an unresolved request remains subject to review. A `finished` ending still requires independent checks of all explicit user requirements, visible claims and actual effects. Only the existing frozen clarification policy may supply a scripted answer; an optional offer or uncertain ending grants no permission for extra actions.

Finalize per-slot counters from settled ledger rows and cross-check their request identities and usage against provider attempts before persisting `review.entry`, `result` and `runs`. A zero-request slot has zero unknown usage; a failed request without usage remains unknown. Count mismatches or unsettled requests stop further execution, rather than overwriting evidence with zero or excluding the slot. Preserve batch budget, model/source drift, one-use claim and critical-effect stops.

Required offline checks: `evaluation-v2/remediation.test.ts` covers necessary requests, optional offers, uncertain endings, zero/unknown usage and ledger/attempt mismatches; `evaluation-v2/evaluation.test.ts` cross-checks persisted counters through real local HTTP/Pi preparation, controlled-provider runs and a critical duplicate-write stop. These tests validate the evaluator, not model reasoning. Wrong: classify every sentence containing “if” as optional. Correct: retain a required input request or mark uncertain scope for review without synthesizing an answer.

## Repeated-error evaluator and loading preparation (2026-10-28)

**Scope / signatures.** `10-26-agent-plotting-integration/evaluation-v3` owns revised `replyFor`, `clarificationResponse`, `assessEnding` and the HTTP runner. It reuses unchanged v2 helpers and includes them in its source freeze. Never edit frozen v2 or old live evidence to apply fixes.

**Contracts.** Scripted responses require the single recognized, case-specific current question. Mentioning a layer, source, range or draft is not permission to repeat the original task. Question options must not turn an unrelated prompt into an allowed question. Unknown/conditional requests remain unanswered for review. Evidence-insufficiency statements can be `needs_review`; that classification alone neither proves incompletion nor authorizes a synthetic reply.

**Counters / errors.** Persist `messageSendAttempts` (attempted POSTs), `sentTurns` (successful message HTTP responses), `successfulResponseTurns` (successful host turn results), `respondedUserTurns` (distinct original prompt indexes with successful host responses) and legacy `completedTurns` (protocol-accepted original prompts) separately. No counter proves semantic completion. A failed transport must not become a successful sent turn or receive a guessed reply.

**Cases.** Good: a recognized type question receives its frozen answer, while a layer-choice question in the same fixture remains unresolved. Base: an actual successful save ends in an optional invitation and requires review, but its successful response remains counted. Bad: answer a statement about insufficient arrival evidence by sending the original query again.

**Tests.** v3 regression tests exercise explanatory insufficiency, necessary requests, wrong-field questions, structured-question option contamination, and separate counters through local HTTP/Pi. The task's `loading-diagnostic/prepare.ts` is offline-only: native explicit Skill selection in B, ordinary selection in A, actual readonly tools, mocked provider outputs, preserved wire evidence and unchanged tool definitions. Reject live mode. Its prepared slots and synthetic request counts are not model pass rates or an authorized live batch.

**Wrong vs correct.** Wrong: infer a loading fix from successful mocks, or run the preparation transport against a live provider. Correct: validate delivered body and paired fixture equivalence first, then build and review a separately budgeted real diagnostic; do not change product prompts before the causal hypothesis is tested.

**Separate live diagnostic.** `loading-diagnostic-live/run.ts` fixes 6 cases × A/B × 2 repeats, uses the v3 interaction rules and unchanged v2 provider, and includes the protocol, driver, helper and product bytes in its freeze. `prepare` makes no provider calls; `freeze` writes an exclusive identity file. `live` requires matching scope/freeze, explicit batch authorization and provider allowance verification. A uses native on-demand loading; B selects the existing Skill through the native request field. Inspect actual wire body delivery and tool-schema identity on every request; preserve A's spontaneous reads instead of reclassifying its group.

**Budget and effects.** The diagnostic's lower ledger caps are 120 requests / 4M input / 200K output, checked before requests and after settlement. Inherited pair reserves may stop the batch before 24 slots finish. Never silently expand limits, retry a failed slot, or remove unfinished slots from the denominator. All tasks preserve source state; readonly/preview cases preserve the entire map state. Successful responses remain counted even when an effect check subsequently fails.

**Review and verification.** A semantic review may accept an executed `needs_review` slot after inspecting evidence, but cannot award a pass to a missing, not-executed, prepared or still-started outcome. Test native HTTP/Pi writes, actual clarification and preview with a controlled provider, plus lower-budget limits, one-use claims, side-effect stops and denominator retention. These are driver checks, not evidence that a real model improved. Leave all semantic model judgments pending until actual claims and effects have been reviewed.


## Integrated settled-request review gate (2026-10-28)

**Scope.** `10-28-agent-spatial-plotting/evaluation` is evaluation-only continuation control. It does not modify product Agent prompts, old frozen drivers, or historical scores. Every settled ordinary answer currently receives explicit offline review; there is no automatic semantic classifier.

**Signature.** `runReviewedTurns({directory,prompts,replies,ports})` consumes frozen original prompts and `{id,userTurn,text}` replies. Ports are `send(text)`, `review(checkpoint)` and `inspect()`. The existing runner owns authorization, budgets, provider-version checks, native service lifetime and structured-interaction replies.

**Contract.** Persist dispatch attempts and actual native evidence before review. Decisions contain `checkpointHash`, attributed `reviewer`, `reason`, and `advance|reply|hold`. `reply` may select only an unused frozen reply for the current original user turn. `advance` authorizes the next original turn, never semantic success. Reinspect native session/map evidence after review and reject drift. Keep original-versus-scripted dispatch kind explicitly; identical text does not imply identical purpose.

**Validation / errors.** Stale hashes, changed native state, unknown/reused reply IDs and unattributed decisions reject continuation. Failed/pending native requests remain unresolved; ordinary messages must not bypass AskUser. Transport failure is recorded without automatic resend. Existing evidence directories reject automatic restart. `hold` ends this adapter invocation; the caller must retain any desired native service state. Only a pending review Promise supports same-process continuation; process-exit or historical-session recovery is not implemented.

**Good / base / bad.** Good: review a completed preview ending with an optional offer, then send the frozen save turn once and save the original geometry. Base: a wrong but finished answer proceeds while semantic scoring remains pending. Bad: infer required input from a question mark, repeat the original task as a guessed answer, or claim that protocol advancement proves correctness.

**Tests.** `review-gate.test.ts` replays R16 Q20 and plotting C09 evidence copies with explicitly constructed review decisions and tests narrow replies, holds, drift, dispatch identity and no retry. `http.test.ts` uses real local HTTP/Pi, the existing AskUser response endpoint, actual analysis/save tools and a controlled provider; assert one session, two original messages, one clarification, exact geometry and plan preservation. These are offline evaluator checks, not live model outcomes.

**Wrong versus correct.** Wrong: describe the adapter as a 288-task runner or automatic recovery for the old Q20. Correct: connect its ports to a separately reviewed, budgeted runner, freeze that connection, and keep old evidence/denominators unchanged.

## Source-selection generalization diagnostic (2026-10-30)

**Scope / trigger.** The task-local `10-28-agent-spatial-plotting/source-generalization-20261030` runner validates independent candidate/reference source selection from fresh native sessions. Product code, Skills and historical runners remain unchanged; fixture adaptation is confined to archived mock/startup scripts.

**Signatures.** From `experiments/harness-lab`, `node --import tsx <round>/run.ts freeze <file>` creates a source identity; `live <new-batch-directory> <authorization-json>` requires the matching freeze and limits. `Decision` contains `checkpointHash`, `reviewer`, `reason`, `action: finish|reply|fail_task|stop`; `reply` has `selection.axes` or question-specific `answers`. This is evaluator control, not a product intent state machine.

**Contracts.** Load fixture facts through real backend APIs; keep oracles and evaluator replies outside model workspaces. Replace old source objects, area catalogues and task focus together. A required empty intel catalogue is not a second resource candidate source. A reviewer classifies actual questions; the program only sends frozen answers for the asked candidate/reference axes. Generic questions resolve remaining unknown axes according to the frozen protocol. One already-known-scope restatement is allowed; optional invitations receive no corrective reply. Structured questions use native free-text answers when the frozen choice is absent from options.

**Validation / errors.** `finish` is flow completion, never semantic success. Ordinary mistakes and task-local unknown questions can finish/fail the task while the next isolated task proceeds. Transport, unknown usage, source drift and exhausted budgets stop the batch without retry. A response authorized as request N at the exact request cap must be retained; block request N+1 rather than cancelling the last valid answer. Freeze transitive shared helpers, not just entry modules. Preserve original execution rows and publish a separate scored index with evidence references.

**Good / base / bad cases.** Good: count draft points against a source boundary explicitly requested by the user. Base: clarify only the unknown boundary, or report both boundary results. Bad: silently select draft candidates because the user said “this session”, or give a partial answer and treat an optional offer as permission for an evaluator rescue prompt. Full conditional answers followed by an optional invitation do not require continuation.

**Tests required.** `run.test.ts` covers all eight native HTTP/Pi fixtures and 32 combinations, both clarification paths, unknown AskUser cancellation followed by the next task, actual on-demand Skill body delivery, and exact budget boundaries. `provider-fault.test.ts` covers 429, missing usage and model drift with retained failures and no second dispatch. Synthetic provider outputs establish runner correctness only; live scoring must inspect public statements, actual tool arguments/results and complete business state.

**Wrong vs correct.** Wrong: equate successful geometry or a read Skill with successful task scope; penalize every unclear phrase without context. Correct: score unresolved-source coverage, required names/counts, process facts, final facts and effects separately; identify definite extra factual errors even when the requested answer is correct. Record expression concerns separately when no definite false assertion is established. Agent review is not human annotation or a blinded model comparison.
