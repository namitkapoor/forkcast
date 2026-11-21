import { useSyncExternalStore } from "react";

// Hovered component (canvas pointer or Layers row). Kept outside React context so a pointer
// moving across a screen re-renders only the overlay that draws the box, not the whole canvas.

export interface Hover {
  screenId: string;
  id: string;
}

let current: Hover | null = null;
const listeners = new Set<() => void>();

export function setHover(h: Hover | null) {
  if (h?.screenId === current?.screenId && h?.id === current?.id) return;
  current = h;
  for (const l of listeners) l();
}

export function getHover() {
  return current;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useHover = () => useSyncExternalStore(subscribe, getHover, getHover);
