# Chat Result UI

## Scope

R1.1 adds resource metrics and a category bar chart to the existing desktop conversation. Keep the ordinary Markdown reply and its tool details available in the same turn.

## Entry points

- `src/presentation/resource-ui.ts` defines the fence, catalog and model instructions.
- `ChatPresentation` supplies the session and preceding public tool messages to `ChatMessage`.
- `readResultUiSnapshot(previous, lines, closed)` accepts complete fence-body lines from the current cumulative text snapshot.
- `LAB_RESULT_UI_ENABLED` accepts `true` or `false` and defaults to `false`. Eligible foreground requests receive either generation instructions or an instruction to use ordinary Markdown. History rendering is independent of the setting.

## Format and data

`berserk-ui-v1` is a dedicated top-level code fence beginning in column one. Its first nonblank line contains `id`, `catalog: "resource-v1"` and the exact `resultRef`. Subsequent lines are native json-render SpecStream patches for `/root` or `/elements/<id>`. The root is a `Stack` with a list of distinct child IDs. The leaves `ResourceMetrics` and `ResourceBar` use empty props and no children.

The browser resolves the reference from preceding successful `task_resource_query` projections in the same session. Prefer the current request's projection when present. The existing live and historical tool projections supply authorization, and the browser validates the selected ResourceResult. Pi retains the original text and tool result. Reopening a conversation decodes that saved text and result using the existing snapshot request.

The category chart uses `resourceStatisticsItems` and counts items by category. Levels of resource identity, quantity and evidence remain in the original result. Display a null entity count as unknown with the known entity count beside it. Carry the fixed statistics time and applicable relation, availability, spatial scope and coverage.

## Validation and user states

| State | Outcome |
| --- | --- |
| Full patch line with a resolvable registered leaf | Render immediately, including while the assistant is still responding |
| Incomplete line or unresolved leaf in an open stream | Wait for a complete patch or show the available registered leaves |
| Identical cumulative text | Reuse the snapshot |
| Replaced cumulative text | Rebuild from that snapshot's own lines |
| Invalid version, operation, component or graph | Hide raw patch content and report the invalid block. Retain any already validated renderable leaves |
| Result missing from current authorized evidence | Report the original result as unavailable |
| Reply stops with an open fence | Mark the block incomplete |
| Ordinary, quoted, list-nested or enclosing Markdown example | Keep it as code |

## Examples

- The sample in `resourceUiInstructions` is also an executable parser and browser fixture. It compiles a stack with metrics and a bar chart from one fixed resource reference.
- A plain Markdown answer can sit before and after that fence. A dashboard option or model-supplied bar value in a component's props fails validation.

## Verification

Run `tests/result-ui-stream.test.ts` for fragmented lines, repeated snapshots, replacement, invalid patches and terminal validation. Run `tests/web/result-ui-markdown.test.ts` for CommonMark handling and exact line boundaries. Run `tests/e2e/result-ui.spec.ts` against real local Pi and tool execution with a deterministic provider. It holds the response open while looking for metrics and then SVG bars, checks counts and unknowns, drags the desktop splitter, restarts with generation disabled, and opens the original session again.

## Implementation guidance

Feed the compiler only from the merged assistant message. Subscribing directly to both `text.delta` and `assistant.updated` duplicates patches. Keep ordinary React presentations and chart parameters in the web module. Supply exact category values through the chart's keyboard-accessible disclosure.

## R1.2 calculation datasets

### Scope and signatures

- An eligible foreground `bash` call can supply fixed values for chat charts and tables. `LAB_RESULT_UI_ENABLED` gates result capture and generation guidance. Stored results remain available through authorized history.
- Use the same `berserk-ui-v1` fence with catalog `dataset-v1`, a `Stack` root, empty props for `ResultTable`, and `ChartView` props `{kind, x, y, horizontal?, donut?}`. The model selects existing column IDs. `horizontal` applies to bars and `donut` applies to pies.

### Data contract

- A successful command can emit one UTF-8 JSON object with `format: "result-dataset.v1"`, typed columns, row IDs, and provenance. The shared contract caps data at 48 KiB, 32 columns, and 1,000 rows.
- The Pi tool result stores the validated dataset and its digest in native `details`. Model-facing text contains `resultRef`, column descriptors, and the row count. The existing `tool.completed` event and session snapshot project a scoped `resultDataset` only from the validated receipt.
- Consume a preceding completed `bash` receipt with the exact session, request, and tool-call identity. The browser renders from the recorded values, including after a restart or source file edit.

### Validation and states

| Condition | Outcome |
| --- | --- |
| Oversized, truncated, invalid UTF-8 or invalid JSON output | No dataset reference. Ordinary command output and logs remain available |
| Incomplete fence while streaming | Render resolved components as their complete patch lines arrive |
| Missing, invalid, or foreign receipt | Show the unavailable-result notice |
| Chart column, unit, scale or shape mismatch | Display chart validation feedback and retain the valid table |

### Good, base, and bad cases

- Good. A CSV summary supplies a chart and table in the active turn. The same values survive a source edit and service restart.
- Base. An ordinary command keeps its existing output. An explicit file download uses its own file tool.
- Bad. The chart consumes values from model-authored patches or a reference copied from another turn.

### Tests required

Run `tests/pi/result-dataset.test.ts` for receipt validation and replay, `tests/web/result-dataset-chart.test.ts` for normal and invalid mappings, and `tests/e2e/result-dataset.spec.ts` for CSV upload, chart timing before reply close, and restart after a source edit. Keep the R1.1 streaming browser regression.

### Renderer and data source

Pass fixed numeric values from the validated receipt to the chart component. Keep tool execution, result persistence, and optional file publication outside the renderer.

## R1.3 resource sources and details

- A `resource-v1` stack may contain one `ResourceResultView` leaf. Its props contain only `section`, with value `sources` or `details`, and its child list is empty. Existing metric and bar leaves remain valid.
- A resource block with this leaf shows the fixed time, applicable scope, and important coverage gaps once. Its disclosure starts closed. The sources view displays fixed origins, coverage, and exclusions. The details view adds quantity groups, ten candidates per page, and per-item evidence. A task candidate outside `resourceStatisticsItems` has a visible exclusion label.
- Opening or paging rereads the existing authorized session snapshot for the exact `resultRef`. The inline block shares the refreshed result across its metrics, chart, and details. Failed reads clear this block's data and keep its retry control. Paging preserves keyboard focus while loading. The ordinary process card also reuses the underlying React details and read logic.
- Run `tests/e2e/resource-result-details.spec.ts` for streaming before reply completion, compact copy, keyboard disclosure and paging, per-item evidence, map navigation, restart replay, denied reads, and retry.
