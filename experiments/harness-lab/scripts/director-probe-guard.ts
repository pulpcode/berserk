/** Historical Orchard fixtures cannot be relabelled as a current harbor debug run. */
export function requireDirectorProbeRebuild(name:string):void {
  throw new Error(`${name} 使用旧 map-* 独立地图事实，真实模型验收入口已停用。须按导演台自由调试的 run-* 预置数据重新编排业务用例后再运行，不能仅改 URL 或套用旧事实。当前可在 /director 明确切换自由调试并使用轮次限定编辑；自动回归为 tests/scenario-director-api.test.ts 和 tests/director-debug-store.test.ts。未创建环境、修改数据、发送通知或调用模型。`);
}
