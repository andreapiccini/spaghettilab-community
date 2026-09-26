/** First-visit coach marks on the public GitHub Pages demo. */

export const VISITOR_DEMO_TOUR_STORAGE_KEY = "demo.visitor-tour.seen.v2";
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
    title: "Firmware functions",
    body: "Schedule and Digital Out Toggle run in the Core firmware. This is the programmable logic — not a physical module.",
    side: "right",
  },
  {
    target: "flow-node-demo-backbone",
    title: "Hardware on the Backbone",
    body: "The LED is a real module plugged into the Backbone. Flow commands it; color and timing settings show on that module.",
    side: "left",
  },
  {
    target: "demo-tour-inspector",
    title: "Change the settings",
    body: "Click a firmware block or the LED. Period and toggle change the logic; LED color and delays change the hardware look.",
    side: "left",
  },
  {
    target: "demo-tour-run",
    title: "Watch it run",
    body: "Run previews the firmware commanding the LED. The blink comes from the Flow; the swatch is the module.",
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
