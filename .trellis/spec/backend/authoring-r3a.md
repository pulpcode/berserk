# R3A conversational capability authoring

## Boundary

Administrators may create or modify expert and method-only Skill drafts through their own existing personal chat. Main create buttons use the original new-chat/workspace flow; manual creation and Skill import remain explicit alternatives with no model dependency. Saving remains in chat, with a host-validated link into existing management. Do not create an authoring page, message-card system, chat store or managed expert identity.

`contracts/authoring.ts` owns per-message intent, baseline, full candidate, proposal and receipt types plus public validation. Host-selected methods are deployment-owned and loaded on demand. Uploaded names, text in sources, ordinary answers and old history never grant authority. Each request rechecks current administrator, exact owner/session and personal scope; no background, trial, child or business scope injection. Management requests use a restricted tool set, never publication, policy/default/lifecycle, business writes, arbitrary file writes, Shell, installation or delegation.

## Confirmation and persistence

`authoring/service.ts` fixes a request-local proposal to owner, session, request, target/new-object, baseline and exact candidate digest. Expert patching preserves unspecified fields and legacy skillIds/new fixed SkillRefs. Skill patching preserves every unmodified file byte; removal is explicit. Reject entire script/binary/installation packages from conversational mutation instead of deleting unsupported files. Original manual package handling remains available.

A save tool takes proposalId only. The existing operation interaction shows the host's actual full candidate and baseline, with expandable before/after content. Only an actual same-request approval can grant the tool call; an AskUser answer or model claim is insufficient. Check current authority, abort and parameter identity after approval and at the original service's lock/async boundaries. Switching target or replacing a candidate invalidates the old suggestion.

Original `CapabilityManagement.saveAuthoring` and `SkillService.saveAuthoring` commit complete draft/initial asset, audit and full receipt in the original service transaction and serialization lock. Stable proposalId is the action key; same input returns original effect, changed input conflicts. Receipts retain owner/session/request/proposal/target/baseline and actual resulting revision/digest. Reuse r2_actions/r3_skill_actions; no schema migration or second asset store. No outer cross-connection transaction is assumed.

Pending proposals are not restarted. Original native Pi history owns proposal/confirmation evidence; a readonly receipt lookup can reconcile a committed result after restart without executing save. Approval alone is not execution evidence. Stop/revocation before commit blocks mutation; after commit preserve the true saved effect. Strict native interaction/history decoders must remain compatible with old records, and must not fabricate successful results or replay approvals.

## Existing management

Draft saves never publish, configure scope or change defaults. Skill format and original scan enqueue are reused; scans and trials remain non-gates for Skill publication. Expert validation, successful trial and separate publication confirmation remain mandatory. Report reads bind actual content and expose private trial material only to its owner. Administrator personal use of published organization Skills remains as specified by R3.

## Verification

Use isolated deterministic native Pi and API tests for real confirmations, malformed/forged history, owner/session/target isolation, CAS, transaction failure, lost-response idempotence, restart/stop/revocation, true references and file fidelity. Desktop1060/1440 browser tests cover main/manual entry, cancellation, unchanged composer inputs, full candidate visibility, explicit save and active management links. Run current global typecheck/lint/boundaries/build/unit tests. Real Ark authoring, original publication/use, and user acceptance are distinct evidence; mocks do not prove model behavior. Live probes use synthetic accounts and independent data, never production listeners or histories.

Rollback still pairs the pre-R3A program with its stopped full-root backup and preserves the R3A active root: absence of a database migration does not make older strict JSONL decoders compatible with new authoring interactions. Never rewrite old entries for a rollback.

## Stage feedback: genuine management Skill selection

`authoring/management-skills.ts` registers deployment-owned `expert-manager` and `skill-creator`; real SKILL.md fixtures are the only method body source. The global admin metadata/detail endpoints support an unbound draft. The ordinary workspace resources/detail routes append these methods only for a current administrator's own personal workspace; they are not fabricated published assets and require no install/publish or new database rows.

The ordinary `skill:{id,hash}` selector resolves a registered method into the protected authoring request. Exact registry identity/current method hash and current owner/administrator guards are authoritative; an uploaded package with the same human-readable name remains an ordinary package. Contradictory legacy authoring target/kind and selected method fail before model use. Legacy explicit authoring input remains compatible for existing callers, but is not a visible conversation mode.

Only an explicit registered management Skill selection adds it to the native request snapshot using resource schema3 and composer input v8. Ordinary native snapshots retain their prior catalogs. V8 records the actual delivered Skill body/hash; edit context remains governed by the original request/target guards and confirmation evidence. All v1—v7 templates/decoders retain their old semantics. Validate management readonly identity, content hashes, membership and selected body without substituting the current deployment body for old historical text. Recheck current authority after asynchronous method loads. Do not broaden background, trial or readonly-child membership. Older binaries still require a paired pre-upgrade full backup for rollback.
