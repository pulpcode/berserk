# 本地 UI 验收

- 基线：本地 main；独立分支 codex/sidebar-compact。
- worktree：/Users/lau/.codex/worktrees/sidebar-compact/berserk
- 地址：http://127.0.0.1:4318
- 席位：UI 验收席位；账号 preview；密码 sidebar-ui-123。
- 8 个公共任务空间、2 个个人空间；本地持久化独立于原工作区。
- 使用真实 API 与演示数据，模型回复使用现有测试运行时，不访问真实模型。
- 启动：在 experiments/harness-lab 下运行 node_modules/.bin/tsx .local/sidebar-preview.ts。
- 首次需 npm run build；dist 和 .local 都被 Git 忽略。
- 人工检查：点击顶部 Logo 折叠/展开，检查列表隐藏及恢复、底部设置和全局页面选择。
- Chrome 实页检查：1440×960 和 960×800 均为64px侧栏，无横向溢出；折叠仅显示展开、新建对话、工作待办、工作总览、态势地图、设置。
- 截图：/tmp/sidebar-expanded.png、/tmp/sidebar-collapsed.png、/tmp/sidebar-collapsed-960.png。

已完成实现与自动检查；本地验收服务保留运行。

自动检查通过：typecheck、lint、build、git diff --check；6 个相关浏览器测试通过，强化滚动恢复和正式空间测试后再次通过 2/2。等待用户 UI 验收。
