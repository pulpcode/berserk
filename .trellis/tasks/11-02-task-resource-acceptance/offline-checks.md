# 离线检查记录

无真实模型调用。所有模拟提供方检查只证明评测器和真实产品回路，不证明模型业务正确率。

## 首次检查及修复

- scoring.test.ts 首次 11/11 通过。
- 任务 TypeScript 首次失败 TS5097（scoring.test.ts .ts 导入），已修。
- 首次 ESLint 两项失败：provider.ts models prefer-const、run.ts CaseId unused。已通知 runtime owner 修其所属文件；最终复查待记录。
- 评分结构门槛补充后 scoring.test.ts 13/13 通过。
- `tsc --noEmit -p .trellis/tasks/11-02-task-resource-acceptance/tsconfig.json` 通过。

## 待完成

真实本地HTTP、12题建模/采用/受控导入、SDK多轮与原生重试、未知用量停止、浏览器两步引用、最终冻结与全量离线回归。正式oracle只在运行器冻结后做解释核对。

## 复核者补充检查

- 新增 provider-check.test.ts，6/6通过：原始 init 同一对象与响应字节；HTTP/SSE 缺失用量后下一实际请求计数不增加；断流/取消失败保留；计量503可保留失败并继续，401/429阻止；跨Provider持久版本校验；240请求/800万输入/100万输出预留门槛。
- 任务 TypeScript 与 ESLint 再次全部通过（含 browser/runtime 新文件）。
- C05 构造题干按原审阅建议明确为“已分配且可用交集”，仅更新该原始快照 SHA，不改答复/预期/判分。
- runtime owner 的全量实际HTTP/SDK测试尚在运行；已收到其报告12题建题和coverage通过，多工具回路一项断言待修。最终结果尚待记录。

## 最终运行器证据（报告适配器之前）

- `checks/offline-tests.txt`：42/42通过，0失败；其中fixtures 11、observer 6、runtime 12、scoring 13。复核者已检查完整日志和对应代码，未重复占用相同服务端口。
- `checks/scheduler-tests.txt`：1/1通过；源 `run-gates.test.ts`。实际 prepare/execute 调用检查 readiness、前序排期、终答复核文件、原生历史拷贝和整题不重跑；提供方为本地确定性返回，0付费。
- P01浏览器证据独立审阅通过，见 review.md 和 browser-offline-notes.md；1次确定性请求，与计划中的真实P01分开。
- 最后静态发现 run.ts 在 await browserWork 后可能吞掉后置截图/断言错误；已协调owner增加 await 后错误再检查，并在所有分支后统一检查 ledger halted。
- 新增报告适配器及正式freeze后oracle核对尚待最终审查。此处不声称通过模型业务验收。

## 冻结后检查

- 已核验正式protocol的所有执行文件hash一致；未改冻结材料。
- 冻结后独立阅读oracle，并再次运行fixtures 11/11通过；不额外计入43项独立测试数。
- 运行前评分解释与paid-readiness结论见review.md。公开4项门槛及正式16项独立评分仍需实际执行，不由离线检查替代。

## 独立后处理适配器

report-materials.ts/.test.ts 在execution freeze后作为独立只读后处理补充，输出pending语义复核，不修改执行条件。复核者检查代码并独立运行6/6通过；定向发现public工具名为skill.read而非native skill_read，已由owner修正两者映射并补真实形状检查。最新全任务ESLint通过；任务TypeScript通过。累计独立离线检查49项（43执行/评分/数据＋6后处理），不重复计数重跑。

## 全批完成后的最终复核（权威收尾状态）

前述“待完成”均为当时的检查历史，不代表当前仍未核对。本复核阶段没有新增真实模型调用，也没有修改冻结产品或执行文件。

- 只读后处理最终13/13通过（report-materials + compile-reviews），日志 `checks/checker-postprocessing-tests-final.txt`；累计独立检查 **56项＝43执行/评分/数据＋13后处理**。重复执行不重复计数。
- 全任务TypeScript通过，日志 `checks/checker-tsc-final.txt`。ESLint首次从仓库根调用缺配置（原失败日志 `checker-eslint-final.txt`）；明确使用现有 `experiments/harness-lab/eslint.config.js` 后全任务通过（`checker-eslint-final-with-config.txt`）。没有为通过检查改冻结代码。
- 最终hash复核：15个执行材料、319个冻结运行时文件、14397个锁定依赖包文件全部相符，0漂移；详见 `checks/checker-final-integrity.json`。产品修订 `12e1cc9`，product-freeze SHA256 `74187029ff31091d9d83a1cc5c9e2aa1c5880a23f74cd5cd64cb3314c81509fd`，protocol SHA256 `dc3090d99360470b8dd73bc9116bc39a2b2cfd0b3b3cc2ace57a81fb99ad20fd`。
- 全20任务均有终态快照、状态前后与结果记录，状态前后一致；逐题请求文件数与账本90次尝试相符，用量2,900,996 input / 57,986 output。详见 `checks/checker-final-evidence.json`。
- 19题全部公开工具payload可在其后实际provider输入中逐字找到；A06-2宿主在资源结果校验失败后安全停止，最后2条工具未送入新模型请求，原生历史及公开错误仍完整保留，这不是漏录或新的未计量调用。
- 公共4题审阅是 `records/P01-review-check.md` 至 P04，同名formal first-review不存在并非漏审；正式16题独立第一审JSON全部存在、证据hash重核一致。

A06-2暴露冻结产品边界缺陷，不能由离线测试通过掩盖：task目的查询保留unconfirmed记录，但汇总已过滤为空，producer误留entityCount=0，validator要求null。真实调用已保留失败，不重跑，计入16题分母。只读原始validator复现false，内存clone仅把0改null即true。证据/诊断见 `records/first-review-A06-2.md` 与 `A06-2-integrity-diagnostic.json`。本次不修产品，后续另立修复及回归。
