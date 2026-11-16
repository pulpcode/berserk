import { isMap, parseDocument } from 'yaml';

export interface SkillMethodFields { name: string; description: string; instructions: string }

function document(source: string) {
  const match = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))([\s\S]*)$/.exec(source);
  if (!match) return;
  try {
    const yaml = parseDocument(match[2], { uniqueKeys: true });
    if (yaml.errors.length || !isMap(yaml.contents)) return;
    const values: unknown = yaml.toJS({ maxAliasCount: 0 });
    if (!values || typeof values !== 'object' || !('name' in values) || !('description' in values)
      || typeof values.name !== 'string' || typeof values.description !== 'string') return;
    return { match, yaml, fields: { name: values.name, description: values.description, instructions: match[4] } };
  } catch { return; }
}

/** Viewing and no-op edits retain every original byte, including imported metadata. */
export function readSkillMethod(source: string): SkillMethodFields | undefined { return document(source)?.fields; }

export function updateSkillMethod(source: string, patch: Partial<SkillMethodFields>): string {
  const value = document(source);
  if (!value) return source;
  const fields = { ...value.fields, ...patch };
  const metadataChanged = fields.name !== value.fields.name || fields.description !== value.fields.description;
  const bodyChanged = fields.instructions !== value.fields.instructions;
  if (!metadataChanged && !bodyChanged) return source;
  const newline = value.match[1].endsWith('\r\n') ? '\r\n' : '\n';
  const fence = value.match[3] + (fields.instructions && !value.match[3].endsWith('\n') ? newline : '');
  if (!metadataChanged) return value.match[1] + value.match[2] + fence + fields.instructions;
  if (fields.name !== value.fields.name) value.yaml.set('name', fields.name);
  if (fields.description !== value.fields.description) value.yaml.set('description', fields.description);
  const header = value.yaml.toString({ lineWidth: 0 }).replace(/\n$/, '').replace(/\r?\n/g, newline);
  return value.match[1] + header + fence + fields.instructions;
}

/** JSON strings are valid YAML scalars; user text cannot inject metadata keys. */
export function createSkillMethod(fields: SkillMethodFields): string {
  return `---\nname: ${JSON.stringify(fields.name.trim())}\ndescription: ${JSON.stringify(fields.description.trim())}\n---\n${fields.instructions}`;
}
