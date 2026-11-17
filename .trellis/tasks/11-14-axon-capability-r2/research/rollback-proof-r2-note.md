# R2 完整备份与配对回退证明

实际基线为 13b4e87a7a393d50d5db89c3426034176b27c17b；通过 --baseline-root 指定本地仓库，脚本检查 R1 PiLab 与能力服务源码相对该提交无改动。真实原生 Pi 循环仅替换模型传输，先由 R1 创建合成会话并明确发送一次；停服后 R2 dry-run 保持字节不变，apply 完整备份原数据。R2 打开/GET 不调用模型且不改历史，明确发送才追加一轮。

随后仅复制升级前原备份到独立恢复目录，由实际 R1 代码打开该副本并明确续聊。旧代码从不访问升级后的活动根。验证原修订与历史前缀保留、原备份逐文件摘要不变、升级活动根未被回退修改。环境不含真实业务资料、凭据、网络模型或Docker；这不是生产迁移，也不替代真实模型/Docker验收。

复现：在 experiments/harness-lab 使用 node --import tsx scripts/probe-capabilities-r2-rollback.ts --baseline-root ABS_R1_REPOSITORY --output ABS_REPORT_JSON。结果见 rollback-proof-r2.json。
