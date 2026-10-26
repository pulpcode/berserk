# 整合方案的代码依据

核查日期：2026-10-26。当前标绘固定 `99cba1f`，Agent 产品固定 `6a631a4`。以下是静态核查，不是已执行的组合版本测试。路径均相对仓库根目录，行号以当前标绘固定版本为准。

| 事实或缺口 | 代码依据 | 对设计的影响 |
| --- | --- | --- |
| 已有固定版本对象引用 | `experiments/harness-lab/src/web/annotations/AnnotationWorkspace.tsx:201`；`src/web/main.tsx:394`（后续路径均相对该实验目录） | 复用“引用此对象”，不新增选中对象的后台同步机制 |
| 引用只加载描述性元信息 | `src/pi/composer-input.ts:88`；`src/pi/annotation-tools.ts:118` | 引用不等于读取，修改前仍用 draft 模式读取当前草稿 |
| 名称查询已提供同名消歧和分页 | `src/pi/annotation-tools.ts:20` | 不新增搜索工具；单对象定向读取，不因只见第一页就选第一个 |
| 新字段已进入共享目录和工具参数 | `src/contracts/map-symbols.ts:1`；`src/pi/annotation-tools.ts:39` | 增补现有参数说明中的标准/扩展、方向规则及整体替换语义 |
| update_object 顶层合并，style/attributes 整体替换 | `src/annotations/service.ts:286`；`src/annotations/validation.ts:104` | 不能只传 style.heading；读取完整 style 后生成替换对象，未改顶层字段不提交 |
| UI 表单有独立本地状态，并会生成默认样式值 | `src/web/annotations/FeatureEditor.tsx:12`、`:22`、`:35` | “未触碰字段”与 UI 默认值须区分；最小修改集合不能简单用填满默认值的表单覆盖原对象 |
| 编辑依据只记录修订和基线 | `src/web/annotations/useAnnotations.ts:6`；`AnnotationWorkspace.tsx:44`、`:94` | 为冲突比较保留编辑起点对象/图层；仅作当前页面局部状态 |
| binding 与内容分两次加载 | `src/web/annotations/useAnnotations.ts:21` | 不能把新 headRevision 和旧对象内容组合成可写编辑起点；使用成对成功加载的固定版本 |
| 保存冲突已保留本地表单 | `src/web/annotations/useAnnotations.ts:29`；`AnnotationWorkspace.tsx:167` | 复用 pending/回执；升级“重新编辑”为明确比较与选择，不能仅给旧完整表单换新修订号 |
| 已有测试只覆盖其他字段更新后的重新编辑 | `tests/e2e/annotations.spec.ts:92` 附近的 rename_set 冲突案例 | 补同对象同字段、不同字段、删除、刷新失败、二次冲突与缺省值保留 |
| Agent 写入已有请求级版本依据 | `src/pi/annotation-state.ts:47`、`:60`；`src/annotations/service.ts:453` | 保留现有 Pi 循环、CAS 与不确定回执流程；不新增锁或宿主事实状态 |
| Agent 消息变化会触发地图刷新 | `src/web/main.tsx:416`；`src/web/annotations/useAnnotations.ts:28` | 沿用现有刷新入口；有本地输入时应展示版本变化而不替换表单 |
| 全屏地图引用可能返回对话页面 | `src/web/main.tsx:396`、`:399` | 存在未保存输入时阻止引用引起的离页，先提示保存或取消；不把未保存预览伪装成固定引用 |

## 固定 Agent 基线

`6a631a4` 的 `fixtures/skills/map-annotations/SKILL.md` 和 `spatial-analysis/SKILL.md` 已增加来源消歧、点数与业务数量区分、阶段效果和事实依据规则。其产品目录与 R13 证据提交 `e07f46e` 相同。只在该已选基线上补充本次新字段和接续规则，不复制另一 worktree 的 R12 未提交候选。

## 边界判断

这些证据支持三个最小改动面：现有工具/Skill 说明、当前页面的编辑差异与冲突交互、整合场景测试。它们不支持新建 Agent 内核、服务端编辑锁、跨页面未保存草稿同步、通用协同编辑系统或新的写入 API。
