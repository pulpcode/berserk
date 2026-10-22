# Conversation References Contract (W01-9)

## 1. Scope / Trigger

Read when changing composer file references, explicit Skill loading, role selection or their native history projection. Keep Pi's ordinary parent loop and readonly child mechanism. A selected role expresses user intent; only a real `subagent` tool call creates a child.

## 2. Signatures

- Scoped `GET /workspaces/:id/agents` returns `{name,description,hash}[]` from existing controlled roles.
- `POST /sessions/:id/messages` accepts optional `skill:{id,hash}`, `agent:{name,hash}`, and `contextRefs:ContextRef[]`, alongside existing text/uploadIds/fileRefs. Reject extra fields; clients cannot supply Skill content, source object bodies, system prompts or permissions.
- `resolveComposerSelection` validates against the request resource snapshot and roles. `snapshotSkill` is shared with `skill_read`.
- `PublicMessage.selections` contains the resolved Skill (including body) and/or role metadata for historical display.

## 3. Contracts

Resolve uploads and references in the captured seat's session workspace, deduplicate by resolved path, then apply the existing combined file limit. Same filenames in different directories remain distinct. File metadata is not a frozen business handoff or proof of reading.

The disk workspace index keeps the legacy `synthesis`/`review` pair. `effectiveSkillIds` adds the deployed `map-annotations` and `spatial-analysis` methods for foreground resource info, snapshot, readSkill and conversation continuation choices. Background execution still loads only its explicit Profile skillIds; child tool whitelists are unchanged. Skill availability never grants annotation tools. The model sees catalog metadata until explicit selection or `skill_read` supplies the controlled body.

Controlled catalog descriptions come from the deployed Skill file frontmatter through `pi/skill-metadata.ts`, which reuses Pi’s public `parseFrontmatter` inside the SDK adapter boundary. Registration still owns allowed IDs, display names and versions. Validate matching `name`, a nonempty string `description` and nonempty body; preserve and hash the exact original file content. Do not duplicate descriptions in the registration table or introduce workspace-wide discovery.

Native resource/composer decoders accept only the four controlled IDs (at most four catalog entries), retaining body/hash/request ownership checks and unchanged old record text. Old two-/three-Skill and new four-Skill histories must reopen together. Older binaries are not valid rollback targets for new Skill histories without a compatibility build or restoring a stopped pre-upgrade backup.

Host method-selection guidance is an instruction, not proof of reading or a permission gate. Measure actual body delivery and task correctness separately. Changing this guidance must not rewrite historical composer templates, force every task to read a Skill, or expand tool authority.

Explicit Skill selection loads the controlled body before `AgentSession.prompt`, without a synthetic `skill_read` call. No selection preserves ordinary on-demand tools. AGENTS.md, permissions and operation confirmation retain their existing authority.

Map object references use complete `{systemId,objectType,objectId}` keys, at most 20, deduplicated independently of file limits. Before prompting, the host reads all selected current objects through `ContextService` as the authenticated seat. Missing/forbidden objects or failed queries stop preparation; do not silently send partial selections. Store the validated references and actual query envelopes (256 KiB combined limit) in the existing native custom input. `PublicMessage.selections.context` projects these facts on reopen. This is material supplied by the host, not a fabricated model tool call. Validate stored query/ref coverage and timestamps; never reload current facts to replace history. Old records without context retain their existing representation. See [Situation Map](./situation-map.md).

Persist `berserk.composer-input.v1` through Pi's public custom-message API with `display:false`, owning workspace/session/request IDs and resolved selections. Save ordinary user text separately. Native history decoding validates ownership, hashes, body, ordering and duplicate records. Old histories require no migration. Normal Pi compaction can summarize this input; full JSONL remains available.

New map-bearing selections use `berserk.composer-input.v5` while method/role-only inputs retain v1; existing v1/v2/v3/v4 histories remain readable with their exact original text. V5 preserves v4 explanations of the fixed draft baseline, owned draft revision and draft-only writability next to automatic metadata; this block does not provide task-current adoption state. These essential meanings are always supplied without requiring a selected Skill or `skill_read`. V5 omits only annotation selection metadata hashes from model text, retaining original native details and explicitly limiting selection summaries to their selected range. See [Map Annotations](./map-annotations.md) for the version routing and rollback contract. Do not modify old template output to update instructions for new requests.

When the parent calls the selected role, `selectedChildInput` forwards the Skill body and file references in addition to the actual task. Other roles do not receive that automatic selection. Children retain their readonly tool whitelist; an analyst can use an already loaded Skill without acquiring `skill_read`. Do not copy parent history into child context. Do not overwrite the parent-generated task or add hidden retries/forced dispatch.

Cancellation between saving custom input and saving user text can leave input history without an associated user message. Preserve native history, render only associated selections and never replay the request automatically. Historical context can still influence a model; absence of host replay is not a guarantee of semantic forgetting.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Invalid deployed Skill frontmatter, mismatched name, blank description/body | `RESOURCE_STATE_INVALID` 409 |
| Unknown Skill or role | `RESOURCE_NOT_FOUND`; no model call |
| Selected Skill/role hash changed | `SELECTION_CHANGED` 409; select again |
| Extra authority fields | Strict schema rejection |
| Foreign workspace or unsafe/missing file | Existing seat/file error before model use |
| Repeated file via upload and reference | One entry, counted once |
| Bad native record or child-input mismatch | Existing history validation failure; no reconstructed success |
| Preparation failure | Release session activity; browser retains recoverable input |

## 5. Good / Base / Bad Cases

Base: ordinary text with no selection behaves as before.

Good: reviewer receives a selected review method and file paths, actually reads files, returns its result to the parent; the UI distinguishes requested role from actual execution.

Bad: reporting a completed delegation from a selection tag, trusting browser-supplied Skill text, adding child write tools, or counting uploads and references separately before deduplication.

## 6. Tests Required

`tests/pi/skill-metadata.test.ts` covers single-source catalog descriptions, multiline/CRLF parsing, exact original content/hash and malformed metadata rejection. `tests/pi/provider-payload.test.ts` checks host guidance in the actual provider payload; this does not prove live-model adherence.

`tests/pi/map-skill.test.ts` also verifies the spatial catalog, exact explicit/on-demand body delivery, strict metadata rejection and restart without rewriting the legacy workspace index. This establishes delivery correctness, not live-model method-selection quality.

`tests/pi/composer-input.test.ts` exercises the actual Pi loop with deterministic model output: controlled loading, selected child inputs, permissions, invalid selections, file deduplication, preparation/cancel boundaries, compaction and restart. Existing subagent/history/recovery tests remain required. `tests/e2e/references.spec.ts` covers browser drafts, candidates and submission.

`npm run probe:references` runs configured real model and Docker against a new temporary data directory, without a production listener. Check actual tool calls, file reads, Skill use, ordinary continuation and reopened history. Record failures honestly; model compliance is distinct from deterministic delivery.

## 7. Wrong vs Correct

Wrong: silently retry a model that ignored a role or method until the test passes.

Correct: inspect the delivered input and actual delegation task, fix a demonstrated ambiguity if present, rerun the same acceptance scenario and retain the earlier failure in the validation report.
