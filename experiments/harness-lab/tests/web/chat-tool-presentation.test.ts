import { expect, it } from 'vitest';
import { patchLineCounts } from '../../src/web/ChatMessage';

it('counts native patch hunks without mistaking ++/-- content for file headers', () => {
  expect(patchLineCounts('--- a/report.ts\n+++ b/report.ts\n@@ -1,2 +1,2 @@\n---counter;\n+++counter;\n context\n@@ -6 +6 @@\n-old\n+new')).toEqual({ added: 2, removed: 2 });
  expect(patchLineCounts('--- a/report.ts\n+++ b/report.ts')).toBeUndefined();
  expect(patchLineCounts(undefined)).toBeUndefined();
});
