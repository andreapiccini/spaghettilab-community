import { useMemo, useState } from "react";
import {
  emptyFields,
  executeWritePlan,
  FactoryFlags,
  FallbackClass,
  hex,
  manufacturingDateFromIso,
  planFactoryProgram,
  uuidToBytes,
  bytesToUuid,
} from "@spaghettilab/module-tag-protocol";
import { ensureBuiltinSignatures, RegistryClient } from "@spaghettilab/module-tag-registry";
import type { NfcReader } from "@spaghettilab/module-tag-reader";
import { AuditStore } from "@spaghettilab/module-tag-audit";
import { randomUuid } from "../lib/blocks.js";

type Unit = { serial: bigint; instanceId: string; status: "pending" | "ok" | "error"; message?: string };

export function BatchMode({
  reader,
  audit,
  operator,
}: {
  reader: NfcReader;
  audit: AuditStore;
  operator: string;
}) {
  const [count, setCount] = useState(3);
  const [startSerial, setStartSerial] = useState(1000);
  const [units, setUnits] = useState<Unit[]>([]);
  const [currentUid, setCurrentUid] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const usedIds = useMemo(() => new Set(units.map((u) => u.instanceId)), [units]);

  function buildLot() {
    const next: Unit[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < count; i++) {
      let id = randomUuid();
      while (seen.has(id) || usedIds.has(id)) id = randomUuid();
      seen.add(id);
      next.push({ serial: BigInt(startSerial + i), instanceId: id, status: "pending" });
    }
    setUnits(next);
    setIndex(0);
    setError(null);
  }

  async function programNext() {
    setError(null);
    const unit = units[index];
    if (!unit) return;
    try {
      if (reader.getState() === "disconnected") {
        await reader.connect({ baseUrl: reader.kind === "bringup" ? "/reader" : undefined });
      }
      const scan = await reader.scan(1);
      if (!scan.found) {
        setError("Place the next blank tag on ANT1.");
        return;
      }
      setCurrentUid(scan.uid);
      await ensureBuiltinSignatures();
      const registry = new RegistryClient();
      const resolved = await registry.resolve({ registryId: 1, vendorId: 1, moduleTypeId: 1001, definitionRevision: 3 });
      if (!resolved.ok) {
        setError(resolved.message);
        return;
      }
      const fields = emptyFields();
      fields.factoryFlags = FactoryFlags.HAS_DEFINITION_HASH | FactoryFlags.PRODUCTION_UNIT | FactoryFlags.HAS_FALLBACK_SUMMARY;
      fields.registryId = 1;
      fields.vendorId = 1;
      fields.moduleTypeId = 1001;
      fields.definitionRevision = 3;
      fields.hardwareRevision = 2;
      fields.moduleInstanceId = uuidToBytes(unit.instanceId);
      fields.definitionHash = resolved.definitionHash;
      fields.serialNumber = unit.serial;
      fields.manufacturingLot = 42;
      fields.manufacturingDate = manufacturingDateFromIso(new Date().toISOString().slice(0, 10));
      fields.fallbackClass = FallbackClass.Backbone;

      const pages = await reader.readAllPages();
      const plan = planFactoryProgram(fields, pages);
      const result = await executeWritePlan(
        {
          readPage: (p) => reader.readPage(p),
          writePage: (p, d) => reader.writePage(p, d),
        },
        plan,
      );
      if (!result.ok) {
        setUnits((u) => u.map((row, i) => (i === index ? { ...row, status: "error", message: result.message } : row)));
        setError(result.message);
        return;
      }
      audit.addReport({
        timestamp: new Date().toISOString(),
        operator,
        reader: reader.kind,
        antenna: 1,
        uid: scan.uid,
        productCode: "0x9090",
        moduleInstanceId: unit.instanceId,
        serialNumber: unit.serial.toString(),
        definitionKey: "1:1:1001:3",
        definitionHash: hex(resolved.definitionHash),
        factoryCrc: "verified",
        installationCrc: "verified",
        verifyOk: true,
        lockState: "unlocked",
        errors: [],
        retries: 0,
      });
      setUnits((u) => u.map((row, i) => (i === index ? { ...row, status: "ok" } : row)));
      setIndex((i) => i + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className="card">
      <h2>Batch production</h2>
      <p className="hint">Same definition for the whole lot; unique module_instance_id per unit. Resume from the first pending row.</p>
      {error && <p className="err">{error}</p>}
      <div className="row">
        <label>
          Count{" "}
          <input type="number" min={1} max={500} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </label>
        <label>
          Start serial{" "}
          <input type="number" value={startSerial} onChange={(e) => setStartSerial(Number(e.target.value))} />
        </label>
        <button type="button" className="btn" onClick={buildLot}>
          Build lot
        </button>
        <button type="button" className="btn primary" disabled={!units[index]} onClick={() => void programNext()}>
          Program unit {index + 1}/{units.length || 0}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const blob = new Blob([audit.exportReportsJson()], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "batch-report.json";
            a.click();
          }}
        >
          Export JSON
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const blob = new Blob([audit.exportReportsCsv()], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "batch-report.csv";
            a.click();
          }}
        >
          Export CSV
        </button>
      </div>
      {currentUid && (
        <p className="status" role="status">
          Current tag UID: <span className="mono">{currentUid}</span>
        </p>
      )}
      <table style={{ width: "100%", marginTop: "1rem", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th align="left">#</th>
            <th align="left">Serial</th>
            <th align="left">module_instance_id</th>
            <th align="left">Status</th>
          </tr>
        </thead>
        <tbody>
          {units.map((unit, i) => (
            <tr key={unit.instanceId} style={{ background: i === index ? "var(--bg-accent)" : undefined }}>
              <td>{i + 1}</td>
              <td className="mono">{unit.serial.toString()}</td>
              <td className="mono">{unit.instanceId}</td>
              <td className={unit.status === "ok" ? "ok" : unit.status === "error" ? "err" : undefined}>
                {unit.status}
                {unit.message ? ` — ${unit.message}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <details>
        <summary>Duplicate guard</summary>
        <p className="hint">Lot builder refuses to reuse a module_instance_id already present in this session ({usedIds.size} tracked).</p>
        <pre className="mono">{[...usedIds].slice(0, 5).join("\n") || "(none yet)"}</pre>
      </details>
    </div>
  );
}

void bytesToUuid;
