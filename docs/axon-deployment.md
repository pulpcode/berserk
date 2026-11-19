# Axon 部署规范

- Axon 主线由 systemd 的 `axon-4316.service` 管理，监听 `4316`。部署根目录为 `/home/ubuntu/axon/4316/`，`releases/` 存放版本代码和依赖，`current` 指向现役版本，`data/` 存放持久数据。私有配置放在 `/etc/axon/4316/`。
- 发布时先准备新版本，再切换 `current` 并重启服务。涉及数据库变更时，先停服并备份数据。发布后检查 `/api/health`，并验证登录、历史任务和会话可正常读取。
- 旧版本、回滚备份和验收材料集中归档到 `/srv/axon-archive/`。清理前核对运行和回滚引用，并确认归档可恢复。

## 席位配置与部署核对

- 在实例的私有配置目录准备 `seats.json`。清单项填写稳定的 `id`、显示名称 `name`、类型 `type` 和职责 `responsibility`。普通业务实例配置管理员和实际办理业务的席位。开启演练时只配置一个导演席，并核对 `simulation.directorSeatId`。开启下达时可配置一个或多个控制席，对照 `commands.seatIds`。使用 [日常业务清单](../experiments/harness-lab/fixtures/seat-deployment.example.json) 或 [演练与下达清单](../experiments/harness-lab/fixtures/seat-deployment.scenario.example.json) 作为示例。
- 新服务按 [Harness Lab 登录入口](../experiments/harness-lab/README.md#业务任务与账号入口) 初始化，沿用现有离线入口准备登录记录。演练与控制席仍按 [演练配置说明](../experiments/harness-lab/scripts/mock-context/scenarios/README.md#隔离配置) 配置来源、查询范围和服务端凭证。
- 升级现有服务时由原席位和实际集成配置生成清单，保留原席位 ID、登录记录、来源授权和数据。切换共享模型设置前核对独立管理员能登录。历史上有模型管理标志的业务席仍能选择开放模型。
- 在实际发布目录的 `experiments/harness-lab` 执行 `npm run seats:check -- --manifest /实例配置/seats.json --data-dir /实例数据/data`。已初始化连接器的实例以库内连接配置为准。新实例按实际启用模块提供 `LAB_CONTEXT_CONFIG` 和 `LAB_BACKGROUND_CONFIG`。预检使用目标实例的私有环境核对凭证是否可用。先核对停服数据或一致的备份副本，修正差异后再启动业务入口。该命令只检查数据和配置，不开通席位，也不连接外部服务。
- 切换后核对各席入口、共享模型设置、旧任务和管理员个人空间。回退使用对应旧版程序和原配置，涉及其他数据库变更时恢复配对备份。

## axon-jc 支线

- 支线由独立的 systemd 单元 `axon-jc.service` 管理，部署根目录为 `/home/ubuntu/axon-jc/`。沿用 `releases/` 和 `current` 布局，业务数据放在支线自己的 `data/`，私有配置放在 `/etc/axon-jc/`。
- 切换前备份原服务的数据和启动配置，并将原数据保留在原路径。支线如需继承数据，先复制所需数据，再迁移副本。启动后核对应用数据库和模拟来源均使用支线的数据目录。
- 复用原服务的端口时，先停掉原服务及其模拟来源，再启动支线。并行运行时，分别分配对外端口和模拟来源端口。回退时以原版本配原数据启动，两套数据各自保留。
