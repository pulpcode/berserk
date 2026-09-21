import { isAbsolute, resolve } from 'node:path';
import { lstat } from 'node:fs/promises';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { BackgroundStore } from '../src/background/store.js';
import { loadBackgroundConfig } from '../src/background/config.js';

const args = process.argv.slice(2);
const value = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
if (!args.includes('--service-stopped')) throw new Error('请先停止服务，并传入 --service-stopped。');
const raw = value('--data-dir');
if (!raw || !isAbsolute(raw) || resolve(raw) === '/') throw new Error('需要 --data-dir 指定已有正式账号数据目录的绝对路径。');
const dataDir = resolve(raw);
const stat = await lstat(dataDir); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('数据根必须为普通目录。');
const config = await loadBackgroundConfig();
if (!config) throw new Error('请通过 LAB_BACKGROUND_CONFIG 指定已登记来源的配置文件。');
const db = await openDatabase(dataDir);
try {
  if (Number(db.prepare('PRAGMA user_version').get()?.user_version) < 2) throw new Error('请先开通正式账号；该入口不升级历史测试身份。');
  new AccessStore(db); const store = new BackgroundStore(db);
  if (args[0] === 'list') {
    console.info(JSON.stringify(store.listGrants(), null, 2));
  } else if (args[0] === 'grant' || args[0] === 'revoke') {
    const sourceId = value('--source'), username = value('--account'), seatId = value('--seat');
    if (!sourceId || !config.sources.some(source => source.sourceId === sourceId) || (!!username === !!seatId)) throw new Error('需要已登记的 --source，及 --account 用户名或 --seat 席位ID（二选一）。');
    const kind = username ? 'account' as const : 'seat' as const;
    const account = username ? db.prepare('SELECT id FROM accounts WHERE username=?').get(username) : undefined;
    if (username && !account) throw new Error('账号不存在。');
    const subjectId = username ? String(account!.id) : seatId!;
    if (args[0] === 'revoke') store.revoke(kind, subjectId, sourceId);
    else {
      const permission = value('--permission'); if (permission !== 'view' && permission !== 'manage') throw new Error('--permission 必须为 view 或 manage。');
      store.grant(kind, subjectId, sourceId, permission);
    }
    console.info('来源范围内的信息中心授权已保存；不会授予他人私有会话访问权。');
  } else throw new Error('使用 list，或 grant/revoke --source ID --account USERNAME|--seat ID；grant 还需要 --permission view|manage。');
} finally { db.close(); }
