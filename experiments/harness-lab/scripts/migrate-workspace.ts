import { migrateWorkspace } from '../src/pi/migration.js';
const args = process.argv.slice(2);
const value = (key: string) => { const index = args.indexOf(key); return index === -1 ? '' : args[index + 1] || ''; };
const apply = args.includes('--apply');
if (apply === args.includes('--dry-run') || !value('--data-dir') || !value('--backup-dir')) {
  console.error('用法：npm run migrate:workspace -- --data-dir ABS --backup-dir ABS (--dry-run | --apply --service-stopped)');
  process.exitCode = 1;
} else {
  try {
    const report = await migrateWorkspace({ dataDir: value('--data-dir'), backupDir: value('--backup-dir'), apply, serviceStopped: args.includes('--service-stopped') });
    console.info(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...report }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : '升级失败，原目录和备份已保留。');
    process.exitCode = 1;
  }
}
