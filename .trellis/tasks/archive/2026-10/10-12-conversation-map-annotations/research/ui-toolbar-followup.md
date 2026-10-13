# 标题栏工具按钮统一（2026-10-13）

用户反馈地图、分派工作与右侧文件、资料按钮不协调。沿用同一已授权 UI 任务和线上服务更新范围。

- 四个入口合并为标题栏右侧同一工具组，使用既有 icon-button / workspace-tool 样式；图标均为 20px、1.75 线宽，悬停显示名称。
- 地图、文件、资料按 aria-expanded 使用同一高亮样式；分派工作保留导航语义，不伪装成弹窗。
- 保留权限条件、禁用状态、地图幂等打开与关闭焦点恢复。删除不再使用的旧文字按钮 CSS。
- 独立增量审阅无问题；类型检查、完整 Lint/依赖边界、本地构建和 diff check 通过。
- 5 项既有浏览器回归通过（28.4 秒）：地图编辑保留、分栏尺寸、375px 文件面板、375px 分派工作、侧栏折叠后的资料面板。检查 1440px 截图，图标同组对齐。

## 发布结果

- 2026-10-13 12:02:40（Asia/Singapore）更新既有线上服务，PID 4110772 保持不变。
- 发布目录：`/home/ubuntu/axon-map-release-e073df6/updates/header-tools-ui-20261013`；备份：`/home/ubuntu/axon-map-release-e073df6/backup/header-tools-ui-20261013T040239Z/code.tar.gz`。回滚恢复前端源码及 dist 备份，无数据迁移。
- 309 文件发布包 SHA256：`cafdde2c780566ea2159fce4a8afbf693b427c9f7318bdc53b8da9b02b4985a2`。线上基线、暂存文件哈希与 15 个静态资源 HTTP 字节一致。
- 四席位登录与标注读取正常，数据库 schema 10、完整性 ok。实际 Chrome 验证四个工具按钮均为 40×40px，顶部位置相同、20px / 1.75 图标；1440/1280px 地图操作正常、无水平溢出及页面错误。
- 线上截图：`/Users/lau/.codex/visualizations/2026/10/12/01a12f1c-b5f9-7ac3-bba6-669f26cef98b/header-tools-online-1440.png`。
