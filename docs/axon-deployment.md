# Axon 部署规范

- Axon 由 systemd 的 `axon-4316.service` 管理，监听 `4316`。部署根目录为 `/home/ubuntu/axon/4316/`，`releases/` 存放版本代码和依赖，`current` 指向现役版本，`data/` 存放持久数据。私有配置放在 `/etc/axon/4316/`。
- 发布时先准备新版本，再切换 `current` 并重启服务。涉及数据库变更时，先停服并备份数据。发布后检查 `/api/health`，并验证登录、历史任务和会话可正常读取。
- 旧版本、回滚备份和验收材料集中归档到 `/srv/axon-archive/`。清理前核对运行和回滚引用，并确认归档可恢复。
