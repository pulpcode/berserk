import { loadServerConfig } from './config.js';
import { PiLab } from '../pi/lab.js';
import { createApp } from './app.js';
import { managedSandboxReleaseEnv } from './sandbox-release.js';

const config = loadServerConfig(managedSandboxReleaseEnv());
const lab = await PiLab.create(config);
const app = await createApp(lab, true);
await app.listen({ host: config.listenHost ?? '127.0.0.1', port: config.port });
console.info(`Axon: ${config.publicOrigin ?? `http://127.0.0.1:${config.port}`} · ${lab.info().model} · ${lab.info().configured ? '模型已配置' : '等待模型配置'}`);
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => { void app.close(); });
}
