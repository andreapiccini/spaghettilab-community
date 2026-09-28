import { useEffect, useState } from "react";
import {
  bytesToUuid,
  decodeUserMemory,
  concatPages,
  hex,
  USER_FIRST_PAGE,
  USER_LAST_PAGE,
} from "@spaghettilab/module-tag-protocol";
import type { NfcReader } from "@spaghettilab/module-tag-reader";
import { BlockMap } from "../components/BlockMap.js";

export function AdvancedMode({ reader }: { reader: NfcReader }) {
  const [pages, setPages] = useState<Map<number, Uint8Array>>(new Map());
  const [decoded, setDecoded] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  async function refresh() {
    setError(null);
    setReading(true);
    try {
      if (reader.getState() === "disconnected") await reader.connect({ baseUrl: reader.kind === "bringup" ? "/reader" : undefined });
      const all = await reader.readAllPages();
      setPages(all);
      const user = concatPages(all, USER_FIRST_PAGE, USER_LAST_PAGE);
      const result = decodeUserMemory(user);
      setDecoded(JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? hex(v) : v), 2));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="card">
      <h2>Advanced diagnostics</h2>
      <p className="hint">
        Read-only tag inspection. To program module type / serial / registry, use <strong>Guided</strong> mode.
      </p>
      {error && <p className="err">{error}</p>}
      <button type="button" className="btn primary" disabled={reading} onClick={() => void refresh()}>
        {reading ? "Reading…" : "Re-read all pages"}
      </button>

      <div className="grid-2" style={{ marginTop: "1rem" }}>
        <div style={{ minWidth: 0 }}>
          <h3>Page table</h3>
          <div className="page-table-wrap">
            <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
              <thead>
                <tr>
                  <th align="left">Page</th>
                  <th align="left">Hex</th>
                </tr>
              </thead>
              <tbody>
                {[...pages.entries()]
                  .sort((a, b) => a[0] - b[0])
                  .map(([page, data]) => (
                    <tr key={page}>
                      <td style={{ padding: "0.15rem 0.35rem" }}>{page}</td>
                      <td style={{ padding: "0.15rem 0.35rem" }}>{hex(data)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <h3>Decoded payload</h3>
          <pre className="mono decode-wrap">{decoded || "(no decode)"}</pre>
          {pages.get(17) && (
            <p className="mono hint">
              Instance preview:{" "}
              {(() => {
                try {
                  const id = new Uint8Array(16);
                  for (let i = 0; i < 4; i++) id.set(pages.get(17 + i) ?? new Uint8Array(4), i * 4);
                  return bytesToUuid(id);
                } catch {
                  return "n/a";
                }
              })()}
            </p>
          )}
          <details>
            <summary>Lock / system pages</summary>
            <pre className="mono decode-wrap">
              {`page2=${pages.get(2) ? hex(pages.get(2)!) : "—"}
page44=${pages.get(44) ? hex(pages.get(44)!) : "—"}
page45=${pages.get(45) ? hex(pages.get(45)!) : "—"}
page46=${pages.get(46) ? hex(pages.get(46)!) : "—"}
page47/48 kill (RO / blocked in UI)`}
            </pre>
          </details>
        </div>
        <div style={{ minWidth: 0 }}>
          <h3>Memory map</h3>
          <BlockMap wave={reading} waveLabel={reading ? "Reading tag…" : undefined} />
        </div>
      </div>
    </div>
  );
}
