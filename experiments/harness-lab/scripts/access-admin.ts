import { randomBytes } from 'node:crypto';
import { mkdir, rename, lstat, copyFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';

const args=process.argv.slice(2);
const value=(name:string)=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
if(!args.includes('--service-stopped'))throw new Error('请先停止服务，并传入 --service-stopped；不能对正在使用的数据根操作。');
const raw=value('--data-dir');if(!raw || !isAbsolute(raw) || resolve(raw)==='/')throw new Error('需要 --data-dir 指定独立的绝对数据目录。');
const dataDir=resolve(raw);
const command=args[0];
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
    if(command==='account') {
      const username=value('--username'),seatId=value('--seat');if(!username || !seatId)throw new Error('需要 --username 与 --seat。密码仅从终端隐蔽输入。');
      const password=await hiddenPassword('密码（至少12个字符）：');const repeated=await hiddenPassword('再次输入密码：');if(password!==repeated)throw new Error('两次密码不一致，未保存。');
      await store.saveAccount({username,seatId,displayName:value('--name')||username,seatName:value('--seat-name')||seatId,password,createPublicTask:args.includes('--create-public'),manageModelSettings:args.includes('--manage-model')});
      const envPath=resolve('.env.auth.local');
      if(!await lstat(envPath).catch(()=>null))await writeFile(envPath,`LAB_AUTH_MODE=login\nLAB_SESSION_SECRET=${randomBytes(48).toString('base64url')}\nLAB_DATA_DIR=${dataDir}\n`,{flag:'wx',mode:0o600});
      console.info('账号已保存，旧登录已失效。签名配置位于被 Git 忽略的 .env.auth.local；密码未写入配置文件。');
    } else if(command==='disable') {
      const username=value('--username');if(!username)throw new Error('需要 --username。');store.disable(username);console.info('账号已停用，旧登录已失效。');
    } else throw new Error('使用 account（开通/重置）、disable 或 reset；参数说明见 README。');
  } finally {db.close();}
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
