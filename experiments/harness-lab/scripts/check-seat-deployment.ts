import { parseArgs } from 'node:util';
import { checkSeatDeployment } from '../src/access/seat-deployment.js';

function paths() {
  try {
    const { values } = parseArgs({ options: { manifest: { type: 'string' }, 'data-dir': { type: 'string' } } });
    if (values.manifest && values['data-dir']) return { manifestPath: values.manifest, dataDir: values['data-dir'] };
  } catch {
    // Report the accepted syntax without echoing the supplied arguments.
  }
  throw new Error('用法 npm run seats:check -- --manifest /abs/seats.json --data-dir /abs/data');
}

try {
  const report = await checkSeatDeployment(paths());
  console.info(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : '席位部署预检失败。');
  process.exitCode = 1;
}
