# 命令策略参考与验收样例

日期：2026-09-18。状态：**设计依据与拟验收样例，尚未实现或执行**。主方案见 [设计](../design.md)。

## 参考什么

| 来源 | 可借鉴的机制 | 本项目边界 |
| --- | --- | --- |
| [Claude Code 权限](https://code.claude.com/docs/en/permissions) | allow／ask／deny、禁止优先、复合命令及参数检查；Shell 规则不能覆盖程序内部所有行为 | 借鉴分层与检查方式，首期命令清单由 Axon 确定，不复制整个权限产品 |
| [Claude Code 沙盒](https://code.claude.com/docs/en/sandboxing) | 执行隔离与用户确认分别负责环境边界和操作授权 | 保留现有 Docker，不因确认而放宽隔离 |
| [Codex 执行规则](https://learn.chatgpt.com/docs/agent-configuration/rules) | 参数前缀规则、最严格决定、可分析 Shell 链拆分、规则正反样例与检查工具 | 其规则主要针对沙盒外执行；Axon 借鉴判断方法，不声称两者权限语义相同，也不引入 Codex 作为运行依赖 |
| [Pi permission-gate](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/examples/extensions/permission-gate.ts) | 工具执行前等待确认／拒绝的扩展接入点 | 示例正则不是完整 Shell 判断系统，规则需另做 |
| [tree-sitter Bash](https://github.com/tree-sitter/tree-sitter-bash)、[Node 绑定](https://github.com/tree-sitter/node-tree-sitter) | 成熟 Shell 语法树解析 | 语法树不是权限策略；P1 验证并锁定兼容版本，本期不自写 Shell 解析器 |

[Anthropic sandbox-runtime](https://github.com/anthropics/sandbox-runtime) 提供进程级文件系统／网络隔离，可作为参考，但不是危险命令分类器；当前已有 Docker，无需仅为确认功能替换执行环境。[Claude Agent SDK 用户输入](https://code.claude.com/docs/en/agent-sdk/user-input) 则用于核对结构化提问与权限请求分开处理的方式。

下面的命令清单、复杂语法询问、普通 Python／Node 文件脚本放行均为 Axon 的待审选择，不是上述项目共同规定的“标准答案”。规则固定在服务端，不交给模型自行决定；暂不建设风险分类模型、权限配置页或持久允许规则。

## 首期判断样例

基准 cwd 为 `/workspace`。以下仅作为策略测试输入；涉及删除等效果的集成验证使用单独生成的测试文件，不操作用户成果。

| 输入 | 预期 | 原因 |
| --- | --- | --- |
| `ls /workspace` | allow | 可分析的普通命令 |
| `python /workspace/process.py`、`node /workspace/process.js` | allow | 普通文件脚本保留；正文行为不在本期审计范围 |
| `printf '%s' 'rm -rf /workspace'` | allow | 引号内是数据，不是待执行的 rm |
| `rm -- /workspace/fixtures/a.txt` | ask | 直接删除 |
| `/bin/rm -- /workspace/fixtures/a.txt` | ask | 绝对命令路径仍按 basename 识别 |
| `MODE=test env /bin/rm -- /workspace/fixtures/a.txt` | ask | 解析字面量赋值与简单 env 包装，不只判断首个单词 |
| `command rm -- /workspace/fixtures/a.txt` | ask | 简单 command 包装不绕过规则 |
| `rmdir /workspace/fixtures/empty`、`unlink /workspace/fixtures/a.txt`、`shred /workspace/fixtures/a.txt` | ask | 删除类命令 |
| `truncate -s 0 /workspace/fixtures/a.txt`、`chmod 600 /workspace/fixtures/a.txt`、`chown 1000 /workspace/fixtures/a.txt`、`chgrp 1000 /workspace/fixtures/a.txt` | ask | 截断或权限／归属修改 |
| `git -C /workspace reset --hard`、`git reset HEAD --hard`、`git -c core.quotePath=false clean -fd`、`git restore -- /workspace/fixtures/a.txt` | ask | 识别 Git 全局选项、子命令和覆盖／清理参数，不仅匹配固定前缀 |
| `ls /workspace && rm -- /workspace/fixtures/a.txt` | ask | 整条决定前连 ls 也不执行；换行、分号、管道及逻辑或同样逐项判断 |
| `sudo ls /workspace` | deny | 识别到不开放的提权入口；su、doas、mount、umount、nsenter、chroot 同理 |
| `rm -- /workspace/fixtures/a.txt && sudo ls /workspace` | deny | 禁止优先，整条不执行、也不提供批准按钮 |
| `echo "$(rm -- /workspace/fixtures/a.txt)"` | ask | 命令替换，不按 echo 前缀放行 |
| `$CMD /workspace/fixtures/a.txt`、`for f in /workspace/fixtures/*; do rm "$f"; done` | ask | 动态命令／展开／循环超出首期可自动放行语法 |
| `python -c 'print(1)'`、`node -e 'console.log(1)'`、`bash -c 'ls /workspace'`、`bash /workspace/process.sh` | ask | 内联代码或 Shell 委托执行需人工查看；不声称所有内联代码都危险 |
| 含 here-doc、函数、后台运行、复杂包装或未支持语法的命令 | ask | 无法可靠分析，不按安全前缀放行 |
| `printf '%s' ok > /workspace/fixtures/output.txt`、`printf '%s' ok > output.txt` | allow | 初始 cwd 明确，静态目标属于当前工作区；仍可能覆盖文件，不构成全写入审批 |
| `printf '%s' ok > /tmp/result.txt`、`printf '%s' ok > /dev/null` | allow | 既有容器内临时／丢弃输出路径 |
| `printf '%s' ok > /etc/example`、`printf '%s' ok > ../outside.txt` | ask | 超出自动放行路径或有穿越；批准后仍受实际沙盒权限限制 |
| `cd /tmp && printf '%s' ok > result.txt` | ask | cwd 已变化，不用初始目录推断重定向目标 |
| 语法树存在错误／缺失节点或未覆盖语法 | ask | 不足以证明属于可自动放行子集 |
| 解析器装载失败或策略运行异常 | 不执行，结束请求 | 系统故障不能作为 allow，也不以人工批准绕过失效策略 |

## 不能从规则推导出的保证

- allow 表示“该命令按当前策略无需人工确认”，不表示它只读或没有破坏性。脚本、其他程序和普通重定向仍可能修改工作区文件。
- 按命令文本分析不能证明可执行文件内容、动态载入内容或脚本行为；不承诺识别一切等价删除，也不对工作区共享文件提供并发冻结。
- ask 只批准当前命令和参数；不会开放网络、宿主路径或提权。deny 无批准按钮，但它不是对任意程序内部行为的完整证明。
- 规则应在完整实际调用进入执行前判断；解析不执行 Shell 展开或命令。卡片须保留原始命令，执行时不能替换成模型后来生成的另一条命令。

实现时将此表转成自动化正反样例；同名程序、引号、包装和未知语法是必要回归点。真实任务若频繁出现无价值确认，应基于记录调整受支持语法及规则，不能默默关闭策略。
