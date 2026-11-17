# Director Unification

## 1. Scope / Trigger

2026-11-17 approved director-unification plan. Covers scene/debug exclusivity, source consolidation and user-visible history. Reuse source `scenario_active` as the sole active pointer. No separate debug database or inferred task ownership. User acceptance remains a separate gate.

## 2. Signatures

- Page `/director`; `/simulation` and `/scenario-director` have no compatibility redirect or built HTML fallback.
- `GET /api/simulation/director`, `GET /api/simulation/director/operations/:id`, `POST /api/simulation/director/switch`.
- Switch input: UUID `clientActionId`, `mode: scenario|free_debug`, `expectedActiveRevision`, paired nullable `expectedInstanceId`/`expectedRevision`, `confirmed:true`, optional `restart` only for debug.
- `GET /api/simulation/instances/:id/debug`; POST its `debug/object-updates` and `debug/report-updates` with `clientActionId`, `expectedRunRevision` and object/report `expectedRevision`.
- `POST /api/simulation/actions/:id/send` requires debug instance and run revision; saved notifications retain frozen IDs/content.
- Offline `tsx scripts/migrate-director-sources.ts --data-dir ABS --backup-dir ABS --mapping FILE --external-file ABS` previews; add `--apply --service-stopped` to migrate. Runtime remains stopped through paired-backup verification.

## 3. Contracts

All controls require current `controlScenarios`, configured director seat and original source/query permissions. Source-management alone and administrator status do not grant control. Original scene task-management checks remain.

Free debug is source schema 4 on the existing run store. It initializes seeded data, captures its own revisions and ownership, and exposes visual editing rather than arbitrary JSON. Saving does not send. Report references must belong to the same run. Execution commands unsupported by debug fail explicitly.

Switch persists one host transition receipt (`ending`, `starting`, `complete`), closes admission, drains existing work and ends the original run before new activation. Pending recovery uses the same immutable action ID. Startup closes gates but never replays switching or notification sends. Returning to scenario mode leaves no active run until explicit scene start. Historical reads never appoint the control target. The operation-count cap blocks new edits but still permits pause/finish, so users can start a new run. A recent-record window must always include all unconfirmed notifications: otherwise a blocking receipt loses its reconciliation entry.

Source consolidation explicitly maps two businesses to canonical scenario source IDs and per-mode original policy IDs. `retired` disables new writes to other sources; `operationPolicies` selects only through authenticated run mode. New events/jobs freeze `policySourceId`; all rule/grant/delivery decisions use it, preserving each original scope. Wire `sourceId` stays canonical. Historical event bytes and original IDs are unchanged. `historySources` provides authorized group metadata; `ruleSources` exposes authorized original rule scopes labelled by business/mode. Display grouping never grants access. `InformationJobSummary.policySourceId` carries that same scope to UI controls.

Query and notification configuration, secrets, statuses and permissions stay separate inside the business card. Notification acceptance reuses the existing background source control and its revision through the host `bindInboundControl` adapter, so the capability card and work overview do not maintain competing switches. If recording the connector audit fails after the control changed, read the actual revision; an old-revision retry conflicts rather than repeating the write. Unassigned generic inbound integrations remain manageable. Old retired credentials permit receipt lookup only, never new writes or automatic resend.

Migration changes connector snapshot/bindings only. Backup the entire data root plus external configuration, credentials and encryption keys with verified pairing. Explicit mapping must match the actual four-source configuration. Reentry checks snapshot, file inventory and unrelated capability data. Preserve rule/profile/recipient/grant rows and old message hashes. Any enabled mapped continuous stream requires an explicit migration plan rather than automatic permission merging.

## 4. Validation & Error Matrix

| Condition | Required outcome |
| --- | --- |
| Stale pointer/run/object revision | Conflict; no state mutation |
| Switching with uncertain notification receipt | Block; keep original receipt for reconciliation |
| Lost response or restart | Read original operation; explicit same-request recovery only |
| Old write while another run is active | Reject; no implicit rerouting |
| Retired source new POST / legacy source-control PUT | Reject even if old token or grant is valid; control returns 410 |
| Canonical-only grant reading debug-policy event | Deny; canonical grouping is not authorization |
| Historical duplicate ID across old source family | Migration conflict, no guessed deduplication |
| Unfinished job / unsupported enabled continuous mapping | Migration conflict, no partial apply |
| Missing external key, changed backup or incomplete migration | Fail closed; preserve scene for recovery |

## 5. Good / Base / Bad Cases

Base: explicitly start debug, edit road, save, preview and send separately. Restart preserves old run read-only and seeds a fresh one.

Good: two historical source IDs group under 情报接入 while records keep original IDs and each viewer retains original permissions. New debug notification uses canonical source with the original debug policy.

Bad: union original grants, choose a rule by source-name prefix, replay POST after reload, or silently change an existing scene when an unscoped probe runs.

## 6. Tests Required

`director-debug-store`, `scenario-director-api`, `mock-scenarios`, `scenario-scope`, `director-sources`, `source-groups`, background policy tests, and desktop `scenario-director`/old-address e2e. Assert CAS, same-ID recovery, restart no replay, ended-run read-only behavior, no save-triggered send, separate policy ACLs, unchanged history, offline backup/reentry/collision and retired-credential denial. Run full package typecheck/lint/build/Vitest after integration.

## 7. Wrong vs Correct

Wrong: authorize a grouped historical event using the canonical source's grant.
Correct: check `event.policySourceId ?? event.sourceId`, then project its authorized business grouping. Preserve the original ID in details and audit.

Wrong: resubmit a new operation after a timeout.
Correct: retain the old UUID and payload, query its receipt, explicitly retry only that operation.
