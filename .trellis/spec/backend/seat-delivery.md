# Seat Responsibilities and Supplementary Delivery

## 1. Scope / Trigger

Read when changing seat duties, background recipient suggestions, review decisions or delivery projections. Fixed rule recipients remain independent. Pi uses its public tool loop; human review happens after the job ends, with no suspended model or container. This extends the background and task-information contracts.

## 2. Signatures

- The original review schema v5 added `background_delivery_reviews` and seat `responsibility` / `responsibility_revision`. The integrated application uses v7 for authentication-only databases and v8 for background databases, preserving review decisions and explicit inbox handling. See [Workbench](workbench.md) for legacy layout migration and integrity requirements. Back up before migration and restore a matching backup for older code.
- `npm run access:admin -- seat --data-dir DIR --seat ID --responsibility-file FILE [--seat-name NAME] --service-stopped` changes duties/name, not account credentials or history. An actual change increments the revision.
- `information_suggest_recipients({recipients:[{seatId,reason}],noAdditionalReason?})` records a proposal for the current preprocessing request.
- `GET /api/information/delivery-reviews?status=pending&offset=0&limit=25` and `GET /api/information/delivery-reviews/:id` return authorized summaries/details.
- `POST /api/information/delivery-reviews/:id/decision` accepts `{clientActionId,revision,decision:'approve',recipients:[{seatId,reason}]}` or `{clientActionId,revision,decision:'decline',reason}`.

## 3. Contracts

Background config `deliveryReviewSeatId` explicitly selects the overall seat. Rule `supplementaryDelivery.candidateSeatIds` enables suggestions; the Profile must allow `information_suggest_recipients`. Admission captures candidate names, duties/revisions and reviewer in the rule snapshot. Source recipient bounds, active seats and context scope apply. Candidates exclude fixed recipients and the reviewer; duties are centrally maintained, not repeated in each rule.

Nonempty recipients require omission of `noAdditionalReason`; empty recipients require that explanation. Errors explain which field to correct. Registration returns `{suggestion,published:false}`. Successful tool evidence must match the persisted suggestion, request and call ID in native history before the final answer. Invalid subsequent calls preserve a prior valid proposal; an explicit valid empty proposal clears it. No valid proposal means fixed-only delivery, without forced model calls.

Successful verified completion atomically creates fixed deliveries and, for a valid nonempty proposal, a pending review. The worker ends. Approval requires the configured overall identity, source manage grant and context rights, rechecked after asynchronous evidence reads. Candidate eligibility is also checked currently. One transaction stores the decision, idempotent action receipt and pending supplementary deliveries. Existing delivery code then sends; `approved` does not imply `delivered`. Retries use the original result and never restart Pi.

Details recheck current authorization after asynchronous history/file reads. Revoked access cannot return a previously authorized body or open stream. Source viewers can inspect reviews without deciding; recipient inbox/task-information projections omit other candidates, full proposals and internal rule snapshots. A recipient sees its own delivery reason. Delivery adds no access to another seat's private work.

Frontend uses the information center sidebar and review drawer. Keep local edits on failed decisions; after response loss, read the stored decision. If it matches the submitted decision, show saved status; if it differs, retain the draft alongside the current decision. Never automatically overwrite a decision. No new auth secrets or model environment keys are introduced.

## 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Missing duties/reviewer grants/profile tool, foreign candidate | Reject enabling the rule or recording the invalid proposal |
| Mixed proposal fields | Tool error explains correction; Pi may continue naturally |
| Missing/mismatched native suggestion evidence | Fixed result may deliver; no supplementary review is published |
| Failed/interrupted job | No new review or result deliveries |
| Wrong reviewer or revoked permission | Deny decision; no new deliveries |
| Stale revision or conflicting decision | Conflict; return/read current state, preserve UI draft |
| Repeated action with same payload | Original receipt; no duplicate delivery |
| Approved delivery fails current checks | Review stays approved; delivery shows failed and supports explicit retry |

## 5. Good / Base / Bad Cases

Base: a legacy rule keeps its fixed recipients and does not expose the suggestion tool.
Good: intelligence receives the result; overall later changes the proposed planning/situation list and approves one recipient, using the same analysis.
Bad: treating duties as permissions, approval as analysis correctness, or task association as an automatic recipient grant.

## 6. Tests Required

`seat-responsibilities`, `recipient-store`, `recipient-evidence`, `recipient-service`, `recipient-tool-feedback` cover migration/reopen, immutable snapshots, native evidence, authority races, concurrent decisions, retry without a model and recoverable tool errors. Desktop `recipient-routing.spec.ts` covers fixed receipt before review, adjusted approval, decline, response loss, drafts and sidebar/focus. Run broader access/background/information regressions when touching shared paths.

Real-provider tests use isolated synthetic data, preserve failed attempts, and distinguish mechanism assertions from recipient quality. `probe:recipients` does not prove every business judgment correct or substitute for external-system integration tests.

## 7. Wrong vs Correct

Wrong: keep a Pi tool pending until a manager answers; approve merely because an actor has the highest permission; rerun analysis to retry delivery.
Correct: end the job, persist its review metadata, check the explicit overall reviewer and current rights, then deliver the same verified result after a transactional decision.
