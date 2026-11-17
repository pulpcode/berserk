# Shared R3A interface

Storage owns contracts/authoring.ts. Current types written. Request-local AuthoringService, no new tables or schema migration: fixed proposal map; original native Pi proposal/confirmation evidence. Original r2_actions/r3_skill_actions atomically retain full AuthoringReceipt, ownership/baseline and mutation.

`new AuthoringService(management, skills)`; all methods receive `AuthoringContext` {actor:SkillActor, sessionId:string, requestId:string, assertActive:()=>void}. Actor.assertAdministrator and assertActive checked per call and again after awaits. One instance may be per PiLab; maps scope-checked by context, never restores proposals after restart.

- `catalog(context)` Promise of real tools/skills/experts/skill assets, no private trial contents
- `read(context, {kind,targetId})` returns saved draft/baseline; builtin read-only declared, does not execute
- `propose(context, AuthoringProposeInput)` Promise<AuthoringProposal>; expert patch merged into latest read content using exact provided baseline; skill files patch preserves unmodified bytes; explicit removePaths; scripts/binary package rejected whole
- `getProposal(context, proposalId)` AuthoringProposal: complete candidate + before + summary and digest, for existing confirmation
- `commit(context, proposalId, {interactionId,toolCallId})` Promise<AuthoringReceipt>. Called ONLY from Pi's existing actual approval gate after its own current guard; service checks current authorization, fixed context/digest/baseline. Stable proposalId is service action UUID; same proposal cannot be adopted under another model actionId. No tool directly exposes commit grant.
- `receipt(context, {kind,proposalId})` AuthoringReceipt|undefined: read-only original action receipt query; current owner/session match, requestId may differ for later reconciliation; never executes save
- `report(context,{kind,targetId,reportId})`: existing authorized validation/scan/trial metadata only; another owner trial rejected/omitted

Tool names capability_authoring_catalog/read/propose/save/report/method; save takes only proposalId. Pi owns existing interaction action.authoring typed extension and strict replay decoding, with complete proposal content shown. UI active locator uses host-produced receipt only; receipt draftDigest means expert draftDigest or skill packageDigest respectively. AuthoringIntent kind+optional targetId is per-message, not durable permission. Save does not navigate/publish/configure policy.
