import type { SkillFileInput } from '../contracts/skills.js';
import { RequestError } from '../contracts/errors.js';
import { packageContent } from '../skills/package.js';

const dependencyManifest = /(^|\/)(package(?:-lock)?\.json|npm-shrinkwrap\.json|pnpm-workspace\.ya?ml|composer\.json|bower\.json|deno\.json|jsr\.json|environment(?:[.-][^/]*)?\.ya?ml|conda-lock\.ya?ml|pyproject\.toml|requirements[^/]*|[a-z]*lock\.[^/]+)$/i;

/** R3A edits methods, references and text templates. Other packages remain manually editable. */
export function methodFiles(files: SkillFileInput[], requirements: Record<string, string>) {
  const parsed = packageContent(files, requirements);
  if (Object.keys(requirements).length || parsed.content.files.some(file =>
    !/\.(md|txt|csv|tsv|json|yaml|yml|xml|j2|jinja|template)$/i.test(file.path)
    || /(^|\/)(scripts|bin|node_modules|\.github)(\/|$)/i.test(file.path)
    || dependencyManifest.test(file.path)
    || Buffer.from(file.contentBase64, 'base64').includes(0))) {
    throw new RequestError('AUTHORING_METHOD_ONLY', '本轮对话仅维护方法、文本参考和文本模板；含脚本、二进制或安装配置的包请使用手动编辑。', 409);
  }
  if (!parsed.validation.valid) throw new RequestError('SKILL_INVALID', parsed.validation.issues.filter(issue => issue.severity === 'error').map(issue => issue.message).join(' '));
  return parsed;
}
