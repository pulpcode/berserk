import { execFileSync } from "node:child_process";
import { loadServerConfig } from "../src/server/config.js";
import { sandboxReleaseEnv } from "../src/server/sandbox-release.js";

export function deployPreflight(env = process.env, bindingPath?: URL) {
  if (["LAB_AUTH_MODE", "LAB_SESSION_SECRET", "LAB_DATA_DIR"].some(key => env[key] !== undefined)) {
    throw new Error("instance.env 中的认证与数据目录由 auth.env 管理。");
  }
  const { execution, port } = loadServerConfig({ ...sandboxReleaseEnv(env, bindingPath), LAB_SESSION_SECRET: "preflight-only-configuration-value" });
  if (execution?.enabled) {
    const docker = (...args: string[]) => execFileSync("docker", args, { stdio: ["ignore", 2, 2] });
    try {
      const serverVersion = execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" }).trim();
      if (!serverVersion || serverVersion === "<no value>") throw new Error("Docker Server version unavailable");
    }
    catch { throw new Error("沙盒已启用，请启动 Docker 并确认当前服务账号可访问 daemon。"); }
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_./:@-]*$/.test(execution.image)) throw new Error("执行镜像名称无效。");
    try { execFileSync("docker", ["image", "inspect", execution.image], { stdio: "ignore" }); }
    catch {
      try { docker("pull", "--platform=linux/amd64", execution.image); }
      catch { throw new Error(`无法从 GHCR 拉取沙盒镜像 ${execution.image}。`); }
    }
    docker("run", "--rm", "--pull=never", "--platform=linux/amd64", "--network=none", "--read-only", "--user", execution.uid + ":" + execution.gid,
      "--cap-drop=ALL", "--security-opt=no-new-privileges", "--entrypoint", "/bin/sh", execution.image,
      "-c", "test \"$(id -u)\" -ne 0");
  }
  return port;
}

if (import.meta.main) console.log(deployPreflight());
