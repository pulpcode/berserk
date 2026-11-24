import { existsSync, readFileSync } from 'node:fs';

const bindingPath = new URL('../../../../release/sandbox-image.json', import.meta.url);
const imagePattern = /^ghcr\.io\/pulpcode\/berserk-file-runtime@sha256:[a-f0-9]{64}$/;

export function sandboxReleaseEnv(
  env: NodeJS.ProcessEnv = process.env,
  path = bindingPath,
): NodeJS.ProcessEnv {
  if (env.LAB_EXECUTION_ENABLED === 'false') return env;

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new Error('缺少 release/sandbox-image.json，请检出包含镜像摘要的正式发布版本。');
  }
  const binding = JSON.parse(raw) as { image?: unknown; platform?: unknown } | null;
  if (typeof binding?.image !== 'string' || !imagePattern.test(binding.image) || binding.platform !== 'linux/amd64') {
    throw new Error('release/sandbox-image.json 须绑定公开 GHCR 镜像的 SHA256 摘要与 linux/amd64 平台。');
  }
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('这个发布版本的沙盒镜像需要 linux/amd64。');
  }
  if (env.LAB_EXECUTION_IMAGE !== undefined && env.LAB_EXECUTION_IMAGE !== binding.image) {
    throw new Error('LAB_EXECUTION_IMAGE 与发行版本的镜像摘要冲突，请从 instance.env 移除该覆盖。');
  }
  return { ...env, LAB_EXECUTION_IMAGE: binding.image };
}

export function managedSandboxReleaseEnv(
  env: NodeJS.ProcessEnv = process.env,
  path = bindingPath,
): NodeJS.ProcessEnv {
  const marker = new URL('.managed-deployment', path);
  return existsSync(marker) ? sandboxReleaseEnv(env, path) : env;
}
