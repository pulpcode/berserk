# R4 foundation implementation report

Owner: connection foundation worker. No production migration, deployment, commit, push or user acceptance was performed.

## Changed files

- New `experiments/harness-lab/src/contracts/connectors.ts`: shared safe catalog/admin/config/credential/call DTOs; no SDK/Pi types.
- New `src/connectors/{store,service,secrets,validation,legacy-config,migration}.ts`: independent version1 R4 module in existing `capabilities.sqlite` (user_version stays2), immutable configuration revisions, transaction CAS/action receipts/audit, four permanent fixed business families, actual-subject catalog cache, current-account credentials, encrypted SQLite secret records with external versioned AES-256-GCM keyfile, no plaintext fallback, minimal non-replaying external-call intents.
- New `src/server/connector-routes.ts`, `scripts/migrate-connectors-r4.ts`: admin routes, safe eligible user catalog with host-resolved optional workspace, current-user credential routes, explicit stopped migration.
- Modified `src/context/service.ts`, `src/commands/service.ts`, `src/scenario/scope.ts`, `src/server/{context-routes,scenario-routes,background-routes}.ts`, `src/background/config.ts`: original domain checks remain; actual query/control/readback/scenario/ingress auth resolves current authoritative fixed connector. Fixed page read IDs cannot cross revision/credential versions. New prepared Commands pin internal connection identity; changed target/credential invalidates confirmation before send. Public legacy command/native history shape stays unchanged.
- New `tests/connectors-{store,migration,api,legacy}.test.ts`; adjusted `tests/commands.test.ts` for authoritative lifecycle and added stale-confirmation test; adjusted only the internal missing-context assertion in `tests/context-background.test.ts` while preserving external503/legacy-queue expectations.
- Root owns app/auth/Pi integration and transport/UI workers own their respective files; this worker did not edit app.ts/lab.ts.

## Checks and exact limitations

- Store/API/migration focused group initially9 tests passed. Migration was subsequently strengthened to require explicit usable `.env` credential file coverage for each legacy envref; its3 existing tests passed again, and its final4-test migration suite passed, including refusal without paired credential source coverage.
- Real two-local-HTTP-source legacy test passed: new endpoint+credential effective, old page snapshot refused, ingress token rotated independently, revoked query token does not fall back to old env after restart.
- New original CommandService stale R4 revision confirmation test passed (1 selected;24 skipped).
- Scoped ESLint over all foundation/domain/test files passed after final substantive changes.
- Early full typecheck completed clean before last domain/test edits. Root final full typecheck/lint/build remain required.
- First restricted run failed70 local-listener tests with `listen EPERM`; synthetic files only. Escalated identical7 old-domain suites returned62 passed/9 failed:8 generic-source migration conflicts and1 obsolete legacy-file override assertion. Generic omitted `systemId` channels are now preserved without inventing a business source. Fixed original-config override test now proves authority remains in R4 and explicit lifecycle disables control.
- Followup selected old tests5 passed/1 failed; full context-background rerun7 passed/1 failed. Remaining failure was original missing-query-credential status409 versus503, now mapped at original context scope seam; exact missing-context test rerun passed. Root full suite must rerun final tree; no claim that the earlier7-suite group wholly passed.

## Migration and rollback

Run only on a stopped COPY first; these commands have not been run against deployed data:

```sh
cd experiments/harness-lab
node_modules/.bin/tsx scripts/migrate-connectors-r4.ts --data-dir /ABS/COPY --backup-dir /ABS/INDEPENDENT-BACKUP --context-config /ABS/context.json --background-config /ABS/background.json --credential-file /ABS/credentials.env --key-file /ABS/connector-keys.json --dry-run
```

Omit genuinely absent optional config/key arguments. Repeat `--credential-file` for every actual environment source file; all referenced legacy variables must have nonempty values in explicitly paired `.env` sources. Reports list references/paths, never values. New secret writes require an external0600 keyfile, outside data root: `{ "activeKeyId": "v1", "keys": { "v1": "<base64-32-bytes>" } }`; retain every key version referenced by ciphertext/action receipts.

After conflict-free copy validation, explicit apply uses the exact same arguments plus `--apply --service-stopped` in place of `--dry-run`. Backup layout is `BACKUP/data/` (complete original root), `BACKUP/external/` (original configs, usable keyfile and credential source files,0600), and `BACKUP/pairing.json` (path/hash correspondence). Prepared markers block startup; re-entry requires exact paths/input bytes/backup and proves the logical SQLite transformation, including schema-only and post-import crash states. Extra files, unrelated database changes, different inputs or incomplete backups refuse recovery.

Rollback copies `BACKUP/data/` into a new restore root and uses the matched old program plus copied configs/credential environment/key versions mapped from `pairing.json`. Preserve active R4 root and original backup; never point the old program at active R4 data. Original native history/business bytes are not rewritten, and no command/call is replayed.

## Remaining risks / follow-up

- Root independent check, final full tests/typecheck/build, live model/real third-party acceptance, desktop interaction and operator copy migration rehearsal remain separate evidence.
- Startup metadata remains available for intentionally disabled/revoked fixed connections so administrators can restore. Original missing credentials yield unavailable query capability while legacy generic ingress/queue continue; cryptographic key absence still fails closed.
- Four fixed families are information, situation, simulation-control and one ingress family containing exact original source channels; generic channels with omitted optional systemId remain unbound. Explicit nonexistent/conflicting business source references and duplicate same-business sources are conflicts.
