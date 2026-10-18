import { publicAsset } from "../../lib/public-asset.js";

/** Shared wordmark for every application header. */
export function BrandMark() {
  return (
    <span className="inline-flex shrink-0 items-center gap-2">
      <img
        src={publicAsset("ux-assets/icon-transparent-28@2x.png")}
        alt=""
        className="h-6 w-6 shrink-0"
      />
      <strong className="whitespace-nowrap font-heading text-lg font-bold text-ink-muted">
        Spaghetti<span className="text-brand-blue">LAB</span>
      </strong>
    </span>
  );
}
