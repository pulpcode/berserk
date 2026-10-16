import type { GeoJSONSource, Map as LibreMap } from 'maplibre-gl';
import type { SpatialGeometry, SpatialResult } from '../../contracts/spatial';
import { BUSINESS_ANCHOR } from './basemap-style';

export interface AnalysisMapState {
  result: SpatialResult;
  visible: boolean;
  selected?: string;
  focusRequest: number;
  focusItem?: string;
  toggle: () => void;
  clear: () => void;
  locate: (itemId?: string) => void;
  pick: (itemId?: string) => void;
}
export function geometryPositions(geometry: SpatialGeometry): [number, number][] {
  switch (geometry.type) {
    case 'Point': return [geometry.coordinates];
    case 'LineString': return geometry.coordinates;
    case 'Polygon': return geometry.coordinates.flat();
    case 'MultiPolygon': return geometry.coordinates.flat(2);
  }
}
export const ANALYSIS_GEOMETRY_ID = 'analysis:generated-geometry';
export const analysisReferenceId = (id: string) => `analysis:reference:${id}`;
export function analysisGeometries(state: AnalysisMapState) {
  if (state.focusItem) {
    const item = state.result.items.find(item => item.id === state.focusItem);
    const reference = state.result.referenceItems?.find(item => analysisReferenceId(item.id) === state.focusItem);
    return item ? [item.geometry] : reference ? [reference.geometry] : [];
  }
  return [...(state.result.geometry ? [state.result.geometry] : []), ...state.result.items.map(item => item.geometry), ...(state.result.referenceItems || []).map(item => item.geometry)];
}
export function analysisFeatures(state?: AnalysisMapState) {
  return { type: 'FeatureCollection' as const, features: !state?.visible ? [] : [
    ...(state.result.geometry ? [{ type: 'Feature' as const, geometry: state.result.geometry, properties: { role: 'generated', analysisId: ANALYSIS_GEOMETRY_ID, selected: !state.selected || state.selected === ANALYSIS_GEOMETRY_ID } }] : []),
    ...state.result.items.map(item => ({ type: 'Feature' as const, geometry: item.geometry, properties: { role: 'result', analysisId: item.id, selected: item.id === state.selected } })),
    ...(state.result.referenceItems || []).map(item => ({ type: 'Feature' as const, geometry: item.geometry, properties: { role: 'reference', analysisId: analysisReferenceId(item.id), selected: analysisReferenceId(item.id) === state.selected } })),
  ] };
}
const sourceId = 'analysis:results';
export const analysisLayerIds = ['analysis:fill', 'analysis:halo', 'analysis:line', 'analysis:reference-line', 'analysis:point'] as const;
/** Owns only temporary analysis layers; the map, editor and basemap lifetimes stay independent. */
export function createAnalysisRuntime(map: LibreMap, read: () => AnalysisMapState | undefined) {
  return {
    update() {
      if (!map.getLayer(BUSINESS_ANCHOR)) return;
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        // All analysis rendering stays below original business colors and annotation editing handles.
        const before = map.getStyle().layers?.find(layer => layer.id.startsWith('business:') && layer.id !== BUSINESS_ANCHOR)?.id;
        map.addLayer({ id: analysisLayerIds[0], type: 'fill', source: sourceId, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#516575', 'fill-opacity': 0.13 } }, before);
        map.addLayer({ id: analysisLayerIds[1], type: 'line', source: sourceId, filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#ffffff', 'line-width': ['case', ['get', 'selected'], 7, 5] } }, before);
        map.addLayer({ id: analysisLayerIds[2], type: 'line', source: sourceId, filter: ['all', ['!=', ['geometry-type'], 'Point'], ['!=', ['get', 'role'], 'reference']], paint: { 'line-color': '#344c60', 'line-width': ['case', ['get', 'selected'], 4, 2] } }, before);
        map.addLayer({ id: analysisLayerIds[3], type: 'line', source: sourceId, filter: ['all', ['!=', ['geometry-type'], 'Point'], ['==', ['get', 'role'], 'reference']], paint: { 'line-color': '#687582', 'line-width': ['case', ['get', 'selected'], 4, 2], 'line-dasharray': [3, 2] } }, before);
        map.addLayer({ id: analysisLayerIds[4], type: 'circle', source: sourceId, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#ffffff', 'circle-opacity': 0.3, 'circle-radius': ['case', ['get', 'selected'], 14, 11], 'circle-stroke-width': 3, 'circle-stroke-color': ['case', ['==', ['get', 'role'], 'reference'], '#687582', '#344c60'] } }, before);
      }
      (map.getSource(sourceId) as GeoJSONSource).setData(analysisFeatures(read()));
    },
    destroy() {
      for (const id of [...analysisLayerIds].reverse()) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    },
  };
}
