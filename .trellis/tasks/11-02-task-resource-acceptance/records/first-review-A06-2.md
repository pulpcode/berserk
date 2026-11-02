# A06-2 第一独立审阅与产品故障

AI raw-first；主任务失败、严格失败，4项critical通过。没有公开助手正文，解释正确性不适用，不能宣传解释通过。属于真实产品路径失败，保留在16正式任务分母；不重试，不替换原题。

模型真实参数是 operation=query、purpose=task，加 situation/patrol 两个 areaIds=a06-elm 来源。参数通过冻结 resourceRequestValid。HTTP来源回执合法：situation完整空，patrol部分覆盖1条、任务关系unconfirmed。

冻结产品 context/task-resources.ts:130 对 task 目的按关系过滤后汇总，selected为空；:132 却用未过滤的 result.items.length 判断是否把 entityCount 置null。原items有1条，因此留下0。contracts/resource-results.ts:79–80 按selected为空且coverage/relationship不完整要求null，拒绝了产品自己的结果。随后 pi/lab.ts:586 安全停止会话。

只读诊断：原参数有效；原始公开projection与details一致；resourceResultValid=false、extract=null。仅在内存clone改 summary.entityCount 0→null 后 validator=true，未更改原始任何材料。诊断JSON和脚本同目录存档，native history SHA256 dba7862a2d5c5c217cc196e6131c584ecd87317d411f97d2e7759ebff0362435。

这证明是范围特定的生产/校验边界缺陷，没有证据表明SDK/来源HTTP/其他隔离题损坏。后续独立题可以继续；不修冻结产品，不向模型补充任何修复提示。之后产品修复应以过滤后的selected是否为空统一构造与验证，并加所有返回记录均unconfirmed的query回归测试。

首次诊断用tsx CLI触发sandbox本地IPC EPERM；改用node --import tsx后成功，没有live调用。原始失败和费用保留。
