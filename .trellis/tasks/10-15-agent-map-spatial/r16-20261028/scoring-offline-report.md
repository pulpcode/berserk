# R16 评分辅助工具离线检查

2026-10-28。仅实现评分、证据包装与离线统计，没有模型调用、没有修改产品或历史R15文件。

## 完成内容

- `review-tools.ts`：复用R15已验证的Score/strictOf/validateScore/publicMessage；新增24题×4组×3次的槽位与配对校验。每组分母72，缺失不删除，语义结论不依赖原始执行标签。
- 汇总修订集36、新集36、业务66、简单6及8种题型；按题显示每次结果和0/3—3/3。任一分项待定的题单列未完整，不因另一分项已失败就伪装完整。
- 主比较GST−G0，四个诊断比较；题目成组的固定种子10000次bootstrap。任意配对有缺失/待定维度不输出区间，不将它当失败补数。描述性合用差异同样要求完整。
- 独立复核覆盖失败、待定、同题组间/重复分歧以及25%通过抽样；名单从初评冻结，终评汇总不隐式重新抽样。
- 盲评去除标签及私有思考，保留公开证据、缺失说明、原题和额外澄清次数及逐轮账本；映射只保存评测侧。不同工具封装可能使版本可被推断，未承诺绝对盲。

## 检查结果

10条离线测试全部通过：严格与分项一致、固定分母、同题同重复配对、跨重复分歧抽样、成组置信区间、业务门槛、边界违例、身份和重复拒绝、去除私有思考/盲评账本、已知失败不能掩盖缺失维度。

评分两个TS文件的ESLint通过。首次全目录类型检查发现本模块outcome推断为string造成索引报错，已显式收窄；评分模块独立TypeScript检查通过。全目录检查时其他代理仍在编写cases/live测试，发现其联合类型收窄错误已通知所属实现者；本报告不把当时全目录状态写成通过。

`offline-review-calibration.json`内8条真实R15终评均通过Score格式和分项一致性验证；四条构造对照独立标识。历史原句、理由、证据引用与三个来源文件哈希保留。校准不等于新的模型得分或人工金标一致率。

## 可执行命令

以下从仓库根目录运行。只包装或汇总已有证据，不触发模型。输出路径必须尚不存在；禁止覆盖旧评审。批次runs.json必须含完整288槽位，包括未执行槽位。

```sh
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs --test .trellis/tasks/10-15-agent-map-spatial/r16-20261028/review-tools.test.ts
./experiments/harness-lab/node_modules/.bin/eslint --config experiments/harness-lab/eslint.config.js .trellis/tasks/10-15-agent-map-spatial/r16-20261028/review-tools.ts .trellis/tasks/10-15-agent-map-spatial/r16-20261028/review-tools.test.ts
./experiments/harness-lab/node_modules/.bin/tsc --noEmit --project .trellis/tasks/10-15-agent-map-spatial/r16-20261028/tsconfig.json
```

证据及评分命令（将大写路径替换为实际绝对路径，不要将占位符原样执行）：

```sh
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs .trellis/tasks/10-15-agent-map-spatial/r16-20261028/review-tools.ts blind BATCH_DIRECTORY NEW_BLIND_DIRECTORY
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs .trellis/tasks/10-15-agent-map-spatial/r16-20261028/review-tools.ts select BATCH_DIRECTORY NEW_SELECTION_JSON INITIAL_SCORES_JSON
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs .trellis/tasks/10-15-agent-map-spatial/r16-20261028/review-tools.ts summarize BATCH_DIRECTORY NEW_RESULTS_JSON FINAL_SCORES_JSON
```

Score文件为`{"rows":[...]}`，使用review-rules.md及tasks.md对公开证据人工式逐项评审。初评、独立复核和最终裁决分别保存。`diagnosticGatePassed`只是本轮门槛，不是上线授权；主比较的稳定改善与候选达到90%是两个不同问题。

## 后续仍需

执行者在离线总检查后才冻结评分文件；真实任务结束后完成语义评审和独立复核。不能用测试中构造的全通过Score代替真实评分，不能用未触发的工具提示宣称工具效果改善。
