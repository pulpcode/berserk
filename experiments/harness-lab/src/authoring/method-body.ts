import type { SkillFileInput } from '../contracts/skills.js';
import { RequestError } from '../contracts/errors.js';
import { decodeSkillFile } from '../skills/package.js';

/** Replace only an already validated method's body; never serialize its YAML metadata. */
export function replaceMethodBody(file: SkillFileInput, body: string): SkillFileInput {
  if (file.path !== 'SKILL.md' || typeof body !== 'string') throw new RequestError('INVALID_INPUT', '正文修改需要已有SKILL.md。');
  const source=Buffer.from(decodeSkillFile(file).contentBase64,'base64').toString('utf8');
  const match=/^(\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$))([\s\S]*)$/.exec(source);
  if (!match) throw new RequestError('SKILL_INVALID', '请先在手动编辑中修正SKILL.md元数据。');
  if (match[2] === body) return file;
  const separator=body&&!match[1].endsWith('\n')?(match[1].includes('\r\n')?'\r\n':'\n'):'';
  return {path:file.path,contentBase64:Buffer.from(match[1]+separator+body,'utf8').toString('base64')};
}
