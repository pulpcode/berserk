import { migrateCapabilities } from '../src/pi/capability-migration.js';

const args = process.argv.slice(2);
const value = (key: string) => { const index = args.indexOf(key); return index < 0 ? '' : args[index + 1] || ''; };
const apply = args.includes('--apply');
if (apply === args.includes('--dry-run') || !value('--data-dir') || !value('--backup-dir')) {
  console.error('用法：npm run migrate:capabilities -- --data-dir ABS --backup-dir ABS (--dry-run | --apply --service-stopped)');
  process.exitCode = 1;
} else {
  try {
    const report = await migrateCapabilities({ dataDir: value('--data-dir'), backupDir: value('--backup-dir'), apply, serviceStopped: args.includes('--service-stopped') });
    console.info(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : '能力中心迁移失败；原目录和备份已保留。');
    process.exitCode = 1;
  }
}
