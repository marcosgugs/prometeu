/** Authored interaction metadata only. Consumers own capture and event delivery. */
export function identifyControl<T extends HTMLElement>(control: T, target: string, area?: string): T {
  control.dataset.track = target;
  if (area) identifyArea(control, area);
  return control;
}

export function identifyArea<T extends HTMLElement>(element: T, area: string): T {
  element.dataset.trackArea = area;
  return element;
}

export function trackingArea(element?: Element | null): string | undefined {
  return element?.closest<HTMLElement>("[data-track-area]")?.dataset.trackArea;
}

/** Portals retain the authored context of their opener without reading its text or identity. */
export function inheritTrackingArea(element: HTMLElement, opener?: Element | null, area?: string) {
  const context = area ?? trackingArea(opener);
  if (context) identifyArea(element, context);
  else delete element.dataset.trackArea;
}
