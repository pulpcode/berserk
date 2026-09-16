import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
async function check(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) { await check(path); continue; }
    if (!/\.[jt]sx?$/.test(path) || path.startsWith('src/pi/')) continue;
    const source = await readFile(path, 'utf8');
    if (/@earendil-works\/pi-|SessionManager|\.jsonl/.test(source)) throw new Error(`Pi dependency escaped src/pi: ${path}`);
    if (path.startsWith('src/web/') && /from ['"].*(?:\/pi\/|\/server\/)/.test(source)) throw new Error(`Server dependency escaped into web: ${path}`);
  }
}
await check('src');
console.info('Pi and browser dependency boundaries passed.');
