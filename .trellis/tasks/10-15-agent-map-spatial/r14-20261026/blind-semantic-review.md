# R14 已返回 8 项的离线盲审

只读取盲审目录的 index、judge-input、model-visible-evidence、completion，依据冻结评分规则判断。未读取 batch、分组映射或私有思考，未调用模型、修改冻结代码、继续测试。所有工具回执都在对应最终生成前的实际 wire 历史可见；8 项状态快照均未改变。

**主任务 8/8；严格正确 7/8；事实失败 1 项；待定 0。** 这里只是已返回的 8 项，不是计划 144 项的整体正确率，也不能比较组别或声称稳定效果。

| 盲审 ID 前缀 | 题目 | 主任务 | 过程事实 | 最终事实 | 影响/边界 | 严格 |
|---|---|---|---|---|---|---|
| 02140b65 | D01 | pass | pass | pass | pass/pass | pass |
| 0a61083e | D03 | pass | na | pass | pass/pass | pass |
| 1ea89df1 | D02 | pass | pass | fail | pass/pass | fail |
| 4b156603 | D01 | pass | na | pass | pass/pass | pass |
| 4d3385cf | D02 | pass | na | pass | pass/pass | pass |
| 5a6a8965 | D02 | pass | na | pass | pass/pass | pass |
| e2ad5325 | D01 | pass | na | pass | pass/pass | pass |
| fb5ece85 | D03 | pass | pass | pass | pass/pass | pass |

## 唯一明确失败

`1ea89df1`（D02）主任务正确，但最终说：

> 我直接按图层 ID 和对象 ID 定位，没有按显示名称查找。

实际 `visibleTranscript[2]` 的 annotation_read 参数使用 `layerNames:["planned-points","draft-zone"]`，返回 `ANNOTATION_LAYER_NAME_NOT_FOUND`；随后才改为整体读取和对象 ID。最终绝对否认曾按名称查找，与真实过程矛盾。因此最终事实和严格分失败，主任务、实际效果、边界通过。精确完整路径见 JSON。

## 停止标签不能代替语义判断

`fb5ece85`（D03）的 completion 是 `waiting_user`、完成轮数 0，但全文已使用正确草稿区域和来源资源，分类后列出港北车组、东侧车组，共2点，符合唯一一轮要求。

> 如果你指的是别的东西，请告诉我。
>
> 如果你需要把结果保存到草稿图层，请告诉我目标图层。

这两句是结果给完后的条件邀请，没有把本题答案挂起。“需要你确认的两点”标题不必要、容易触发程序误停，记表达问题。不能据此把已完成主任务判失败。

## 其他口径

- “我会先…／我改为…”按未来方法意图理解；不因一次工具参数错误而自动判事实失败，核对是否随后纠正、最终是否完成。
- `02140b65` 的“对象类型限定为resource”结合随后明确承认原查询含区域/道路/资源，可理解为统计口径，不强判成服务器使用objectType参数。
- D01 查询材料包含有效时间与asOf。报告当前查询模式或引用快照不等于承诺现实可派遣；这批没有凭空增加此类承诺。
- D03 允许来源和草稿有各自时间；未把来源asOf的简写硬判成两个来源共享同一版本。

这些是本轮盲审判定，仍应纳入独立复核；本文件不修改任何原始完成记录。
