import { migrateCapabilityManagement } from '../src/capabilities/management-migration.js';
const args=process.argv.slice(2);const value=(key:string)=>{const index=args.indexOf(key);return index>=0?args[index+1]:undefined;};
try {
  const dataDir=value('--data-dir'),backupDir=value('--backup-dir');const apply=args.includes('--apply');
  if(!dataDir||!backupDir||apply===args.includes('--dry-run'))throw Error('用法：--data-dir ABS --backup-dir ABS (--dry-run | --apply --service-stopped)');
  console.info(JSON.stringify(await migrateCapabilityManagement({dataDir,backupDir,apply,serviceStopped:args.includes('--service-stopped')}),null,2));
} catch(error) {console.error(error instanceof Error?error.message:'R2迁移失败，请保留原目录和备份。');process.exitCode=1;}
