# 工作任务图标跟进

用户确认：工作任务采用工作公文包，个人空间保持文件夹。任务详情布局仍待审阅，本次未调整。

- WorkspaceNavigation 按分组选择 BriefcaseBusiness / Folder，展开与收起侧栏一致；收起侧栏的新建工作任务入口同步公文包，个人空间保留 FolderPlus。
- 本地 typecheck、lint、build、git diff --check 通过。构建保留既有 chunk 大小警告。
- 线上仅应用导航文件补丁，备份：`/home/ubuntu/axon-map-release-e073df6/backup/task-icons-20261011T124721Z/code.tar.gz`。
- 服务器构建成功，保留旧资源并最后切换 index.html；未重启服务。health 返回 ok。
- 公网登录验证：工作任务 3 行在展开/收起侧栏均显示 BriefcaseBusiness；个人空间收起入口保留 FolderPlus。该席位当前无个人空间条目，条目 Folder 分支由代码审阅确认。
