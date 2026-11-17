# Research: R4 MCP runtime and Pi integration

- Query: Verify installable official TypeScript SDK v2, Node24/Pi compatibility, bounded Streamable HTTP seams, request-scoped MCP tools, confirmation/cancel/history and expert/authoring boundaries.
- Scope: mixed; current repository source plus official documentation and public npm registry metadata/package source. No dependency installation, lockfile edit, product code edit, model call, MCP endpoint call, or real credential use.
- Date: 2026-11-17

## Findings

### Verified package and protocol baseline

Public npm registry reads on 2026-11-17 returned:

| Package | Exact latest version | Node engine | Relevant dependencies |
| --- | --- | --- | --- |
| `@modelcontextprotocol/client` | `2.4.0` | `>=20` | Exact `@modelcontextprotocol/core:2.4.0`; `zod:^4.2.0`; `jose:^6.1.3`; eventsource/parser and other transport dependencies |
| `@modelcontextprotocol/core` | `2.4.0` | `>=20` | `zod:^4.2.0` |
| `@modelcontextprotocol/sdk` | `1.32.2` | `>=18` | Legacy all-in-one package; not the proposed v2 client dependency |

Sources: [client registry metadata](https://registry.npmjs.org/@modelcontextprotocol%2fclient/2.4.0), [core registry metadata](https://registry.npmjs.org/@modelcontextprotocol%2fcore/2.4.0), [legacy package metadata](https://registry.npmjs.org/@modelcontextprotocol%2fsdk/1.32.2). The client tarball integrity is `sha512-LgrD2OphHuG12vfKFKz6SOnq7bKHQmhGJIAYdD+MZBn2npHEyry6uD8zvktodtl5CQM85MO0anUyD9JwmUmxww==`; this research downloaded it into memory and inspected its package manifest, declarations and bundled source maps, without extracting or installing files. [Published client tarball](https://registry.npmjs.org/@modelcontextprotocol/client/-/client-2.4.0.tgz).

Proposed dependency pin is **client 2.4.0**, with its exact core dependency retained by the future lockfile. Add core as a direct dependency only if application code actually imports it. Do not install the similarly named v1 SDK or upgrade Pi as part of this change. `experiments/harness-lab/package.json:6` requires Node `>=24 <25`, uses ESM and pins Pi AI/coding-agent `0.85.1`; this satisfies the MCP package engine. `tsconfig.json:3` already includes DOM fetch types and Bundler resolution. This establishes engine/package compatibility, not a completed runtime/typecheck test.

The current protocol is `2026-07-28`; the SDK documentation identifies v2 as stable. Current versioning uses per-request metadata and the HTTP version header, while `2025-11-25` and earlier use the handshake model. [Official versioning](https://modelcontextprotocol.io/specification/versioning), [v2 overview](https://ts.sdk.modelcontextprotocol.io/v2/).

### Actual v2 API and defaults to override

The 2.4.0 published manifest exports the root, `./stdio`, validators, skills extension and runtime shims. **It does not export `@modelcontextprotocol/client/streamableHttp`**. The correct public import for the required transport is:

```ts
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
```

Verified declarations in the published tarball:

- `dist/index.d.mts`: root exports both classes; `StreamableHTTPClientTransportOptions` exposes `fetch`, `requestInit`, `redirectPolicy`, `reconnectionOptions`, `sessionId`, `protocolVersion`, `onInsufficientScope` and `maxStepUpRetries`.
- `dist/client-BTIWJvaF.d.mts`: `ClientOptions` exposes `capabilities`, `versionNegotiation`, `inputRequired`, `jsonSchemaValidator`, `listMaxPages`, `responseCacheStore` and `cachePartition`; inherited public `ProtocolOptions.supportedProtocolVersions` is also available.
- `connect(transport, options?: ConnectOptions)`, `listTools(params?, options?)`, and **`callTool(params, options?)`** are the v2 signatures. Do not copy the v1 result-schema positional argument pattern.
- `getNegotiatedProtocolVersion()`, `getProtocolEra()` and `getDiscoverResult()` provide actual protocol evidence; record that evidence without credentials/session tokens.

The official protocol guide confirms the root import and that default negotiation is **legacy**, `mode:'auto'` probes modern support then uses the SDK's legacy handshake when appropriate, and `{pin:'2026-07-28'}` requires modern support. For R4's two-era target use the public SDK option, bound probe/connect timeout and `probe.maxRetries:0`, restrict `supportedProtocolVersions` to the two R4 revisions, then assert the admitted version/era. Without that restriction auto mode may accept older legacy revisions; do not silently claim those have been validated. The SDK's one corrective `-32022` continuation belongs to the discovery probe and is separate from its timeout retry count; do not confuse probe negotiation with permission to retry a business call. HTTP probe timeout is an error, not proof of legacy support. [Protocol versions](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions.html).

Required explicit exclusions:

1. `inputRequired:{autoFulfill:false}`. Published `ClientOptions` documents that the default auto driver can fulfill embedded elicitation/sampling/roots and **resubmit the original call** with input responses. R4 excludes remote interactive continuation; a typed unsupported/input-required outcome must surface without handler registration, fake empty inputs or replay. Keep capabilities minimal; do not register sampling, roots, elicitation, tasks, subscriptions or remote Skill handlers.
2. Do not construct an SSE fallback transport. Streamable HTTP may return SSE within its HTTP response; that is distinct from the excluded standalone legacy SSE fallback. [v2 upgrade guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html).
3. Static bearer/API-key authentication can use controlled `requestInit.headers` with **no OAuth provider**. A token-only provider without refresh callback is another seam, but unnecessary for this scope. `authProvider.onUnauthorized`, OAuth scope step-up and remote continuation can resend calls; do not enable them for this implementation. Set `onInsufficientScope:'throw'` and never use `'follow'` redirects. [Streamable HTTP options](https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/client/client/streamableHttp.html).
4. Published streamable HTTP source defaults SSE reconnection retries to 2; it uses GET/Last-Event-ID resumption, not automatically a new business POST. Still disable automatic reconnection for the first R4 transport (`maxRetries:0`, other required reconnection fields explicitly bounded), do not persist resumption tokens, and use the existing request signal. Reconnection is not proof of business idempotency. The source honors `requestSignal` for the originating POST and its SSE stream; modern cancellation closes that stream, whereas legacy cancellation uses protocol notification semantics. Do not implement one homemade cancellation sequence for both eras.

### Minimal runtime boundary

Recommended internal interface shape, not a new Agent loop:

- `admitRequest(context, trustedSelection, expertRef, signal)` returns an immutable request grant: stable connection/revision IDs, authentication owner reference/version, approved catalog digest/action mappings and actual allowed tool IDs. It contains no secret or raw target supplied by the model.
- `toolsForGrant(grant, hooks): ToolDefinition[]` wraps only admitted exact actions as sequential native Pi tools, using deterministic bounded names mapped to `(connectionId, actionId, remoteName, contractDigest)`. Descriptions include the concrete connection/account label and that results are external material. Model arguments contain only the remote action's schema; URL, credentials and hidden subject IDs remain host state.
- `prepareCall(grant, toolCallId, finalArgs)` checks current authority, contract/config identity, signal and parameter bounds. It yields exact confirmation data; target selection and operation approval remain separate.
- `invoke(prepared, oneUseApproval, signal)` rechecks after approval, resolves the current credential for that same subject, durably records minimal intent for write/unknown effects before any POST, invokes once, and records actual outcome. No fallback to another connection/identity. The public result carries bounded text plus validated nonsecret source/outcome details.
- `close()` belongs to the admitted request and releases client/transport/listeners in `finally`. Stop/revoke only that request's transport, not a shared client used by other users.

Avoid an arbitrary URL/method proxy, generic credential access tool, second chat database, second execution loop, task-connection binding/default chain, or background MCP registration.

### Network, catalog, schema and credential bounds

`src/context/http.ts:26` already links abort, fixed URL, a 15-second default, response byte counting and no redirects. Its JSON-only reader is not an MCP transport: reuse its defensive principles and error-redaction pattern, not its JSON parser/body buffering in place of the official SDK.

The v2 custom-fetch seam is sufficient to enforce the transport policy while the SDK retains protocol parsing. It must cover every SDK HTTP method (POST/GET/DELETE) and returned JSON/SSE/error body, not only successful `tools/call`. Set redirect manual/error; reject all redirects in the first slice. Validate approved scheme/origin/path/port, reject URL credentials/fragments and nonapproved addresses, and enforce DNS/IP policy at the **actual connection/dial** boundary. A DNS precheck followed by unrestricted `fetch(url)` leaves a rebinding gap. Existing deployment-approved private HTTP targets require explicit operator allowlisting; public MCP must not implicitly authorize loopback, link-local, cloud metadata or arbitrary private networks. Decide and test the actual resolver/dispatcher implementation during R4-0; it is not implemented here.

Bound request bytes, cumulative streamed response bytes, per-event/parser material, whole call/probe deadlines and idle time. Reject oversized bodies during streaming, including absent/false Content-Length and SSE comment floods. Do not download linked resources or render remote HTML. Sanitize transport errors rather than displaying server bodies, headers or URLs with secrets. Credentials are injected only after the target is fixed and never put in schemas, arguments, model context, containers, public DTOs or call logs.

SDK no-cursor `listTools()` auto-aggregates up to `listMaxPages` (default64); explicit cursor calls are per-page and **not capped**. Use a bounded aggregate plus total tool/schema/text bytes, or a host-controlled bounded page loop with duplicate cursor/tool detection. Do not assume that one `listTools()` result is one network page. Keep exact remote names/descriptions/input and applicable output schema/annotations in a stored immutable catalog; publish unsupported tools as unavailable rather than replacing their schema with `{}`. Newly discovered actions or changed contracts require explicit reopening; admin refresh must not replace the in-flight catalog. SDK output validation should remain enabled; tool-level `isError` and thrown protocol/transport failures remain distinct.

Pi expects a TypeBox-compatible `parameters` schema (`node_modules/.../pi-coding-agent/dist/core/extensions/types.d.ts:344`). Pi AI actually compiles schemas and clones/coerces input (`.../pi-ai/dist/utils/validation.js:280`). A narrow schema-admission adapter is required: bounded depth/node count/serialized bytes/enum sizes/regex length/reference graph, no remote `$ref` fetching, and rejection of unsupported dialect/keywords rather than silently changing constraints. Preserve the original schema and validate final outgoing arguments against the admitted contract. Test actual TypeBox compile/provider behavior before declaring a schema supported. Confirm **final validated/coerced/hook-transformed arguments**, not the earlier raw model JSON.

Use a fresh client and response-cache store for each admitted authentication context/request initially. Future pool keys must include connection ID+revision, exact auth owner+credential version and relevant scope. SDK cache partitions alone do not isolate all entries: its declarations allow server-declared public entries to share a server-identity slot, and serverInfo is self-reported. A shared global store can therefore mix same-name/version services or subjects. Never cache authorization; recheck at admission, after async loads, before network call and after approval. Credential rotation invalidates corresponding client/auth/catalog caches; personal discovery is not an organization catalog. The pending question about personal credentials in public tasks remains a user decision, not a research conclusion.

### Current files and concrete integration seams

All paths below are relative to `experiments/harness-lab/` unless otherwise stated.

| File / line | Current behavior and implication |
| --- | --- |
| `src/pi/lab.ts:1026` | Request guard checks abort, active identity, capability and scenario state; add connector grant/current-auth checks without weakening existing guards. |
| `src/pi/lab.ts:1059` | Authoring selects a dedicated restricted tool array before ordinary business tools; add MCP only to ordinary foreground branch and explicitly exclude authoring, child, service/background and trial. |
| `src/pi/lab.ts:1093` | Native custom tools are intersected with service/expert allowlists. Add explicit connector entitlement before this filter. |
| `src/pi/lab.ts:1103` | Public `createAgentSession` passes `noTools:'builtin'`, customTools and an exact list of names. Preserve this seam and sequential execution; no Pi internal monkeypatch or new loop. |
| `src/pi/lab.ts:1114` | Existing public beforeToolCall hook runs original hook first, then authorizes transformed args. Add exact MCP mapping recognition and confirmation preparation here. |
| `src/pi/lab.ts:1191` | Existing confirmation binds native request/tool call, persists wait, rechecks authority and argument identity after approval. Extend with typed source/config/catalog/auth metadata; consume one-use approval inside MCP execute. |
| `src/pi/lab.ts:1226` / `1256` | afterToolCall preserves actual policy-controlled execution if original hook fails. Current `executionStarted:true` projection is not enough to prove an external write succeeded; retain separate sent/unknown/result evidence. |
| `src/pi/lab.ts:655` / `1840` / `1899` | Stop aborts the request controller, invalidates waits and initiates Pi abort without awaiting its own pipeline. Pass this signal through SDK connect/list/call and request-owned transport cleanup. |
| `src/pi/lab.ts:1674` | Native execution manifest v1 records tool names but no connector identity; add a strict new manifest/custom-entry version for source snapshots, preserving v1. |
| `src/pi/interactions.ts:13` / `38` / `117` | Native interaction/policy types and decoder enumerate fixed tool names and record versions. Arbitrary new names cannot be appended to old policy records without broadening historical meaning. Introduce a new strict branch/version and retain old decoders exactly. |
| `src/pi/interactions.ts:154` | Replay crosschecks real calls, approvals and results. Extend linkage to connector revision/catalog/args digest and actual unknown effect; approval never proves execution. |
| `src/pi/composer-input.ts:12` / `133` | Composer versions v1-v8 have strict field/template branches; connection selection needs a new version or separate strict native record, not widening old variants or rewriting JSONL. |
| `src/pi/capability-history.ts:30` | Execution manifest v1 has exact keys and tool membership; preserve byte/semantic compatibility and reject forged mixed versions. |
| `src/pi/chat-projection.ts:20` / `33` | Public tool input/details are whitelisted and currently omit MCP source/account. Add validated nonsecret connector projections in the existing chat, not raw remote details or a new result-card system. |
| `src/capabilities/service.ts:14` / `133` | IDs follow `[a-z][a-z0-9_-]{0,127}`; general system expert uses allowedTools:null. Generated tool names must respect this limit, the interaction toolName limit80 and provider limits (a deterministic name of at most64 ASCII characters is a conservative starting point), with collision checking; null must not become automatic new MCP grant. |
| `src/capabilities/management.ts:78` / `112` | Built-ins are read-only; draft tools must come from real catalog. New explicit connector references need versioned immutable expert/draft validation; no widening old allowedTools history. |
| `src/pi/authoring-tools.ts:42` / `src/authoring/management-skills.ts:15` | Authoring gets only read/propose/save/report methods under current admin/personal checks. Extend read-only catalog/reference fields only; no remote calls, connection/secret management, publication or deployment authority. |
| `src/pi/capability-trials.ts:165` | Isolated expert trial verifies supported tools/synthetic substitutions. Do not auto-register live MCP to satisfy coverage; retain optional trials and honest unverified integration notes. |

The current `capabilities/catalog.ts:4` contains fixed host tools only. R4 must distinguish a real connector reference from a remote display name. For an old explicit allowlist, new MCP actions remain absent. For the old general `allowedTools:null` expert, retain old native availability and require independent explicit connector admission; do not iterate all enabled MCP connections and call that authorization. Selected Skill requirements and R3A catalog references never grant remote use. System built-ins remain copyable/read-only; do not rewrite old revisions on startup to add connectors.

Target ambiguity must be resolved without sending business arguments to any candidate. Build choices from host-known authorized metadata, bind the accepted option to the exact request/connection, and keep ordinary AskUser results separate from the later operation approval. An untrusted model assertion or historical answer cannot grant target selection. Existing experts without AskUser cannot silently select the first candidate; the existing explicit UI selection path or an honest unresolved-target result is needed.

### Write intent, unknown outcomes and historical preservation

Before write/unknown-effects network dispatch, persist minimal intent with request/tool-call identity, connection revision, catalog/action digest, argument digest and upstream correlation reference. This supplements native history only for external-effect reconciliation, without duplicating the conversation. A persisted intention or approval is not evidence of POST dispatch; a sent request with lost reply is not evidence of failure or nonexecution.

Outcomes should distinguish preflight/approval rejection or cancelled-before-send, remote tool error, actual success, transport failure before send, and sent-but-unverified/unknown. Record actual source and time. When send outcome cannot be known, preserve unknown and block automatic replay; if a target has a real status lookup, reconcile the original operation only. MCP request IDs and reconnect state are not business idempotency keys. Restart never continues pending confirmations or resends writes. Native tool details and projection must preserve unknown even if Pi subsequently reports cancellation or a result hook fails.

Strict new record versions must bind request/session/owner/tool call, selected connection/config/catalog/auth-owner references, final parameter digest and actual result linkage. Retain old v1-v8 branches and old native bytes; do not substitute today's connection names/catalogs/secrets into old evidence. A pairing of new binary+R4 data and old binary+pre-R4 full backup remains necessary because strict JSONL decoders can make rollback incompatible even without a DB migration.

### Required verification map

| Test group | Required evidence / existing test seam |
| --- | --- |
| SDK2 compatibility | Node24 native import plus typecheck of root Client/transport, two-argument callTool, custom fetch, request signal and schema adapter; controlled modern2026-07-28 and legacy2025-11-25 JSON/SSE servers; unsupported version/HTML/empty-probe failures; no standalone SSE fallback. |
| Catalog/limits | Pagination completion, cursor cycles, duplicate names, total tools/schema limits, invalid/recursive/external-ref schema, output compile/validation failure, changed contract not silently opened, SSE byte/comment limits, timeout/abort cleanup. |
| Network | Same/cross-origin and method-changing redirects blocked, DNS answer/dial changes blocked, loopback/link-local/metadata/private-address policy, exact approved old HTTP exception, no credential forwarding; no raw error-body/header leak. |
| Identity/cache | Same remote name and same serverInfo at two addresses; same address with organization vs two user credentials; credential rotation, current account revocation, late async completion; verify another request continues when one is stopped. |
| Pi request scope | Extend `tests/pi/capability-guards.test.ts`, `capability-history.test.ts`, `provider-payload.test.ts`, `interactions.test.ts`, `recovery.test.ts` and add focused `mcp-tools`/`mcp-history` tests: exact registered list, source mapping, target ambiguity, per-call approval, transformed args, stale/forged approval, stop at every boundary, unknown POST result and no resend. |
| Authoring/experts | Extend `tests/pi/authoring.test.ts`, `authoring-history.test.ts`, `management-skills.test.ts`, `capability-trials.test.ts`: null/old explicit allowlist no new grant, built-in read-only, real connector refs survive patch/publish/digest checks, no live remote tools in authoring/trial/child/background; trials stay optional. |
| History/UI | New-version fixtures plus unchanged v1-v8 fixtures; strict cross-record tampering rejection; existing chat projection/source/error text at desktop1060/1440; history read performs zero network calls. |
| External verification later | Microsoft Learn actual list/call and real model loop using isolated data; label controlled fixtures, real network, actual model, business integration and user acceptance separately. |

No tests were run in this research-only pass. Run package typecheck/lint-boundaries/unit/build and appropriate desktop regressions after implementation; no dependency installation or lockfile has occurred here.

### Official external target: Microsoft Learn

Microsoft's official overview documents a public, unauthenticated Streamable HTTP endpoint, `https://learn.microsoft.com/api/mcp`, for public documentation; this is an appropriate read-only real target. Its developer reference names search/fetch/code sample search but explicitly requires runtime listing because contracts can change. Do not hardcode documentation examples as discovery results or infer the endpoint's current negotiated revision from docs. Sources: [Microsoft Learn overview](https://learn.microsoft.com/en-us/training/support/mcp), [developer reference](https://learn.microsoft.com/en-us/training/support/mcp-developer-reference). This pass read only those documentation pages and **did not invoke the MCP endpoint or its tools**.

### Related specs read

- `.trellis/workflow.md`: research persistence and research-only role boundary.
- `.trellis/spec/backend/index.md`: relevant package/layer entry point.
- `.trellis/spec/backend/capabilities-r3.md`: immutable package/version/history and current scoped runtime authorization.
- `.trellis/spec/backend/authoring-r3a.md`: protected request-local authoring, real confirmation, receipts, old-history meaning and no remote execution expansion.
- `.trellis/spec/backend/hitl.md`: AskUser versus operation approval; strict native linkage; stop, unknown execution and no replay.
- `.trellis/spec/backend/background-execution.md`: service identity isolation, native Pi reuse and no hidden background expansion.

## Caveats / Not Found

- Public registry metadata and package declarations/source were verified, but SDK2 has not been installed or executed with the repository; type/runtime/provider schema compatibility remains a planned test. Node engine compatibility alone is not integration proof.
- No actual MCP response, external protocol version, remote schema, cancellation behavior or Microsoft Learn call was observed. No real model or credential was used.
- The implementation of DNS/IP enforcement at the actual dial boundary, concrete schema/byte/time ceilings and exact persisted record versions still needs design and executable tests. Existing `context/http.ts` does not establish SSRF-safe arbitrary MCP networking.
- Personal credentials in public tasks are explicitly pending user choice in the task PRD. This research preserves that open decision and does not authorize broader use.
- The reviewed v0.2 plan is a planning artifact; this report does not authorize dependency changes, code implementation, production migration/deployment, external tool invocation or commits.
