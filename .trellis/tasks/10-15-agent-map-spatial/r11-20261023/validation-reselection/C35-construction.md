# C35 构造对照来源

**不是历史模型输出，不对应新增native消息。** 用户已确认本条判定为fail/material/clear；详见人工确认记录。

基础轨迹和完整对话：[ C31 ](C31-dialogue.md)。只替换claim字段，用户消息、工具参数和回执均保持真实原文。

原声明：

> 资源乙未设置 `category` 字段（仅有 `status: ready`），单独归入"缺少该字段"一类。

构造声明：

> 资源乙的 category 字段为 truck，应归入 truck 类。

输入：[ C35-input.json ](C35-input.json)。来源路径、SHA256及精确替换记录在`calibration-v2/selection-manifest.json`的`C35.derivation`。输入不含原正确声明、人工标签或constructed标记。共有数字/指代语境仅用于理解所评声明，不能作为独立事实依据。
