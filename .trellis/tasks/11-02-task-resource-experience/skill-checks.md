# 第三批 Skill 与 Pi 链路检查

日期：2026-11-02。只做离线程序检查，外部模型调用为 0。本报告不代表 Skill 主动读取率或任务正确率。

## 修改内容

- 更新现有 `spatial-analysis`、`map-annotations`，未新增 Skill。目录描述从同一正文解析，两份版本升为 2，hash 按实际正文计算。
- 区分纯图形、明确来源、任务资源与真实歧义。任务资源复用第二批 query/data/task、空间分类、关系/状态/位置统计；明确范围优先，不要求来源系统支持按任务查询。
- 说明 resource 整体替换、未知值、事实依据、受控导入与普通复制差别。页面单击不是引用；只有宿主核实传入的显式引用和仍适用的明确前文可作为对象依据。
- 宿主只增加前台标绘请求的一段简短规则。未把完整正文预加载，也未改历史 composer 正文、原计算或模型配置。
- 加强目录版本/hash/大小一致性检查；增加实际 Pi 工具链测试，使用真实标注服务和资源/空间工具计算结果。

## 验收证据

| 项目 | 检查与结果 |
| --- | --- |
| T17 目录、显式选择与按需读取 | `tests/pi/map-skill.test.ts`、`skill-discovery.test.ts`、`skill-metadata.test.ts`：两份目录与正文版本/hash一致，完整正文小于16KiB；首次 provider 输入有目录、无整份正文；实际 skill_read 后记录并交付原正文；显式选 Skill 不伪造读取工具调用；重启保留原记录 |
| T18 方法规则 | 人工对照批准方案及第二批工具契约，下面四类样例的方法无冲突；这是规则审核，不是自然语言模型评测 |
| T19 实际资源链 | `tests/pi/task-resource.test.ts` 新增 B3 用例：显式固定区域引用→skill_read→task query→classify_points→assigned/available/interior summarize→read。候选含可用救援车、故障车和仅有计划位置的车；实际统计只列救援车、数量1辆，计划位置单列为未分类，确定实体总数仍为 null；读回一致，草稿修订未被自动增加 |
| T24 旧历史与压缩 | `composer-input.test.ts` 固定 v1—v4 原文字节与 v5 混合记录；`annotations.test.ts` 重启续问、实际原生压缩后读固定版；`spatial.test.ts` 空间 v1/v2混合历史、原生压缩/重启后的固定结果；`task-resource.test.ts` 第二批结果与派生统计重启、压缩、分页、撤权检查 |

T19 的 fake provider 只指定工具调用顺序和参数，业务数据来自真实标注服务，统计来自真实工具；最终预设文本不计入正确率。它能证明接口、固定引用、工具执行和原生结果记录互通，不能证明真实模型会选择正确方法、主动读 Skill 或写出正确解释。卡片展示由 UI 检查单独验证。

### T18 四类公开方法样例

| 问题 | 应用方式 | 保留的限制 |
| --- | --- | --- |
| “统计这个区域里本任务已分配且可用的车辆” | task query→资源点分类→关系/状态/位置统计 | 引用面只确定边界，不自动确定候选来源；未知位置不算区域外 |
| “仅查来源 A 的港区船只” | data query，明确来源 A 和空间范围 | 不扩为全部任务资源，任务关系未知不阻断普通数据分析 |
| “所选面面积多少”“数这个图层的点” | 原空间/标绘工具 | 不要求普通图形先填写资源声明，不把点数说成可用资源数 |
| “两份同名方案哪份是这次范围？” | 先定向读摘要，仍影响答案才追问 | 不凭同名取第一份；已明确的范围不再反复询问 |

## 实际命令与结果

执行目录为 `experiments/harness-lab`：

- `npm run typecheck`：通过。
- `npx eslint src/pi/lab.ts src/resources/service.ts tests/pi/map-skill.test.ts tests/pi/task-resource.test.ts`：通过。
- `npm test -- --configLoader runner tests/pi/task-resource.test.ts tests/pi/map-skill.test.ts tests/pi/skill-discovery.test.ts tests/pi/skill-metadata.test.ts tests/pi/composer-input.test.ts tests/pi/annotations.test.ts tests/pi/spatial.test.ts`：7 个文件、93 项通过。2026-11-02 15:44:49 开始，22.70 秒。
- 中间受影响单文件重跑：`task-resource.test.ts` 8/8 通过。该数量包含在上述93项内，不重复累计。

使用既有测试临时目录和 runner 配置；未调用外部模型，未更改共享 node_modules。

## 首次失败及修正

1. 首次 typecheck 命令误在仓库根目录执行，该目录没有 package.json，报 ENOENT；改到实验包执行。这不是产品失败。
2. 首轮 7 文件检查为92通过、1失败；typecheck 同时指出测试直接读取 union 中非共有的 readSkills。改用结构匹配检查真实记录。新增工具链断言把 provider 工具名 `skill_read` 当成公共审计名，实际公共名为 `skill.read`，纠正断言，未改生产行为。
3. 下一次单文件为7通过、1失败：新增断言将引用版本写成平铺形态，实际公共选择是 `{ref, objectIds, ...}`。按既有契约纠正；后续8/8及完整93/93通过。

## 仍需明确的边界

- Skill 是方法说明，不是约束语言模型的程序证明。不能据本报告宣称解释误述已消失；过程说明、最终回答、真实主动读取表现仍需第四批测评。
- 查询成功不证明资源已分配、可用或已到场；未知总数不能变为0；数据、关联、位置的缺口必须分别保留。这些已写入方法，但最终模型表述仍需验证。
- 显式来源引用是在发送时读取，标注引用使用固定保存版本；未保存页面编辑不进入上下文。前端引用交互和结果卡片需与 UI 组证据合并验收。
- 以上 typecheck/lint 是该时间点共享工作区结果；其他并行实现完成后由主代理执行整体检查。

独立审核追加：统一provider-payload回归发现新目录遗漏原有“创建/修改”和“组合分析/边界判断”的发现提示，已补回而非放松测试。受影响8文件82项重新通过，包含真实SDK目录/正文交付；最终hash以handoff.json为准。
