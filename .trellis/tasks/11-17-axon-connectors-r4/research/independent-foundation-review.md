# Independent R4 foundation review

Review owner: independent `trellis-check` agent. Read the task PRD/design/implementation notes, v0.2 requirements, foundation/business research, and applicable backend contracts. Scope was `connectors/*` except remote/network/schema, connector routes, the production migration CLI and foundation tests. Root subsequently assigned `commands/service.ts` and its exact regression coverage. Other agents' changes were preserved. No deployment, production migration, commit, push, stage completion or user acceptance was performed.

## Findings (fixed)

- File: `experiments/harness-lab/src/connectors/service.ts`
  - Issue: lifecycle and credential versions were read before `BEGIN IMMEDIATE` and not checked again at the actual write. A concurrent commit between the optimistic read and transaction could be overwritten.
  - Fix: recheck state revision inside lifecycle transactions, and configuration revision plus credential version inside credential transactions. Conflict rolls back audit/action writes. A deterministic transaction-boundary regression reproduces the original overwrite and now proves refusal.

- File: `experiments/harness-lab/src/connectors/migration.ts`
  - Issue: `completed` re-entry returned before verifying the original backup; `pairing.json` was written but never checked. A changed pairing or damaged rollback copy could still yield a successful completed receipt.
  - Fix: strictly decode and compare the exact pairing, then verify complete pre-R4 data and external files before acknowledging completed re-entry. Prepared re-entry retains its full unrelated-file/logical-SQLite proof. Normal post-migration active-root changes are not compared against the old snapshot. Tests independently corrupt pairing, credential backup and old native data and require refusal.

- File: `experiments/harness-lab/scripts/migrate-connectors-r4.ts`
  - Issue: the hand-written argument scanner silently ignored unknown flags. A misspelled legacy-config flag could be interpreted as an intentionally absent configuration and freeze an incomplete authority.
  - Fix: use Node's strict `parseArgs`, including a repeated string option for `--credential-file`. The real production CLI is tested in subprocesses through two-file dry-run, stopped apply and identical reapply; a misspelled option fails. Reports contain no credential values.

- File: `experiments/harness-lab/src/connectors/validation.ts`
  - Issue: `String(raw.mode)` and equivalent auth checks accepted JSON arrays such as `["none"]` as enum values. Such a persisted policy does not have the same semantics as a literal `none` policy.
  - Fix: require literal string enums before membership checks. Regression coverage rejects coerced policy/auth/source shapes. Existing fixed-adapter auth immutability was verified with rejected none/API-key/personal changes; no unsupported legacy auth mode was introduced.

- Files: `experiments/harness-lab/src/connectors/{service,migration}.ts`
  - Issue: replacing a fixed ingress token could bypass the original background configuration's minimum 24-character requirement; a short or multiline environment value could be counted as a usable paired migration credential source.
  - Fix: preserve the original ingress minimum for managed writes and paired ingress environment references; reject NUL/CR/LF credential sources. Other credentials retain their existing nonempty requirement. Tests prove rejection without changing the original ingress credential and prove valid generic ingress remains migratable without an invented system mapping.

- File: `experiments/harness-lab/src/commands/service.ts`
  - Issue: every explicit receipt/execution read compared the full configuration revision ID. A harmless rename permanently prevented readback of already received/unknown commands, even at the unchanged fixed target.
  - Fix: sends still require the captured revision and credential version. Explicit readback uses current organization credentials only when the stable connector and normalized endpoint equal the command's immutable original revision. Address changes refuse control readback, retain the original command/history, and never send again. One real-HTTP regression covers lost response, changed target refusal while unknown, rename, actual encrypted token replacement accepted by the receiver, successful original receipt/execution readback, current task summary, stale pending confirmation, and later changed-target refusal.

- File: `experiments/harness-lab/src/connectors/migration.ts`
  - Issue: the current Node typings permit undefined values from `parseEnv`, causing TS18048.
  - Fix: safely narrow values before inspecting or accepting a credential reference.

## Findings (not fixed)

No unresolved concrete issue remains in the assigned foundation/command scope. The host's persisted-projection assembly and R4 specification synchronization were reported to root and are root-owned; root has updated the assembly and added the R4 contract. Remote transport/schema, Pi/history, browser behavior, final package-wide QA and live acceptance remain separate review/verification owners.

## Verification

- Lint: **pass**. Scoped ESLint covered all assigned foundation modules/routes/CLI/tests plus `commands/service.ts` and `commands.test.ts` after the final edits. `git diff --check` passed.
- TypeCheck: **pass**. Final `tsc --noEmit` returned 0 after the ingress and command changes. Earlier transient failures were the fixed `parseEnv` narrowing and root-owned interaction/probe changes; these are not reported as final failures.
- Tests: **pass for the exact focused coverage**. Latest store/migration/API run: **16 passed** across three files. Legacy real-HTTP integration: **1 passed**. Commands selected by `--testNamePattern='R4'`: **2 passed, 24 skipped**. This is not a full commands/full package result.
- First evidence: new CAS and completed-backup regressions both failed against the pre-fix code, then passed after fixes. The restricted legacy run failed solely with `listen EPERM`; its identical single-file run with local-listener permission passed. An intermediate test-source typo was corrected before final store verification.
- New restart coverage proves missing ciphertext keys fail startup, fixed disabled metadata remains available for restoration, encrypted rotated credentials override old environment references, prepared intents become cancelled, sent intents become unknown, and startup/retry performs no remote discovery or resend.
- Migration coverage retains write-free conflict inventory, all original IDs/bytes, schema/prepared crash recovery, unrelated-change refusal, verified full/external backup, copied old-root rollback checks, exact CLI repeated credentials, and safe reports. All roots and credentials used here were temporary synthetic fixtures.
- Root must still run the agreed final full tests/lint/boundaries/build and broader original-domain/browser/live checks. No acceptance status was inferred from these focused passes.

## Final full-suite regression follow-up

Root's subsequent package-wide run reached 195 files / 1966 cases, with 192 files / 1961 cases passing and exactly five failing cases. Root supplied the final stacks: four permission assertions observed 200 instead of 403/404; the old single-seat backup case failed at the required R4 migration gate. This follow-up did not change product behavior or weaken any assertion.

- `tests/recipient-service.test.ts` and `tests/background/service.test.ts`: their setup helpers returned the legacy input object after R4 had copied it into the authoritative runtime projection. Four tests therefore attempted to revoke recipient access on an unused object. The helpers now capture the actual `BackgroundService.config` via a scoped initialize spy, call the original initializer, and immediately restore the spy in `finally`. Existing current-permission, after-await, status-code, pending-review and content-redaction assertions remain unchanged.
- `tests/seat-api.test.ts`: the stopped old fixture was created with `PiLab.create` without ever installing the R4 module through app initialization. Before opening the upgraded copy, the fixture now runs the real explicit stopped R4 migration with an independent rollback backup. All original native-history, ordinary-file, instruction, source-root and copied-root byte assertions remain unchanged.
- Exact follow-up command: `vitest run tests/recipient-service.test.ts tests/background/service.test.ts tests/seat-api.test.ts --maxWorkers=2`. Result: **3 files / 42 tests passed**, exit 0, 60.90 seconds. These are complete affected files, not five selected cases. No local-listener escalation was necessary.
- All three changed test files pass scoped ESLint and `git diff --check`; final package `tsc --noEmit` returned 0 after these fixture changes. Root retains ownership of broader browser/build/live acceptance evidence; the earlier full-run failures are preserved here rather than relabeled as a wholly green initial run.
