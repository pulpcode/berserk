# 文件执行镜像

应用服务、Docker daemon 和工作区数据应位于同一 Linux 主机。使用普通用户运行应用，确保其 UID/GID 与 `LAB_EXECUTION_UID`、`LAB_EXECUTION_GID` 一致；运行时始终禁止容器使用 root。Docker Desktop 仅作为本机可选验证环境。

在 `experiments/harness-lab` 中构建镜像：

```sh
docker build -t berserk-file-runtime:w01-5 execution-image
npx tsx scripts/probe-execution.ts
npx tsx --env-file=.env.local scripts/probe-files.ts
```

`probe-execution.ts` 不调用模型，验证真实容器、文件与格式库、隔离、并发、超时、子进程清理及残留容器清理。`probe-files.ts` 使用已配置的真实 API，在独立临时数据目录验证上传、Pi 工具、模型编写脚本、多轮修改、子 Agent 读取、固定下载与重新加载历史。Docker 或镜像不可用会失败，不能作为验证通过。后者保留证据目录，且不替代网页验收。

构建默认使用 Debian 官方 HTTPS 源。若服务器到官方源下载缓慢，可通过 `--build-arg DEBIAN_MIRROR=https://mirrors.cloud.tencent.com` 使用部署方确认的镜像；源需同时提供 `/debian` 与 `/debian-security`，并继续由原有 Debian 密钥校验包索引签名。

Python 包默认来自 `https://pypi.org/simple`；构建期可通过 `--build-arg PIP_INDEX_URL=https://mirrors.cloud.tencent.com/pypi/simple` 选择部署方确认的 HTTPS 镜像。上述参数仅控制镜像构建下载，运行容器仍关闭网络。

镜像提供 Python、Bash、Node、ripgrep、`file`（文件类型识别）、Noto 中文字体及 `requirements.txt` 中固定版本的 Python 文件处理库。镜像构建需要获取依赖；任务执行时关闭网络，缺少依赖不会自动安装。Python 顶层包固定版本，系统包与传递依赖以构建所得镜像为准；验证时应记录实际镜像 ID，不能把标签视为不可变镜像摘要。

每个请求惰性创建自己的容器：仅 `/workspace` 挂载该席位普通文件，`/logs` 只读挂载该工作区历史命令日志。普通聊天不创建容器。系统只读，`/tmp` 是 256 MiB 临时盘，无额外 capabilities，禁止提权。CPU、内存、进程数由服务配置；默认单次读取和命令输出各为 100 MiB。普通工作目录没有硬磁盘配额。

`files.py` 通过目录文件描述符逐段打开路径，拒绝符号链接和特殊文件；文件工具只访问 `/workspace` 与只读 `/logs`。Bash 本身可读取容器镜像中的库与程序，不获得宿主数据目录、Docker socket 或模型凭证。

`command.py` 为每条命令启用 Linux subreaper，命令退出或超时时清理其后代，包括双重 fork 和 `setsid` 后代；停止请求会销毁该请求的容器并等待客户端结束。后台作业不能跨命令持续运行。工作文件不随停止回滚，同席位的其他请求使用独立容器，不被一并停止。

启动服务时只清理相同数据实例标签的残留容器；无法确认清理时关闭文件执行，不退回宿主 Shell。请勿在同一数据目录启动多个服务进程。
