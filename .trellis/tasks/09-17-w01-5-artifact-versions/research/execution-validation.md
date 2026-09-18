# W01-5 真实执行环境验证

日期：2026-09-18。结果：**不依赖模型 API 的真实容器 P0 通过**。本文不代表浏览器与真实模型的 E15 已通过。

## 环境与版本

验证使用用户指定的 SSH 别名 `tencent-server`，在独立目录 `/home/ubuntu/berserk-w01-5.gIXPCA` 中进行。应用源代码在 `app/`，应用 Node 单独安装在 `runtime/`，未更换服务器系统 Node 或 Python。

| 项目 | 实际值 |
| --- | --- |
| 宿主 | Ubuntu；UID/GID 1000；Docker Server 26.1.3 |
| 应用验证运行时 | Node 24.14.0 |
| 执行镜像 | `berserk-file-runtime:w01-5`，linux/amd64 |
| 镜像 ID | `sha256:b32432c33720afe2b0f8d6f6f72378306152c2c2bc19323ba384b654ce1cdc76` |
| 基础镜像 | `python:3.12.11-slim-bookworm` |
| 基础镜像 digest | `sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7` |
| 容器内工具 | Python 3.12.11；Node 18.20.4；ripgrep 13.0.0；Noto CJK 字体 |

容器 Node 用于文件处理脚本，与运行应用的 Node 24 分开。Python 文件处理库实际安装版本为：openpyxl 3.1.5、python-docx 1.2.0、pypdf 5.8.0、reportlab 4.4.3、Pillow 11.3.0、matplotlib 3.10.5。

其余实际 Python 依赖：charset-normalizer 3.5.1、contourpy 1.4.0、cycler 0.12.1、et_xmlfile 2.0.0、fonttools 4.65.0、kiwisolver 1.5.1、lxml 6.1.3、numpy 2.5.3、packaging 26.3、pyparsing 3.3.2、python-dateutil 2.9.0.post0、six 1.17.0、typing_extensions 4.16.0。

## 构建与执行

服务器到官方 Debian/PyPI 文件源下载较慢。本次构建使用腾讯云 HTTPS 镜像；Dockerfile 默认仍为官方 HTTPS 源。没有修改 daemon、宿主 DNS 或系统软件源，没有禁用 APT 签名或 TLS 校验。

在远端 `app/` 运行：

```sh
docker build \
  --build-arg DEBIAN_MIRROR=https://mirrors.cloud.tencent.com \
  --build-arg PIP_INDEX_URL=https://mirrors.cloud.tencent.com/pypi/simple \
  -t berserk-file-runtime:w01-5 execution-image

/home/ubuntu/berserk-w01-5.gIXPCA/runtime/node-v24.14.0-linux-x64/bin/node \
  --import tsx scripts/probe-execution.ts
```

首次探针通过后，补充了明确的双重 fork 与停止后文件字节稳定断言；增强后的探针再次退出 0，返回 `passed: true`。模型 API Key 未参与构建或本次探针。

## 已验证行为

| 检查 | 实际验证 |
| --- | --- |
| 目录归属 | 两个请求容器挂载同一席位目录时读取相同文件；另一席位目录中不存在该文件 |
| 执行边界 | 非 root；系统目录不可写；网络连接失败；环境无模型/会话凭证；无 Docker socket；文件工具拒绝 `/etc` 与符号链接；`/logs` 可读不可写 |
| 文件格式 | 从 CSV 求和，生成并重新读取 JSON、XLSX、DOCX、含文本 PDF；生成并校验使用中文字体的 PNG |
| 输出与失败 | 360,001 字节 UTF-8 命令输出完整返回；退出码 7 不误报成功，后续命令仍可运行 |
| 遗留进程 | 普通后台、`setsid`、双重 fork 后代在命令结束后清理，等待后对应文件字节不再变化 |
| 命令超时 | `sleep` 触发显式单命令超时后完成清理，同请求可以继续执行下一命令 |
| 精确停止 | 停止一个请求后，其输出文件不再增长；同席位另一容器继续运行，已保存文件保留并可由新请求读取 |
| 启动清理 | 相同实例标签的残留请求容器被初始化清理；不自动重新执行原命令 |

这些检查证明所列样本与边界，未把 Docker 验收等同于生产多租户隔离、任意格式处理或磁盘硬配额。

## 证据与收尾

远端独立验证目录中的原始记录：

- `evidence/execution-probe.json`：增强后的完整探针结果。
- `evidence/execution-image.txt`：实际镜像 ID、架构与系统。
- `evidence/execution-tools.txt`：容器内 Python、Node 与 ripgrep 版本。
- `evidence/execution-python-packages.txt`：实际 `pip freeze`。

收尾时 `docker ps -a --filter label=io.berserk.harness.instance` 无残留容器，探针自身的临时工作文件已清理。镜像和证据保留，供后续真实模型验收使用。

服务器原有 `backend-mysql-1`、`backend-redis-1` 在核对时均显示 `Exited (0) About an hour ago`，无正在运行的容器。本次没有对这两个容器执行启动、停止、删除或配置变更。

本地新增确定性检查仍包括 7 项执行层测试和 9 项 Pi 文件工具测试；相关 ESLint、全工程类型检查、Python 语法检查与 `git diff --check` 已通过。真实模型、网页上传交付、多轮与压缩续作由另外的探针和验收记录承担；本记录不提前将它们记为通过。
