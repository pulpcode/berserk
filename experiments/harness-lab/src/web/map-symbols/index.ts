import type { Map as MapLibreMap } from 'maplibre-gl';
import type { AnnotationStyle } from '../../contracts/annotations';
import { getMapSymbol, MAP_SYMBOLS } from '../../contracts/map-symbols';

const assets = import.meta.glob<string>('./assets/*.svg', { eager: true, query: '?url', import: 'default' });
const registrations = new WeakMap<MapLibreMap, Promise<string[]>>();
export const MAP_SYMBOL_BASE_SIZE = 32;

export function symbolImageId(id: string): string { return `annotation-symbol:${id}`; }
export function symbolAssetUrl(id: string): string | undefined {
  const definition = getMapSymbol(id);
  return definition ? assets[`./assets/${definition.assetKey}.svg`] : undefined;
}

/** The same resolver is available to annotation and explicitly typed source points.
 * Never infer a vehicle subtype from a resource count, display name or category. */
export function resolveMapSymbol(style?: AnnotationStyle) {
  const definition = getMapSymbol(style?.symbolId);
  if (!definition) return undefined;
  return {
    definition,
    imageId: symbolImageId(definition.id),
    iconSize: style?.iconSize ?? definition.defaultIconSize,
    rotation: definition.orientation === 'heading'
      ? ((style?.heading ?? definition.intrinsicHeading) - definition.intrinsicHeading + 360) % 360 : 0,
  };
}

function canvasContext() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法创建专业符号画布');
  return context;
}

async function rasterize(url: string): Promise<ImageData> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const context = canvasContext();
  // A white silhouette halo keeps standard red/black marks legible on imagery.
  // The original glyph colors and transparent interior are preserved.
  context.drawImage(image, 0, 0, 128, 128);
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 128, 128);
  const halo = canvasContext();
  for (const [x, y] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) halo.drawImage(context.canvas, x, y);
  halo.drawImage(image, 0, 0, 128, 128);
  return halo.getImageData(0, 0, 128, 128);
}

function missingImage(): ImageData {
  const context = canvasContext();
  context.fillStyle = '#fff'; context.strokeStyle = '#475569'; context.lineWidth = 7;
  context.beginPath(); context.arc(64, 64, 42, 0, Math.PI * 2); context.fill(); context.stroke();
  context.fillStyle = '#475569'; context.font = 'bold 64px sans-serif';
  context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('?', 64, 68);
  return context.getImageData(0, 0, 128, 128);
}

/** Register once per retained map. Basemap changes do not own these images.
 * Failures are reported to the caller and get a neutral, selectable fallback. */
export function ensureMapSymbols(map: MapLibreMap): Promise<string[]> {
  const existing = registrations.get(map);
  if (existing) return existing;
  const loading = Promise.all(MAP_SYMBOLS.map(async definition => {
    const imageId = symbolImageId(definition.id);
    if (map.hasImage(imageId)) return undefined;
    let image: ImageData;
    let failed = false;
    try {
      const url = symbolAssetUrl(definition.id);
      if (!url) throw new Error(`缺少符号素材：${definition.name}`);
      image = await rasterize(url);
    } catch {
      failed = true; image = missingImage();
    }
    if (!map.hasImage(imageId)) map.addImage(imageId, image, { pixelRatio: 4 });
    return failed ? definition.id : undefined;
  })).then(results => results.filter((id): id is string => id !== undefined));
  registrations.set(map, loading);
  return loading;
}
