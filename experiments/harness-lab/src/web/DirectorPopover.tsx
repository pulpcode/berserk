import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

type EventSelection = {scope: string; id: string; anchor: HTMLButtonElement; pinned: boolean};

/** Inline expansion responds to pointer movement, never to boundaries shifted by row height. */
export function useDirectorEvents(scope: string, list: RefObject<HTMLOListElement | null>) {
  const [selection, setSelection] = useState<EventSelection>();
  const current = useRef<EventSelection | undefined>(undefined);
  const pointer = useRef<{x: number; y: number} | undefined>(undefined);
  const opening = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancel = useCallback(() => {
    clearTimeout(opening.current);
    clearTimeout(closing.current);
  }, []);
  const update = useCallback((value?: EventSelection) => {
    current.current = value;
    setSelection(value);
  }, []);
  const close = useCallback((restoreFocus = false) => {
    cancel();
    const anchor = current.current?.anchor;
    update();
    if (restoreFocus && anchor?.isConnected) anchor.focus({preventScroll: true});
  }, [cancel, update]);
  function move(id: string, anchor: HTMLButtonElement, event: PointerEvent) {
    if (pointer.current?.x === event.clientX && pointer.current.y === event.clientY) return;
    if (current.current?.scope === scope && current.current.pinned) return;
    clearTimeout(closing.current);
    clearTimeout(opening.current);
    if (current.current?.scope === scope && current.current.id === id) return;
    opening.current = setTimeout(() => update({scope, id, anchor, pinned: false}), 200);
  }
  function toggle(id: string, anchor: HTMLButtonElement) {
    cancel();
    const previous = current.current;
    if (previous?.scope === scope && previous.id === id && previous.pinned) {
      close();
      return;
    }
    update({scope, id, anchor, pinned: true});
  }
  useEffect(() => {
    const movePointer = (event: globalThis.PointerEvent) => {
      const moved = pointer.current?.x !== event.clientX || pointer.current?.y !== event.clientY;
      pointer.current = {x: event.clientX, y: event.clientY};
      if (!moved) return;
      clearTimeout(closing.current);
      if (list.current?.contains(event.target as Node)) return;
      clearTimeout(opening.current);
      closing.current = setTimeout(() => {
        if (!current.current?.pinned) update();
      }, 180);
    };
    const outside = (event: Event) => {
      if (!list.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && current.current?.scope === scope) {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener('pointermove', movePointer);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => {
      cancel();
      document.removeEventListener('pointermove', movePointer);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [scope, list, close, cancel, update]);
  return { selection: selection?.scope === scope ? selection : undefined, move, toggle, close};
}
