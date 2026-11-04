# Bug Analysis: 泳道图滚轮缩放占用平移手势

日期：2026-11-04。用户要求修复“滚轮放大缩放后无法再滚轮上下调整”。本轮不 commit/push。

## 1. Root Cause Category

- **Category**: E 隐含假设 + D 交互组合测试缺口。
- **Specific Cause**: 原 wheel handler 对所有普通滚轮调用 preventDefault 并执行 zoom；平移只有拖动／方向键。此前只证明了滚轮会缩放，没有覆盖用户放大后继续用滚轮移动内容的实际操作。
- 代码证据可以直接解释行为，非后端读取、权限或滚动条数据问题。

## 2. Why Fixes Failed

此前实现把“支持滚轮缩放”当成滚轮唯一用途，未分配普通平移与修饰缩放两种输入。此次在 wheel 所属组件修正，不在页面外层补偿滚动。

## 3. Prevention Mechanisms

| 优先级 | 机制 | 行动 |
|---|---|---|
| P0 | 输入契约 | 普通滚轮／触摸板平移；Ctrl／Meta+滚轮缩放；Shift+滚轮横向 |
| P0 | 组合回归 | 放大后释放修饰键再滚轮，比例保持而 Y 改变；验证指针锚点 |
| P1 | 消费边界 | Alt、浮层控制区、画布外及零增量不被无差别 preventDefault；浏览器键盘快捷键保留 |
| P1 | 可发现性 | 在缩放图标悬停提示中标注快捷操作，不增加常驻说明文字 |

## 4. Systematic Expansion

修复限于工作泳道图和其浏览器回归。地图继续使用既有地图 SDK 交互，不批量改写。静态方案原型是历史视觉材料，实际交互以本轮修订后的 PRD／设计／code-spec 为准。

## 5. Knowledge Capture

- 已更新 `.trellis/spec/backend/workbench.md`，明确平移／缩放修饰键与事件消费边界。
- 已同步当前子任务 `prd.md` 与 `design.md`。
- 类型检查、受影响两份文件 ESLint、定向相机综合浏览器回归、构建、diff 检查通过；独立复核未发现待修问题。回归包含 Meta、零增量、Shift、消费边界及缩放后滚动。
- CUA 在实际 4316 页面放大后，滚轮向下使 Y 从 -145.304 变为 -391.304，scale 均为 1.29274；向上滚动后 Y 回到 -145.304，scale 不变。
- [修复后的实际预览](screenshots/wheel-pan-fixed.jpg)已保存，最终 dist 已更新。本轮未 commit/push，无模板目录需要同步。
