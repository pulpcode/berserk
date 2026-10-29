# 重复验证离线检查

2026-10-29。3/3测试、TypeScript及根目录ESLint通过；真实模型请求0。

1. 30槽唯一ID、五题各组3次交错；原题/预期逐值一致，夹具和回复直接复用；请求240、输入600万、输出15万及32768输出预留检查。
2. 30/30本地HTTP夹具准备成功，各会话ID不同，原数据/题干/预期/回复一致（约100秒）。证据：`/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/integrated-repeat-aTl7pl/batch`。
3. P02/P05两组4槽受控原生HTTP/Pi回放，20次假响应；实际AskUser API、P05两轮和保存同对象browser关口均执行，几何与700米预览逐值一致（约26秒）。证据：`/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/integrated-repeat-aHHHyE/batch`。不替代真实语义评分/浏览器验收。

旧live目录未改，新run/provider/budget仅改新导入、预算、冻结/claim和去掉旧首4暂停。终态复核、AskUser、P05浏览器关口保留。

准备过程记录：创建目录发现review已创建，写入前停止后复用；第一次包内ESLint忽略外部文件，改根config验证通过；首次记录/冻结用了包内相对路径，未写入也未发模型，现以绝对根路径纠正。上述不算任务失败。
