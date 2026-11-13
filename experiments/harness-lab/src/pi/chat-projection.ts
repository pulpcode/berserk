import type { PublicAssistantContent, PublicMessage, PublicToolDetails, PublicToolInput } from '../contracts/index.js';

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

/** Only visible native content is public; opaque signatures and redacted blocks never cross this boundary. */
export function assistantProjection(content: unknown, presentationId: string): Pick<PublicMessage, 'text' | 'content' | 'presentationId'> {
  const blocks: PublicAssistantContent[] = [];
  if (Array.isArray(content)) content.forEach((block: unknown, index) => {
    if (!object(block)) return;
    if (block.type === 'text' && text(block.text) && block.text) blocks.push({ id: `${presentationId}:content:${index}`, type: 'text', text: block.text });
    if (block.type === 'thinking' && block.redacted !== true && text(block.thinking) && block.thinking.trim()) blocks.push({ id: `${presentationId}:content:${index}`, type: 'thinking', text: block.thinking });
  });
  return { presentationId, text: blocks.filter(block => block.type === 'text').map(block => block.text).join('\n'), content: blocks };
}

/** Deliberate allowlist: arbitrary tool arguments and business metadata remain private. */
export function publicToolInput(name: string, input: unknown): PublicToolInput | undefined {
  if (!object(input)) return undefined;
  const result: PublicToolInput = {};
  if (['read', 'ls', 'find', 'write', 'edit', 'file_output'].includes(name) && text(input.path)) result.path = input.path;
  if (name === 'read') {
    if (positive(input.offset)) result.offset = input.offset;
    if (positive(input.limit)) result.limit = input.limit;
  }
  if (name === 'find' && text(input.pattern)) result.pattern = input.pattern;
  if (name === 'bash' && text(input.command)) result.command = input.command;
  return Object.keys(result).length ? result : undefined;
}

export function publicToolDetails(name: string, details: unknown, isError = false): PublicToolDetails | undefined {
  if (!object(details)) return undefined;
  const result: PublicToolDetails = {};
  if (name === 'edit' && !isError) {
    if (text(details.diff)) result.diff = details.diff;
    if (text(details.patch)) result.patch = details.patch;
    if (positive(details.firstChangedLine)) result.firstChangedLine = details.firstChangedLine;
  }
  if (['bash', 'read', 'ls', 'find'].includes(name) && object(details.truncation) && details.truncation.truncated === true) result.truncated = true;
  // file-tools maps native temporary paths before publishing updates/results.
  if (name === 'bash' && text(details.fullOutputPath) && /^\/logs\/[a-zA-Z0-9-]+\/[a-f0-9]+\.log$/.test(details.fullOutputPath)) result.fullOutputPath = details.fullOutputPath;
  return Object.keys(result).length ? result : undefined;
}

export function publicResultText(result: unknown): string {
  if (!object(result) || !Array.isArray(result.content)) return '';
  return result.content.filter(object).filter(block => block.type === 'text' && text(block.text)).map(block => block.text).join('\n');
}
