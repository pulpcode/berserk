# R2 隔离试用运行实现与检查

2026-11-14。实现文件：`src/pi/capability-trials.ts`、`src/pi/trial-tools.ts`、`src/contracts/capability-trials.ts`，以及PiLab内部试用参数/工具注册/守卫/禁止自动重试的窄接缝。运行复用PiLab的原生会话、工具、文件输出和历史，不存在第二条模型执行循环。

## 已执行证据

`npx vitest run tests/pi/capability-trials.test.ts --maxWorkers=1`：10/10通过。Provider及Docker传输可控替身，Pi会话、工具装配、文件存储、下载和历史均为真实产品实现；不称作真实模型/Docker验收。

覆盖固定的非发布/不可选草稿、原生trial模式manifest、明确合成来源、生产账号/签名/角色路径不复制及递归持久目录无模型key；并发与重启重试不重跑、样例变化拒绝；不可用Docker及未知依赖拒绝；业务读取替身明确simulated/productionEffect:false，正式业务写动作不注册并列未验证，尝试调用不通过；原生write/file_output和固定下载；等待回答取消/异管理员隔离/撤权停止；收费模型错误不自动重试；重启未完成试用标记interrupted且不继续运行。

定向ESLint通过。最终全包typecheck由主代理统一汇总；本文件不重复宣称整个R2通过。

## 运行接口

`CapabilityTrials.open({dataDir,modelConfig,authorize,onUpdate?,runtimeFactory?,executionFactory?})`；`start(actor,{trial,expert},files)`、`get`、`wait`、`cancel`、`respond`、`download`、`close`。`authorize`须验证当前管理员及owner；事件/工具/推理守卫与轮询都复核。生命周期终态和实际证据先在试用目录保存，再同步管理状态；人工确认仍由管理服务独立记录。

记录存于`capability-trials/<trialId>`；正式workspace-index/session目录不包含试用。合成/脱敏UTF8样例最多8个，每个1MiB，原生上传与文件输出都属于独立目录。所有副作用只有显式新试用动作才执行；同试用ID有回执或不确定记录均不重新执行。

## 合成业务边界

仅封闭的业务只读工具有内部合成替身。替身使用通用测试参数，不宣称真实接口schema/外部业务已验收；证据unverified逐项标注。正式指令、成果提交、工作办理等写动作不提供同名替身，不为模拟调用放宽原生人工确认及历史解码。R2发布仍需要管理员基于代表性任务和已列出的未验证范围明确确认。文件/脚本环境为必须验证项。

## 修正记录

初期同名业务写替身会违反原生确认历史校验，已移除，未改解码器或伪造批准记录。真实HTTP/UI试用揭示不可选草稿被原普通会话准入拒绝，现采用内部executionMode=trial触发allowUnselectable，保留原修订摘要和普通目录不可见性；测试夹具同样改为selectable:false/releaseVersion:trial。

## 待真实验证

新增`scripts/probe-capabilities-r2.ts`可在独立临时目录用既有授权模型和Docker执行：编辑、两次文件试用、管理员确认、幂等发布、个人默认、真实多轮、PATCH更新、旧会话旧指令、新会话新修订及普通停用。只在新的合成账号和数据根运行，不监听端口、不修改生产数据、不自动批准模型交互。真实模型、镜像可用性、性能以及升级回退证据由主代理分别汇总；本实现记录不代表已执行该探针。
