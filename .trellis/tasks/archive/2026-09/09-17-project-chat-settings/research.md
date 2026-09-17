# 参考项目与采用范围

参考项目：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，本次查看的源码版本为 `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`。

- [Web 使用指南](https://github.com/deepseek-ai/deepseek-harness/blob/0d1f50007f9bca3f52b06e1c3074fa14d5fb0720/docs/user/guide/index.md)：在 Settings → Models 配置模型，下一请求使用保存结果。
- [提供方配置说明](https://github.com/deepseek-ai/deepseek-harness/blob/0d1f50007f9bca3f52b06e1c3074fa14d5fb0720/docs/user/guide/providers.md)：API Key 为只写输入，读取配置只返回脱敏信息；自定义提供方配置包含地址、协议与模型。参考其密钥不回传与下一请求生效的交互。
- [SettingsRoot.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/0d1f50007f9bca3f52b06e1c3074fa14d5fb0720/packages/client/ui-settings-general/src/client/SettingsRoot.tsx)：入口在侧栏底部，居中设置窗口包含左侧分类导航、右侧内容与关闭按钮；支持 Escape 关闭及焦点恢复。本项目使用已有原生 dialog 实现相同组织方式，只保留本期可用的模型分类。

本项目的配置存储位置、原子保存、会话空闲校验、版本冲突和端点切换时必须重新输入密钥，是结合当前单进程服务的实现设计，并非宣称照搬参考项目。暂不引入其插件、Agent 预设、归档管理、多协议与多提供方配置系统。

用户已确认：蓝点仅表示“有新回复未读”，查看后消失；普通空闲会话不显示“已完成／等待输入”。项目复用当前工作区实体与隔离边界，不改会话存储格式。
