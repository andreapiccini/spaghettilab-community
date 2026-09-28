import { bytesEqual, splitPages } from "../bytes.js";
import { encodeUserMemory, encodeUserMemoryWithoutMagic, validateFieldsForWrite } from "../codec.js";
import { MAGIC, type ModuleTagFields, type PlanStep, type WritePlan } from "../types.js";

function step(page: number, before: Uint8Array | null, after: Uint8Array, reason: string, irreversible = false): PlanStep {
  return {
    page,
    before: before ? new Uint8Array(before) : null,
    after: new Uint8Array(after),
    reason,
    rollbackPossible: !irreversible && page !== 11,
    irreversible,
  };
}

/** Full factory programming plan (README §10). Magic page 11 is last. */
export function planFactoryProgram(fields: ModuleTagFields, currentPages: Map<number, Uint8Array>): WritePlan {
  const errors = validateFieldsForWrite(fields);
  if (errors.length) throw new Error(errors.join("; "));

  const finalImage = encodeUserMemory(fields);
  const preCommit = encodeUserMemoryWithoutMagic(fields);
  const finalPages = splitPages(4, finalImage);
  const prePages = splitPages(4, preCommit);

  const steps: PlanStep[] = [];

  // Invalidate magic first
  const page11Before = currentPages.get(11) ?? null;
  steps.push(step(11, page11Before, new Uint8Array(4), "invalidate magic before payload write"));

  for (let page = 4; page <= 43; page++) {
    if (page === 11) continue;
    const after = prePages.get(page)!;
    const before = currentPages.get(page) ?? null;
    if (before && bytesEqual(before, after)) continue;
    steps.push(step(page, before, after, page <= 10 ? "NDEF envelope" : page === 43 ? "NDEF terminator" : "payload body"));
  }

  // Final commit
  steps.push(step(11, new Uint8Array(4), new Uint8Array(MAGIC), "commit SLM1 magic"));

  return {
    steps,
    expectedUserMemory: finalImage,
    expectedPages: finalPages,
    backupRequired: true,
    description: "Factory program with two-phase SLM1 commit",
  };
}

/** Installation-only update (README §11): pages 34..42. */
export function planInstallationUpdate(
  currentFields: ModuleTagFields,
  patch: Partial<Pick<ModuleTagFields, "installationId" | "roleId" | "userFlags">>,
  currentPages: Map<number, Uint8Array>,
): WritePlan {
  const next: ModuleTagFields = {
    ...currentFields,
    ...patch,
    installationId: patch.installationId ? new Uint8Array(patch.installationId) : currentFields.installationId,
    configRevision: currentFields.configRevision + 1,
  };
  const image = encodeUserMemory(next);
  const pages = splitPages(4, image);
  const steps: PlanStep[] = [];
  for (let page = 34; page <= 41; page++) {
    steps.push(step(page, currentPages.get(page) ?? null, pages.get(page)!, "installation body"));
  }
  steps.push(step(42, currentPages.get(42) ?? null, pages.get(42)!, "installation CRC commit"));

  return {
    steps,
    expectedUserMemory: image,
    expectedPages: pages,
    backupRequired: true,
    description: "Mutable installation update (pages 34-42 only)",
  };
}

/**
 * ST25TN01K factory lock plan (README §12).
 * Static locks page 2 + dynamic locks page 44 so pages 4..33 RO, 34..43 RW.
 *
 * Mapping (documented assumption — see docs/st25tn01k-lock-map.md):
 * - STATLOCK locks pages 4..15 via page-2 bits
 * - DYNLOCK_0/1 lock page pairs through 32..33 while leaving 34..43 clear
 */
export function planFactoryLock(currentPages: Map<number, Uint8Array>): WritePlan {
  const page2 = currentPages.get(2);
  const page44 = currentPages.get(44);
  if (!page2 || !page44) throw new Error("lock pages 2 and 44 must be readable");

  // Page 2: keep UID/internal bytes; OR lock bits for CC + user 4..15.
  // Byte2: L_CC|BL + L4..L7; Byte3: L8..L15 (ST25TN Type2-compatible layout).
  const lock2 = Uint8Array.of(page2[0]!, page2[1]!, page2[2]! | 0xf8, page2[3]! | 0xff);

  // Page 44 DYNLOCK: lock pairs covering 16..33; keep 34..43 unlocked (bits for those pairs = 0).
  // DYNLOCK_0 bits 0..7 => pairs 16-17 .. 30-31; DYNLOCK_1 bit0 => 32-33; higher bits leave 34+ free.
  const dyn0 = page44[0]! | 0xff;
  const dyn1 = page44[1]! | 0x01; // only pair 32-33
  const lock44 = Uint8Array.of(dyn0, dyn1, page44[2]!, page44[3]!);

  return {
    steps: [
      step(2, page2, lock2, "static lock pages 4-15 (irreversible)", true),
      step(44, page44, lock44, "dynamic lock pages 16-33; keep 34-43 writable (irreversible)", true),
    ],
    expectedUserMemory: new Uint8Array(160),
    expectedPages: new Map([
      [2, lock2],
      [44, lock44],
    ]),
    backupRequired: true,
    description: "Irreversible factory lock of NDEF+identity (4-33)",
  };
}

export function factoryLockLeavesMutableWritable(plan: WritePlan): boolean {
  const dyn = plan.expectedPages.get(44);
  if (!dyn) return false;
  // Bits for pairs 34-35 and above must remain 0 in our planned mask.
  const dyn1Extra = dyn[1]! & 0xfe;
  const dyn2 = dyn[2]!;
  return dyn1Extra === 0 && dyn2 === (plan.steps.find((s) => s.page === 44)?.before?.[2] ?? 0);
}
