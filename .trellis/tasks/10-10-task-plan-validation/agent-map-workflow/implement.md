# 实施与验证顺序

状态：已实施并完成本期检查（2026-10-14），真实模型仍有未达标项，见 [验收报告](validation.md)；不部署。目标、范围、验收见 [PRD](prd.md)，接口与兼容见 [设计](design.md)。

## 0. 保留基线

- [x] 审阅当前尚未提交的上一阶段改进；保存其真实模型与桌面失败证据，不重写旧报告。
- [x] 实施前记录代码 hash/提交边界；不能把 ac50ba1 错称为已经包含来源工具实现。
- [x] 阅读 backend map-annotations/harness-lab/context-analysis/conversation-references、frontend 相关 spec。

## 1. 先证明宿主时序

- [x] 使用项目当前 Pi SDK、真实 loop 和假 provider，证明公开 hooks 可区分同一 assistantMessage、新读取与本链成功写入。
- [x] 证明新读取在下一次推理后成为依据，同输出 read+write 不提前获得依据；已读后的三个写入逐次 CAS 并立即推进本链条件，外部插入和失败阻断后续。
- [x] 覆盖原生重试、压缩、follow-up/steer、取消与 hooks 异常；保留已有 hooks，不调整 Pi internals、不改 provider 设置。
- [x] 若顺序无法可靠成立，暂停适配并回到设计，不降级为“执行时取最新 head”。

## 2. 宿主依据与来源批量

责任文件：src/pi/annotation-tools.ts、src/pi/context-tools.ts、src/pi/lab.ts，必要的小型请求内辅助文件；src/annotations/service.ts、validation.ts、src/contracts/annotations.ts。

- [x] 增加 read draft 模式和请求内已观察状态；固定历史 read 不切换编辑依据。
- [x] 模型 apply/from_source/set_current 移除机械条件；宿主从已读结果注入，服务及 HTTP 的显式 CAS 保留。
- [x] 来源 items 1～20 原子写入；一次副作用、一次回执、一个修订；各来源再查时仍核对已观察修订。
- [x] 保留刷新 ID/业务字段、不改变旧发布与另一会话、请求前后授权检查。
- [x] 幂等摘要使用原始意图，回执留实际读写依据；相同调用返回旧结果、改变意图冲突，不重放。
- [x] 不新增全局缓存、表、自动恢复和对象级合并。

## 3. Skill 与历史兼容

责任文件：fixtures/skills/map-annotations/SKILL.md（拟新增）、src/resources/service.ts、src/pi/resource-tools.ts、composer-input.ts、history-evidence.ts 及对应 tests；核查相关目录 UI/公开资源 DTO。

- [x] 实现部署级附加 Skill 的统一可见集合，不改写现有 workspace-index 的两个固定基础 Skill。
- [x] 按领域语义编写紧凑正文，不写测试名称、坐标或答案；工具保留自身必要契约。
- [x] 扩展严格受控 Skill ID/数量；旧记录正文/hash/类型不改；显式 picker 与按需 skill_read 一致。
- [x] 两 Skill 旧历史、三 Skill 新历史、混合历史、旧 explicit composer 及新的选择均能重开；非法 ID/错误 hash/越请求引用仍拒绝。
- [x] 子 Agent/后台不因获得 Skill 而获得写工具；检查 profile 快照和父子历史比对。
- [x] 明确旧二进制不能直接读取新 Skill 历史的回退限制，不在本阶段上线。

## 4. 结构化结果入口

责任文件：src/web/situation/evidence.ts、MapContext.tsx、ChatMessage.tsx、ContextEvidence.tsx（仅必要处）及相关桌面 tests。

- [x] 来源查询继续显示实际证据入口；标注回执生成固定版本/对象选择；处理旧单对象和新批量普通 toolResult。
- [x] 成功请求最终回答旁展示有界、去重、可折叠入口；限定同 requestId，不把旧 receipt 当作新动作。
- [x] 原生历史重开仍可派生入口，不增加持久 UI 索引；权限撤销/坏数据/缺失结果不能产生越权访问。
- [x] 正确旧 Markdown 保持工作；即使正文 href 错误或无链接，结构化结果仍可点击；当前来源与固定标注的时间语义区分。
- [x] 仅桌面普通窗口、三栏和窄地图面板，不增加手机验收。

## 5. 确定性验收矩阵

必须覆盖：

- [x] 初始未读、成功读草稿、固定历史/他会话读取、未建草稿/baseline、成功写后继续、外部手工保存、旧 head 冲突。
- [x] 批量全部成功、第二项缺几何/离线/修订改变、重复 target ID、撤权、取消、内容容量、来源重查后用户保存；任何失败整批无写入。
- [x] 同输出多写入/read-write、失败/成功回执、相同 ID 改意图、权限撤销后回执读取、断连/重启不重放。
- [ ] 业务意图全部达标：已有命名层/新层/同名澄清及固定参考已验证；真实模型多候选无目标 0/2，保留未通过。点/线/面/文字沿用既有几何及桌面回归，不冒称四类均有新的真实模型专项。
- [x] 新旧历史/Skill 混合、说明摘要不含全图、压缩后必须重读、普通聊天无需地图 Skill。
- [x] malformed Markdown、无 Markdown、回执缺失、重复来源、多个保存版本、跨请求混入、历史来源与当前状态差异。

在 experiments/harness-lab、Node 24：

```sh
npm run typecheck
npm run lint
npm test -- tests/annotation-from-source.test.ts tests/annotations.test.ts tests/annotations-acceptance.test.ts tests/pi/annotations.test.ts tests/pi/annotation-source-history.test.ts tests/context-http.test.ts tests/agent-framework-boundaries.test.ts tests/probe-source-annotations.test.ts
npm run build
CI=1 AXON_E2E_PORT=5299 npx playwright test tests/e2e/annotations.spec.ts tests/e2e/situation-map.spec.ts --workers=1
```

新增时序/Skill兼容/结果引用用例加入实际命令；相关现有资源与历史测试按影响范围纳入。使用固定本地瓦片和独立端口，不复用已启动旧页面。

## 6. 固定真实模型验证计划（实施后执行）

沿用已授权的本机 DeepSeek 与合成来源，不传业务资料或凭据到第三方执行服务器。执行前固定语料、模型设置、工具定义/Skill hash；每案独立账号/任务/会话，无人工纠错和自动审批。计划 11 个独立 case，不因失败追加批次：

- 3 轮完整地图主流程：换用不同任务/图层/对象名称，查询三个来源并一次导入、明确发布、来源变化后保 ID 刷新。至少一轮从没有草稿开始，不全靠预建层。评分包含实际几何、时间、来源版本、一个批次一个修订、旧发布/任务当前不变。
- 4 对图层意图变体（共 8 案）：指定已有层、明确创建新层、同名层歧义、未给唯一层的歧义。每个变体分别用同一新版工具/模型配置，在地图 Skill 可用和不可用两种隔离测试配置下运行；只改变 Skill 暴露。歧义案记录 ask_user 后取消，不替用户选择。

对照要分开记录 Skill 是否被发现/读取、读取后是否遵守、业务效果以及调用/用量成本。4 对只是诊断样本，不宣称有统计显著性或证明唯一原因。layerId 通过真实读取工具返回；业务提示不提供正确 ID 或工具序列，不写固定答案。

几何缺失/来源离线的服务边界在确定性测试及上一阶段证据中保持；本批次不声称又做了新的模型专项。任何新发现保留，另行讨论，不暗中换模型、调整提示后选择最好结果。

## 7. 交付与审阅

交付改进代码、短地图 Skill、实际工具契约、兼容测试、固定批次完整证据、逐案语义报告。源码检查通过、模型流程完成、业务意图遵循分别评分。未执行的项目不得预先打勾。

不在本阶段自动提交上一阶段代码、不部署。用户已审阅并授权实施，交付时如实报告全部检查和模型行为。

## 实际交付

代码/规范/驱动已完成；确定性检查和桌面 14/14 通过。固定 11 案已执行，主流程 3/3 完成，图层意图 6/8；Skill 读取 2/7 个可用 case，空草稿起步出现 8 次保护性拒绝。完整记录见 [validation.md](validation.md)，审阅见 [review.md](review.md)。没有因模型失败更改语料追加批次，不标记全面业务验收通过。
