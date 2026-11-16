# Implementation evidence

## Scope
Five existing product files changed: shared publication DTO, management routes/service, expert management UI and trial label. No trial runner/runtime/schema/Skill changes. GET expert detail now filters trials by current administrator owner so automatic optional association cannot accidentally submit another administrator’s private trial.

## First attempts
- Original browser fixture auth and management entry worked: draft/conflict case passed. The old trial/publication case reached trial confirmation and timed out only on the deliberately changed publication-checkbox label. Full first log: implement-e2e-first.log. Updated the label/assertions and added 1060/1440 no-trial publication tests.
- Initial focused test run: 26 passed, 1 new test failed because its mock tried to call confirmTrial inside the publication SQLite transaction (nested transaction). Corrected the test injection to revoke confirmation before registerExpert starts its transaction, which models the intended async gap. No product workaround was introduced. Corrected focused run: 4 files, 27 tests passed (implement-focused.log).

## Covered behavior
No-trial publication, absent trial reference persistence, all unreferenced pending/non-success/unconfirmed statuses, file-tools risk confirmation without trial environment gate, explicit reference owner/expert/current-validation matching, commit-time decision recheck, mandatory scope/notes/validation/CAS/risk gates, idempotency and mixed old/new publication reads after restart. Authenticated API confirms omitted trialId accepted, invalid optional values rejected and publish causes zero model calls.

## Final implementer checks
- Focused service/API/security/synchronization: 4 files / 27 tests passed, implement-focused.log.
- Desktop browser: 5 tests passed, including 1060 and 1440 no-trial publication with zero fake provider calls, implement-e2e.log. Trial confirmation still works; revalidation no longer accidentally attaches the earlier validation’s trial.
- npm run typecheck: exit 0, implement-typecheck.log.
- npm run lint (including boundaries): exit 0, implement-lint.log. Two existing react-hooks warnings in untouched web/InteractionCard.tsx; zero errors.
- git diff --check: passed.
- Preserved screenshots: optional-trial-ready-{1060,1440}.png and optional-trial-published-{1060,1440}.png under this research directory.
- No production actions, model-provider credentials, dependency changes, git commits or pushes by implementer. Parent owns full build/unit suite, independent review, docs and final delivery.
