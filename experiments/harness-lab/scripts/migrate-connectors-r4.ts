import { parseArgs } from 'node:util';
import { migrateConnectorsR4 } from '../src/connectors/migration.js';

try {
  const {values} = parseArgs({options:{
    'data-dir':{type:'string'},
    'backup-dir':{type:'string'},
    'context-config':{type:'string'},
    'background-config':{type:'string'},
    'key-file':{type:'string'},
    'credential-file':{type:'string',multiple:true},
    'dry-run':{type:'boolean'},
    apply:{type:'boolean'},
    'service-stopped':{type:'boolean'},
  }});
  const dataDir=values['data-dir'], backupDir=values['backup-dir'], apply=values.apply===true;
  if (!dataDir || !backupDir || apply===(values['dry-run']===true)) throw Error('用法：--data-dir ABS --backup-dir ABS [--context-config ABS] [--background-config ABS] [--key-file ABS] [--credential-file ABS ...] (--dry-run | --apply --service-stopped)');
  console.info(JSON.stringify(await migrateConnectorsR4({
    dataDir,backupDir,apply,serviceStopped:values['service-stopped']===true,
    contextConfigPath:values['context-config'],backgroundConfigPath:values['background-config'],
    keyFile:values['key-file'],credentialFiles:values['credential-file'],
  }),null,2));
} catch (error) {
  console.error(error instanceof Error?error.message:'R4连接迁移失败，请保留数据和备份。');
  process.exitCode=1;
}
