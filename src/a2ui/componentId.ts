// Maps a DOM click back to the A2UI component that rendered it.
//
// The v0.9 React renderer renders every component as a custom element and assigns the
// resolved node to it (`element.node = { componentId, ... }`, `element.context.componentModel.id`).
// It doesn't add a DOM attribute, so we read those properties off the composed event path
// (which also crosses the components' shadow roots). The nearest match wins.

interface A2uiHostElement extends Element {
  node?: { componentId?: unknown };
  context?: { componentModel?: { id?: unknown } };
}

export function componentIdOf(el: EventTarget | null | undefined): string | undefined {
  if (!el || !(el instanceof Element)) return undefined;
  const h = el as A2uiHostElement;
  const id = h.node?.componentId ?? h.context?.componentModel?.id;
  return typeof id === "string" ? id : undefined;
}

export function componentIdFromEvent(e: Event, boundary?: Element | null): string | undefined {
  for (const t of e.composedPath()) {
    if (boundary && t === boundary) break;
    const id = componentIdOf(t);
    if (id) return id;
  }
  return undefined;
}
