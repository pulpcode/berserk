import { migrateSeats } from '../src/workspaces/seat-migration.js';
const args = process.argv.slice(2);
const value = (key: string) => { const index = args.indexOf(key); return index < 0 ? undefined : args[index + 1]; };
const apply = args.includes('--apply');
if (apply === args.includes('--dry-run') || !value('--data-dir') || !value('--backup-dir')) {
  console.error('用法：npm run migrate:seats -- --data-dir ABS --backup-dir ABS [--seat-id test-seat] (--dry-run | --apply --service-stopped)');
  process.exitCode = 1;
} else {
  try { console.info(JSON.stringify(await migrateSeats({dataDir: value('--data-dir')!, backupDir: value('--backup-dir')!, seatId: value('--seat-id'), apply, serviceStopped: args.includes('--service-stopped')}), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : '升级失败，原文件与备份保留。'); process.exitCode = 1; }
}
