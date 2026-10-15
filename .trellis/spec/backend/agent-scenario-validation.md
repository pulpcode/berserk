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
