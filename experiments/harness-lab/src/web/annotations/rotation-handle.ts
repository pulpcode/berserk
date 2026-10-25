import type { Map as LibreMap } from 'maplibre-gl';
import type { AnnotationFeature } from '../../contracts/annotations';
import { getMapSymbol } from '../../contracts/map-symbols';

export interface AnnotationRotation {
  feature: AnnotationFeature;
  change: (objectId: string, heading: number) => void;
}
export const normalizeHeading = (angle: number) => ((angle % 360) + 360) % 360;
export const screenHeading = (heading: number, eastAngle: number) => normalizeHeading(heading + eastAngle);
export const headingFromScreen = (angle: number, eastAngle: number) => normalizeHeading(angle - eastAngle);
const degrees = 180 / Math.PI;

/** Match MapLibre's map-rotation / viewport-pitch symbol shader: the projected
 * local east tangent rotates the screen-facing glyph, even on a tilted map. */
export function projectedEastAngle(map: Pick<LibreMap, 'project'>, point: [number, number]) {
  const a = map.project(point), b = map.project([point[0] + 0.00001, point[1]]);
  return Math.atan2(b.y - a.y, b.x - a.x) * degrees;
}

/** Kept outside business-layer cleanup: preview updates must retain capture. */
export function createRotationHandle(map: LibreMap, read: () => AnnotationRotation | undefined) {
  const root = document.createElement('div'); root.className = 'annotation-rotation'; root.hidden = true;
  const line = document.createElement('span'); line.className = 'annotation-rotation-line';
  const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'annotation-rotation-handle';
  handle.setAttribute('aria-label', '旋转标号方向'); handle.title = '拖动旋转；也可在属性中输入真北方向';
  handle.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 7v5h-5M20 12a8 8 0 1 0-2 6"/></svg>';
  const label = document.createElement('span'); label.className = 'annotation-rotation-angle';
  root.append(line, handle, label); map.getContainer().append(root);
  type Drag = {pointerId: number; key: string; offset: number; enabled: Array<{enable: () => void}>};
  let drag: Drag | undefined;
  function current() {
    const value = read(), feature = value?.feature, symbol = getMapSymbol(feature?.style?.symbolId);
    if (!value || !feature || feature.kind !== 'point' || feature.geometry.type !== 'Point' || symbol?.orientation !== 'heading') return;
    return {value, point: feature.geometry.coordinates, heading: feature.style?.heading ?? symbol.intrinsicHeading, key: `${feature.objectId}:${symbol.id}`};
  }
  function stop() {
    const previous = drag; drag = undefined;
    if (!previous) return;
    if (handle.hasPointerCapture(previous.pointerId)) handle.releasePointerCapture(previous.pointerId);
    previous.enabled.forEach(handler => handler.enable());
    root.classList.remove('is-rotating'); window.removeEventListener('blur', stop);
  }
  function render(value: NonNullable<ReturnType<typeof current>>, heading = value.heading) {
    const center = map.project(value.point), angle = screenHeading(heading, projectedEastAngle(map, value.point)) / degrees;
    const radius = Math.max(46, (value.value.feature.style?.iconSize ?? 32) / 2 + 30);
    const x = Math.sin(angle) * radius, y = -Math.cos(angle) * radius;
    root.hidden = false; root.style.transform = `translate(${center.x}px,${center.y}px)`;
    line.style.height = `${radius}px`; line.style.transform = `rotate(${angle * degrees}deg)`;
    handle.style.left = `${x}px`; handle.style.top = `${y}px`;
    label.style.left = `${x}px`; label.style.top = `${y}px`; label.textContent = `真北 ${Math.round(heading * 10) / 10}°`;
  }
  function update() {
    const value = current();
    if (!value) { stop(); root.hidden = true; return; }
    if (drag && drag.key !== value.key) stop();
    render(value);
  }
  function pointerAngle(event: PointerEvent, point: [number, number]) {
    const box = map.getContainer().getBoundingClientRect(), center = map.project(point);
    const x = event.clientX - box.left - center.x, y = event.clientY - box.top - center.y;
    return Math.hypot(x, y) < 8 ? undefined : Math.atan2(x, -y) * degrees;
  }
  function down(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary) return;
    const value = current(); if (!value) return;
    const angle = pointerAngle(event, value.point); if (angle === undefined) return;
    event.preventDefault(); event.stopPropagation(); stop();
    const handlers = [map.dragPan, map.dragRotate, map.scrollZoom, map.boxZoom, map.doubleClickZoom, map.keyboard, map.touchZoomRotate];
    const enabled = handlers.filter(handler => handler.isEnabled());
    drag = {pointerId: event.pointerId, key: value.key, offset: screenHeading(value.heading, projectedEastAngle(map, value.point)) - angle, enabled};
    enabled.forEach(handler => handler.disable());
    handle.setPointerCapture(event.pointerId); root.classList.add('is-rotating'); window.addEventListener('blur', stop);
  }
  function move(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const value = current(); if (!value || value.key !== drag.key) { stop(); return; }
    const angle = pointerAngle(event, value.point); if (angle === undefined) return;
    const heading = normalizeHeading(Math.round(headingFromScreen(angle + drag.offset, projectedEastAngle(map, value.point)) * 10) / 10);
    if (heading === value.heading) return;
    render(value, heading); value.value.change(value.value.feature.objectId, heading);
  }
  function up(event: PointerEvent) { if (drag?.pointerId === event.pointerId) { event.preventDefault(); event.stopPropagation(); stop(); } }
  const click = (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); };
  handle.addEventListener('pointerdown', down); handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up); handle.addEventListener('lostpointercapture', stop); handle.addEventListener('click', click);
  map.on('move', update); map.on('resize', update);
  return {update, destroy: () => {stop(); map.off('move', update); map.off('resize', update); root.remove();}};
}
