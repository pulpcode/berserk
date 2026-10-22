# main 开发主线集成复核（2026-10-22）

## 结论

审查基线为 `main@e7d56e8cb7d4e10b34c016bd5d37a2a7cd7e6aa8` → `codex/agent-map-spatial@bab22915a8d0388ac05ffcbea214d8a6dad5947b`。本次没有发现需要修改产品代码才能集成的新增阻断。类型、Lint/依赖边界、构建均通过。**适合在主会话完成本次单元与桌面回归后合入开发主线；这不是稳定功能发布，也不是模型效果验收通过。** 本复核不执行合并、推送、分支删除或付费模型测试。

审查覆盖底图、共享地图、空间输入/计算/结果/保存、受控 Skill、读取入口与错误提示、共享契约和对应评测的集成边界；未声称重新证明每个历史测评样本。候选方案与默认产品必须分别理解。

## 默认产品与实验的真实边界

| 内容 | bab2291 默认产品 | R6 对照的区别 |
| --- | --- | --- |
| 基础空间分析与固定结果保存 | 已接入前台主 Agent | 三组同一 b56de82 基线已有 |
| 正式 spatial-analysis / map-annotations 正文 | 正式 fixtures 中既有正文 | E1/E2 替换为任务目录候选；并未采用到正式 fixtures |
| objectNames 精确名称查询、classify_points 分类 | 已接入工具、契约、历史/UI | R6 仅 E2 启用；E0/E1 沿用旧工具 |
| skill_read 的可用 ID 枚举与目录描述 | 默认启用 | R6 三组使用旧读取入口 |
| 宿主方法选择/已加载复用约定 | 默认启用 | R6 明确选择目标 Skill，不评主动发现 |
| 已知可恢复错误 methodAdvice | 默认可选返回 | R6 刻意未启用 |

源码依据：

- `src/resources/service.ts` 仅从部署目录 `fixtureDir/skills/<受控ID>/SKILL.md` 加载；`effectiveSkillIds` 沿用前台目录机制。产品 `src/` 和 `fixtures/` 未引用 R5/E1/E2/R6 任务目录。
- `src/pi/resource-tools.ts` 从本次 snapshot 生成 `skill_read.id` 枚举及描述；不注入正文，不新增自动读取或权限状态。空目录不注册该工具。服务端仍用 `snapshotSkill` 校验。
- `src/pi/lab.ts` 在默认宿主指令中提供方法使用约定，并把 snapshot 的 skillIds 传给前台 annotation/spatial tools。后台与子 Agent 工具白名单不扩展。
- `src/pi/skill-method-advice.ts` 只针对已有可恢复错误返回可用方法提示；不替代错误码/恢复事实，不在未知提交结果上建议重试。提示不强制读取、不自动执行。
- `src/pi/annotation-tools.ts` 的名称查询 schema 与 `src/annotations/service.ts` 使用同一固定版本，名称精确匹配、同名全部返回、图层取交集、分页和权限均保留；未把合法 ID 升级为意图已正确理解的凭证。
- `src/pi/spatial-tools.ts` 暴露 classify_points 及类型边界；`src/spatial/service.ts` 和计算实现使用原有受限计算链。新分类结果使用 v2，原有操作仍使用 v1；历史读取与 UI 共用严格提取契约。

所以，**不能把 R6 E1 的 3/4 或 E2 的 2/4 作为整支代码合并后的准确率**。当前组合未做同条件完整自然加载效果验收；本轮不因 Git 集成自动追加模型调用。

## 底图与空间整合核对

- `MapCanvas.tsx` 保持 MapLibre 实例；底图更新/重试只交给 basemap runtime。底图资源以 `basemap:*` 命名，业务资源以 `business:*` 命名，固定 `business:anchor` 不随源替换。
- `analysis-runtime.ts` 只管理 `analysis:*` 源与图层，位于业务对象下方；标绘运行时也以固定 anchor 判断可用性。切换底图不重建分析/标绘/绘制器。
- 计算输入来自 ContextService、AnnotationService 或实际原生工具结果，不来自当前底图瓦片、视口、图层显隐或底图覆盖范围。
- 结果打开/定位才请求移动视角；绘制中不强行定位。历史入口来自严格结构化证据而非助手散文。分析清除只是本地显示操作。
- `SpatialInputs` 重检来源权限与固定标绘版本；原生结果解析验证请求、工具调用、参数、scope 与投影。保存沿用已有草稿依据、CAS、幂等及不确定回执规则，不自动发布或采用。
- 默认底图为 Esri World Imagery 与 OpenFreeMap 的 OpenMapTiles 兼容矢量数据。配置保留源、坐标、覆盖、缩放和署名；本次工程复核不等于重新测量公网服务可用性。

## Findings (fixed)

没有修改产品文件。当前工程检查未产生需要机械修复的失败。

## Findings (not fixed)

1. **效果验收仍未通过（产品质量边界，不是合并冲突）。** R6 每组 4 题，任务完成均 3/4，严格通过 E0/E1/E2 为 2/4、3/4、2/4；D02 存在题意歧义，剩余确定错误含多余数值和存储状态解释。R5 主动发现也未证明稳定改善。不能宣布整体或保留集达到 90%，不能把成功计算/保存等同正确解释。保留任务进行中，详见 `r6-results-20261022.md`。
2. **任务入口文字过时（主会话已修正）。** 审查时 prd/design/implement 顶部“当前实施入口”仍称新模型尚未运行、预算待审阅，与 R5/R6 已完成不符。主会话确认已添加最新入口并保留旧段为阶段历史；本 reviewer 未改这些文件，旧测评记录未重写。
3. **回退兼容性需保留。** 新空间 v2、受控 Skill 与原生历史产生后，不能直接把服务二进制退回到不认识新记录的旧 main。必要回退须保留历史读取支持或采用停止服务后的完整匹配备份；Git 分支合并本身不执行数据迁移/部署。
4. **构建体积提示。** Vite 提示 index/MapCanvas chunk 超过 500 kB；构建成功，本轮不为 Git 管理扩大前端拆包范围。
5. **历史文件空行提示。** `git diff --check main..bab2291` 报告 evaluation-v1/review-D01-D08.md:287、r5-engineering-evidence/crash-recheck.log:11、unit-first.log:162 的 EOF 空行。均为保留测评文档/日志，无产品代码格式错误；不为清除此提示改写留存证据。

## Verification

运行目录：`experiments/harness-lab`，检查 HEAD 为 bab2291。

- Lint：通过，`npm run lint` exit 0，含 Pi/browser dependency boundaries。
- TypeCheck：通过，`npm run typecheck` exit 0。
- Build：通过，`npm run build` exit 0，2208 modules；保留上述 chunk 提示。
- Tests：主会话负责本轮全量单元与相关桌面端到端回归，本 reviewer 未重复运行；最终集成记录须填写其实际结果，不能由本报告推定通过。
- 付费模型：本轮未运行；旧 R5/R6 成绩和原始证据保持不变。

本报告只支持开发主线集成决策，正式功能效果 AC10 仍待后续获准评测验证。
