import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { createSkillMethod, readSkillMethod, updateSkillMethod } from '../src/web/skill-method.js';
import { packageContent } from '../src/skills/package.js';

const original = '# retained comment\r\nname: old-name # name comment\r\ndescription: |\r\n  imported description\r\nmetadata:\r\n  owner: external\r\nuser-invocable: false\r\ncustom:\r\n  entries: [one, two]';
const source = `---\r\n${original}\r\n---\r\n原始正文\r\n第二行\r\n`;
test('opening or no-op editing preserves imported bytes and body-only edit leaves frontmatter untouched', () => {
  const fields = readSkillMethod(source)!;
  expect(fields).toMatchObject({ name: 'old-name', description: 'imported description\n', instructions: '原始正文\r\n第二行\r\n' });
  expect(updateSkillMethod(source, fields)).toBe(source);
  expect(updateSkillMethod(source, {})).toBe(source);
  const changed = updateSkillMethod(source, { instructions: '新的正文' });
  expect(changed).toBe(`---\r\n${original}\r\n---\r\n新的正文`);
});
test('metadata edits preserve unknown fields, extensions, comments and original body line endings', () => {
  const changed = updateSkillMethod(source, { name: 'new-name', description: 'A "quoted" description\nwith another line' });
  const fields = readSkillMethod(changed)!;
  expect(fields.name).toBe('new-name'); expect(fields.description).toBe('A "quoted" description\nwith another line');
  expect(fields.instructions).toBe(readSkillMethod(source)!.instructions);
  const header = changed.slice(5, changed.indexOf('\r\n---', 5));
  expect(parse(header)).toMatchObject({ metadata: { owner: 'external' }, 'user-invocable': false, custom: { entries: ['one', 'two'] } });
  expect(changed).toContain('# retained comment'); expect(changed).toContain('# name comment');
  expect(changed.replaceAll('\r\n', '')).not.toContain('\n');
});
test.each(['\n', '\r\n'])('adding a body to an EOF fence inserts one %j separator and remains valid', newline => {
  const text = ['---', 'name: eof-method', 'description: ends at fence', '---'].join(newline);
  expect(updateSkillMethod(text, readSkillMethod(text)!)).toBe(text);
  const updated = updateSkillMethod(text, { instructions: 'new body' });
  expect(updated).toBe(text + newline + 'new body');
  expect(readSkillMethod(updated)?.instructions).toBe('new body');
});
test('form creation quotes metadata safely, permits empty instructions and retains exact instructions', () => {
  const instructions = '## 步骤\n不要替换未知元数据。\n';
  const text = createSkillMethod({ name: '资料摘要', description: '描述: "quoted"\nlicense: forged', instructions });
  expect(readSkillMethod(text)).toEqual({ name: '资料摘要', description: '描述: "quoted"\nlicense: forged', instructions });
  const parsed = packageContent([{ path: 'SKILL.md', contentBase64: Buffer.from(text).toString('base64') }]);
  expect(parsed.validation.valid).toBe(true); expect(parsed.validation.extensions).toEqual([]);
  const empty = packageContent([{ path: 'SKILL.md', contentBase64: Buffer.from(createSkillMethod({ name: 'empty-body', description: 'later', instructions: '' })).toString('base64') }]);
  expect(empty.validation.valid).toBe(true); expect(empty.validation.issues.some(i => i.code === 'AXON_EMPTY_BODY')).toBe(true);
});
test.each(['name: invalid', '---\nname: duplicate\nname: second\ndescription: test\n---\nbody', '---\nname: [list]\ndescription: test\n---\nbody'])('unadapted or damaged frontmatter remains unchanged for source editing', text => {
  expect(readSkillMethod(text)).toBeUndefined(); expect(updateSkillMethod(text, { name: 'replacement' })).toBe(text);
});
