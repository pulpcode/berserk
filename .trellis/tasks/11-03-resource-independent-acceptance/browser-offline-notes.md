# 桌面引用离线证据

所有响应为确定性本地provider，真实产品Web/API、AnnotationService与来源HTTP未伪造；没有在线模型调用。视口1600×1000，禁用外部地图瓦片请求。

- `/private/tmp/resource-independent-browser-20261103-c`：P01、N02、N03均实际发送1次、pageerror为空。保存原始sent-message-bodies、消息响应、原生快照和截图。P01普通点击矩形时两个引用区均为空，随后发送固定assets图层+area对象。N02发送实际受控副本对象及两个来源汇总，N03发送四个来源引用。
- `/private/tmp/resource-independent-browser-20261103-d`：改为公开API显式启动已冻结的chromium.executablePath后，只复查受影响的P01，一次发送成功、无pageerror。详见checks/browser-explicit-binary.log。
- 前期a保留P01通过及N02定位导入对象的driver失败；b保留P01/N02通过及N03仅来源引用没有draftRef的driver失败。已分别改为读实际固定版本寻找导入对象、支持source-only引用。均为付费执行前的离线运行器错误，不计产品/模型成绩。

复查命令（目录必须全新）：

```sh
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs .trellis/tasks/11-03-resource-independent-acceptance/browser.ts offline /absolute/new-offline-dir 4347 P01 N02 N03
```
