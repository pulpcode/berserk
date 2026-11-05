import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Pin, X } from 'lucide-react';

type EventSelection = {scope: string; id: string; anchor: HTMLButtonElement; pinned: boolean};

/** Presentation-only selection; hover never issues a request or replaces a pinned event. */
export function useDirectorPopover(scope: string) {
  const [selection, setSelection] = useState<EventSelection>();
  const current = useRef<EventSelection | undefined>(undefined);
  const opening = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function cancel() { clearTimeout(opening.current); clearTimeout(closing.current); }
  useEffect(() => () => { clearTimeout(opening.current); clearTimeout(closing.current); }, [scope]);
  function update(value?: EventSelection) { current.current=value;setSelection(value); }
  function close(restoreFocus = false) {
    cancel(); const anchor=current.current?.anchor; update();
    if(restoreFocus && anchor?.isConnected)anchor.focus({preventScroll:true});
  }
  function enter(id: string, anchor: HTMLButtonElement) {
    cancel();
    if(current.current?.scope===scope && current.current.pinned)return;
    opening.current=setTimeout(()=>update({scope,id,anchor,pinned:false}),250);
  }
  function leave() {
    clearTimeout(opening.current); clearTimeout(closing.current);
    closing.current=setTimeout(()=>{if(!current.current?.pinned)update();},180);
  }
  function keep() { clearTimeout(opening.current);clearTimeout(closing.current); }
  function pin(id: string, anchor: HTMLButtonElement) {
    cancel();const previous=current.current;
    if(previous?.scope===scope && previous.id===id && previous.pinned){close();return;}
    update({scope,id,anchor,pinned:true});
  }
  return {selection:selection?.scope===scope?selection:undefined,enter,leave,keep,pin,close};
}

export function DirectorPopover({selection, id, title, time, status, keep, leave, pin, close, children}: {
  selection: EventSelection; id: string; title: string; time: string; status: string;
  keep: () => void; leave: () => void; pin: () => void; close: (restoreFocus?: boolean) => void; children: ReactNode;
}) {
  const panel=useRef<HTMLElement>(null);
  const [position,setPosition]=useState<{left:number;top:number}>();
  const {anchor,pinned}=selection;
  useLayoutEffect(()=>{
    const element=panel.current;if(!element)return;
    const align=()=>{
      const row=anchor.getBoundingClientRect(),box=element.getBoundingClientRect();
      const left=Math.max(12,Math.min(row.right-box.width,innerWidth-box.width-12));
      const below=row.bottom+8,above=row.top-box.height-8;
      const top=Math.max(12,Math.min(below+box.height<=innerHeight-12?below:above>=12?above:row.top,innerHeight-box.height-12));
      setPosition(previous=>previous?.left===left&&previous.top===top?previous:{left,top});
    };
    align();const observer=new ResizeObserver(align);observer.observe(element);observer.observe(anchor);
    window.addEventListener('resize',align);window.addEventListener('scroll',align,true);
    return ()=>{observer.disconnect();window.removeEventListener('resize',align);window.removeEventListener('scroll',align,true);};
  },[anchor]);
  useLayoutEffect(()=>{if(pinned)panel.current?.focus({preventScroll:true});},[pinned]);
  useEffect(()=>{
    const outside=(event:Event)=>{const target=event.target as Node;if(!panel.current?.contains(target)&&!anchor.contains(target))close();};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close(true);}};
    document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('keydown',escape);
    return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape);};
  },[anchor,close]);
  return createPortal(<section ref={panel} id={id} className="director-event-popover director-card" role="dialog" aria-label={title} tabIndex={-1} data-pinned={pinned} style={position?position:{visibility:'hidden'}} onPointerEnter={keep} onPointerLeave={leave}>
    <header className="director-popover-heading"><div><span className="director-scope">{time} · {status}</span><h2>{title}</h2></div><div className="director-buttons">{!pinned && <button className="icon-button" aria-label="固定事件详情" title="固定" onClick={pin}><Pin size={15} aria-hidden="true"/></button>}<button className="icon-button" aria-label="关闭事件详情" title="关闭" onClick={()=>close(true)}><X size={16} aria-hidden="true"/></button></div></header>
    {children}
  </section>,document.body);
}
