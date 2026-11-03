# 独立执行前审阅

审阅者：acceptance_preflight_review（AI辅助复核，未参与本轮运行器/评分实现，不是真人盲审）。范围：已批准4公开＋16正式槽位；模型调用0；产品与Skill冻结333cb5161ccd991d586c832430d96c7c18cdee5a。

最终结论：执行前复核通过，无未解决阻断项。可冻结当前执行材料并开始已授权的4项公开检查；16项正式执行仍须真实公开流程证据与public-gate审阅通过。此结论是运行准备就绪，不是模型成绩、工具live门槛通过或整体验收通过。

## 已核对

- 先读任务PRD/design/implement、check.jsonl列出的批准范围与规范，再比对cases.md、cases.ts与fixtures.ts。逐题原文、全部初始引用、来源/标绘名称与ID、成员、坐标、条件及相对时间符合题包。原资源properties.memberRefs移除是合法契约修正，成员coverage和单体名称位置仍保留；未偷换业务事实。
- 独立读取校准的user/evidence/process/fault/final字段，屏蔽annotation/expected/category后先记录13项判断，再读取预期。13/13主任务、解释、严格、过程及工具硬门槛一致，见checks/checker-calibration-first-pass.json与checker-calibration-comparison.json。该过程是AI独立复核，不是独立人类标注。
- 在读oracle.json前先核对输入事实；随后用有限集合并集与矩形边界人工核对：N02并集5，N03车辆重叠未知/舟艇5，N04可确认交集只有桤岸1辆，N05车辆与舟艇成员各4且各范围位置独立，N07西区内部3边界1/东区内部2边界2，N08首轮实际资源2点/次轮全层4点。无调用产品统计函数生成预期。
- 来源为真实HTTP序列化，ContextService负责合法解码；分页先筛选，响应limit保持请求值，pageLimit只控制实际页大小；N01末页partial不会变成完整，青埠为独立complete空页。标绘由真实AnnotationService创建，N02/N04副本由fromSource产生关联与回执，未手填resourceAssociation。
- 每槽独立SQLite、账号认证、实际taskId/sessionId、草稿和文件目录；同名席位仅在独立数据库内复用。T0来自实际本地只读HTTP时钟，业务相对时间可平移；平台createdAt/ref、queriedAt与真实来源响应时间另存。初始1小时/总体24小时窗口保留，不改运行中事实。
- 追问经reviewedContinuation核对实际消息/interaction身份与原句；无问号启发式。普通文本走同会话后续用户消息，结构化问答走真实questionId/optionIds响应。未获准事实不临时生成。
- 复用预算在出网前保守预留，原生每次HTTP重试单独入账；未结算或未知usage阻断恢复，模型漂移/未核准出网/限额认证失败停止后续；240请求、800万输入、100万输出上限固定。已有槽目录拒绝整题重跑，人工进展审阅不自动补题。
- v2语义审阅纳入全过程，不用工具成功替代答复；无最终答复主任务/严格失败、解释N/A，先前过程错误仍保留；正式分母固定16，主任务/严格各15及四关键16，同题不得双失败。工具三类门槛独立，模型纠正不消除工具回归，离线成功不能替代公开/正式实际路径覆盖。
- 报告导出仅作辅助，trajectoryComplete/evidenceVerified默认false，原始来源分页、控制器、原生会话与状态证据仍须逐槽核对。公开流程放行须审阅P01/P03/P04实际证据，不能从总分推定。

## 发现与协同修复

1. run.ts只对annotationSelections走浏览器，导致N03四个初始来源引用经API直接注入；browser.ts也要求draftRef，不能执行source-only引用。已由运行器负责人修复：任何annotationSelections或contextRefs均走浏览器，source-only不要求草稿；browser-c的N03四引用真实发送并留在原生用户消息，与原题完全一致。
2. runtime.ts原dependencyHashes仅冻结pi-ai/pi-coding-agent包且跳过symlink，未冻结实际传递依赖。已由负责人改为完整安装树递归跟随symlink并记录目标/内容，冻结Node及实际Chromium完整bundle。浏览器显式使用被冻executablePath；更换为该实际二进制后的P01在browser-d通过。symlink内容变更测试通过。
3. 原P04离线测试只做offset3读取，不能证明题包要求offset2/limit2和offset0/limit2。负责人已补充并通过精确双读与旧records/revision保持不变的断言；N02真实原生结果quantity=5且受控关联保留，N03两组quantity分别未知与5，N08同固定图层两轮原生工具均成功。

4. 同步完整依赖扫描约11.5秒占用主事件循环时，N03出现本地来源fetch ECONNRESET，provider观察器停止后续出网。原始失败工具返回如实保留另一来源的舟艇5与部分覆盖，不能误报成数量算法回归。负责人将相同完整hash函数移到独立Node进程，运行前逐次await比对完整baseline；受影响N03检查随后通过，未延长超时、弱化hash或修改产品。失败日志及原生快照均保留。
5. 浏览器元数据此前对N02/N03列出了仅P01生成的截图名；已改为按真实生成项记录，并同时列出实际来源引用。

以上变更全部由原文件负责人处理，审阅者不覆盖并行编辑。无产品/Skill变更，不需要同步产品spec；本任务review记录执行器问题及修复证据。

## 验证

- 本轮fixtures/scoring/report-materials：36/36通过。
- TypeCheck：任务tsconfig通过。
- Lint：从仓库根目录显式使用experiments/harness-lab/eslint.config.js，13个任务TS文件通过。最初从包目录执行产生outside base path忽略警告，该次不计入验证。
- 复用provider/v2评分测试：16/16通过，见checks/checker-provider-v2.log；同主会话的重复检查不累计成新增测试项。
- 修复后最终TypeCheck与Lint均exit 0，见checks/checker-final-typecheck.log、checker-final-lint.log。产品/Skill目录无diff。
- 运行器初始6项通过摘要：checks/runner-initial-summary.json（运行器保留的stdout摘要，不冒充原始日志）。覆盖12题真实HTTP解码/分页/导入、P02 native空统计与read、普通与结构化真实追问等。
- 增强P04双向read及N08两轮：checks/runner-targeted.log各项通过。该日志同时保留随后已修复的symlink路径断言失败与N03传输失败，不隐藏失败组记录。
- symlink真实路径/内容：checks/dependency-freeze.log通过。N02成功原始快照独立核对：checks/checker-n02-native-evidence.json。N03修复后通过：checks/runner-quantity-async-verify.log。原始local ECONNRESET：checks/runner-quantity-cause.log；工具有限结果检查：checks/checker-quantity-failure-evidence.json。
- 浏览器：/private/tmp/resource-independent-browser-20261103-c 的P01/N02/N03实际发送与原生引用一致；/private/tmp/resource-independent-browser-20261103-d 的P01验证最终固定二进制，见checks/browser-explicit-binary.log。原件hash与引用见checks/checker-browser-evidence.json，已查看P01普通点击无引用及N03四来源chips截图。外部底图请求被评测隔离策略阻断，这不是底图加载功能验收。
- 未运行真实模型；不据确定性提供方回答评分。后续必须保留20槽、真实usage、双份原始轨迹AI/人工审阅身份及工具路径覆盖，缺覆盖标未充分验证，不自动补跑。

本文件完成后交由主会话freeze；live开始后不再修改。后续运行与审阅证据写records/、checks/或未冻结的report.md/execution-notes.md。
