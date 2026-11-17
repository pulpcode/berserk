# R3 完整备份与配对回退证明（确定性模型）

实际基线为 5969069f565d28c753962daca1fe8bf3de17885c；通过 --baseline-root 指定本地仓库，脚本逐文件核对归档中全部受跟踪应用文件与该实际Git对象完全一致。真实原生 Pi 循环仅替换模型传输，先由 R2 创建合成会话并明确发送一次；停服后 R3 dry-run 保持字节不变，apply 完整备份原数据。R3 打开/GET 不调用模型且不改历史，明确发送才追加一轮；随后以合成core管理员fixture发布新的方法包，并在实际Pi会话中明确选择使用，固定正文进入provider输入。该fixture不是HTTP认证或真实模型证据。

随后仅复制升级前原备份到独立恢复目录，由实际 R2 代码打开该副本并明确续聊。旧代码从不访问升级后的活动根。验证原修订与历史前缀保留、原备份逐文件摘要不变、升级活动根未被回退修改。旧R2仅打开独立恢复副本，不宣称其必然拒绝R3新增表。环境不含真实业务资料、凭据、网络模型或Docker；这不是生产迁移，也不替代真实模型/Docker验收。

复现：在 experiments/harness-lab 使用 node --import tsx scripts/probe-skills-r3-rollback.ts --baseline-root ABS_R2_REPOSITORY --output ABS_REPORT_JSON。结果见 rollback-proof-r3.json。
