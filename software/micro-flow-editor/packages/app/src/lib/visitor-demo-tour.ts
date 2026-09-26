/** First-visit coach marks on the public GitHub Pages demo. */

export const VISITOR_DEMO_TOUR_STORAGE_KEY = "demo.visitor-tour.seen";
export const VISITOR_DEMO_TOUR_LOCAL_STORAGE_KEY = `spaghettilab:${VISITOR_DEMO_TOUR_STORAGE_KEY}`;

export type VisitorDemoTourStep = {
  readonly target: string;
  readonly title: string;
  readonly body: string;
  readonly side: "right" | "left" | "bottom";
};

export const VISITOR_DEMO_TOUR_STEPS: readonly VisitorDemoTourStep[] = [
  {
    target: "flow-node-demo-schedule",
    title: "This is the Flow",
    body: "A Schedule ticks every second and starts the chain. The Digital Out Toggle sits inside; the LED is the output.",
    side: "right",
  },
  {
    target: "flow-node-demo-toggle",
    title: "Click a block",
    body: "Select Digital Out Toggle or the LED to open its settings on the right.",
    side: "bottom",
  },
  {
    target: "demo-tour-inspector",
    title: "Change the settings",
    body: "Only the useful controls are here. Edits apply immediately — try the period, toggle type, or LED color.",
    side: "left",
  },
  {
    target: "demo-tour-run",
    title: "Watch it run",
    body: "Run starts a local LED preview. Change a value and see the blink follow.",
    side: "bottom",
  },
];

export function parseVisitorDemoTourSeen(raw: string | null | undefined): boolean {
  return raw === "1";
}

export function readVisitorDemoTourSeen(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return parseVisitorDemoTourSeen(window.localStorage.getItem(VISITOR_DEMO_TOUR_LOCAL_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function isVisitorDemoTourForced(search?: string | null): boolean {
  const raw = search ?? (typeof window !== "undefined" ? window.location.search : "");
  const query = raw.startsWith("?") ? raw.slice(1) : raw;
  return new URLSearchParams(query).get("demo-tour") === "1";
}

export function writeVisitorDemoTourSeen(seen: boolean): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(VISITOR_DEMO_TOUR_LOCAL_STORAGE_KEY, seen ? "1" : "0");
  } catch {
    // Private mode / blocked storage: treat as seen so the overlay cannot loop.
  }
}
