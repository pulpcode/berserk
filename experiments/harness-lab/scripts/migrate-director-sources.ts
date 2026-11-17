import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { migrateDirectorSources, type DirectorSourceMapping } from '../src/connectors/director-migration.js';
const {values}=parseArgs({options:{'data-dir':{type:'string'},'backup-dir':{type:'string'},mapping:{type:'string'},'external-file':{type:'string',multiple:true},apply:{type:'boolean'},'dry-run':{type:'boolean'},'service-stopped':{type:'boolean'}}});
if(values.apply&&values['dry-run'])throw Error('不能同时使用 --apply 和 --dry-run。');
if(!values['data-dir']||!values['backup-dir']||!values.mapping)throw Error('需要 --data-dir、--backup-dir、--mapping；先 dry-run，停服后 --apply --service-stopped。外部配置和凭证均须 --external-file 配对备份。');
const mapping=JSON.parse(await readFile(values.mapping,'utf8')) as DirectorSourceMapping[];
console.log(JSON.stringify(await migrateDirectorSources({dataDir:values['data-dir'],backupDir:values['backup-dir'],mapping,externalFiles:values['external-file']??[],apply:!!values.apply,serviceStopped:!!values['service-stopped']}),null,2));
