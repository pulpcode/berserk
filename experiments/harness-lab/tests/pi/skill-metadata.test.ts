import { afterEach, describe, expect, it, vi } from 'vitest';
import { controlledSkillDescription } from '../../src/pi/skill-metadata.js';
import { loadControlledSkills } from '../../src/resources/service.js';
import * as files from '../../src/resources/files.js';

afterEach(() => vi.restoreAllMocks());
describe('controlled Skill metadata', () => {
  it('uses SDK YAML parsing while retaining the exact file for hashing', async () => {
    const content = '---\nname: review\ndescription: >-\n  新方法：核对来源\n  与版本\n---\n完整正文\n';
    vi.spyOn(files, 'readControlled').mockResolvedValue(content);
    const [skill] = await loadControlledSkills(['review']);
    expect(skill).toEqual({id:'review',name:'结果检查',version:'1',description:'新方法：核对来源 与版本',content,hash:files.hashContent(content)});
    expect(controlledSkillDescription(content.replaceAll('\n','\r\n'), 'review')).toBe(skill.description);
  });
  it('refreshes metadata and content together without changing an earlier snapshot', async () => {
    const content = '---\nname: review\ndescription: 第一版简介\n---\n方法正文\n';
    const read = vi.spyOn(files, 'readControlled').mockResolvedValue(content);
    const first = (await loadControlledSkills(['review']))[0];
    read.mockResolvedValue(content.replace('第一版简介','第二版简介'));
    const second = (await loadControlledSkills(['review']))[0];
    expect(first.description).toBe('第一版简介');
    expect(second.description).toBe('第二版简介');
    expect(second.hash).not.toBe(first.hash);
    expect(second.content).toContain(second.description);
    await expect(loadControlledSkills(['unregistered'])).rejects.toMatchObject({code:'RESOURCE_NOT_FOUND'});
    expect(read).toHaveBeenCalledTimes(2);
  });
  it.each([
    'name: review\ndescription: 缺少文件头',
    '---\nname: synthesis\ndescription: 错误ID\n---\n正文',
    '---\nname: review\ndescription: 7\n---\n正文',
    '---\nname: review\ndescription: " "\n---\n正文',
    '---\nname: review\ndescription: 正常简介\n---\n ',
    '---\nname: review\ndescription: [broken\n---\n正文',
    '---\nname: review\nname: review\ndescription: 重复字段\n---\n正文',
  ])('rejects malformed or mismatched deployed content', async content => {
    vi.spyOn(files, 'readControlled').mockResolvedValue(content);
    await expect(loadControlledSkills(['review'])).rejects.toMatchObject({code:'RESOURCE_STATE_INVALID',statusCode:409});
  });
});
