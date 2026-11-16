# R3 Skill Packages

## Ownership and compatibility

`src/skills` owns full skill packages, draft CAS, format/integrity validation, bounded Markdown/ZIP import, immutable publication, ordinary lifecycle, seat policy, scan scheduling and explicit migration. `contracts/skills.ts` owns the shared DTOs. Skills are distinct from experts: Skill publication never requires a successful scan, trial or trial approval. R2 experts also permit publication without a trial. Current expert validation, individually acknowledged risks, explicit use scope and human publication confirmation remain required; see [R2 Expert Management](capabilities-r2.md#optional-expert-trials).

R3 adds `r3_skill_*` tables and an independently checked `r3_skill_meta` version1 to the existing capabilities database. Capability `user_version` remains2. Existing data requires an explicit stopped `scripts/migrate-skills-r3.ts` full-root backup and prepared/completed marker; startup rejects prepared migration. Dry-run reads without modifying business bytes. A post-schema crash is verified by reproducing the exact transformation against a private backup copy, not by trusting a changed SQLite file hash. Rollback pairs the R2 program with the full pre-R3 backup and preserves active R3 data.

Old SkillRevision bodies, 16KiB limits, hashes, fixed workspace-index IDs and native historical messages retain their original meaning. New package content and native input/resource variants are versioned; do not relax legacy decoders to admit dynamic IDs or rewrite old JSONL. Four deployment-owned skills are read-only managed assets; copying creates a new organization skill ID. Skill IDs are platform identities, separate from the standard `name`.

## Package and import boundary

`packageContent` validates controlled UTF-8 text, YAML frontmatter, name/description and optional standard fields. Names follow the reference tool's Unicode lowercase alphanumeric semantics, not an ASCII-only replacement. Empty body and length recommendations are advice rather than invented format errors. Unknown ecosystem fields are preserved and reported separately. Unadapted invocation-qualification extensions make a package ineligible for autonomous discovery; they never grant tools or business access.

`LAB_SKILL_MAX_ARCHIVE_BYTES`, `LAB_SKILL_MAX_EXPANDED_BYTES`, `LAB_SKILL_MAX_FILES`, `LAB_SKILL_MAX_RESOURCE_BYTES`, `LAB_SKILL_MAX_METHOD_BYTES` and `LAB_SKILL_MAX_TEXT_BYTES` may tighten the default platform ceilings. Configuration is validated at module startup: a defined value must be a positive integer no greater than its default ceiling. Invalid values stop startup rather than silently reverting. `loadSkillLimits(env)` is pure for tests; do not mutate process-wide environment to test limits.

A package digest covers all file bytes, relative paths, media metadata and platform-stored requirements. A template or script change changes the digest. Known relative Markdown references must remain within the package and resolve; external URLs are not downloaded. Custom resource directories are allowed. ZIP is an Axon upload adaptation: one root or one outer directory, exactly one skill. Reject traversal, absolute/backslash paths, links/special files, normalized duplicates, file/directory collisions, unsupported/encrypted archives, CRC mismatch, and declared or actual expansion beyond platform bounds. Do not execute uploaded code or install dependencies during import. Ordinary chat uploads never install a Skill.

## Publication, authority and immutable files

All management methods recheck the current administrator inside the serialization lock. Published pointers, revision metadata, audit, publication and action receipt commit atomically only after immutable bytes have been persisted and verified. Same principal/action/input returns the original result; changed input conflicts. A stale draft or current publication conflicts; unchanged content does not manufacture a release. Initial version is1.0.0, then PATCH.

An interrupted publication may leave a valid unreferenced immutable blob. Retrying must reuse the exact persisted revision metadata, including its original creation timestamp. Recomputing a timestamp while reusing the file creates a metadata/blob mismatch. Validate an existing blob's entire immutable identity before adopting it; never silently overwrite damaged content.

Stored asset and policy shapes are validated before granting use. An unknown policy mode must fail closed, not fall through as all seats. Organization use is none/all-business-seats/selected-business-seats and current account denial still wins. A current seatless administrator may use published enabled organization skills in their own personal conversations as well as manage and run isolated trials. The server-side `authorizeUse` callback returns `administrator-personal` only after checking the current account and its exact personal scope (or an account catalog request without a workspace). That trusted result bypasses business seat policy only; it is never inferred from client role fields or `canCollaborate:false`. Unpublished packages, ordinary lifecycle, global bans, explicit account denial, invalid policy shape and current-role revocation remain effective. This does not grant business task/space or business tool access. Current use authorization is checked again after asynchronous package loading and before returning content. Ordinary disable/archive blocks new use; a previously admitted request may finish only within its fixed snapshot and current authorization. Restoration never clears a ban or account denial.

## Scan boundary

Imports and changed saved snapshots automatically enqueue scans; management can request a rescan. Queue and concurrency are bounded, and duplicate pending/running scans of the same package and scanner/rule versions share work. No chat, page read, validation or publication triggers a repeated whole-library scan. Pending/running records become interrupted failures on restart without replay. A scanner completing after service close must not write to the closed or removed data root; its interrupted record is reconciled by the next startup.

The deployment-owned manifest freezes Semgrep CE, local rules and their digest. Uploaded configuration and ignore files do not control scanning; `nosemgrep` suppression is disabled and rule IDs are not rewritten with host paths. The default command is the deployment scanner sandbox wrapper; an explicit operator command override supports development. Scanner/model credentials must not cross into uploaded script execution. The wrapper's Docker/network/resource boundary is maintained by `scripts/skills-scanner`.

Reports bind package digest, scanner/rule versions, actual scanned files, skips, findings, timestamps and errors. Missing tools, parse errors, partial coverage, unsupported languages and no-applicable-language are distinct states. Semgrep may return tuple-shaped error types such as `['PartialParsing', spans]`; project only the type, actual code and authorized package path, never stringify internal span objects or host paths. A parser may recover malformed syntax without reporting an error; absence of findings is not proof of a complete code audit.

Publish captures the scan reference/state available at that instant; late reports never rewrite the publication time or create a passing status. A finding, pending scan, failed scan or missing optional trial does not block an otherwise valid package publication. Format damage and integrity/path violations still block it.

## Runtime, API and verification

`PiLab` and `ResourceService` integrate authorized packages with the existing native Pi loop; there is no second loop or host execution fallback. Expert dependencies fix package references. Explicit per-message selections carry revision and complete package digest and cannot replace a conflicting fixed dependency. Methods and resources are loaded on demand from a request-fixed catalog. Published method hashes are stored as verified revision metadata so catalog construction need not read full package blobs. A formal catalog queries published assets only and never parses mutable drafts, including unrelated drafts. The narrow `onPolicyChange` callback runs after committed policy/lifecycle changes so the runtime can recheck existing active requests without a second policy engine. Only activated authorized packages are materialized under the request-private readonly `/skills/<skillId>/<revisionId>/<name>/` root. The writable workspace remains `/workspace`; mount neither the whole capability library nor mutable drafts. Readonly child permissions do not expand because a package contains scripts.

Skill trials use a separate namespace and data root through the existing capability trial/Pi runner. They are administrator-initiated, owner-bound, explicitly cancellable and never replay on restart. Describe actual tool results and actual errors only; do not add an environment-preflight detector or infer missing business setup from natural language. Reports and ordinary catalog DTOs must not expose another administrator's trial files or logs.

Global `banned` state is an execution constraint for both Skill trials and R2 expert trials with fixed organization dependencies. Recheck it across asynchronous preparation and through the existing trial execution guard/cancellation timer. Keep history, list and administrator package inspection readable; do not reuse an execution-only guard in read endpoints. Ordinary disable/archive and formal seat policy do not prevent administrator isolated debugging.

Trial HTTP actions reuse `r3_skill_actions`: bind the original selector, input and attachments to the deterministic native trial ID after valid snapshot preparation, before dispatch. An authorized identical retry reads its original native record before inspecting the current draft or ban; changed parameters conflict. A reserved action without a native record is explicitly uncertain and must not auto-resume. Rescan retries likewise inspect their receipt before rejecting an expected revision that became stale after the original action.

Required coverage includes authenticated management/publication, malicious ZIP/integrity cases, fixed old/new revisions, current authority across asynchronous boundaries, readonly materialization and child behavior, ordinary lifecycle versus revocation, restart/migration/rollback, and desktop interaction. Real Semgrep, Ark/Docker execution, deterministic provider tests, browser tests and user acceptance are separate evidence categories. Tests cannot label a mocked scanner or fake Docker as physical acceptance.


### Captured membership and unchanged background boundary

`resolveSnapshotSkill` checks the caller snapshot's membership before invoking its optional loader, then verifies the returned fixed method hash/revision/package digest. A narrowed child or copied snapshot must not inherit the original closure's broader catalog. SDK parameter enums alone do not authorize an unknown ID.

A builtin asset may carry a display name separate from the canonical package name/root. Updating a deployment display label must not rewrite an immutable package revision, digest or old method bytes.

`ResourceService.snapshot`'s internal `includeDynamic=false` path keeps background seat analysis on legacy builtins. Profile preprocessing continues to use its supplied fixed resource snapshot. Background explicit organization selections or schema2 expert dependencies fail with `SKILL_BACKGROUND_UNSUPPORTED` before model invocation; do not silently drop a fixed dependency or introduce R5 ahead of schedule.

Formal-account and test-seat skill details share `skills/view.ts` and the same `SkillUseDetail` DTO. Always include the safe trial status projection, including `not_tried`; never send admin trial records, inputs, owner IDs, files or logs to ordinary viewers.

Readonly grep uses the existing request container and anchored file helper. Pi0.85.1's public grep factory still spawns host rg and cannot be used as a sandbox adapter unchanged. The narrow custom Pi tool keeps the same native loop and readonly permission filter; patterns are passed after `--` and cannot inject rg execution flags.


### Atomic form-based creation

The existing administrator create action accepts optional complete `files`, mutually exclusive with `sourceSkillId`. Validate supplied package content before writing an asset; commit the asset, initial draft, created audit and action receipt together through the existing serialization/transaction boundary. Identical principal/action/input returns its original complete draft, changed input conflicts, and failures leave no placeholder asset or receipt. Keep old no-files creation and copy calls compatible; do not require a schema migration or create-then-save recovery engine. The frontend may use ordinary fields, but server package validation remains authoritative.
