import type { ExtraProps } from 'react-markdown';
import { resourceUiFence } from '../../presentation/resource-ui';

export function readResultUiFence(source: string, node: ExtraProps['node']): { lines: string; closed: boolean } | undefined {
  const code = node?.children[0];
  if (code?.type !== 'element' || code.tagName !== 'code'
    || !Array.isArray(code.properties.className) || !code.properties.className.includes(`language-${resourceUiFence}`)) return;

  const position = node?.position;
  const start = position?.start.offset;
  const end = position?.end.offset;
  if (!position || start === undefined || end === undefined) return;

  // The protocol uses its own top-level fence. Examples nested in Markdown remain code.
  if (position.start.column !== 1) return;
  const raw = source.slice(start, end).replace(/\r\n?/g, '\n');
  const opening = /^(`{3,}|~{3,})(\S+)[ \t]*(?:\n|$)/.exec(raw);
  if (!opening || opening[2] !== resourceUiFence) return;

  const body = raw.slice(opening[0].length);
  const finalLineStart = body.lastIndexOf('\n') + 1;
  const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(body.slice(finalLineStart))?.[1];
  const closed = !!closing && closing[0] === opening[1][0] && closing.length >= opening[1].length;
  // Markdown may synthesize a final line break. Compile only lines that arrived in the source.
  if (!closed && body && /^[\r\n]/.test(source.slice(end, end + 1))) {
    return { closed, lines: body.endsWith('\n') ? body : body + '\n' };
  }
  return { closed, lines: body.slice(0, finalLineStart) };
}
