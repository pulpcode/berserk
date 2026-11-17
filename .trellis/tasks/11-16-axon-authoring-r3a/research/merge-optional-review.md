# Optional expert-trial merge integration review

Reviewed the pending merge of `codex/expert-optional-trial@33e9ae3` into the R3A checkpoint `0e96ad1`. The current optional-trial specs and source task PRD/design/verification govern publication; older mandatory-trial evidence remains historical. No commit, push, deployment, task archive or user-acceptance change was performed by this reviewer.

## Findings (fixed)

- File: `experiments/harness-lab/src/web/CapabilityManagement.tsx:68`.
- Issue: the built-in expert copy guidance still required trial after copying, contradicting the new optional-trial contract.
- Fix: it now requires scope/configuration checks and explicit publication confirmation, while stating that isolated trial is optional. No behavior or test assertion changed.

## Findings (not fixed)

No task-scope findings remain. Final global typecheck, lint/boundaries and build belong to the parent after the source freeze; their result is not claimed here. No new real-provider or physical-Docker verification was needed for this merge, and deterministic evidence does not stand in for those categories.

## Integration checks

- Optional `trialId` is consistent across DTO, route schema, service and browser. Explicit null/malformed values remain rejected; omitted values neither query a trial nor create success evidence.
- Explicit references still require private ownership, expert identity, matching draft/validation, actual success and administrator confirmation, including a commit-time confirmation check. Validation, dependencies, individual risks, use scope, notes, authority, CAS and original transaction/receipt semantics remain effective.
- The merged route retains both real management-Skill metadata/detail endpoints and current-owner trial filtering. Registered identities, own-personal workspace authorization and post-load revocation checks remain intact. Uploading a same-named Skill does not grant management authority.
- Legacy authoring API inputs and composer/history versions remain readable. Original full-candidate confirmation, atomic draft save, stopped/revoked/restarted behavior and exact-target protections are retained.
- Single creation entry, real Skill picker/history and workspace-type grouping remain intact. No platform config, generated template, schema or migration changed, so no template synchronization was needed. Current specs already describe this contract.

## Verification

- Unit/integration: **PASS**, 11 files / 89 tests, 67.50s, `merge-optional-unit.log`. This covers management/service/API/security, authoring storage/projection, native authoring/history, genuine management Skills/revocation, composer input and recovery.
- Browser: **PASS**, 10 tests using one worker, 1.3m, `merge-optional-browser.log`. Includes all five capability-management scenarios, all three authoring scenarios, mixed task/personal space authorization and administrator personal two-turn chat.
- Browser first attempt: Vite was blocked by sandbox `EPERM` binding localhost:5193 before any test executed. Preserved in `merge-optional-browser-first.log`; identical command rerun outside the sandbox solely for localhost test listeners. No config or assertion was relaxed.
- Scoped lint: **PASS**, exit0 / zero warnings, `merge-optional-eslint.log`.
- Whitespace checks: `git diff --check` and `git diff --cached --check` passed before evidence staging; new log EOFs normalized.
- Visual: inspected current 1060 ready-to-publish and 1440 published screenshots; controls are visible without horizontal overflow.
- Source: frozen hashes for relevant product, preserved R3A, regression/config and current spec files are in `merge-optional-source.json`. Parent owns final global gates.

All commands ran from `experiments/harness-lab`, sequentially without concurrent browser/unit/build work:

```sh
npx vitest run --maxWorkers=1 --no-file-parallelism tests/capability-management.test.ts tests/capability-management-api.test.ts tests/capability-management-security.test.ts tests/authoring-storage.test.ts tests/authoring-projection.test.ts tests/pi/authoring.test.ts tests/pi/authoring-history.test.ts tests/pi/management-skills.test.ts tests/pi/management-skill-review.test.ts tests/pi/composer-input.test.ts tests/pi/recovery.test.ts
AXON_E2E_PORT=5193 npx playwright test tests/e2e/capability-management.spec.ts tests/e2e/authoring.spec.ts tests/e2e/access.spec.ts tests/e2e/administrator.spec.ts --workers=1 --grep 'admin creates and checks|optional plaintext trial|ordinary user cannot see expert management|untried expert publishes|one create action chooses|the existing confirmation displays|one personal conversation modifies|catalog managers maintain|an administrator creates personal spaces'
npx eslint src/capabilities/management.ts src/contracts/capability-management.ts src/server/capability-management-routes.ts src/web/CapabilityManagement.tsx src/web/ExpertTrial.tsx tests/capability-management.test.ts tests/capability-management-api.test.ts tests/e2e/capability-management.spec.ts
```
