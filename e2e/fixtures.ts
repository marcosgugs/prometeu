import { expect, test as base } from "@playwright/test";

export * from "@playwright/test";

type AnalyticsGap = {
  tag: string;
  missing: ("target" | "area")[];
  target?: string;
  area?: string;
  doubleClick?: string;
  contextMenu?: string;
};

// Strengthen the existing journeys without adding interactions or uploading DOM/content.
export const test = base.extend({
  context: async ({ context }, use) => {
    const gaps = new Map<string, AnalyticsGap>();
    await context.exposeBinding("__reportAnalyticsGap", (_source, gap: AnalyticsGap) => {
      gaps.set(JSON.stringify(gap), gap);
    });
    await context.addInitScript(() => {
      const token = (value?: string) => value && /^[A-Za-z0-9._-]{1,80}$/.test(value) ? value : undefined;
      document.addEventListener("analytics-unidentified", event => {
        const { element, missing } = (event as CustomEvent).detail;
        if (!(element instanceof HTMLElement)) return;
        const gap = {
          tag: element.tagName.slice(0, 32),
          missing: ["target", "area"].filter(key => missing.includes(key)),
          target: token(element.dataset.track ?? element.dataset.tTitle ?? element.dataset.t),
          area: token(element.closest<HTMLElement>("[data-track-area]")?.dataset.trackArea),
          doubleClick: token(element.dataset.trackDoubleClick),
          contextMenu: token(element.dataset.trackContextMenu),
        };
        void (window as unknown as { __reportAnalyticsGap: (gap: unknown) => Promise<void> }).__reportAnalyticsGap(gap);
      });
    });
    await use(context);
    expect([...gaps.values()], "Activated app controls must have authored analytics target and area").toEqual([]);
  },
});
