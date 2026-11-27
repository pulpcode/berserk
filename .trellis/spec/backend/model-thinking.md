# Multi-platform Model Configuration and Thinking

## 1. Scope / Trigger

Read before changing model settings, provider registration, reasoning options, selection, request instructions or auxiliary calls in `experiments/harness-lab`. Extend the existing store and Pi 0.85.1 public SDK; Pi owns the agent loop, native history conversion and compaction. Do not introduce a parallel runtime/configuration system.

## 2. Signatures

- `GET /api/settings/models` returns the administrator catalog with global `version`, `defaultModelId`, `platforms` and `models`.
- `PUT /api/settings/default-model` accepts `{ expectedVersion, modelId }` and returns the updated administrator catalog.
- `POST /api/settings/platforms`, `PUT /api/settings/platforms/:id` use `ModelPlatformUpdate`.
- `DELETE /api/settings/platforms/:id` accepts `{expectedVersion}` and returns the updated administrator catalog.
- `GET /api/settings/platforms/:id/models` probes the saved platform directory and returns candidate IDs and the catalog version. `POST` on the same path saves selected IDs as disabled profiles in one versioned commit.
- `POST /api/settings/models` and `PUT /api/settings/models/:id` use `ModelSettingsUpdate`. The singular GET and PUT address the current system default profile.
- `GET /api/models` returns credential-free `{ defaultModelId, models }`. Session model selection retains its existing profile ID and ownership/busy validation.
- Formal login exposes `GET /api/me/preferences/model` and `PUT /api/me/preferences/model`. GET and successful PUT return `{ revision, choice }`. PUT accepts `{ expectedRevision, choice }`, where `choice` is `{ mode: 'system' }` or `{ mode: 'model', modelId }`.
- `PiLab.updateModelProfile(input,id,create,authorize?)` and `updateModelPlatform(...)` construct affected runtimes before the CAS file commit and publish synchronously afterwards. The authorization callback is rechecked before commit, including `beforeRename`.
- `configuredRuntime(config)`, `modelReasoning(config)` and `nativeThinkingLevel(config)` are shared by all model callers. `isVerifiedDeepSeekModel(config)` defines the exact temporary instruction-reminder exception.

## 3. Contracts

In formal mode, shared model and platform routes require the current independent administrator. The routes pass the administrator route filter and check `accountIdentityOf` and `SystemRoles`. Anonymous requests return 401. Business and director seats return 403 even with a legacy `seats.manage_model` grant. Mutations retain Origin, CSRF and active view checks. Workspace owners can list safe choices and select a model for their own idle conversations.

Platform names allow 100 characters; remote model IDs and model display names allow 200, including the default display name derived from a remote ID. Accepted IDs must survive save/restart. Platforms own `id/name/provider/baseUrl/api/modelsPath/enabled/compat`. The write-only `apiKey` and server-owned `credentialRef` never appear in responses. Models own stable IDs, `platformId/model/displayName/enabled/usageConfirmed`, capacity/compaction parameters, `input`, `thinkingLevels/defaultThinkingLevel/thinkingLevelMap`, model `compat` and optional selected `thinkingMode`. Platform compatibility defaults merge by field beneath model overrides. API is `openai-completions` or `anthropic-messages`; protocol-specific switches are strictly validated.

New writes use `model-settings.json` schema 8 with global CAS version, `defaultModelId`, mode 0600 and a private `credentials` mapping keyed by the stable per-platform `credentialRef`. The pointer is `default` or a profile UUID and must identify an existing model. Read schemas 1–7 without eager rewriting. They use the original `default` slot and retain locally saved keys and profile IDs. Missing API means OpenAI Completions. Legacy per-model endpoint/key edits fork their platform when needed to preserve other profiles' connections. Rollback to old code requires a paired stopped-data/config backup.

The Web service has no environment-variable model credential fallback. Preserve non-key deployment defaults and authentication settings. Kimi Code starts disabled, uses `https://api.kimi.com/coding/` and Anthropic Messages, and offers `kimi-for-coding` (K2.8 Preview) with `low` effort as the offline candidate. Use Pi's adaptive thinking setting for that candidate to send the effort setting. Account capacity, usage confirmation and a saved key are needed before use.

Changing the pointer shares the existing configuration write reservation and checks target readiness, registered runtime, catalog version and administrator authorization again before rename. Publish the new host default synchronously after persistence and abort auxiliary model predictions/analysis. Foreground session creation records the captured profile ID in its existing creation intent and `berserk.model-selection.v1`. Resolve omitted IDs from the pointer, preserve the original intent's ID on retry, and interpret pre-upgrade session histories with no model selection as the original `default` slot. Background requests, service runs and preprocessing capture the current system default at admission.

Personal preferences use `user_model_preferences(user_id, revision, data)` in the access database. The authenticated account provides the key. A missing row returns revision 0 and system mode. Verify model availability when saving a concrete model and compare expected revision inside the SQLite write transaction. Retain stored choices when administrators remove or disable their models. Frontend creation resolves a usable choice for its next session and passes the resulting profile ID explicitly.

Changing an existing profile's platform or remote model resets usage confirmation unless the administrator explicitly confirms that new identity. A platform can be saved without a key. When a key exists, changing provider, normalized base URL or API requires explicit key entry. An omitted or blank key preserves the saved key for the same destination.

Deleting a platform uses the same model-write guard, current settings version and before-rename authorization check. One file commit removes its credential and all its profiles. The lab drops their runtimes synchronously after commit. A platform holding the system default profile can be deleted after the administrator points the default to another platform. Session selections and history retain their original IDs. An affected session remains readable and requires choosing an available model before sending again.

Discovery is a read-only administrator action. `modelsPath` is a fixed path on the saved platform's HTTPS origin. Use that platform's key, protocol authentication, bounded response sizes and timeouts, pinned public DNS results, and no redirects. Parse `data[].id` conservatively, deduplicate IDs, and report a sanitized failure on unsupported account endpoints or formats. Discovery returns no credentials, does not infer model capacities, and never activates or persists candidates. Version checks prevent importing a result against changed settings. Batch import skips already registered IDs on the same platform, shares the model-write guard, and saves only selected new IDs, disabled and without usage confirmation. Manual entry remains available.

Missing `thinkingMode` on an update preserves its old value; explicit null clears the selection to provider default. `defaultThinkingLevel` supports the same reset. Always-on models require `thinkingLevelMap.off = null`; omitting call options alone can otherwise cause Pi Anthropic to emit disabled thinking. Unverified effort values remain unspecified. Capability fields must be explicitly cleared when combining model config with host defaults so one profile cannot inherit another profile's thinking/compatibility.

Capture config/runtime/version and resource snapshot at host-request admission. Foreground reply, tool continuation, native compaction and child execution use that snapshot; same-request steer/followUp does not refresh instructions. Independent prompt suggestions/work activity use the same resolution with their original deadlines and output allowances. Preserve Pi native retry and zero transport retries.

Instructions enter native `agentsFilesOverride`/systemPrompt. Connector target-selection guidance is collected before `DefaultResourceLoader.reload()` and appended through the public loader mechanism for every provider. It must survive disabling the duplicate reminder.

Only exact verified DeepSeek tuples with OpenAI Completions receive the transient `<host_request_instructions>` copy immediately before the final wire user: official `deepseek-flash` at `https://api.deepseek.com` or `/v1`, and Ark `deepseek-v4.1-flash` at `https://ark.cn-beijing.volces.com/api/plan/v3`. Never select this exception by provider alias alone. Kimi receives no second copy, no custom Context, no encoded system-message insertion. The general rule explanation is protocol-neutral. Native compaction retains its own prompt and allowance. Long-term removal/unification stays in issue #4; offline structure tests do not prove rule-following.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Business account, including old manage-model grant | 403 on model/platform administration |
| Missing credential, incomplete capacity, disabled platform/model or unconfirmed usage | Not selectable; explicit request fails before provider call |
| Existing key with changed provider, endpoint or API and no explicit key entry | MODEL_API_KEY_REQUIRED |
| Stale global version or unexpected disk changes | MODEL_SETTINGS_CONFLICT; no runtime publication |
| Stale personal preference revision | 409 PREFERENCE_CONFLICT; preserve the current account preference |
| Missing target profile | 404 MODEL_NOT_FOUND |
| Deleting the platform that holds the system default model | DEFAULT_MODEL_PLATFORM; move the default model first |
| Active foreground/background request | Settings busy; preserve request snapshot |
| Invalid API/compatibility/capability/null-mapped selected level | INVALID_INPUT |
| Save failure or revoked authorization before commit | No settings/runtime publication; preserve original failure category |

Keep Origin, CSRF, current-account and workspace/session scope guards. Return only safe public configuration; do not expose env values or provider secrets in API errors, fixtures or logs.

## 5. Good / Base / Bad Cases

- Good: two platforms expose the same remote model ID with distinct stable profile IDs and credentials; selecting one resolves only that platform.
- Base: old DeepSeek file loads without rewriting, saves to schema 8 and retains original session selection and missing-mode wire behavior.
- Good: switching the system default to a model on another platform changes preprocessing and future sessions. Historical sessions retain their original profile IDs, including old histories with no explicit selection.
- Bad: an arbitrary provider named deepseek inherits the instruction patch, or Kimi receives the default model's explicit thinking selection through object spread.

## 6. Tests Required

`tests/access.test.ts` checks administrator reads and writes, legacy grant denial, revocation and per-session access. `tests/e2e/model-selection.spec.ts` exercises the formal administrator and business interfaces.

Assert schema 7 lazy read and schema 8 restart, pointer CAS and busy/availability checks, legacy model-selection history, creation replay across pointer changes, deletion guard and background/foreground separation. Check preference account isolation, revision conflict, restart persistence and Origin/CSRF/view guards.

Use actual Pi SDK serialization with intercepted HTTP for both APIs. Assert endpoint/auth binding, tools/schema/tool-result IDs, thinking defaults and level overrides, platform/model compat precedence, schema round trip/CAS/permissions/secret redaction, cross-profile capability isolation and same-session DeepSeek→Kimi→DeepSeek. Test Kimi rule update/clear/tool continuation fixed snapshot, no duplicate reminder, native compaction isolation and required connector guidance. Test disabled-model history remains readable and can be switched. Keep heartbeat/stall/cancellation/retry coverage.

Run typecheck, lint, relevant/full Vitest, build and desktop admin/selection Playwright checks. Real Kimi streaming, behavioral rule compliance, account entitlement and cross-model quality remain pending until credentials are supplied; never infer them from mocked HTTP.

## 7. Wrong vs Correct

Wrong: branch on provider alias, insert a system message into every API, or assume omission prevents disabled thinking.

Correct: resolve explicit platform protocol and model capabilities; let Pi encode native context; gate the known DS exception by API plus normalized endpoint and model, and register always-on thinking as off:null.

For model selection, use `settings.defaultModelId()` for new implicit admissions and background execution, and `selectedModelId(entries, workspaceId, sessionId)` for opened foreground sessions.
