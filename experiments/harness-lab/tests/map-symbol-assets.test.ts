import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { MAP_SYMBOLS } from '../src/contracts/map-symbols';
import { resolveMapSymbol, symbolAssetUrl } from '../src/web/map-symbols';

describe('controlled professional map assets', () => {
  it('ships every catalog glyph as local vector geometry, with no remote or active content', async () => {
    for (const symbol of MAP_SYMBOLS) {
      const svg = await readFile(new URL(`../src/web/map-symbols/assets/${symbol.assetKey}.svg`, import.meta.url), 'utf8');
      expect(symbolAssetUrl(symbol.id), symbol.id).toBeTruthy();
      expect(svg).toContain('viewBox="0 0 128 128"');
      expect(svg).toMatch(/<(?:path|circle)/);
      expect(svg).not.toMatch(/<(?:script|image|foreignObject)|\bon\w+=|\b(?:href|xlink:href)=/i);
      expect(svg).toContain(symbol.name);
    }
    expect(symbolAssetUrl('https://example.org/uncontrolled.svg')).toBeUndefined();
  });
  it('preserves native orientation and translates true-north headings', () => {
    const tanker = 'xf3013-2020.6.2.1';
    expect(resolveMapSymbol({symbolId:tanker})).toMatchObject({iconSize:32, rotation:0});
    expect(resolveMapSymbol({symbolId:tanker,heading:0,iconSize:48})).toMatchObject({iconSize:48,rotation:270});
    expect(resolveMapSymbol({symbolId:tanker,heading:90})).toMatchObject({rotation:0});
    expect(resolveMapSymbol({symbolId:'xf3013-2020.6.2.35',heading:90})).toMatchObject({rotation:90});
    expect(resolveMapSymbol({symbolId:'xf3013-2020.6.1.27'})).toMatchObject({rotation:0});
    expect(resolveMapSymbol({symbol:'triangle',size:9})).toBeUndefined();
    expect(resolveMapSymbol({symbolId:'unknown'})).toBeUndefined();
  });
  it('keeps three watercraft visually and semantically distinct', async () => {
    const ids = ['xf3013-2020.6.2.37','app.rescue-inflatable-boat','app.rescue-vessel'];
    const glyphs = await Promise.all(ids.map(id=>readFile(new URL(`../src/web/map-symbols/assets/${id}.svg`, import.meta.url),'utf8')));
    expect(new Set(glyphs).size).toBe(3);
    expect(ids.map(id=>resolveMapSymbol({symbolId:id})?.definition.sourceKind)).toEqual(['standard','extension','extension']);
  });
});
