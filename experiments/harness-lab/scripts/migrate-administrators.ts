import { migrateAdministratorAccess } from '../src/access/administrator-migration.js';
const args=process.argv.slice(2);const value=(key:string)=>{const index=args.indexOf(key);return index>=0?args[index+1]:undefined;};
try {
  const dataDir=value('--data-dir'),backupDir=value('--backup-dir'),apply=args.includes('--apply');
  if(!dataDir||!backupDir||apply===args.includes('--dry-run'))throw Error('用法：--data-dir ABS --backup-dir ABS (--dry-run | --apply --service-stopped)');
  console.info(JSON.stringify(await migrateAdministratorAccess({dataDir,backupDir,apply,serviceStopped:args.includes('--service-stopped')}),null,2));
} catch(error){console.error(error instanceof Error?error.message:'管理员账号迁移失败，请保留原目录与备份。');process.exitCode=1;}
