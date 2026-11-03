# 本轮对照工具

这些脚本是独立测评驱动和离线汇总工具，不属于产品执行循环。首次运行因方舟429额度不足停止。用户随后授权恢复补测；恢复使用新的隔离运行目录，旧中断不覆盖。

- `run.mjs`与`verify-provider.mjs`：读取既有本机LLM配置到子进程环境，不复制凭证；限定完整方舟URL和模型，原输入只读，保留每次尝试。`finish-suites.mjs`仅排队执行固定变体，本轮已因上游失败退出。
- `collect.py`/`summarize.py`：收集真实请求、Pi记录、API快照，输出正式结果供独立核验。
- `metrics.py`/`output-breakdown.py`：离线统计请求、工具、用量、失败、压缩及输出回合；失败尝试的配置模型不计作实际响应模型。
- `score-notifications.py`：按已冻结oracle统计固定提醒；未发布尝试单列，不补成语义正确或提醒错误。
- `summarize-scores.py`：验证独立逐格评分数量、唯一性并汇总；中断样本标partial，不能进入完整配对比较。
- `attest-runs.py`/`archive-evidence.py`：记录实际请求参数并归档原始证据与哈希。

脚本副本在这里便于Git审阅；实际运行目录是`experiments/harness-lab/.local/continuous-validation/quality-20261028/`，离线Python汇总从脚本所在目录读取运行数据。原样本、变体输入以及旧新源码隔离副本均已保留。`run.mjs`可通过QUALITY_RUN_ROOT指定已准备好的运行根目录；本轮状态文件会阻止覆盖既有尝试。后续恢复测试应使用新的运行标识与证据目录，不能删除失败状态来重跑到通过。

## 恢复与离线整合

实际恢复目录为`experiments/harness-lab/.local/continuous-validation/quality-resume-20261028-205505/`。`resume-suites.mjs`按new、old-variants、new-variants串行驱动8次补测；任何上游失败或阶段未完成即退出，不自动重试。运行中实际使用的原文件保留在恢复目录，其manifest记录resumeOf和授权时间，phase状态与日志记录开始结束时间；最后一次额度失败退出，未生成完成文件。

此处的`resume-suites.mjs`是安全审阅副本，**必须显式提供QUALITY_RUN_ROOT**，没有参数就立即退出；不要把仓库审阅目录当作运行根目录。该根目录须事先备好冻结源码、输入、manifest和成功预检。副本仅增加显式根目录保护，不回写或替换已经执行的历史驱动。

`merge-resume.py`仅做离线合并，参数依次为首次运行根目录、恢复根目录；它将原样本6对与完整变体2对分组；第三变体仅相同前缀30格探索性比较，旧partial永久单列，不拼接前后轮次。`summarize-scores.py`保留全部评分notes和原生/正式差异；`score-notifications.py`按冻结fixtureHash选择对应oracle，不把变体套入原文本任务矩阵。

最终恢复阶段7完整、1额度中断；与首次10完整、1中断合计17完整、2中断。没有自动重试。`resume-ledger.json`保留全部阶段状态、两次失败和独立预检用量。

## 最后一组独立补测

2026-10-29运行目录为`experiments/harness-lab/.local/continuous-validation/quality-final-20261029-092754/`。仅执行`new-variant-shared-object-complete`，从R0新隔离会话完整运行。实际驱动相对前阶段仅将变体列表收窄为shared-object、run标识增加-complete；探针、产品和输入未改。`final-run.mjs`为要求显式QUALITY_RUN_ROOT的安全审阅副本，不能替换已经执行的原文件。实际文件与副本哈希分别见`final-driver-provenance.json`。

`merge-resume.py`接受按时间排列的两个或更多运行根目录，只在最后目录写合并结果；三阶段运行时，前两阶段统计文件保持原样。完整的-complete运行进入共享对象主对照，旧partial与其相同前缀探索性结果仍保留，不拼接轮次、不删除失败。若最后运行仍不完整，不把20次尝试写成18完整；按实际发布结果和独立评分汇总。空第三阶段已验证逐字段保持此前聚合结果不变。

最后一组已于2026-10-29新加坡09:37:15完成：12批36格、66请求全200。三阶段实际20次＝18完整＋2历史中断，最终离线产物在quality-data/final-*；语义与提醒仍有失败，运行完成不等于质量通过。
