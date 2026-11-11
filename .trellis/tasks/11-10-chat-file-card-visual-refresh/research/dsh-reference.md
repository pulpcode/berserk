# DSH 交付文件展示参考

检查日期：2026-11-10。参考仓库：`deepseek-ai/deepseek-harness`，固定提交 `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`。本文件只记录设计证据，不复制其组件代码或引入其运行时。

## 一手来源

- [Deliverables.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/ui-deliverables/src/client/Deliverables.tsx)
- [Deliverables.module.css](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/ui-deliverables/src/client/Deliverables.module.css)
- [PresentedFileCard.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/ui-deliverables/src/client/PresentedFileCard.tsx)
- [ui-deliverables README](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/ui-deliverables/README.md)

## 已核实的 DSH 设计

- 单文件使用单列并占满交付容器；多文件默认两列，间距 10px，容器不超过 620px 时切为单列。
- 超过 4 个交付文件时默认显示前 4 个，可展开全部并再次收起。
- 卡片高度 60px，padding 为 8px 10px，图标块为 40×40px、圆角 10px；文件名和描述分别具有固定字号、行高与字重。
- 卡片使用主题化浅表面、细边框和 hover 背景过渡；整卡有独立预览按钮和焦点环，右侧操作区由插槽注入。
- 准备阶段是单行状态，交付卡片在轮次收尾出现；打开、错误、重试等状态复用卡片描述区域。
- 整卡预览、右侧边栏、原生应用打开、右键菜单和变更评审依赖额外数据与宿主能力，不属于纯视觉样式。

## 本地适配取舍

- 不采用 DSH 单文件整行宽度。用户在 2026-11-10 确认保留内容收拢和 480px 上限，并增加容器允许时约 320px 的最小宽度。
- 不照搬固定 60px 高度或单行省略；采用最小高度并允许完整文件名换行，以满足现有完整可读约定。
- 借用图标块、文字层级、多文件网格、4 项折叠和克制的 hover/focus，不引入预览、侧边栏、原生打开或右键菜单。
- 仅合并相邻且同请求的固定交付文件，不重排历史或跨消息边界分组。
