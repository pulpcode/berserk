import type { Map } from 'maplibre-gl';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';

/** Keep TerraDraw's in-progress store/mode alive. stop/setMode discard unfinished vertices.
 * The adapter's protected listener extension point lets browsing resume without synthetic events. */
export class PausableAnnotationAdapter extends TerraDrawMapLibreGLAdapter<Map> {
  private paused = false;
  private visibility = new globalThis.Map<string, 'visible' | 'none'>();
  constructor(private readonly mapInstance: Map) { super({map: mapInstance, prefixId:'annotation-editor'}); }
  setPaused(paused: boolean) {
    if (paused === this.paused) return;
    this.paused = paused;
    for (const listener of this._listeners) {
      if (paused) listener.unregister(); else listener.register();
    }
    this._heldKeys.clear();
    this._dragState = 'not-dragging';
    this._lastDrawEvent = undefined;
    this.setDraggability(true);
    this.setDoubleClickToZoom(paused);
    this.setCursor(paused ? 'grab' : 'crosshair');
    for (const layer of this.mapInstance.getStyle().layers) {
      if (!layer.id.startsWith('annotation-editor-')) continue;
      if (paused) this.visibility.set(layer.id, this.mapInstance.getLayoutProperty(layer.id, 'visibility') === 'none' ? 'none' : 'visible');
      this.mapInstance.setLayoutProperty(layer.id, 'visibility', paused ? 'none' : this.visibility.get(layer.id) || 'visible');
    }
    if (!paused) this.visibility.clear();
  }
}
