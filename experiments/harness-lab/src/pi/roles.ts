import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { RequestError } from '../contracts/errors.js';
import { checkDirectory, hashContent, readControlled } from '../resources/files.js';
import { fixtureDir } from '../tools/sources.js';

export const readonlyToolNames = ['source_list', 'source_read', 'instructions_read', 'skill_read'] as const;
export interface AgentRole {
  readonly name: string;
  readonly description: string;
  readonly tools: readonly string[];
  readonly systemPrompt: string;
  readonly hash: string;
}
const invalid = (message: string) => new RequestError('ROLE_CONFIG_INVALID', `子 Agent 角色配置错误：${message}`, 503);

/** Each request gets its own immutable definitions; no global directory or model discovery. */
export async function loadAgentRoles(directory = join(fixtureDir, 'agents'), signal?: AbortSignal): Promise<AgentRole[]> {
  signal?.throwIfAborted();
  try {
    await checkDirectory(directory);
    const files = (await readdir(directory, { withFileTypes: true })).filter(file => file.name.endsWith('.md')).sort((a, b) => a.name.localeCompare(b.name));
    if (!files.length) throw invalid('请在受控 agents 目录配置至少一个角色。');
    const roles: AgentRole[] = [];
    for (const file of files) {
      signal?.throwIfAborted();
      if (!file.isFile() || file.isSymbolicLink()) throw invalid('角色必须是受控目录中的普通 Markdown 文件。');
      const content = await readControlled(join(directory, file.name), 64 * 1024);
      signal?.throwIfAborted();
      if (content === null) throw invalid('无法读取角色文件。');
      const { frontmatter, body } = parseFrontmatter(content);
      if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) throw invalid('文件头必须包含名称、职责和工具声明。');
      if (Object.keys(frontmatter).some(key => !['name', 'description', 'tools'].includes(key))) throw invalid('仅支持 name、description、tools；模型继承父请求，不能配置 model 或权限覆盖。');
      const { name, description, tools } = frontmatter;
      if (typeof name !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(name)) throw invalid('name 必须以小写字母开头，仅含小写字母、数字、下划线或短横线。');
      if (roles.some(role => role.name === name)) throw invalid('角色名称重复。');
      if (typeof description !== 'string' || !description.trim() || !body.trim()) throw invalid('职责和角色提示正文不能为空。');
      const names: unknown[] | undefined = Array.isArray(tools) ? tools
        : typeof tools === 'string' && tools.trim() ? tools.split(',').map(value => value.trim()) : undefined;
      if (!names || names.some(value => typeof value !== 'string' || !(readonlyToolNames as readonly string[]).includes(value))) throw invalid('tools 必须显式列出获准只读工具；无工具角色请使用 []。');
      if (new Set(names).size !== names.length) throw invalid('工具声明重复。');
      roles.push(Object.freeze({ name, description: description.trim(), tools: Object.freeze(names as string[]), systemPrompt: body.trim(), hash: hashContent(content) }));
    }
    signal?.throwIfAborted();
    return roles;
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof RequestError && error.code === 'ROLE_CONFIG_INVALID') throw error;
    throw invalid('请检查目录和文件格式；文件须为有效 UTF-8，且每份不超过 64 KiB。');
  }
}
