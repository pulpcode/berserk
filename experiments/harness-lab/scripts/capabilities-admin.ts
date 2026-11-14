import { lstat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SystemRoles } from '../src/access/system-roles.js';
import { checkDirectory } from '../src/resources/files.js';
import { CapabilityService } from '../src/capabilities/service.js';
import { controlledSkillIds, loadControlledSkills } from '../src/resources/service.js';
import { loadAgentRoles } from '../src/pi/roles.js';
import { assertCapabilityMigrationReady } from '../src/pi/capability-migration.js';

const args = process.argv.slice(2);
const value = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
try {
  if (!args.includes('--service-stopped')) throw new Error('请先停止服务，并传入 --service-stopped；不能对正在使用的数据根操作。');
  const raw = value('--data-dir');
  if (!raw || !isAbsolute(raw) || resolve(raw) === '/') throw new Error('需要 --data-dir 指定已初始化的绝对数据目录。');
  const command = args[0];
  if (!['grant', 'revoke', 'list', 'sync'].includes(command)) throw new Error('用法：capabilities:admin grant|revoke|list|sync --data-dir ABS --service-stopped [--username NAME]');
  await assertCapabilityMigrationReady(resolve(raw));
  if (command === 'sync') {
    await checkDirectory(resolve(raw));
    const capabilities = await CapabilityService.open(resolve(raw));
    try {
      await capabilities.registerBuiltins({ skills: await loadControlledSkills(controlledSkillIds), roles: await loadAgentRoles() });
      console.info(JSON.stringify(await capabilities.adminSummary(), null, 2));
    } finally { capabilities.close(); }
  } else {
  const directory = join(resolve(raw), 'collaboration'); await checkDirectory(directory);
  const path = join(directory, 'collaboration.sqlite'); const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('认证数据库不是受控普通文件。');
  const db = new DatabaseSync(path, command === 'list' ? { readOnly: true } : {});
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL');
    const roles = new SystemRoles(db);
    if (command === 'list') console.info(JSON.stringify({ administrators: roles.list() }, null, 2));
    else {
      const username = value('--username'); if (!username) throw new Error('需要 --username 指定已有账号。');
      if (command === 'grant') console.info(JSON.stringify({ administrator: roles.grant(username) }, null, 2));
      else { roles.revoke(username); console.info('账号的管理员角色已撤销；业务权限保持原值。'); }
    }
  } finally { db.close(); }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : '管理员角色操作失败。');
  process.exitCode = 1;
}
