# R2 机械证据审计（非语义评分）

日期：2026-10-18。只读原始证据，未调用模型、未读取主审或独立审阅语义分数。

批次：`.local/spatial-r2/live-20261018-r2-01`；冻结HEAD：`13d65ced4efb0fe97cff1d80dd795e49f7336a90`。

计划48项，全部结束：True；实际207次provider请求；HTTP状态：{'200': 207}。
输入3,917,123 token（包含缓存命中），输出32,357 token；与预算账本逐笔一致：True。

| 组别 | 请求 | 输入token | 输出token | isError记录（含取消） | 原生Skill读取记录 |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 69 | 1304846 | 11715 | 2 | 0 |
| map-only | 68 | 1295089 | 9668 | 4 | 0 |
| spatial-only | 70 | 1317188 | 10974 | 2 | 0 |

## 来源、夹具与模型输入

核对268个冻结来源hash，三组runtime各246文件；baseline无差异，map-only/spatial-only只改变各自一个Skill文件。所有48实际fixture按用例比较三组document与oracle元数据，结果详见JSON。目录metadata忽略正文hash后相同。

实际模型、thinking、输出上限逐请求检查；父Agent工具schema只有一个哈希。首包及每轮首请求逐字核对显式选中的Skill正文，并逐包记录另一Skill是否真正曝光。原生readSkills的hash另外核对。

- **map-only**：候选实际曝光 J02, J03, J08, J09, J10, V02, V09；首包曝光 J02, J03, J08, J09, J10, V02, V09；未曝光 J01, J04, J05, J06, J07, J11, J12, V04, V12。
- **spatial-only**：候选实际曝光 J01, J04, J05, J06, J07, J11, J12, V04, V12；首包曝光 J01, J04, J05, J06, J07, J11, J12, V04, V12；未曝光 J02, J03, J08, J09, J10, V02, V09。

未曝光用例不能归因于候选正文；曝光也不代表模型遵守或效果提升。

## 实际效果与独立几何核对

核对60个turn状态，独立重建允许变更并核对实际完整document、publication、current和binding身份；涉及另一个会话的状态逐值比较。没有把driver的effect=true直接当作独立结论。
检查9个点buffer、共1161个顶点；独立haversine采用R=6371008.8m，最大半径误差1.8189325601269957e-09m。

J06首轮固定范围续用：

- J06-spatial-only：复用首轮geometry=True，buffer结果数=1，filter结果数=1。
- J06-baseline：复用首轮geometry=True，buffer结果数=1，filter结果数=1。
- J06-map-only：复用首轮geometry=True，buffer结果数=1，filter结果数=1。

J07首轮预览实际保存：

- J07-baseline：逐值几何与名称一致=True，保存对象数=1。
- J07-map-only：逐值几何与名称一致=True，保存对象数=1。
- J07-spatial-only：逐值几何与名称一致=True，保存对象数=1。

工具错误原始记录分类：{'ANNOTATION_READ_REQUIRED': 5, 'EXPECTED_BOUNDARY_CANCELLATION': 3}。其中ask_user停止是预设边界提问后的驱动取消记录，不能算成工具故障。

## 证据索引与历史保留

本批原始证据SHA256索引覆盖1487个文件：[r2-evidence-index-20261018.json](r2-evidence-index-20261018.json)。覆盖provider输入/SSE/元信息、每轮输入/SSE/effects/前后状态、fixture/manifest/resources/final/native和协议预算账本。runtime源码不重复纳入，索引包含三组runtime-integrity.json；其before/after逐文件hash已另行核对，不遍历node_modules。

校验方式：在工作树根目录读取索引，对每个相对路径的原始文件按SHA256计算并与值比较；完整机械检查可运行本报告所链Python脚本。原始证据位于上述.local目录，未复制或改写。

历史R1检查：{'round1-live-evidence-index.json': 1275, 'round1-supplement-evidence-20261018.json': 48, 'trackedR1ArtifactsSinceApprovedPlan': []}；原始批次和补测索引全部匹配，已批准方案746d4cc之后R1冻结驱动/报告没有变更。

## 审计异常与边界

机械证据异常数：0。
本次机械检查未发现异常。

工具错误计数包含可恢复错误，不自动判语义失败；正确计算或保存也不代表全部可见解释正确。独立核验J06/J07关系并不代替其他题目的语义评分。完整逐项事实、请求hash、曝光、token、效果及几何误差见[JSON](r2-mechanical-audit-20261018.json)。

审计脚本：[mechanical-audit.py](r2-engineering-evidence/mechanical-audit.py)。
