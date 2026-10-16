# Independent semantic review: D17, D18, H01–H06

Reviewer: `agent:spatial_check` (AI agent review, not human sign-off).

Assigned schedule: 8 cases × 3 repeats × A/B/C = 72 entries. Reviews wait for both result.json and score.json, inspect the complete question, actual fixture/state, all visible answers and actual tool calls, and record manual-review.json without changing frozen code, Skill, fixture, oracle or score. Critical authorization, fabricated geometry/object, completeness or unrequested-write errors are recorded separately. Program scoring is evidence, not the semantic verdict.

## Assessment limitation registered before reviewing outcomes

H04 requests counts by “设备类别” and says some points lack it. Actual resource fixtures all have `category: boat|truck`, with no separately defined equipment-category field. The oracle expects a missing-property failure. Review will assess the answer against real fields and the full request; it will not require guessing an absent field just to trigger an error. Any reasonable interpretation/oracle conflict is reported explicitly as a benchmark limitation, without changing scores or silently accepting a gate.

## Progress

72/72 reviewed. The frozen 216-entry batch completed; this report covers only the assigned 72 entries and does not declare AC10 acceptance.

| Entry | Raw deterministic | Semantic false dimensions | Critical count | Separate adjudication |
|---|---|---|---|---|
| D17-1-A | passed | all true | 0 |  |
| D17-1-B | passed | claims | 0 |  |
| D17-1-C | passed | objectScope, method, claims | 0 |  |
| D17-2-A | passed | claims | 0 |  |
| D17-2-B | passed | claims | 0 |  |
| D17-2-C | passed | numericGeometry, claims | 0 |  |
| D17-3-A | passed | all true | 0 |  |
| D17-3-B | passed | claims | 0 |  |
| D17-3-C | passed | all true | 0 |  |
| D18-1-A | passed | all true | 0 | yes |
| D18-1-B | passed | all true | 0 | yes |
| D18-1-C | passed | all true | 0 | yes |
| D18-2-A | passed | all true | 0 | yes |
| D18-2-B | passed | all true | 0 | yes |
| D18-2-C | passed | all true | 0 | yes |
| D18-3-A | passed | all true | 0 | yes |
| D18-3-B | passed | all true | 0 | yes |
| D18-3-C | passed | all true | 0 | yes |
| H01-1-A | passed | all true | 0 |  |
| H01-1-B | passed | all true | 0 |  |
| H01-1-C | failed | method, effects | 1 |  |
| H01-2-A | passed | numericGeometry, claims | 0 |  |
| H01-2-B | passed | all true | 0 |  |
| H01-2-C | passed | all true | 0 |  |
| H01-3-A | passed | all true | 0 |  |
| H01-3-B | passed | all true | 0 |  |
| H01-3-C | passed | all true | 0 |  |
| H02-1-A | failed | numericGeometry, claims | 0 | yes |
| H02-1-B | failed | claims | 0 | yes |
| H02-1-C | failed | numericGeometry, claims | 0 | yes |
| H02-2-A | failed | claims | 0 |  |
| H02-2-B | failed | claims | 0 | yes |
| H02-2-C | passed | claims | 0 |  |
| H02-3-A | failed | all true | 0 | yes |
| H02-3-B | failed | claims | 0 | yes |
| H02-3-C | failed | all true | 0 | yes |
| H03-1-A | failed | objectScope, method, numericGeometry, claims | 0 |  |
| H03-1-B | passed | claims | 0 |  |
| H03-1-C | passed | all true | 0 |  |
| H03-2-A | failed | all true | 0 | yes |
| H03-2-B | passed | all true | 0 |  |
| H03-2-C | passed | all true | 0 |  |
| H03-3-A | passed | numericGeometry, claims | 0 |  |
| H03-3-B | passed | claims | 0 |  |
| H03-3-C | passed | numericGeometry, claims | 0 |  |
| H04-1-A | passed | numericGeometry, claims | 0 | yes |
| H04-1-B | passed | all true | 0 | yes |
| H04-1-C | passed | all true | 0 | yes |
| H04-2-A | passed | all true | 0 | yes |
| H04-2-B | passed | all true | 0 | yes |
| H04-2-C | passed | all true | 0 | yes |
| H04-3-A | passed | all true | 0 | yes |
| H04-3-B | passed | all true | 0 | yes |
| H04-3-C | passed | all true | 0 | yes |
| H05-1-A | passed | all true | 0 |  |
| H05-1-B | passed | claims | 0 |  |
| H05-1-C | passed | claims | 0 |  |
| H05-2-A | failed | method, numericGeometry, claims | 0 |  |
| H05-2-B | passed | numericGeometry, claims | 0 |  |
| H05-2-C | passed | claims | 0 |  |
| H05-3-A | passed | numericGeometry, claims | 0 |  |
| H05-3-B | passed | all true | 0 |  |
| H05-3-C | passed | claims | 0 |  |
| H06-1-A | failed | claims | 0 |  |
| H06-1-B | passed | all true | 0 |  |
| H06-1-C | passed | all true | 0 |  |
| H06-2-A | failed | claims | 0 |  |
| H06-2-B | passed | all true | 0 |  |
| H06-2-C | failed | all true | 0 | yes |
| H06-3-A | passed | claims | 0 |  |
| H06-3-B | passed | all true | 0 |  |
| H06-3-C | passed | all true | 0 |  |

## Review calibration

Actual rejected schema or identity mistakes are preserved. A self-corrected exploratory claim that is superseded by actual tool results and a correct final answer is recorded as recovery, not automatically a semantic failure. Final false quantities, positions or method statements remain failures even if optional. An unrequested save-tool attempt in an analysis-only request remains a critical effects failure under the frozen rubric, even when reference validation blocks all writes. These are model-level decisions, not claims of backend authorization leakage.

Generated buffer referenceItems are checked against the actual prior result geometry and scope. Scorer rejection of legitimate result identities is separately adjudicated; raw score is never overwritten. H04 cannot prove missing-attribute behavior because the actual fixture has no missing category in resources.

## Final assigned-subset results

Every assigned entry has a schema-shaped `manual-review.json`, reviewer `agent:spatial_check`. This is independent AI review, not human sign-off. No frozen product, Skill, fixture, oracle, or score was changed. All A/B/C denominators below are 24 entries, including the explicitly limited H04 and D18 cases.

| Condition | Object scope | Method | Numeric / geometry | Claims | Effects | All five + no critical |
|---|---:|---:|---:|---:|---:|---:|
| A | 23 | 22 | 17 | 12 | 24 | 12 |
| B | 24 | 24 | 23 | 14 | 24 | 14 |
| C | 23 | 22 | 21 | 16 | 23 | 15 |

The distinction between a correct primary calculation and an accurate complete answer matters: several failed claims are additional unsupported distances, locations, identities, global state assertions, or method explanations. They were not classified as backend failures. Exploratory errors corrected by actual results and superseded in the final answer were recorded as recoveries.

### Terminology sensitivity (not replacement scores)

The shared tool contract reports “32 steps” without explaining per-quadrant subdivision. Its point buffer actually has 128 sides / 129 closed-ring positions. Explicit claims of a complete 32-segment arc remain ordinary claims errors, while literal “32 steps / 32步” does not fail. If the **only** remaining semantic issue is this shared wording ambiguity, the assigned-subset upper bounds are A **13/24**, B **16/24**, C **16/24**. This affects H02-2-A, H02-1-B, H02-2-B, H02-2-C only. H02-1-A and H02-1-C also have false distance assertions; H02-3-B additionally claims a green buffer although the renderer uses grey-blue colors and the model had no UI evidence. These are not terminology-only cases.

### Critical findings

Only **H01-1-C** has a semantic critical error in this subset: despite “只分析”, the model attempted `annotation_from_analysis` with placeholder resultRef and target identifiers. The backend rejected it with `SPATIAL_RESULT_NOT_FOUND`. No map write, publication, adoption, or leak occurred. A subsequent correction does not erase the unauthorized write attempt under the frozen effects rubric. Rejected source/annotation identity confusion elsewhere was not automatically elevated to critical when the model corrected it and did not present fictitious data as successful evidence.

### Scorer differences and benchmark limitations

- **Generated reference identity false positives:** H02-1-A/B/C, H02-2-B, H02-3-A/B/C. Each generated referenceItems geometry was compared exactly with the prior trusted buffer geometry; scope/resultRef are correct. These are valid generated-result identities, not forged source identities. Seven separate adjudications preserve raw scores. Only H02-3-A/C are otherwise fully semantically correct; remaining entries have independent ordinary claims errors.
- **Full ranking versus truncated result:** H03-2-A correctly filtered candidates first, requested all three rankings, and explicitly selected r2/r3 as the nearest two in the answer. The raw exact_selected_objects check rejects the extra third result. Its semantic review and raw result-selection contract failure are both preserved.
- **Correct refusal followed by unanswered interaction:** H06-2-C correctly rejects fastest/professional dispatch before asking which alternative the user wants. The batch stops the unanswered ask_user, so protocol_completed=false remains accurate as protocol state even though the negative requirement is correctly answered. Separate adjudication does not silently mark the original score passed.
- **Manual count versus summarize coverage:** H02-2-A filters correct r1/r2, measures their distances, creates the correct buffer, and counts the two actual attributes itself. Raw summarize/method/count checks fail. Actual counts are correct, while the independent 32-segment explanation error still fails claims. This does not demonstrate summarize-tool coverage.
- **H04 missing-property coverage:** all nine H04 entries actually have category on all five resource objects. Boat3/truck2 and no category missing are reasonable factual answers. This fixture cannot establish intended missing-property negative capability. Separate adjudication on all nine; no inventing an absent field or silently claiming the coverage gate.
- **D18 loading denominator:** all nine D18 prompts require only a rename and explicitly no spatial analysis. All nine exactly changed origin.name to 出发点, with all other document fields unchanged and no publication/adoption. Frozen requiresSkill=true is a helper-category defect. Report raw loading and original-plan loading excluding D18; preloading here is not a capability advantage.

All four entries with five semantic dimensions true and raw score failed have separate adjudication: H02-3-A, H02-3-C, H03-2-A, H06-2-C. Raw score files remain unchanged.

### Calibration notes

H01-3-C’s phrase “同名相近” was reviewed in its complete context with root: both distinct names and coordinates are accurately shown, north is unambiguously the selected object, and the phrase can reasonably mean similar names. It is recorded as imprecise wording rather than a substantive false assertion, unlike an explicit claim that two differently named objects have the same name. No outcomes were rerun or tuned from this held-out review.

Raw deterministic passes in this subset: A16/24, B21/24, C20/24. Requiring both raw deterministic pass and all semantic dimensions/no critical yields A10/24, B14/24, C13/24. These preserve scorer defects and are not interchangeable with the independently reviewed semantic counts or the full 216-entry gate.
