import { useMemo, useState } from "react";
import { AuditStore } from "@spaghettilab/module-tag-audit";
import { BringupReader, SimulatedReader, type NfcReader } from "@spaghettilab/module-tag-reader";
import { GuidedMode } from "./modes/GuidedMode.js";
import { AdvancedMode } from "./modes/AdvancedMode.js";
import { BatchMode } from "./modes/BatchMode.js";

type Mode = "guided" | "advanced" | "batch";

export function App() {
  const [mode, setMode] = useState<Mode>("guided");
  const [adapter, setAdapter] = useState<"simulated" | "bringup">("simulated");
  const [operator, setOperator] = useState("operator");
  const audit = useMemo(() => new AuditStore(), []);
  const reader: NfcReader = useMemo(
    () => (adapter === "simulated" ? new SimulatedReader() : new BringupReader()),
    [adapter],
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          Module Tag Studio
          <span className="brand-sub">Spaghetti LAB</span>
        </div>
        <nav className="tabs" aria-label="Modes">
          {(
            [
              ["guided", "Guided"],
              ["advanced", "Advanced"],
              ["batch", "Batch"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" className="tab" aria-selected={mode === id} onClick={() => setMode(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="row" style={{ marginLeft: "auto" }}>
          <label className="hint">
            Operator{" "}
            <input value={operator} onChange={(e) => setOperator(e.target.value)} style={{ minHeight: "2.2rem" }} />
          </label>
          <label className="hint">
            Reader{" "}
            <select value={adapter} onChange={(e) => setAdapter(e.target.value as "simulated" | "bringup")}>
              <option value="simulated">Simulated</option>
              <option value="bringup">Bringup (hardware)</option>
            </select>
          </label>
          <span className="status">{reader.getState()}</span>
        </div>
      </header>
      <main className="main">
        {mode === "guided" && <GuidedMode reader={reader} audit={audit} operator={operator} />}
        {mode === "advanced" && <AdvancedMode reader={reader} />}
        {mode === "batch" && <BatchMode reader={reader} audit={audit} operator={operator} />}
      </main>
    </div>
  );
}
