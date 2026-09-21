import { useLayoutEffect, useRef } from 'react';

export type ChatFocusTransfer = Map<string, number>;
const controls = 'a,button,input,textarea,select,summary,[tabindex]';
/** Only bridges one React commit when grouping moves the same chat item. */
export function useChatItemFocus<T extends HTMLElement>(key: string, transfers: ChatFocusTransfer) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const index = transfers.get(key);
    if (index !== undefined) {
      transfers.delete(key);
      const target = node.querySelectorAll<HTMLElement>(controls)[index];
      // A newly mounted process starts as native closed details. Reveal only the
      // focused control's ancestor disclosures before restoring keyboard focus.
      for (let ancestor = target?.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor instanceof HTMLDetailsElement && !ancestor.querySelector(':scope > summary')?.contains(target!)) ancestor.open = true;
      }
      target?.focus({ preventScroll: true });
    }
    return () => {
      const focused = document.activeElement;
      if (!focused || !node.contains(focused)) return;
      const index = [...node.querySelectorAll(controls)].indexOf(focused);
      if (index < 0) return;
      transfers.set(key, index);
      // A different session or a later navigation must not inherit focus.
      queueMicrotask(() => transfers.delete(key));
    };
  }, [key, transfers]);
  return ref;
}
