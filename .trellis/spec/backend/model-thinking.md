# Effective Model Thinking Configuration

## Scope and ownership

`server/config.ts` resolves the endpoint/model capability and optional `thinkingMode`; `ModelSettingsStore` persists it in the existing model profile. `pi/model-runtime.ts` exports `configuredRuntime` for product and future evaluation callers. Pi registration, the request-scoped AgentSession and `controlled-stream.ts` use the same captured profile. No second configuration system or custom Agent loop is introduced.

## Compatibility

Modes are explicit `off` or `high`. Absence is meaningful: preserve the legacy wire behavior, not an implied new `thinking:disabled` field. The existing provider named `deepseek` retains its prior disabled mapping when no explicit supported adapter is selected; other legacy aliases keep their prior payload. Public settings distinguish explicit selection from legacy behavior. Saving an unrelated field must not silently select off.

Read existing single-profile schema 1/2 and catalog schema 3 without rewriting. New single profiles use schema 4 and catalogs schema 5; only explicit mode is persisted. Preserve atomic writes, CAS, same-identity omitted fields, secret redaction and the busy-request guard. New binaries read old configurations; old binaries are not valid rollback targets for schema 4/5 without an explicit stopped-data restoration.

## Supported adapter

Capability depends on the normalized HTTPS endpoint and exact model ID, not the user-defined provider alias. Verified pairs are `deepseek-flash` at the official DeepSeek root or `/v1`, and `deepseek-v4.1-flash` at `https://ark.cn-beijing.volces.com/api/plan/v3`. Unknown high modes fail explicitly. Do not infer that a compatible protocol or similarly named model supports the setting.

For explicit supported modes, use the installed public Pi SDK reasoning options and DeepSeek thinking format. Actual final JSON carries enabled/high or disabled as selected. The registered model capability must agree with the session and stream settings. Do not overwrite native compaction maxTokens, inject the foreground reminder into compaction, or require returned private reasoning text.

## Execution and failure behavior

Capture the profile/runtime/version at request admission. Foreground first reply, tool continuation, native automatic compaction, child execution and background default-profile execution use that snapshot. Existing authorization and readonly child tools remain unchanged. There is no standalone manual-compaction product endpoint; shared compaction-stream verification is not evidence of such an endpoint.

Keep Pi native transient retry (up to three extra attempts) and transport retries zero. Settings must remain consistent on native retries. SSE bytes including heartbeats reset the HTTP idle deadline; absence of reasoning text is not idle or failure. Genuine timeout and cancellation still settle through the existing controlled stream. Do not add task-level retries or live probes as an implicit configuration check.

## Required evidence

Use real public SDK serialization with HTTP replaced locally to capture endpoint/model/mode/budget and tool continuation, child/background, automatic compaction and native retry requests. Preserve legacy missing-field payload tests, settings save/restart/CAS/secret tests and heartbeat/stall/cancel tests. Do not call a live provider or expose keys in fixtures/logs.

Offline evidence proves request construction and lifecycle consistency. It does not prove provider-side internal reasoning, billing, Skill loading quality or task accuracy. Future evaluations must call the same runtime entry instead of copying an override.
