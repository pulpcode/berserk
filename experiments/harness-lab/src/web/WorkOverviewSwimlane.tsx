import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Armchair, Maximize, Minus, Plus } from 'lucide-react';
import type { WorkOverviewItem } from '../contracts/workbench';
import { workStateLabel } from './WorkInbox';
import { layoutWorkSwimlane, workLaneHeaderWidth, workLaneHeight, workNodeHeight, workNodeWidth, zoomWorkCamera, type WorkCamera } from './work-overview-layout';

export function WorkOverviewSwimlane({ items, hidden, showTask, select }: { items: WorkOverviewItem[]; hidden: boolean; showTask: boolean; select: (item: WorkOverviewItem, trigger: HTMLButtonElement) => void }) {
  const layout = useMemo(() => layoutWorkSwimlane(items), [items]);
  const canvas = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const pointer = useRef<{ id: number; x: number; y: number; camera: WorkCamera } | undefined>(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState<WorkCamera>({ x: 12, y: 12, scale: 1 });
  const arrow = useId();
  const fitScale = Math.min(1, (size.width - 24) / layout.width, (size.height - 24) / layout.height);
  const minimum = Math.max(.001, Math.min(.2, fitScale));
  const fit = () => { const scale = Math.max(.001, fitScale); setCamera({ scale, x: (size.width - layout.width * scale) / 2, y: (size.height - layout.height * scale) / 2 }); };
  const zoom = useCallback((factor: number, point: { x: number; y: number }) => setCamera(current => zoomWorkCamera(current, factor, point, minimum)), [minimum]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { if (element.clientWidth && element.clientHeight) setSize({ width: element.clientWidth, height: element.clientHeight }); });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!size.width || initialized.current) return;
    initialized.current = true;
    // Keep names readable initially; larger diagrams remain fully reachable by pan, focus and fit.
    const scale = Math.max(.85, Math.min(1, (size.width - 24) / layout.width, (size.height - 24) / layout.height));
    setCamera({ scale, x: 12, y: 12 });
  }, [size, layout.width, layout.height]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (event.altKey || (event.target as HTMLElement).closest('.work-swimlane-controls')) return;
      const deltaX = event.deltaX * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1);
      const deltaY = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      if (event.ctrlKey || event.metaKey) {
        if (!deltaY) return;
        event.preventDefault();
        const bounds = element.getBoundingClientRect();
        zoom(Math.exp(-Math.max(-100, Math.min(100, deltaY)) * .002), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      } else {
        const x = event.shiftKey ? deltaX || deltaY : deltaX, y = event.shiftKey ? 0 : deltaY;
        if (!x && !y) return;
        event.preventDefault();
        setCamera(current => ({ ...current, x: current.x - x, y: current.y - y }));
      }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [zoom]);
  function reveal(x: number, y: number, width: number, height: number) {
    setCamera(current => {
      const left = x * current.scale + current.x, top = y * current.scale + current.y;
      const right = left + width * current.scale, bottom = top + height * current.scale;
      const visibleLeft = workLaneHeaderWidth * current.scale + 12;
      const horizontal = Math.max(visibleLeft - left, Math.min(0, size.width - 12 - right));
      return { ...current, x: current.x + horizontal, y: current.y + (top < 12 ? 12 - top : bottom > size.height - 12 ? size.height - 12 - bottom : 0) };
    });
  }
  return <div ref={canvas} hidden={hidden} className="work-swimlane" role="region" aria-label="席位工作泳道图" tabIndex={0}
    onKeyDown={event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target !== event.currentTarget) return;
      const movement: Record<string, [number, number]> = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] };
      if (movement[event.key]) { event.preventDefault(); const [x, y] = movement[event.key]; setCamera(current => ({ ...current, x: current.x + x, y: current.y + y })); }
      else if (event.key === '+' || event.key === '=' || event.key === '-') { event.preventDefault(); zoom(event.key === '-' ? 1 / 1.15 : 1.15, { x: size.width / 2, y: size.height / 2 }); }
      else if (event.key === '0') { event.preventDefault(); fit(); }
    }}
    onPointerDown={event => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
      event.preventDefault(); event.currentTarget.focus(); pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, camera }; event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => { const start = pointer.current; if (start?.id === event.pointerId) setCamera({ ...start.camera, x: start.camera.x + event.clientX - start.x, y: start.camera.y + event.clientY - start.y }); }}
    onPointerUp={() => { pointer.current = undefined; }} onPointerCancel={() => { pointer.current = undefined; }}>
    <div className="work-swimlane-controls" role="group" aria-label="泳道图控制">
      <button className="icon-button" title="缩小（Ctrl/⌘ + 滚轮缩放）" aria-label="缩小泳道图" disabled={camera.scale <= minimum} onClick={() => zoom(1 / 1.15, { x: size.width / 2, y: size.height / 2 })}><Minus size={17} aria-hidden="true" /></button>
      <button className="icon-button" title="放大（Ctrl/⌘ + 滚轮缩放）" aria-label="放大泳道图" disabled={camera.scale >= 2} onClick={() => zoom(1.15, { x: size.width / 2, y: size.height / 2 })}><Plus size={17} aria-hidden="true" /></button>
      <button className="icon-button" title="适应视图" aria-label="适应视图" onClick={fit}><Maximize size={17} aria-hidden="true" /></button>
    </div>
    <div className="work-swimlane-scene" style={{ width: layout.width, height: layout.height, transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}>
      {layout.lanes.map(lane => <div className="work-swimlane-lane" key={lane.id} data-seat-id={lane.id} style={{ top: lane.y, height: workLaneHeight, width: layout.width }}><div className="work-swimlane-seat" style={{ width: workLaneHeaderWidth, transform: `translateX(${-camera.x / camera.scale}px)` }} title={`${lane.name} · ${lane.id}`}><Armchair size={19} aria-hidden="true" /><span><span className="work-swimlane-seat-name">{lane.name}</span>{lane.duplicateName && <small>{lane.id}</small>}</span></div></div>)}
      <svg width={layout.width} height={layout.height} aria-hidden="true"><defs><marker id={arrow} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" /></marker></defs>{layout.works.map(work => <path key={work.item.id} className="work-swimlane-line" d={work.path} markerEnd={`url(#${arrow})`} />)}</svg>
      {layout.works.map(work => <div key={work.item.id}>
        <button className="work-swimlane-origin" aria-label={`${work.item.creatorSeatName}分派：${work.item.title}`} title={`${work.item.creatorSeatName}发起：${work.item.title}`} style={{ left: work.sourceX - 17, top: work.sourceY - 7 }} onFocus={() => reveal(work.sourceX - 17, work.sourceY - 7, 34, 42)} onClick={event => select(work.item, event.currentTarget)}><span className="work-swimlane-dot" aria-hidden="true" /><span>分派</span></button>
        <button className="work-swimlane-work" data-work-id={work.item.id} data-creator-seat-id={work.item.creatorSeatId} data-assignee-seat-id={work.item.assigneeSeatId} style={{ left: work.x, top: work.y, width: workNodeWidth, height: workNodeHeight }} aria-label={`${work.item.title}，${work.item.creatorSeatName}分派给${work.item.assigneeSeatName}，${workStateLabel[work.item.state]}`} title={`${work.item.title} · ${work.item.taskTitle}`} onFocus={() => reveal(work.x, work.y, workNodeWidth, workNodeHeight)} onClick={event => select(work.item, event.currentTarget)}>
          <strong>{work.item.title}</strong>{showTask && <small>{work.item.taskTitle}</small>}<span className={`work-swimlane-status state-${work.item.state}`}>{workStateLabel[work.item.state]}</span>
        </button>
      </div>)}
    </div>
  </div>;
}
