# 首增量设计依据

日期：2026-09-21。代码基线 `255fd61`；仅代码／文档研究，未执行本期验收。

## 当前实现

以下路径相对 `experiments/harness-lab/`。

| 位置 | 已确认事实及影响 |
| --- | --- |
| `src/server/seat-scope.ts` | 测试模式根据 URL 中的 seatId 选身份，非登录认证；正式访问必须改由认证会话解析 |
| `src/web/Seats.tsx` | 已访问席位保持挂载，sessionStorage 选择身份；正式登录后应只挂载当前身份，并处理退出／迟到响应 |
| `src/web/api.ts` | 已有按席位固定的 API client、DOM ID 与 storage key，可复用隔离思路，不能把 URL 参数继续当身份 |
| `src/workspaces/store.ts` | workspace-index v2，taskSpaceId × seatId 唯一；只有任务空间标识及各工作区名称，没有公共／私有任务目录 |
| `src/contracts/collaboration.ts` | WorkItem 有所属任务、目标、分派／接收席位及状态；不等于整个业务任务 |
| `src/collaboration/service.ts` | SQLite v1 单进程，原分派为接收席位准备工作区，提交和回执同事务；账号／任务目录应复用单一迁移入口 |
| `src/server/app.ts` | 当前限制本地 Host／Origin，但没有登录；模型设置是共享服务配置，登录后需单独限制修改能力 |
| `package.json` | Node 24、Fastify 5、React 19、Pi 0.85.1；尚未安装登录／会话插件 |

旧任务没有统一负责人、目标或公私属性，不能从某个工作区名称或第一个账号推断这些事实。已有多席位关系需迁移清单明确范围；旧代码的工作区隔离不能直接证明新登录方案正确。

## 身份实现参考

- [Fastify session](https://github.com/fastify/session)：官方插件依赖 cookie 插件，支持服务端存储和 get／set／destroy 接口；默认内存存储不适合正式使用。本期建议适配已有 SQLite，复用会话生成／更新／销毁机制。
- [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)：参考统一失败提示、登录限流和密码输入处理；不据此扩展成完整账号安全平台。
- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)：参考 Cookie 属性、登录后更换标识、服务端过期及退出失效；业务 Agent 请求与登录会话分别管理。
- [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[Node 24 crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html)：密码派生采用公开 API 与加盐 scrypt，按推荐成本配置并验证服务器资源；不使用明文或快速 hash 保存密码。

以上仅为拟议技术依据。实施时固定兼容版本，并以过期、退出、重置、CSRF、旧 API 旁路及跨标签测试验证，不能把“使用插件”当作访问控制已完成。

## 交互依据

使用本地 ui-ux-pro-max 的 `authentication login form desktop` 查询，相关结果为可访问认证、提交反馈和表单标签。采用密码管理器／粘贴支持、明确字段名、提交状态、键盘焦点及错误恢复；继续沿用 Axon 现有样式和桌面布局，不增加手机端目标或另起设计系统。

## 实施前待审

D01 最小登录、D02 私有任务按席位还是个人账号归属、D03 公共任务目录的可见范围。具体建议及代价见 [PRD](../prd.md#3-待审产品选择)。公开任务不默认公开文件或聊天，后续服务身份可读范围也需独立审阅。
