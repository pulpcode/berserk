# Axon 预设部署操作手册

本手册面向在 Ubuntu 上首次部署 Axon 演练实例的运维人员，覆盖从 GitHub 拉取发布代码到登录验收的操作。部署完成后，登录页应提供六个席位和一个独立管理员入口。

本流程适用于包含仓库根目录 `deploy.sh` 的发布版本。现有实例的常规升级和回退按 [Axon 部署规范](axon-deployment.md) 操作。

## 1. 准备目标实例

确认目标服务器能访问 GitHub 仓库，具备 Node.js 24、npm、Git、curl、systemd 和 flock。以普通服务账号执行，确保该账号能写实例目录及私有配置目录，并有权限通过 sudo 安装和管理目标 systemd 服务。建议私有配置目录权限设为 0700。以下以主线实例为例。

| 用途 | 示例值 |
| --- | --- |
| systemd 服务 | `axon-4316.service` |
| 服务端口 | `4316` |
| 发布目录 | `/home/ubuntu/axon/4316/releases/` |
| 当前版本链接 | `/home/ubuntu/axon/4316/current` |
| 持久数据目录 | `/home/ubuntu/axon/4316/data/` |
| 实例私有配置目录 | `/etc/axon/4316/` |

首次部署使用独立的空数据目录。后续重试使用同一目录。以计划运行 Axon 的普通账号执行以下命令，准备示例实例的目录。

```bash
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 0750 /home/ubuntu/axon/4316
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 0700 /etc/axon/4316
```

演练依赖的来源服务应先启动，并由运维准备实际地址和访问凭据。

### Docker 与执行沙盒

Axon 由 systemd 在宿主机运行。启用 Agent 容器执行时，运维须先安装 Docker 并启动守护进程。若宿主使用标准 Docker systemd 单元，可执行 `sudo systemctl start docker`，再检查 `systemctl is-active docker`。部署入口使用 Axon 服务实际运行的用户及其 Docker 配置检查 daemon 连通性和权限。

沙盒默认开启。正式发布适用于 `linux/amd64`，从 Git 标签中的 `release/sandbox-image.json` 读取公开 GHCR 镜像的 SHA256 摘要。本地缺镜像时自动匿名拉取，已有同摘要时直接复用。拉取或试运行失败会在写库、停服或切换版本前退出。显式设置 `LAB_EXECUTION_ENABLED=false` 时跳过 Docker 和镜像步骤。

现有实例升级时，如果 `instance.env` 设置了旧的 `LAB_EXECUTION_IMAGE` 标签，请删除该覆盖，使服务使用发布版本绑定的镜像。

## 2. 从 GitHub 拉取代码

在服务器的源码目录执行，并记录本次部署的提交号。

```bash
git clone git@github.com:pulpcode/berserk.git
cd berserk
# vX.Y.Z 替换为获准部署的正式发布标签
git checkout --detach vX.Y.Z
git rev-parse HEAD
```

确认该发布版本包含 `release/sandbox-image.json`。部署通过 Git 提交生成发布目录，工作区临时改动需要先进入发布提交。仓库随版本提供 `scenario` 预设，定义席位 ID、显示名、职责、账号和权限。部署人员选择预设即可。

## 3. 准备实例私有配置

从仓库的 [演练查询配置](../experiments/harness-lab/fixtures/scenario-demo/context.example.json) 和 [后台来源配置](../experiments/harness-lab/fixtures/scenario-demo/background.example.json) 复制两份模板到实例私有目录。按环境填写来源地址和凭据引用，保留导演 `seat-director` 和控制 `seat-control` 的绑定。

在私有目录创建权限为 `0600` 的 `instance.env`。以下为非敏感字段示例：

```dotenv
PORT=4316
LAB_LISTEN_HOST=127.0.0.1
LAB_CONTEXT_CONFIG=/etc/axon/4316/context.json
LAB_BACKGROUND_CONFIG=/etc/axon/4316/background.json
```

再补齐两个 JSON 引用的全部凭据环境变量。模板使用 `MOCK_CONTEXT_API_TOKEN`、`MOCK_CONTEXT_CONTROL_TOKEN`、`MOCK_INTEL_SOURCE_TOKEN` 和 `MOCK_SITUATION_SOURCE_TOKEN`。仅在明确不需要容器执行时，设置 `LAB_EXECUTION_ENABLED=false`。

部署会生成权限为 `0600` 的 `auth.env` 和 `initial-credentials.json`。签名配置和数据目录由 `auth.env` 管理。凭据文件中管理员用户名为 `system-admin`，其余用户名与席位 ID 相同。重试期间保留这两个文件，部署验收后按组织流程交付和保管初始凭据。

## 4. 执行预设部署

在仓库根目录执行。数据目录必须是实例根目录下的 `data`。首次执行会配置并启用该实例的 systemd 单元。若同名服务已由其他发布方式配置，使用独立实例名、目录和端口。

```bash
./deploy.sh --preset scenario \
  --data-dir /home/ubuntu/axon/4316/data \
  --config-dir /etc/axon/4316 \
  --service axon-4316.service
```

部署入口依次安装依赖并构建发布版本、校验实例配置、在服务停止时批量开通账号和席位、运行席位预检、切换并启动 systemd 服务。执行结束后检查输出中的部署版本、健康检查结果和初始凭据位置。模型访问凭据按现有流程由管理员登录后在设置中配置。

## 5. 验收并交付

先在服务器确认服务运行和健康接口响应：

```bash
systemctl is-active axon-4316.service
curl -fsS http://127.0.0.1:4316/api/health
```

按示例监听回环地址时，从运维电脑建立 SSH 转发，将 `SERVER` 替换为实际服务器：

```bash
ssh -N -L 4316:127.0.0.1:4316 ubuntu@SERVER
```

在浏览器无痕窗口打开 `http://127.0.0.1:4316/`，核对总体席、情报席、筹划席、态势席、导演席、控制席以及独立管理员入口。分别验证管理员设置入口、导演台和控制席的正式下达入口。检查来源查询与席位授权符合本实例配置。启用沙盒时，再通过应用执行一次能在当前工作区写入并读取测试文件的请求，确认容器执行和挂载均可用。记录提交号、服务名、数据目录及验收结果，凭据通过单独渠道交付。

## 6. 部署异常与重试

| 现象 | 处理 |
| --- | --- |
| 预检报告缺少配置或凭据 | 按报错补齐对应实例配置，再使用同一预设和数据目录重试。 |
| 预检报告席位 ID、账号绑定或授权冲突 | 核对部署目标与现有数据库，按实例实际配置处理差异。 |
| 镜像无法拉取 | 核对 Docker 和部署主机到 `ghcr.io` 的连通性，确认目标摘要已公开发布后重试。 |
| 服务启动失败 | 先确认演练来源已启动。执行 `journalctl -u axon-4316.service -n 100 --no-pager`，按日志核对启动配置、端口和数据目录。 |
| 服务健康但登录选项不齐 | 在未登录状态检查 `/api/auth/session` 的 `loginSeats` 和 `loginUsers`，确认服务使用初始化时的同一数据目录。 |

同一实例重复执行时跳过配置一致的账号，保留密码、会话和数据。启动或登录选项验证失败时，部署尝试恢复原 `current` 链接及原运行服务。数据目录保留供排查及重试。已有实例升级或回退按 [Axon 部署规范](axon-deployment.md) 处理版本、配置和数据库备份。


## 发布方准备沙盒镜像

1. 在 GitHub Actions 手动运行「发布沙盒镜像」工作流，选择应用发布候选所在分支。工作流构建镜像、运行实际执行探针，并推送通过的镜像到 `ghcr.io/pulpcode/berserk-file-runtime`。
2. 首次发布时，在 GitHub Packages 将镜像包可见性设为 **Public**。在无仓库凭据的目标网络和主机上验证可按工作流给出的摘要拉取。
3. 将工作流摘要里的 JSON 保存为仓库根目录的 `release/sandbox-image.json` 并提交。确认最终提交的沙盒相关输入与完成验收的候选提交一致，再创建应用发布标签。
4. 在目标网络验证一键部署和沙盒操作。可回退的应用版本引用的镜像摘要应保留在 GHCR。回退应用发布目录时，服务读取旧目录中对应的镜像绑定。
