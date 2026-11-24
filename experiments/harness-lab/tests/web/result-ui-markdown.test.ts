import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown, { type Components } from 'react-markdown';
import { expect, it } from 'vitest';
import { readResultUiFence } from '../../src/web/result-ui/markdown-fence';

function parseReply(source: string) {
  const fences: NonNullable<ReturnType<typeof readResultUiFence>>[] = [];
  const components: Components = {
    pre: ({ node, children }) => {
      const fence = readResultUiFence(source, node);
      if (!fence) return createElement('pre', null, children);
      fences.push(fence);
      return null;
    },
  };
  const html = renderToStaticMarkup(createElement(Markdown, { components }, source));
  return { fences, html };
}

it('passes only complete source lines to the compiler as a Markdown fence streams', () => {
  const opening = '```berserk-ui-v1\n';
  const first = '{"id":"one"}\n';
  const second = '{"op":"add","path":"/root","value":"a"}\n';
  const body = first + second;
  for (let cursor = 0; cursor <= body.length; cursor++) {
    const text = body.slice(0, cursor);
    expect(parseReply(opening + text).fences).toEqual([
      { lines: text.slice(0, text.lastIndexOf('\n') + 1), closed: false },
    ]);
  }
  expect(parseReply(opening + body + '```').fences).toEqual([{ lines: body, closed: true }]);
});

it('preserves other code and prose while normalizing line endings in the reserved fence', () => {
  const source = '~~~berserk-ui-v1\r\n{}\r\n~~~\r\n\r\n正文。\r\n\r\n```json\r\n{}\r\n```';
  const { fences, html } = parseReply(source);
  expect(fences).toEqual([{ lines: '{}\n', closed: true }]);
  expect(html).toContain('<p>正文。</p>');
  expect(html).toContain('<pre><code class="language-json">{}');
  expect(parseReply('````markdown\n```berserk-ui-v1\n{}\n```\n````').fences).toEqual([]);
  expect(parseReply('> ```berserk-ui-v1\n> {}\n> ```').fences).toEqual([]);
  expect(parseReply('- 示例\n\n  ```berserk-ui-v1\n  {}\n  ```').fences).toEqual([]);
});
