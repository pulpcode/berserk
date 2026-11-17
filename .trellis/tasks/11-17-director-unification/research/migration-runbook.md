# 迁移与回退操作记录（待上线授权）

当前只完成本地实施及配置副本测试，未执行线上迁移或服务更新，用户验收 pending。

## 明确映射

| 业务 | 后续有效来源 | 场景演练原策略 | 自由调试原策略 |
| --- | --- | --- | --- |
| 情报接入 | scenario-intel-source | scenario-intel-source | mock-intel-source |
| 态势接入 | scenario-situation-source | scenario-situation-source | mock-situation-source |

旧策略标识保留原规则与授权依据，不是额外有效接收入口。两条 mock 来源拒绝新上传及新事件；凭证仅供原回执、上传状态只读核对。旧事件、作业、投递、关联和哈希不改写。演练控制仍有独立凭证和导演权限。

## 发布前

1. 按届时授权核对目标服务、程序提交、数据根、source进程及其独立数据根、所有外置env/配置/加密密钥位置。不得将4315与4316配置或密钥混用。
2. 只读核查当前活动轮次、未确认通知、排队/运行作业、持续研判配置及已有规则/授权。保留现场摘要；不得为通过预检删除或任选规则。映射关联的已启用持续研判配置目前会明确阻断，需要先给出其显式迁移办法。
3. 将映射文件与实际配置逐项核对。本地fixture是脱敏真实配置配合构造历史库的技术验证，不代替待发布服务的真实数据预检。
4. 同时停止宿主和source写入方，排除旧CLI、探针及其他后台发送方。保留旧程序及完整启动参数。没有停止写入时不执行apply。
5. 配对备份宿主完整数据根、source完整数据根、外置配置/凭证/加密密钥与旧程序。source数据库可能不在宿主data-dir，必须单独备份其整个目录，包括可能存在的SQLite附属文件；不能把二进制数据库当作CLI的external-file文本输入。记录文件校验和及目录对应关系。

## 预检与应用

在 harness-lab 目录运行以下参数结构，路径由实际部署核实填入；每个外置文本配置/密钥分别重复 `--external-file`：

```sh
npx tsx scripts/migrate-director-sources.ts \
  --data-dir /absolute/host-data \
  --backup-dir /absolute/new-backup-directory \
  --mapping /absolute/reviewed-mapping.json \
  --external-file /absolute/service.env \
  --external-file /absolute/connector-keys.json
```

预检无写入。检查conflicts、有效来源、profile/recipient/grant清单和历史不改写声明。全部冲突解决后，在同一停服现场用原参数追加 `--apply --service-stopped`。脚本校验完整宿主备份及外置凭证配对，再只修改连接器快照与绑定；其他业务表保持原字节/关系。完成标记前重启新服务会拒绝使用不完整迁移；重入使用同样映射、目录及外置文件。

若中断，不删除marker、不换参数、不覆盖原备份；先保留失败现场并只读核对，再用原请求完成或按下述整体回退。

## 上线核对

先启动相匹配的source，再启动宿主；核对新入口、旧地址404、两业务接入、独立查询与通知接收开关，以及原席位访问范围。旧来源POST必须拒绝，旧回执GET仍仅凭原授权可读。历史ID/哈希/关联与备份比对不变。

明确点击切换后才创建调试轮次；刷新无创建/发送；保存与发送分离；重开产生新轮，历史可读。未取得本轮测试授权前，不替用户发送真实业务通知。

## 回退

先停宿主及source，完整保留失败现场；恢复配对的宿主数据、source数据、外置配置/密钥和旧程序，再按原启动参数启动。不能让旧程序直接打开已写schema4的新source数据，也不能只还原某一SQLite表。已发送通知不能撤销：保留失败现场及其回执依据，防止重放成新通知。
