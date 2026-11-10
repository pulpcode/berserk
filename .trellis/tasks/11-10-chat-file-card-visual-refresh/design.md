# 聊天文件展示视觉优化：技术设计

状态：待审阅。实现范围对应 `prd.md` 的 R01–R03。

## 1. 边界与现状

只改末端展示：

```text
现有 SessionSnapshot.fileOutputs / messages
  → conversationItems（原有归属）
  → chatBlocks（新增相邻同请求文件视觉分组）
  → ChatPresentation
  → FileOutputGroup / FileOutputCard
  → 原有固定 downloadId 链接
```

预计修改：

- `experiments/harness-lab/src/web/processGroups.ts`：增加纯展示文件组，不改变原生数据。
- `experiments/harness-lab/src/web/ChatPresentation.tsx`：渲染文件组。
- `experiments/harness-lab/src/web/Files.tsx`：交付卡结构、图标块、元数据和本地展开状态。
- `experiments/harness-lab/src/web/styles.css`：卡片、网格、操作与状态样式。
- `tests/web/process-groups.test.ts`、`tests/e2e/chat.spec.ts`：边界和浏览器验收。

不上传附件、历史引用、项目文件面板、公共契约、后端或 Pi 投影不属于改动边界。

## 2. 文件分组模型

增加 `FileGroup` 展示块，包含 `kind: 'files'`、稳定 `key`、`requestId` 和有序文件项。`chatBlocks` 在遇到文件项时：

1. 仅当前一个块也是文件组且 `requestId` 相同，才追加到该组；
2. 否则以首个文件项的 key 建立新组；
3. 普通消息、交互、错误、子任务和不同请求自然形成边界；
4. 既有 `downloadId` 去重先于分组完成，组内顺序保持 `items` 原顺序。
5. 旧文件缺少有效 `requestId` 时仍使用单文件组容器以保留对齐，但未知归属的相邻文件不得相互合并。

单文件也使用同一组结构，使单/多文件的外边距与正文对齐只有一套实现。文件仍不进入工具过程折叠，过程折叠资格与摘要逻辑不变。

## 3. 组件与交互

`FileOutputGroup` 接收有序 `FileOutput[]`，不读取或修改会话状态：

- 使用本地 `expanded` 状态；总数大于 4 时默认展示前 4 个，否则始终展示全部。
- 展开按钮使用 `type="button"`、`aria-expanded`、`aria-controls` 和明确中文名称；收起后恢复前 4 个。
- React key 来自稳定的文件组/文件项 key，后续文件流入不重置既有展开状态。
- `FileOutputCard` 保留原固定下载 URL 和 `download` 属性。卡片本体不是按钮，点击非下载区域无动作。
- 图标块根据扩展名选择现有 lucide 图标，未知类型回退普通文件图标；元数据由已知文件类型和既有 `size` 本地格式化，不增加后端字段。
- 下载操作使用带 `aria-label`/`title` 的紧凑图标链接，保持键盘可达；不新增整卡下载、预览或打开行为。

## 4. 视觉与布局

以当前主题 token 为主，参考 DSH 的层次而不复制代码：

- 卡片：最小高度约 64px、10px 12px padding、10px 间距、浅色表面、细边框、12px 圆角。
- 图标块：40×40px、10px 圆角、弱化边框与背景，内部 20px 图标。
- 文件名：13–14px、500 字重、20px 行高，完整换行；元数据：11–12px、16–18px 行高和次要色。
- 单文件组：`fit-content` 宽度，容器允许时最小 320px、最大 480px；容器不足时最大为可用宽度。
- 多文件组：占正文可用宽度，使用 `repeat(auto-fit, minmax(min(300px, 100%), 1fr))` 自动形成两列或单列，间距 10px。该规则由实际聊天容器宽度决定，不增加手机断点。
- 卡片高度使用最小值而非固定值；网格同行自然拉伸，长文件名不会裁切。
- hover 仅改变表面/边框，focus 保留全局焦点环并增加轻微卡片聚焦层次；不动画宽高，沿用全局 reduced-motion。
- 外边距由组容器统一拥有，卡片本身不再重复设置 36px 缩进。

## 5. 兼容、性能与回退

- 不改 `FileOutput`、SSE、快照、URL、权限和文件字节；旧快照缺 `fileOutputs` 时仍无卡片。
- 展开是纯 React 本地状态，不持久化、不发送网络请求；切换会话或刷新后恢复默认折叠可接受。
- 文件数量只影响现有渲染数量，不引入虚拟列表；默认折叠同时减少大量文件的初始 DOM。
- 回退可分别撤回 CSS/组件和 `chatBlocks` 分组；不得删除或改写文件记录。

## 6. 验证设计

- 单元测试：相邻同请求分组、跨请求/消息/交互边界、重复 downloadId、稳定顺序和既有过程折叠。
- 浏览器测试：1/2/5 个文件、长中英文名、默认 4 项、展开/收起、固定下载 URL、非下载区域无动作、键盘焦点。
- 截图：1440px、960px 和桌面窄窗口；检查两列/单列、完整长名、无页面横向溢出。
- 运行相关 Vitest、聊天/文件 Playwright、typecheck、lint、build 和 `git diff --check`；截图需人工审阅，不能仅以 DOM 存在代替视觉验收。
