import { randomBytes } from 'node:crypto';
import { mkdir, rename, lstat, copyFile, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { requireAdministratorSchema } from '../src/access/administrator-schema.js';

const args=process.argv.slice(2);
const value=(name:string)=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
if(!args.includes('--service-stopped'))throw new Error('请先停止服务，并传入 --service-stopped；不能对正在使用的数据根操作。');
const raw=value('--data-dir');if(!raw || !isAbsolute(raw) || resolve(raw)==='/')throw new Error('需要 --data-dir 指定独立的绝对数据目录。');
const dataDir=resolve(raw);
const command=args[0];
if(args.includes('--control-scenarios') && args.includes('--no-control-scenarios'))throw new Error('场景控制权限的授予与撤销参数不能同时使用。');
if(command==='reset') {
  const rawBackup=value('--backup-dir');if(!rawBackup || !isAbsolute(rawBackup))throw new Error('需要独立的绝对 --backup-dir。');
  const backup=resolve(rawBackup);
  if(backup===dataDir || backup.startsWith(dataDir+'/') || dataDir.startsWith(backup+'/'))throw new Error('备份目录必须独立于数据目录。');
  if(await lstat(backup).catch(()=>null))throw new Error('备份目录已存在，不覆盖。');
  const stat=await lstat(dataDir);if(!stat.isDirectory() || stat.isSymbolicLink())throw new Error('数据根必须为普通目录。');
  await mkdir(dirname(backup),{recursive:true,mode:0o700});
  await rename(dataDir,backup);await mkdir(dataDir,{mode:0o700});
  const model=await lstat(resolve(backup,'model-settings.json')).catch(()=>null);
  if(model?.isFile() && !model.isSymbolicLink())await copyFile(resolve(backup,'model-settings.json'),resolve(dataDir,'model-settings.json'));
  console.info(`原数据完整保留在 ${backup}；新数据根已准备。请开通账号后启动。`);
} else {
  await mkdir(dataDir,{recursive:true,mode:0o700});
  const db=await openDatabase(dataDir);const store=new AccessStore(db);
  try {
    if(command==='initialize') {
      await ensureAuthConfig();console.info('登录数据目录已初始化；未创建账号或席位。可离线迁移后开通独立管理员。');
    } else if(command==='account' || command==='administrator') {
      const username=value('--username'),seatId=value('--seat');
      if(!username || command==='account'&&!seatId)throw new Error('需要 --username；业务账号还需 --seat。密码仅从终端隐蔽输入。');
      if(command==='administrator') {
        if(['--seat','--seat-name','--manage-tasks','--create-public','--manage-model','--view-work-overview','--control-scenarios','--no-control-scenarios'].some(flag=>args.includes(flag)))throw new Error('管理员账号不绑定业务席位或业务权限。');
        requireAdministratorSchema(db);
      }
      const password=await hiddenPassword('密码（至少10个字符）：');const repeated=await hiddenPassword('再次输入密码：');if(password!==repeated)throw new Error('两次密码不一致，未保存。');
      if(command==='administrator')await store.saveAdministratorAccount({username,displayName:value('--name')||username,password});
      else await store.saveAccount({username,seatId:seatId!,displayName:value('--name')||username,seatName:value('--seat-name')||seatId!,password,createPublicTask:args.includes('--manage-tasks') || args.includes('--create-public'),manageModelSettings:args.includes('--manage-model'),viewWorkOverview:args.includes('--view-work-overview'),...(args.includes('--control-scenarios') ? {controlScenarios:true} : args.includes('--no-control-scenarios') ? {controlScenarios:false} : {})});
      await ensureAuthConfig();
      console.info(`${command==='administrator'?'独立管理员账号':'业务账号'}已保存，旧登录已失效。签名配置位于被 Git 忽略的 .env.auth.local；密码未写入配置文件。`);
    } else if(command==='seat') {
      const seatId=value('--seat'), file=value('--responsibility-file');
      if(!seatId || !file)throw new Error('需要 --seat 与 --responsibility-file（UTF-8 职责文件）。');
      const seat=store.updateSeat(seatId,{name:value('--seat-name'),responsibility:await readFile(resolve(file),'utf8')});
      console.info(`${seat.name}职责已保存，版本 ${seat.responsibilityRevision}；账号和密码保持不变。`);
    } else if(command==='disable') {
      const username=value('--username');if(!username)throw new Error('需要 --username。');store.disable(username);console.info('账号已停用，旧登录已失效。');
    } else throw new Error('使用 initialize（空登录目录）、administrator（独立管理员）、account（业务账号）、seat（名称/职责）、disable 或 reset；参数说明见 README。');
  } finally {db.close();}
}
async function ensureAuthConfig() {
  const envPath=resolve('.env.auth.local');
  if(!await lstat(envPath).catch(()=>null))await writeFile(envPath,`LAB_AUTH_MODE=login\nLAB_SESSION_SECRET=${randomBytes(48).toString('base64url')}\nLAB_DATA_DIR=${dataDir}\n`,{flag:'wx',mode:0o600});
}
async function hiddenPassword(label:string):Promise<string> {
  if(!process.stdin.isTTY)throw new Error('密码需要在交互终端输入，不接受命令参数或管道。');
  process.stdout.write(label);emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();
  return new Promise((resolve,reject)=>{
    let text='';
    const finish=()=>{process.stdin.off('keypress',read);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};
    const read=(value:string,key:{name?:string;ctrl?:boolean})=>{
      if(key.ctrl && key.name==='c'){finish();reject(new Error('已取消。'));}
      else if(key.name==='return'){finish();resolve(text);}
      else if(key.name==='backspace')text=Array.from(text).slice(0,-1).join('');
      else if(value && !key.ctrl && Array.from(value).every(char=>char.charCodeAt(0)>=32 && char.charCodeAt(0)!==127))text+=value;
    };
    process.stdin.on('keypress',read);
  });
}
