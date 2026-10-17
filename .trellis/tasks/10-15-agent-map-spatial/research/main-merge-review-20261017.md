# main 合并复核与检查记录（2026-10-17）

## 合并结论与处理范围

已在空间分支完成本地合并提交`ae9cb6da06fa0e71352623b4c21ceeb805c69f71`，第二父提交为main@`e7d56e8cb7d4e10b34c016bd5d37a2a7cd7e6aa8`。合并后再检查main仍指向该快照；未修改主工作区，未推送。其后仅更新本任务方案、复核记录和日志。

唯一Git冲突位于`.trellis/workspace/bobot/index.md`：双方复用了日志编号33。保留空间分支33–36及incoming交接日志，将后者改为37并注明原编号；原日期、分支及内容保留，索引同步。不涉及产品冲突处理。

下面为独立检查代理的结果；主会话核对了失败堆栈、命令配置与合并树，并按本轮不追加修复的范围保留测试失败。**检查已执行完毕，工程门禁未全部通过；模型效果仍未通过，不能视作发布验收。** 下一轮计划见[审阅方案](../next-round-plan.md)。

## 独立工程检查

- 检查工作树：`/Users/lau/.codex/worktrees/agent-map-spatial/berserk`。
- 本分支检查起点：`5587af32c41a31e1d5e7665584623c1f735da692`；合入主线：`e7d56e8cb7d4e10b34c016bd5d37a2a7cd7e6aa8`；共同祖先 `75fc7f169cc82c34db989c0fb7ee5dda75bf9845`。
- 范围：核对合并内容及确定性工程/桌面回归。没有调用真实模型、读取或打印 `.env`，检查代理没有修改源码、测试、方案或Git/index；初始检查报告、配置、日志及构建/浏览器产物写在`/private/tmp`，主会话随后将本复核记录和产品哈希清单纳入任务文档。
- 结论：类型、Lint/依赖边界、构建和 26 条桌面测试通过；全量 Vitest **1051 通过、1 失败**。唯一失败是旧 provider 文案断言与已合入的 layerNames 描述不一致，故目前不能声称全部检查通过。

## 合并内容核对

逐文件独立重建比较的 13 个产品/脚本/测试变更：10 个逐字等于 incoming main；`annotations/service.ts`、`annotations/validation.ts`、`contracts/annotations.ts` 三个逐字等于 `git merge-file -p 5587af3 75fc7f1 e7d56e8` 的无冲突输出。没有发现这13个文件包含双方已提交变化之外的产品改动。逐文件 SHA256/归属见[合并产品差异清单](main-merge-product-audit-20261017.json)。

主线图层名称精确筛选仅扩展 `annotation_read`：`layerIds` 与 `layerNames` 互斥、名称严格匹配、歧义要求明确 ID、仍取 objectIds 交集。`AnnotationService.version` 权限检查先于名称解析；固定版本、分页、历史与原有字段语义保留。空间请求 `src/contracts/spatial.ts:7,57` 仍仅支持 layerIds/objectIds，`src/spatial/inputs.ts:35–36` 继续按固定版本 ID 选择，不自动支持 layerNames。调用者须把读取结果中的 layerId 用于空间工具。

相关规范核对：backend/map-annotations、conversation-references、context-analysis、situation-map、agent-scenario-validation 与现有后端/前端质量检查条款。名称匹配的新确定性用例覆盖不存在、同名、大小写/空格、交集、分页、权限、历史版本和原生工具 schema/调用投影。

## 命令与结果

以下工作目录均为 `/Users/lau/.codex/worktrees/agent-map-spatial/berserk/experiments/harness-lab`，PATH 前置 `/Users/lau/.nvm/versions/node/v24.14.0/bin`（Node 24.14.0）。

| 检查 | 实际命令 | 结果 | 日志 |
| --- | --- | --- | --- |
| 类型 | `npm run typecheck` | 退出0 | `/private/tmp/spatial-merge-typecheck.log` |
| Lint与依赖边界 | `npm run lint` | 退出0；Pi and browser dependency boundaries passed | `/private/tmp/spatial-merge-lint.log` |
| 构建 | `node node_modules/vite/bin/vite.js build --config /private/tmp/spatial-main-merge-check-20261017/vite.config.mjs --configLoader native --outDir /private/tmp/spatial-main-merge-dist-20261017 --emptyOutDir` | 退出0；8.72秒 | `/private/tmp/spatial-merge-build-isolated.log` |
| 全量Vitest | `node node_modules/vitest/vitest.mjs run --config /private/tmp/spatial-main-merge-check-20261017/vitest.config.mjs --configLoader native --no-cache --maxWorkers=4` | 退出1；97文件：96通过/1失败；1052测试：1051通过/1失败；235.60秒 | `/private/tmp/spatial-merge-vitest-authorized.log` |
| 桌面浏览器 | `node node_modules/@playwright/test/cli.js test spatial.spec.ts annotations.spec.ts situation-map.spec.ts --config /private/tmp/spatial-main-merge-check-20261017/playwright.config.mjs` | 退出0；26/26通过；3.2分钟 | `/private/tmp/spatial-merge-playwright-authorized.log` |
| 产品与规范空白 | `git diff --check HEAD -- experiments/harness-lab .trellis/spec` | 退出0 | 本记录 |

全量Vitest涵盖 annotations、Pi annotation hooks/source-history/provider payload、全部spatial、collaboration、probe-source兼容及其余现有单元/集成测试。没有运行任何 probe live；provider-payload 测试的 fetch 被测试内存 mock，其他Agent/浏览器测试使用 fakeRuntime（`allowModelNetwork:false`），不代表真实模型效果验收。

26条浏览器测试覆盖独立草稿、CAS、保存丢回执恢复、只读固定发布/历史入口、三栏/窄地图面板、图层对象树、底图连续切换/失败重试/未完成绘制、源对象引用/不可用回退、青岛与悉尼本地地图夹具、空间结果显示/隐藏、精确保存和历史重开、无WebGL回退、点点和点线量算的双端几何显示。截图/浏览器输出在 `/private/tmp/spatial-main-merge-check-20261017/playwright-output`，仅使用桌面测试。

## 未修复的检查失败

`tests/pi/provider-payload.test.ts:122`：测试仍要求 layerIds.description 包含 `摘要中的 layers 定位 ID`。main引入 layerNames 后实际文案为 `按图层 ID 筛选，与 layerNames 互斥；同时指定 objectIds 时取交集，所列对象须均位于这些图层内，否则读取失败。已有摘要足以回答时无需重复读取。`，已不包含旧字串。

同一测试后续第124行的 `同时指定 layerIds 时取交集` 和第128行的 `未指定 layerIds/objectIds 时，在该固定版本的全部对象中分页` 也与主线包含 layerNames 的新说明不一致，尚未执行到这些断言。建议同步测试到已批准的主线契约并保留原生provider投影/receipt/history检查；无须因该失败回退产品名称筛选。本代理按分工只报告，没有修改测试或任何产品实现。

## 环境阻塞及恢复（不是产品失败）

1. 原始 Vite/Vitest 启动因沙箱禁止写 `node_modules/.vite-temp` 得到 EPERM。没有改仓库配置；改用 `/tmp` wrapper config + native config loader，cacheDir/outDir均在/tmp；显式空envDir避免加载项目.env。
2. 沙箱内Playwright无法监听127.0.0.1，Vitest涉及本地服务亦受限；保留日志并中止该Vitest尝试（进程13876），随后按本地确定性检查授权运行。未将这个不完整环境尝试计入正式通过数。
3. 首次授权Playwright发现5198端口已有占用；未终止占用方，也未复用未知服务，改为独立43897。正式运行完成后测试进程和其Vite服务自动退出。
4. 构建仍有既有大chunk警告（超过500kB）；构建成功，无本轮新增拆包修改。

环境日志：`spatial-merge-vitest.log`、`spatial-merge-build.log`（初始config EPERM）；`spatial-merge-vitest-isolated.log`（沙箱中止）；`spatial-merge-playwright.log`（监听EPERM）；`spatial-merge-playwright-local.log`（5198占用）。均在/private/tmp。

## 历史字节保留

`.trellis/tasks/10-16-agent-map-evidence-audit/candidate.patch:151` 的单空格行导致该历史实验patch的diff --check报告trailing whitespace。文件逐字等于main@e7d56e8，SHA256 `414c0e9932e02803482a12caf9e59554139574de86649a3e60652e9c6b10a80e`。这不是本次新写入的产品空白错误；遵照要求保留原始实验补丁字节。

## 本轮限制

这是合并的工程兼容性检查；没有重跑模型评测，不更新既有正确率、人工裁定状态或90%验收结论。唯一确定性测试失败已由主会话列为下一轮R0前置项，当前不能标记全部质量门禁通过。本轮没有修复该断言；后续须先审阅、同步契约测试并通过相关检查，才进入新的真实模型实验。

## 方案复核与历史保留

合并当时的独立检查代理核对了空间84/28/8、五组通过数、23项仅声明失败与5项核心失败、V3加载7/18，以及main两类地图对照的统计和局限；当时版本预算96＋48＋24＋144＋180＝492、正式每条件108项及98/108、54/60的90%门槛计算正确。采纳其建议：Pro补全15例独立复核，input已含缓存时不重复计数。没有执行新的评分裁定。

此次main也包含分派说明50例报告；其局部改善及goal偏移作为跨域旁证单列，不合入空间成绩。新方案保留Mermaid架构图，原设计/修复方案中的全部架构图和历史分数均保留。元数据将当前执行状态设为待审阅，历史授权另存，AC10保持未通过。

**后续方案修订（2026-10-17，仅文档）：** 用户要求R1先改为一轮48次，保留两种模型与两种Skill加载方式；可选第二轮另48次，触发条件及单独报审要求见[方案第7.1节](../next-round-plan.md#71-何时提出第二轮以及如何停止)。上述独立检查记录对应修订前版本，不声称已独立复核新预算。修订后各后续阶段合计444次（含可选恢复、不含第二轮）；若第二轮也获批则492。此次未执行首轮、第二轮或任何测试，既有检查与模型分数不变。
