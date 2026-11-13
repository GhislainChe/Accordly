"use client";
import { useEffect, useRef, useState } from "react";

export function useUnsavedChanges(dirty: boolean) {
  const current = useRef(dirty);
  const [pending, setPending] = useState<{ href: string; anchor?: HTMLAnchorElement } | null>(null);
  useEffect(() => {
    current.current = dirty;
    const unload = (event: BeforeUnloadEvent) => { if (current.current) { event.preventDefault(); event.returnValue = ""; } };
    const link = (event: MouseEvent) => {
      if (!current.current || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const next = new URL(anchor.href, location.href);
      if (next.href === location.href || (next.pathname === location.pathname && next.search === location.search && next.hash)) return;
      event.preventDefault(); event.stopImmediatePropagation(); setPending({ href: next.href, anchor });
    };
    // Modern browsers can also cancel same-document Back/Forward navigation.
    // No synthetic history entries or back-button traps are introduced.
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const traverse = (event: Event) => {
      const navigationEvent = event as Event & { navigationType?: string; destination?: { url: string } };
      if (current.current && event.cancelable && navigationEvent.navigationType === "traverse" && navigationEvent.destination) { event.preventDefault(); setPending({ href: navigationEvent.destination.url }); }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", link, true);
    navigation?.addEventListener("navigate", traverse);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", link, true); navigation?.removeEventListener("navigate", traverse); };
  }, [dirty]);
  return { release: () => { current.current = false; }, pending: !!pending, stay: () => setPending(null), leave: () => {
    if (!pending) return;
    current.current = false; setPending(null);
    if (pending.anchor?.isConnected) pending.anchor.click(); else location.assign(pending.href);
  } };
}
