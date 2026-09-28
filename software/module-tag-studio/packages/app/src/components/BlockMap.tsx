import { CATEGORY_LABEL, CATEGORY_SHORT, categoryForPage, type BlockCategory } from "../lib/blocks.js";

const SWATCH: Record<BlockCategory, string> = {
  sys: "var(--sys)",
  ndef: "var(--ndef)",
  factory: "var(--factory)",
  install: "var(--install)",
  crc: "var(--crc)",
  reserve: "var(--reserve)",
  danger: "var(--danger-zone)",
};

export function BlockMap({
  changedPages = [],
  highlight,
  wave = false,
  waveLabel,
}: {
  changedPages?: number[];
  highlight?: number[];
  /** Concentric NFC-style waves around the tag memory graphic (read / program). */
  wave?: boolean;
  waveLabel?: string;
}) {
  const changed = new Set(changedPages);
  const hi = new Set(highlight ?? []);
  return (
    <div className={`map-scroll${wave ? " map-wave-active" : ""}`}>
      <div className="legend">
        {(Object.keys(CATEGORY_LABEL) as BlockCategory[]).map((key) => (
          <span key={key}>
            <i className="swatch" style={{ background: SWATCH[key] }} />
            {CATEGORY_LABEL[key]}
          </span>
        ))}
      </div>
      <div className={`tag-graphic${wave ? " waving" : ""}`}>
        {wave && (
          <div className="tag-waves" aria-hidden>
            <span className="tag-wave w1" />
            <span className="tag-wave w2" />
            <span className="tag-wave w3" />
            <span className="tag-wave w4" />
          </div>
        )}
        <div className="block-map" role="list" aria-label="Tag memory map pages 0 to 63">
          {Array.from({ length: 64 }, (_, page) => {
            const cat = categoryForPage(page);
            const isHi = hi.has(page);
            const isChanged = changed.has(page) || isHi;
            return (
              <div
                key={page}
                role="listitem"
                className={`block ${cat}${isChanged ? " changed" : ""}${isHi ? " writing" : ""}`}
                title={`Page ${page}: ${CATEGORY_LABEL[cat]}`}
              >
                <div className="block-num">{page}</div>
                <div className="block-tag">{CATEGORY_SHORT[cat]}</div>
              </div>
            );
          })}
        </div>
        {wave && waveLabel && <div className="tag-wave-caption">{waveLabel}</div>}
      </div>
    </div>
  );
}
