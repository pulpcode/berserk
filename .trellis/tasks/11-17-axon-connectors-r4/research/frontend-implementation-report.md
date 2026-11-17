# R4 frontend implementation and verification

## Boundary

Implemented the original capability-center connector tab, management/detail panels, write-only organization/current-account credentials, explicit session connector selections, original confirmation/tool-result presentation, and expert action references. Applied `trellis-before-dev` and `ui-ux-pro-max` with the repository's desktop-only override. Backend connection DTOs/routes/storage belong to foundation; native Pi/history/expert authorization belong to root; SDK/network transport belongs to transport. No commits, deployment, production migration or user acceptance were performed.

### Files

- New `src/web/ConnectorLibrary.tsx` and `src/web/connectors.css`: searchable cards and real tool disclosures; structured MCP connection form; separate save/discover/open-tool/use-policy/lifecycle actions; explicit CAS comparison without silently adopting a newer baseline; fixed business cards have no duplicate/copy registration action. Ingress credential forms address each existing source channel.
- `src/web/CapabilityCenter.tsx`: replaces only the connector placeholder using the existing tab/panel pattern. No extra page subtitle or new page system.
- `src/web/ComposerReferences.tsx`, `src/web/useComposerSelections.ts`, `src/web/useChat.ts`, `src/web/main.tsx`: safe connector IDs only, at most eight, scoped by the existing authenticated client's login-view storage key and draft/session owner. First-session move, refresh, settlement and explicit per-message recovery retain current choices. Retained IDs do not prevent ordinary queued text. Busy/confirmation requests prevent connection changes; library staging rechecks the exact destination's active/background state and navigation ownership. No selection sends text or changes expert/model/files.
- `src/contracts/index.ts`: adds only `ComposerSelection.connectorIds?: string[]` and typed `PublicToolDetails.mcp` evidence.
- `src/web/InteractionCard.tsx`, `src/web/ChatMessage.tsx`: original confirmation displays actual connection/account/tool plus complete inert JSON parameters; native result evidence shows actual source and distinguishes success, remote error, required input, not-sent and unknown result. A confirmed action is not presented as execution success.
- `src/web/CapabilityManagement.tsx`: current approved connection-action contracts in the original expert form, preserved through edit/save/copy; stale contracts remain visible/removable, and history comparison includes connector references.
- New `tests/e2e/connectors.spec.ts` and `tests/web/mcp-presentation.test.ts`.

### Secret handling

Secret-bearing mutations use a fresh random action ID directly, never `sessionAction`, browser storage, URL parameters, draft text or model input. Password fields begin empty and clear on completion/failure. A disconnected mutation response blocks another save until explicit safe status reconciliation; the UI does not replay it. Connection URLs are validated to exclude embedded account/password, search and fragment before safe configuration idempotency state is stored. Administrator personal credentials used for discovery stay separate from runtime eligibility. Ordinary users can only configure their own credentials for an already approved target.

## Checks actually run

- Final serial browser batch: `npx playwright test tests/e2e/connectors.spec.ts tests/e2e/capabilities.spec.ts tests/e2e/references.spec.ts --workers=1` — **22 passed, 2.1 minutes**. All six new connector tests passed. Existing references includes its historical 375px case; no new mobile design/test was added and that historical case is not R4 mobile acceptance.
- New browser cases cover administrator cancellation/no implicit discovery, actual SDK discovery over controlled HTTP, tools/policy/enable separation and CAS; two independent logged-in browser contexts and own-secret lost-response/no storage/no replay; two named connections with the same tool retained across refresh/first send/settlement/new-draft isolation; expert action save/reload/copy; busy choice freeze and destination staging preserving next text; original live confirmation with inert full parameters, refusal with zero remote calls and approval with exactly one selected A call and zero B calls, plus historical typed source evidence.
- `npx vitest run tests/web/mcp-presentation.test.ts tests/web/composer-interaction.test.ts tests/web/chat-tool-presentation.test.ts tests/web/api.test.ts` — **4 files, 12 tests passed**.
- Focused ESLint across owned frontend/contracts/tests — **zero errors**; `InteractionCard.tsx` retains two existing `react-hooks/exhaustive-deps` ref-cleanup warnings on unchanged lines.
- `npm run build` passed twice, retaining the existing large-chunk advisory. The final helper-copy change was subsequently covered by the final browser batch; root's final quality gate owns the final build.
- Typecheck passed during integration. Latest global rerun encountered only a newly added root-owned `tests/pi/mcp-runtime.test.ts:112` callback returning `undefined` instead of a Promise; reported to root for correction/final rerun. No frontend type errors remained in that output.
- `git diff --check` passed before handoff.

## First failures and exact corrections

1. Initial browser invocation could not bind local Vite (`EPERM 127.0.0.1:5187`); reran with the standard local-server sandbox escalation, which was approved.
2. Expert browser save was rejected by the initial server connector-ID schema when a generated UUID began with a number. Root corrected that route schema. The fresh-process expert save/reload/copy rerun passed; the test now asserts PUT 200 explicitly.
3. `app.inject` buffers the SSE response, so the initial busy test could not observe the native active request ID. Only the two stream-sensitive cases now use the original live Vite→API proxy and a local API listener, like existing authoring tests. A temporary dynamic-URL forwarding experiment produced a CSRF failure due to browser cookie routing and was discarded. No product authentication rule was relaxed.
4. Stream test-only corrections fixed the `lab.list(workspaceId, seatId)` argument order and compared the JSON parameter display against exact serialized JSON rather than an unescaped substring. Both stream cases then passed and all six passed in the final batch.

## Desktop visual evidence

All below are synthetic local test data, with no real secrets. Manually inspected card/tool disclosure at1060, loaded retained chips at1440, configuration/CAS at1440 and pending full-parameter confirmation at1060; the paired widths were captured and overflow assertions passed.

- [Cards1440](../evidence/ui/connector-cards-1440.png), [cards1060](../evidence/ui/connector-cards-1060.png)
- [Configuration1440](../evidence/ui/connector-config-1440.png), [configuration1060](../evidence/ui/connector-config-1060.png)
- [Retained chips1440](../evidence/ui/connector-chips-1440.png), [chips1060](../evidence/ui/connector-chips-1060.png)
- [Native confirmation1440](../evidence/ui/connector-confirmation-1440.png), [confirmation1060](../evidence/ui/connector-confirmation-1060.png)

## Remaining checks and limits

Root's independent review and final global lint/type/build/unit suite remain authoritative. The stream-sensitive connector tests and existing authoring tests both use the repository's Vite API target port4310, so serialize them (`--workers=1`) rather than running those files concurrently. The actual official client talks to disposable controlled wire fixtures; provider transport is deterministic. These browser results do not claim third-party MCP, live-model, production migration/rollback, old business integration equivalence or user acceptance.

Handoff review found and corrected one derived UI condition after the browser batch: `recoverableSelectionDiffers` now compares only per-message selections, excluding retained connector IDs on both sides. Otherwise a failed message whose text was already restored would show a redundant recovery button solely because the current session retained connections. Focused ESLint and the same four Vitest files/12 tests passed after this one-line correction; root's independent check can assess this condition with the rest of draft recovery.
