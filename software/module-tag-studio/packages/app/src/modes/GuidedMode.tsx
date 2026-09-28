import { useMemo, useState } from "react";
import {
  bytesToUuid,
  decodeUserMemory,
  emptyFields,
  encodeUserMemory,
  executeWritePlan,
  FactoryFlags,
  FallbackClass,
  hex,
  manufacturingDateFromIso,
  manufacturingDateToIso,
  planFactoryLock,
  planFactoryProgram,
  uuidToBytes,
  validateFieldsForWrite,
  type ModuleTagFields,
} from "@spaghettilab/module-tag-protocol";
import { ensureBuiltinSignatures, RegistryClient, BUILTIN_AUTHORITIES, DEFINITION_CATALOG } from "@spaghettilab/module-tag-registry";
import type { NfcReader } from "@spaghettilab/module-tag-reader";
import { AuditStore } from "@spaghettilab/module-tag-audit";
import { BlockMap } from "../components/BlockMap.js";
import { CodeGuide } from "../components/CodeGuide.js";
import { NfcStage, StepHelp, WriteProgress, type NfcStageMode, type StepHelpContent } from "../components/StepChrome.js";
import { randomUuid } from "../lib/blocks.js";

const ZERO_INSTALLATION_ID = new Uint8Array(16);

const STEPS = [
  "Connect reader",
  "Detect tag",
  "Verify model",
  "Registry",
  "Definition",
  "Module identity",
  "Production",
  "Installation",
  "Review",
  "Program",
  "Factory lock",
  "Result",
];

const HELP: StepHelpContent[] = [
  {
    title: "Connect the reader",
    body: "The NFC reader talks to the chip on the module. Simulated needs no hardware; Bringup needs CORE + a local server.",
    bullets: [
      "Simulated: try the full flow without physical tags.",
      "Bringup: run `npm run dev:server` and select Bringup in the top bar.",
      "Choose ANT1 or ANT2 depending on where you place the tag.",
    ],
    tip: "If unsure, stay on Simulated and complete a full run — it is the same wizard as the bench.",
  },
  {
    title: "Detect the tag",
    body: "Place the ST25TN01K tag on the selected antenna. Scan reads UID and model.",
    bullets: [
      "Hold the tag still for 1–2 seconds over the antenna.",
      "If nothing is found, scan again (do not move it too soon).",
      "UID is needed for the audit report: we do not invent it.",
    ],
    tip: "In Simulated, scan always “finds” a virtual tag — useful for practice.",
  },
  {
    title: "Verify model and lock",
    body: "We check that it really is an ST25TN01K (Product Code 0x9090) and capture lock state.",
    bullets: [
      "Other NFC chips are not programmed (safety).",
      "If factory locks are already active, we do not rewrite identity.",
      "The block map on the right shows where data will go.",
    ],
    tip: "Wrong Product Code = stop. Do not force it: change the tag.",
  },
  {
    title: "Registry",
    body: "Enter the numeric ID of the signed registry (the authority that publishes definitions). This is not a username/password.",
    bullets: [
      "Offline demo: use registry_id = 1 (Spaghetti LAB Dev).",
      "You can type it or pick it from the list below.",
      "An unknown ID will fail the Definition step.",
    ],
    tip: "Pick from the dropdown; the code guide below lists the codes.",
  },
  {
    title: "Module definition",
    body: "Choose the module from the catalog with the dropdowns (or the quick pick). Then press Resolve.",
    bullets: [
      "Quick pick: one row = vendor + type + revision.",
      "Or filter: vendor → module_type_id → definition_revision.",
      "The code guide lists every code for the selected registry.",
    ],
    tip: "Demo: 1:1:1001:3 (Backbone) or 1:1:2001:1 (Sensor).",
  },
  {
    title: "Unit identity",
    body: "Automatic UUID + hardware_revision only among those supported by the definition.",
    bullets: [
      "module_instance_id: generated (not a catalog code).",
      "hardware_revision: menu from allowed PCB revisions.",
    ],
    tip: "Module type was already chosen in the Definition step.",
  },
  {
    title: "Production data",
    body: "Serial / lot / date are free-form. fallback_class is a fixed code from the menu.",
    bullets: [
      "serial_number and lot: editable",
      "fallback_class: pick from the guide (Backbone, Sensor, …)",
    ],
    tip: "Double-check the serial before Review.",
  },
  {
    title: "Installation (optional)",
    body: "These fields assign the unit to a project/site and a role inside that project. They live in the mutable installation section (pages 34–43) and can be updated later even after factory lock of pages 4–33.",
    bullets: [
      "Three separate identities: module_type_id = product type; module_instance_id = this physical unit; installation_id = which project/site/installation the unit is assigned to.",
      "installation_id: 128-bit UUID. All zeros = unassigned to any installation.",
      "role_id: numeric role inside that installation’s project database — not a display string. Example: DB maps 1001 → “Main Backbone”. 0 = no role assigned yet.",
    ],
    tip: "If you don’t know the site or role yet: leave installation_id as zeros and role_id as 0, then Continue.",
  },
  {
    title: "Final review",
    body: "Last check before writing. The map highlights pages that will be touched.",
    bullets: [
      "Compare serial, definition hash, instance UUID.",
      "The plan writes the SLM1 magic last (logical atomic commit).",
      "After “Proceed” the tag will be rewritten.",
    ],
    tip: "If something looks wrong, go back now: after programming, factory fields are “official”.",
  },
  {
    title: "Programming",
    body: "Two-phase write: invalidate magic → body → commit SLM1 → verify decode. Do not move the tag.",
    bullets: [
      "The bar shows backup → write → verify.",
      "If it fails mid-way, magic is not SLM1: the tag does not count as “programmed”.",
      "Do not power off the reader or PC during the progress bar.",
    ],
    tip: "Cyan animation = pages being written. Wait for the “verified” message.",
  },
  {
    title: "Factory lock (irreversible)",
    body: "Permanently locks pages 4–33 (NDEF + identity). Pages 34–43 stay updatable for installation.",
    bullets: [
      "Confirm by typing the serial or the last 8 digits of the UUID.",
      "There is no undo on silicon.",
      "You can skip lock in the lab; in production you usually lock.",
    ],
    tip: "If unsure: Skip lock, export the report, test the unit, then repeat with lock on another tag.",
  },
  {
    title: "Result and export",
    body: "Provisioning complete. Export HTML/CSV for line traceability.",
    bullets: [
      "HTML = single-unit report.",
      "CSV = append to the operator session.",
      "Keep the unit labeled as on the report.",
    ],
    tip: "For another unit: reload the page or restart from Connect.",
  },
];

export function GuidedMode({
  reader,
  audit,
  operator,
}: {
  reader: NfcReader;
  audit: AuditStore;
  operator: string;
}) {
  const [step, setStep] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [uid, setUid] = useState("");
  const [antenna, setAntenna] = useState<1 | 2>(1);
  const [pages, setPages] = useState<Map<number, Uint8Array>>(new Map());
  const [definitionHash, setDefinitionHash] = useState<Uint8Array>(new Uint8Array(16));
  const [definitionName, setDefinitionName] = useState("");
  const [definitionResolved, setDefinitionResolved] = useState(false);
  const [mfgDateIso, setMfgDateIso] = useState(() => new Date().toISOString().slice(0, 10));
  const [serialConfirm, setSerialConfirm] = useState("");
  const [lockConfirm, setLockConfirm] = useState("");
  const [resultHtml, setResultHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<NfcStageMode>("idle");
  const [prog, setProg] = useState<{ phase: string; index?: number; total?: number; page?: number } | null>(null);
  const [writingPage, setWritingPage] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const [fields, setFields] = useState<ModuleTagFields>(() => {
    const f = emptyFields();
    f.factoryFlags = FactoryFlags.HAS_DEFINITION_HASH | FactoryFlags.HAS_FALLBACK_SUMMARY | FactoryFlags.PRODUCTION_UNIT;
    f.registryId = 1;
    f.vendorId = 1;
    f.moduleTypeId = 1001;
    f.definitionRevision = 3;
    f.hardwareRevision = 2;
    f.moduleInstanceId = uuidToBytes(randomUuid());
    f.serialNumber = 4812n;
    f.manufacturingLot = 1;
    f.manufacturingDate = manufacturingDateFromIso(new Date().toISOString().slice(0, 10));
    f.fallbackClass = FallbackClass.Backbone;
    f.fallbackFlags = 0x0101;
    return f;
  });

  const expectedImage = useMemo(() => encodeUserMemory(fields), [fields]);
  const planPreview = useMemo(() => {
    try {
      return planFactoryProgram(fields, pages.size ? pages : new Map());
    } catch {
      return null;
    }
  }, [fields, pages]);

  const catalogForRegistry = useMemo(
    () => DEFINITION_CATALOG.filter((d) => d.registryId === fields.registryId),
    [fields.registryId],
  );
  const vendorOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const d of catalogForRegistry) {
      if (!map.has(d.vendorId)) map.set(d.vendorId, `vendor ${d.vendorId}`);
    }
    return [...map.entries()].map(([code, label]) => ({ code, label }));
  }, [catalogForRegistry]);
  const typeOptions = useMemo(
    () => catalogForRegistry.filter((d) => d.vendorId === fields.vendorId),
    [catalogForRegistry, fields.vendorId],
  );
  const uniqueTypes = useMemo(() => {
    const map = new Map<number, { code: number; label: string }>();
    for (const d of typeOptions) {
      if (!map.has(d.moduleTypeId)) map.set(d.moduleTypeId, { code: d.moduleTypeId, label: d.name });
    }
    return [...map.values()];
  }, [typeOptions]);
  const revisionOptions = useMemo(
    () =>
      typeOptions
        .filter((d) => d.moduleTypeId === fields.moduleTypeId)
        .map((d) => ({ code: d.definitionRevision, label: `${d.name} · rev ${d.definitionRevision}` })),
    [typeOptions, fields.moduleTypeId],
  );
  const selectedCatalog = useMemo(
    () =>
      DEFINITION_CATALOG.find(
        (d) =>
          d.registryId === fields.registryId &&
          d.vendorId === fields.vendorId &&
          d.moduleTypeId === fields.moduleTypeId &&
          d.definitionRevision === fields.definitionRevision,
      ) ?? null,
    [fields.registryId, fields.vendorId, fields.moduleTypeId, fields.definitionRevision],
  );
  const hwRevOptions = selectedCatalog?.supportedHardwareRevisions ?? [fields.hardwareRevision || 1];

  const definitionKey = `${fields.registryId}:${fields.vendorId}:${fields.moduleTypeId}:${fields.definitionRevision}`;
  const installationIdDisplay = bytesToUuid(fields.installationId);
  const installationUnassigned = fields.installationId.every((b) => b === 0);

  function applyDefinitionKey(key: string) {
    const entry = DEFINITION_CATALOG.find((d) => d.key === key);
    if (!entry) return;
    setDefinitionResolved(false);
    setFields((f) => ({
      ...f,
      registryId: entry.registryId,
      vendorId: entry.vendorId,
      moduleTypeId: entry.moduleTypeId,
      definitionRevision: entry.definitionRevision,
      hardwareRevision: entry.supportedHardwareRevisions[0] ?? f.hardwareRevision,
    }));
  }

  function push(msg: string) {
    setLog((prev) => [...prev, msg]);
    audit.appendLog("ui", { message: msg, step });
  }

  function goBack() {
    if (busy || step <= 0) return;
    setError(null);
    setStage("idle");
    if (step === 5) setDefinitionResolved(false);
    setStep((s) => s - 1);
  }

  function StepNav({
    onContinue,
    continueLabel = "Continue",
    continueDisabled,
    hideContinue,
  }: {
    onContinue?: () => void;
    continueLabel?: string;
    continueDisabled?: boolean;
    hideContinue?: boolean;
  }) {
    return (
      <div className="step-nav">
        {step > 0 && step < 11 && (
          <button type="button" className="btn" disabled={busy} onClick={goBack}>
            ← Back
          </button>
        )}
        {!hideContinue && onContinue && (
          <button type="button" className="btn primary" disabled={busy || continueDisabled} onClick={onContinue}>
            {continueLabel}
          </button>
        )}
      </div>
    );
  }

  async function connect() {
    setError(null);
    setBusy(true);
    setStage("busy");
    try {
      await reader.connect({ baseUrl: reader.kind === "bringup" ? "/reader" : undefined });
      push(`Reader connected (${reader.kind})`);
      setStage("ok");
      setTimeout(() => setStep(1), 350);
    } catch (cause) {
      setStage("err");
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function detect() {
    setError(null);
    setBusy(true);
    setStage("scanning");
    try {
      const scan = await reader.scan(antenna);
      if (!scan.found) {
        setStage("err");
        setError("No tag on the antenna. Place an ST25TN01K and try again.");
        return;
      }
      setUid(scan.uid);
      push(`Tag detected on ANT${scan.antenna}: ${scan.uid} (${scan.model})`);
      setStage("ok");
      setTimeout(() => setStep(2), 400);
    } catch (cause) {
      setStage("err");
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function verifyModel() {
    setError(null);
    setBusy(true);
    setStage("busy");
    try {
      const all = await reader.readAllPages();
      setPages(all);
      const product = all.get(45)!;
      const pc = product[0]! | (product[1]! << 8);
      if (pc !== 0x9090) {
        setStage("err");
        setError(`Product Code 0x${pc.toString(16)} is not ST25TN01K (0x9090). Programming disabled.`);
        return;
      }
      push("ST25TN01K verified. Lock bits captured for review.");
      setStage("ok");
      setTimeout(() => setStep(3), 350);
    } catch (cause) {
      setStage("err");
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function loadDefinition() {
    setError(null);
    setBusy(true);
    setDefinitionResolved(false);
    try {
      if (!fields.vendorId || !fields.moduleTypeId || !fields.definitionRevision) {
        setError("Fill vendor_id, module_type_id, and definition_revision (all > 0).");
        return;
      }
      if (!BUILTIN_AUTHORITIES.some((a) => a.registryId === fields.registryId)) {
        setError(`Registry ${fields.registryId} is not in the signed authority list. Go back and pick a known ID (demo: 1).`);
        return;
      }
      await ensureBuiltinSignatures();
      const client = new RegistryClient();
      const result = await client.resolve({
        registryId: fields.registryId,
        vendorId: fields.vendorId,
        moduleTypeId: fields.moduleTypeId,
        definitionRevision: fields.definitionRevision,
      });
      if (!result.ok) {
        setError(
          `${result.message} — for the offline demo use vendor=1, module_type=1001, revision=3.`,
        );
        return;
      }
      setDefinitionHash(result.definitionHash);
      setDefinitionName(result.definition.presentation.name);
      setDefinitionResolved(true);
      setFields((f) => ({
        ...f,
        definitionHash: result.definitionHash,
        factoryFlags: f.factoryFlags | FactoryFlags.HAS_DEFINITION_HASH,
      }));
      push(`Definition loaded: ${result.definition.presentation.name} (hash ${hex(result.definitionHash)})`);
    } finally {
      setBusy(false);
    }
  }

  async function program() {
    setError(null);
    const errs = validateFieldsForWrite(fields);
    if (errs.length) {
      setError(errs.join("; "));
      return;
    }
    setBusy(true);
    setStage("busy");
    setProg({ phase: "backup" });
    try {
      const current = pages.size ? pages : await reader.readAllPages();
      const plan = planFactoryProgram(fields, current);
      const mem = {
        readPage: (p: number) => reader.readPage(p),
        writePage: (p: number, d: Uint8Array) => reader.writePage(p, d),
      };
      push(`Writing ${plan.steps.length} pages (magic last)…`);
      const result = await executeWritePlan(mem, plan, {
        onProgress: (p) => {
          if (p.phase === "error") {
            setProg({ phase: p.phase, page: p.page });
            return;
          }
          setProg({ phase: p.phase, index: p.index, total: p.total, page: p.page });
          if (p.phase === "write" && p.page != null) setWritingPage(p.page);
        },
      });
      if (!result.ok) {
        setStage("err");
        setError(`${result.message}${result.failedPage != null ? ` (page ${result.failedPage})` : ""}. Tag left unlocked.`);
        audit.appendLog("program_failed", { message: result.message, page: result.failedPage });
        return;
      }
      const decoded = decodeUserMemory(result.verifiedUserMemory);
      if (!decoded.ok) {
        setStage("err");
        setError(`Verify decode failed: ${decoded.message}`);
        return;
      }
      setPages(await reader.readAllPages());
      setProg({ phase: "done", index: 1, total: 1 });
      setWritingPage(null);
      push("Programming verified byte-for-byte.");
      setStage("ok");
      setTimeout(() => setStep(10), 450);
    } catch (cause) {
      setStage("err");
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function applyLock() {
    setError(null);
    const serial = fields.serialNumber.toString();
    const inst = bytesToUuid(fields.moduleInstanceId);
    if (serialConfirm !== serial && lockConfirm !== inst.slice(-8)) {
      setError("Type the serial or the last 8 digits of module_instance_id to confirm the irreversible lock.");
      return;
    }
    setBusy(true);
    setStage("busy");
    try {
      const current = await reader.readAllPages();
      const plan = planFactoryLock(current);
      const mem = {
        readPage: (p: number) => reader.readPage(p),
        writePage: (p: number, d: Uint8Array) => reader.writePage(p, d),
      };
      const result = await executeWritePlan(mem, plan, {
        onProgress: (p) => {
          if (p.phase === "error") {
            setProg({ phase: p.phase, page: p.page });
            return;
          }
          setProg({ phase: p.phase, index: p.index, total: p.total, page: p.page });
        },
      });
      if (!result.ok) {
        setStage("err");
        setError(result.message);
        return;
      }
      push("Factory lock applied and verified. Blocks 34-43 remain writable.");
      setStage("ok");
      finish(true);
    } catch (cause) {
      setStage("err");
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function finish(locked: boolean) {
    const report = {
      timestamp: new Date().toISOString(),
      operator,
      reader: reader.kind,
      antenna,
      uid,
      productCode: "0x9090",
      moduleInstanceId: bytesToUuid(fields.moduleInstanceId),
      serialNumber: fields.serialNumber.toString(),
      definitionKey: `${fields.registryId}:${fields.vendorId}:${fields.moduleTypeId}:${fields.definitionRevision}`,
      definitionHash: hex(definitionHash),
      factoryCrc: "verified",
      installationCrc: "verified",
      verifyOk: true,
      lockState: locked ? "factory 4-33 locked; 34-43 writable" : "unlocked",
      errors: [] as string[],
      retries: 0,
    };
    audit.addReport(report);
    setResultHtml(audit.exportReportHtml(report));
    setStep(11);
  }

  const help = HELP[step]!;

  return (
    <div className="card">
      <div className="steps" aria-label="Guided steps">
        {STEPS.map((label, index) => (
          <span key={label} className={`step-pill${index === step ? " active" : ""}${index < step ? " done" : ""}`}>
            {index + 1}. {label}
          </span>
        ))}
      </div>

      <StepHelp content={help} key={step} />

      {error && <p className="err">{error}</p>}

      <div className="step-panel" key={`panel-${step}`}>
        {step === 0 && (
          <section>
            <h2>Connect the reader</h2>
            <NfcStage
              mode={stage === "idle" ? "idle" : stage}
              caption={busy ? "Connecting…" : reader.kind === "simulated" ? "Simulated mode ready" : "Waiting for Bringup"}
              label="RD"
            />
            <div className="field">
              <label htmlFor="antenna">Antenna</label>
              <select id="antenna" value={antenna} onChange={(e) => setAntenna(Number(e.target.value) as 1 | 2)}>
                <option value={1}>ANT1</option>
                <option value={2}>ANT2</option>
              </select>
            </div>
            <StepNav onContinue={() => void connect()} continueLabel="Connect" continueDisabled={busy} />
          </section>
        )}

        {step === 1 && (
          <section>
            <h2>Detect the tag</h2>
            <NfcStage mode={busy ? "scanning" : stage} caption={busy ? `Scan ANT${antenna}…` : "Place the tag on the antenna"} />
            <StepNav onContinue={() => void detect()} continueLabel={`Scan ANT${antenna}`} continueDisabled={busy} />
          </section>
        )}

        {step === 2 && (
          <section className="grid-2">
            <div>
              <h2>Verify model &amp; lock</h2>
              <p className="mono">UID {uid}</p>
              <NfcStage mode={busy ? "busy" : stage} caption={busy ? "Reading pages…" : "Ready to verify ST25TN01K"} label="T2" />
              <StepNav onContinue={() => void verifyModel()} continueLabel="Read Product Code" continueDisabled={busy} />
            </div>
            <BlockMap wave={busy} waveLabel={busy ? "Reading tag…" : undefined} />
          </section>
        )}

        {step === 3 && (
          <section>
            <h2>Registry</h2>
            <p className="hint">Select the authority from the list (predefined codes, not free-typed).</p>
            <div className="field">
              <label htmlFor="registryPick">registry_id</label>
              <select
                id="registryPick"
                value={fields.registryId}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setDefinitionResolved(false);
                  const first = DEFINITION_CATALOG.find((d) => d.registryId === id);
                  setFields((f) => ({
                    ...f,
                    registryId: id,
                    vendorId: first?.vendorId ?? f.vendorId,
                    moduleTypeId: first?.moduleTypeId ?? f.moduleTypeId,
                    definitionRevision: first?.definitionRevision ?? f.definitionRevision,
                  }));
                }}
              >
                {BUILTIN_AUTHORITIES.map((a) => (
                  <option key={a.registryId} value={a.registryId}>
                    {a.registryId} — {a.name}
                  </option>
                ))}
              </select>
            </div>
            <CodeGuide
              title="Registry code guide"
              rows={BUILTIN_AUTHORITIES.map((a) => ({
                code: String(a.registryId),
                label: a.name,
              }))}
            />
            <StepNav
              onContinue={() => {
                if (!fields.registryId) {
                  setError("Select a registry from the list.");
                  return;
                }
                setError(null);
                setStep(4);
              }}
              continueDisabled={!fields.registryId}
            />
          </section>
        )}

        {step === 4 && (
          <section>
            <h2>Module definition</h2>
            <p className="hint">Choose the module from the catalog (dropdowns). Codes match the guide below.</p>
            <div className="field">
              <label htmlFor="defPick">Definition (quick pick)</label>
              <select id="defPick" value={selectedCatalog?.key ?? ""} onChange={(e) => applyDefinitionKey(e.target.value)}>
                <option value="" disabled>
                  — select from catalog —
                </option>
                {catalogForRegistry.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.key} — {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="vendorId">vendor_id</label>
                <select
                  id="vendorId"
                  value={fields.vendorId}
                  onChange={(e) => {
                    const vendorId = Number(e.target.value);
                    const next = catalogForRegistry.find((d) => d.vendorId === vendorId);
                    setDefinitionResolved(false);
                    setFields((f) => ({
                      ...f,
                      vendorId,
                      moduleTypeId: next?.moduleTypeId ?? f.moduleTypeId,
                      definitionRevision: next?.definitionRevision ?? f.definitionRevision,
                      hardwareRevision: next?.supportedHardwareRevisions[0] ?? f.hardwareRevision,
                    }));
                  }}
                >
                  {vendorOptions.map((v) => (
                    <option key={v.code} value={v.code}>
                      {v.code} — {v.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="moduleTypeId">module_type_id</label>
                <select
                  id="moduleTypeId"
                  value={fields.moduleTypeId}
                  onChange={(e) => {
                    const moduleTypeId = Number(e.target.value);
                    const next = typeOptions.find((d) => d.moduleTypeId === moduleTypeId);
                    setDefinitionResolved(false);
                    setFields((f) => ({
                      ...f,
                      moduleTypeId,
                      definitionRevision: next?.definitionRevision ?? f.definitionRevision,
                      hardwareRevision: next?.supportedHardwareRevisions[0] ?? f.hardwareRevision,
                    }));
                  }}
                >
                  {uniqueTypes.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.code} — {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="definitionRevision">definition_revision</label>
                <select
                  id="definitionRevision"
                  value={fields.definitionRevision}
                  onChange={(e) => {
                    setDefinitionResolved(false);
                    setFields((f) => ({ ...f, definitionRevision: Number(e.target.value) }));
                  }}
                >
                  {revisionOptions.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.code} — {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Key</label>
                <input className="mono" readOnly value={definitionKey} />
              </div>
            </div>
            <CodeGuide
              title="Definition code guide (this registry)"
              rows={catalogForRegistry.map((d) => ({
                code: d.key,
                label: `${d.name} · supported HW rev: ${d.supportedHardwareRevisions.join(", ")}`,
              }))}
            />
            <div className="row" style={{ marginTop: "0.75rem" }}>
              <button type="button" className="btn" disabled={busy || !selectedCatalog} onClick={() => void loadDefinition()}>
                Resolve definition
              </button>
            </div>
            {definitionResolved && (
              <div className="def-resolved">
                <strong>{definitionName || "(unnamed)"}</strong>
                <span className="mono hint">hash {hex(definitionHash)}</span>
              </div>
            )}
            <StepNav
              onContinue={() => {
                setError(null);
                setStep(5);
              }}
              continueDisabled={!definitionResolved}
            />
          </section>
        )}

        {step === 5 && (
          <section>
            <h2>Unit identity</h2>
            <p className="hint">
              Module: <strong>{definitionName || selectedCatalog?.name || "—"}</strong>{" "}
              <span className="mono">({definitionKey})</span>
            </p>
            <div className="form-grid">
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="instance">module_instance_id</label>
                <input id="instance" className="mono" value={bytesToUuid(fields.moduleInstanceId)} readOnly />
                <span className="hint">Auto-generated UUID (not a catalog code). Identifies this physical unit.</span>
              </div>
              <div className="field">
                <label htmlFor="hwRev">hardware_revision</label>
                <select
                  id="hwRev"
                  value={fields.hardwareRevision}
                  onChange={(e) => setFields((f) => ({ ...f, hardwareRevision: Number(e.target.value) }))}
                >
                  {hwRevOptions.map((rev) => (
                    <option key={rev} value={rev}>
                      {rev}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <CodeGuide
              title="hardware_revision code guide (from definition)"
              rows={hwRevOptions.map((rev) => ({
                code: String(rev),
                label: `PCB revision ${rev} supported by ${selectedCatalog?.name ?? "definition"}`,
              }))}
            />
            <div className="row" style={{ marginTop: "0.75rem" }}>
              <button type="button" className="btn" onClick={() => setFields((f) => ({ ...f, moduleInstanceId: uuidToBytes(randomUuid()) }))}>
                Regenerate UUID
              </button>
            </div>
            <StepNav onContinue={() => setStep(6)} />
          </section>
        )}

        {step === 6 && (
          <section>
            <h2>Production info</h2>
            <p className="hint">Serial, lot, and date are free-form. fallback_class is a predefined code (menu).</p>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="serial">serial_number</label>
                <input
                  id="serial"
                  value={fields.serialNumber.toString()}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, "") || "0";
                    setFields((f) => ({ ...f, serialNumber: BigInt(raw) }));
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="lot">manufacturing_lot</label>
                <input
                  id="lot"
                  type="number"
                  min={0}
                  value={fields.manufacturingLot}
                  onChange={(e) => setFields((f) => ({ ...f, manufacturingLot: Number(e.target.value) || 0 }))}
                />
              </div>
              <div className="field">
                <label htmlFor="mfgDate">manufacturing_date</label>
                <input
                  id="mfgDate"
                  type="date"
                  value={mfgDateIso}
                  onChange={(e) => {
                    const iso = e.target.value;
                    setMfgDateIso(iso);
                    setFields((f) => ({ ...f, manufacturingDate: manufacturingDateFromIso(iso) }));
                  }}
                />
                <span className="hint">ISO → days since 2020-01-01 ({fields.manufacturingDate})</span>
              </div>
              <div className="field">
                <label htmlFor="fallbackClass">fallback_class</label>
                <select
                  id="fallbackClass"
                  value={fields.fallbackClass}
                  onChange={(e) => setFields((f) => ({ ...f, fallbackClass: Number(e.target.value) }))}
                >
                  {Object.entries(FallbackClass).map(([name, value]) => (
                    <option key={name} value={value}>
                      {value} — {name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <CodeGuide
              title="fallback_class code guide"
              rows={Object.entries(FallbackClass).map(([name, value]) => ({
                code: String(value),
                label: name,
              }))}
            />
            <StepNav onContinue={() => setStep(7)} />
          </section>
        )}

        {step === 7 && (
          <section>
            <h2>Installation (optional)</h2>
            <p className="hint">
              Site/installation assignment vs role are separate. These live in pages 34–43 and stay writable after factory lock.
            </p>
            <div className="form-grid">
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="installationId">installation_id</label>
                <input id="installationId" className="mono" value={installationIdDisplay} readOnly />
                <span className="hint">
                  Which project/site/installation this unit is assigned to (128-bit UUID). All zeros = unassigned
                  {installationUnassigned ? " (current)." : "."}
                </span>
                <div className="row" style={{ marginTop: "0.5rem" }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setFields((f) => ({ ...f, installationId: uuidToBytes(randomUuid()) }))}
                  >
                    Regenerate UUID
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setFields((f) => ({ ...f, installationId: new Uint8Array(ZERO_INSTALLATION_ID) }))}
                  >
                    Clear to zeros
                  </button>
                </div>
              </div>
              <div className="field">
                <label htmlFor="role">role_id</label>
                <input
                  id="role"
                  type="number"
                  min={0}
                  value={fields.roleId}
                  onChange={(e) => setFields((f) => ({ ...f, roleId: Number(e.target.value) || 0 }))}
                />
                <span className="hint">
                  Numeric role inside that installation’s project database — not a display string. Example: DB maps 1001 →
                  “Main Backbone”. 0 = no role assigned yet.
                </span>
              </div>
              <div className="field">
                <label htmlFor="userFlags">user_flags</label>
                <input
                  id="userFlags"
                  type="number"
                  min={0}
                  value={fields.userFlags}
                  onChange={(e) => setFields((f) => ({ ...f, userFlags: Number(e.target.value) || 0 }))}
                />
              </div>
            </div>
            <StepNav onContinue={() => setStep(8)} continueLabel="Continue to review" />
          </section>
        )}

        {step === 8 && (
          <section className="grid-2">
            <div>
              <h2>Review</h2>
              <ul className="review-list">
                <li>
                  <span>Registry</span>
                  <span>{fields.registryId}</span>
                </li>
                <li>
                  <span>Model</span>
                  <span>{definitionName || "—"}</span>
                </li>
                <li>
                  <span>Type</span>
                  <span>
                    {fields.vendorId}/{fields.moduleTypeId} rev {fields.definitionRevision}
                  </span>
                </li>
                <li>
                  <span>HW rev</span>
                  <span>{fields.hardwareRevision}</span>
                </li>
                <li>
                  <span>Serial</span>
                  <span className="mono">{fields.serialNumber.toString()}</span>
                </li>
                <li>
                  <span>Mfg date</span>
                  <span>{manufacturingDateToIso(fields.manufacturingDate) ?? mfgDateIso}</span>
                </li>
                <li>
                  <span>Instance</span>
                  <span className="mono">{bytesToUuid(fields.moduleInstanceId)}</span>
                </li>
                <li>
                  <span>Installation</span>
                  <span className="mono">{installationIdDisplay}</span>
                </li>
                <li>
                  <span>Role</span>
                  <span>{fields.roleId}</span>
                </li>
                <li>
                  <span>Def hash</span>
                  <span className="mono">{hex(definitionHash)}</span>
                </li>
                <li>
                  <span>User memory</span>
                  <span>160 / 160 B</span>
                </li>
                <li>
                  <span>Write steps</span>
                  <span>{planPreview?.steps.length ?? "—"}</span>
                </li>
              </ul>
              <StepNav
                onContinue={() => {
                  setStage("idle");
                  setProg(null);
                  setStep(9);
                }}
                continueLabel="Proceed to programming"
              />
            </div>
            <BlockMap changedPages={planPreview?.steps.map((s) => s.page) ?? []} />
          </section>
        )}

        {step === 9 && (
          <section className="grid-2">
            <div>
              <h2>Program &amp; verify</h2>
              <NfcStage
                mode={busy ? "busy" : stage}
                caption={busy ? "Do not move the tag…" : "Ready to write SLM1"}
                label="WR"
              />
              {prog && <WriteProgress {...prog} />}
              <StepNav
                onContinue={() => void program()}
                continueLabel={busy ? "Programming…" : "Program tag"}
                continueDisabled={busy}
              />
            </div>
            <BlockMap
              changedPages={planPreview?.steps.map((s) => s.page) ?? []}
              highlight={writingPage != null ? [writingPage] : []}
              wave={busy || stage === "busy" || stage === "ok"}
              waveLabel={
                busy
                  ? prog?.phase === "verify"
                    ? "Verifying…"
                    : prog?.phase === "write"
                      ? `Writing page ${prog.page ?? "…"}…`
                      : "Programming tag…"
                  : stage === "ok"
                    ? "Write complete"
                    : undefined
              }
            />
          </section>
        )}

        {step === 10 && (
          <section>
            <h2>Factory lock (optional, irreversible)</h2>
            <p className="warn">Permanently locks blocks 4–33. Blocks 34–43 remain writable.</p>
            {busy && prog && <WriteProgress {...prog} />}
            <div className="form-grid">
              <div className="field">
                <label htmlFor="serialConfirm">Type the serial to confirm</label>
                <input id="serialConfirm" value={serialConfirm} onChange={(e) => setSerialConfirm(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="uuidConfirm">Or last 8 of module_instance_id</label>
                <input id="uuidConfirm" value={lockConfirm} onChange={(e) => setLockConfirm(e.target.value)} />
              </div>
            </div>
            <div className="step-nav">
              <button type="button" className="btn" disabled={busy} onClick={goBack}>
                ← Back
              </button>
              <button type="button" className="btn danger" disabled={busy} onClick={() => void applyLock()}>
                Lock factory section
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => finish(false)}>
                Skip lock
              </button>
            </div>
          </section>
        )}

        {step === 11 && (
          <section>
            <div className="success-burst">
              <div className="check" aria-hidden>
                ✓
              </div>
              <h2 style={{ margin: 0 }}>Provisioning complete</h2>
              <p className="hint" style={{ margin: "0.35rem 0 0" }}>
                Serial {fields.serialNumber.toString()} · {bytesToUuid(fields.moduleInstanceId)}
              </p>
            </div>
            <div className="row">
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  const blob = new Blob([resultHtml], { type: "text/html" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `tag-report-${fields.serialNumber}.html`;
                  a.click();
                }}
              >
                Export HTML report
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const blob = new Blob([audit.exportReportsCsv()], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "tag-reports.csv";
                  a.click();
                }}
              >
                Export CSV
              </button>
            </div>
            <details>
              <summary>Expected image ({expectedImage.length} B)</summary>
              <pre className="mono">{hex(expectedImage)}</pre>
            </details>
          </section>
        )}
      </div>

      <details>
        <summary>Session log</summary>
        <pre className="mono">{log.join("\n") || "(empty)"}</pre>
      </details>
    </div>
  );
}
