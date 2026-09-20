# Conversation References Contract (W01-9)

## 1. Scope / Trigger

Read when changing composer file references, explicit Skill loading, role selection or their native history projection. Keep Pi's ordinary parent loop and readonly child mechanism. A selected role expresses user intent; only a real `subagent` tool call creates a child.

## 2. Signatures

- Scoped `GET /workspaces/:id/agents` returns `{name,description,hash}[]` from existing controlled roles.
- `POST /sessions/:id/messages` accepts optional `skill:{id,hash}` and `agent:{name,hash}`, alongside existing text/uploadIds/fileRefs. Reject extra fields; clients cannot supply Skill content, system prompts or permissions.
- `resolveComposerSelection` validates against the request resource snapshot and roles. `snapshotSkill` is shared with `skill_read`.
- `PublicMessage.selections` contains the resolved Skill (including body) and/or role metadata for historical display.

## 3. Contracts

Resolve uploads and references in the captured seat's session workspace, deduplicate by resolved path, then apply the existing combined file limit. Same filenames in different directories remain distinct. File metadata is not a frozen business handoff or proof of reading.

Explicit Skill selection loads the controlled body before `AgentSession.prompt`, without a synthetic `skill_read` call. No selection preserves ordinary on-demand tools. AGENTS.md, permissions and operation confirmation retain their existing authority.

Persist `berserk.composer-input.v1` through Pi's public custom-message API with `display:false`, owning workspace/session/request IDs and resolved selections. Save ordinary user text separately. Native history decoding validates ownership, hashes, body, ordering and duplicate records. Old histories require no migration. Normal Pi compaction can summarize this input; full JSONL remains available.

When the parent calls the selected role, `selectedChildInput` forwards the Skill body and file references in addition to the actual task. Other roles do not receive that automatic selection. Children retain their readonly tool whitelist; an analyst can use an already loaded Skill without acquiring `skill_read`. Do not copy parent history into child context. Do not overwrite the parent-generated task or add hidden retries/forced dispatch.

Cancellation between saving custom input and saving user text can leave input history without an associated user message. Preserve native history, render only associated selections and never replay the request automatically. Historical context can still influence a model; absence of host replay is not a guarantee of semantic forgetting.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
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

`tests/pi/composer-input.test.ts` exercises the actual Pi loop with deterministic model output: controlled loading, selected child inputs, permissions, invalid selections, file deduplication, preparation/cancel boundaries, compaction and restart. Existing subagent/history/recovery tests remain required. `tests/e2e/references.spec.ts` covers browser drafts, candidates and submission.

`npm run probe:references` runs configured real model and Docker against a new temporary data directory, without a production listener. Check actual tool calls, file reads, Skill use, ordinary continuation and reopened history. Record failures honestly; model compliance is distinct from deterministic delivery.

## 7. Wrong vs Correct

Wrong: silently retry a model that ignored a role or method until the test passes.

Correct: inspect the delivered input and actual delegation task, fix a demonstrated ambiguity if present, rerun the same acceptance scenario and retain the earlier failure in the validation report.
