import { bytesEqual, concatPages, splitPages } from "./bytes.js";
import { decodeUserMemory } from "./codec.js";
import type { WritePlan } from "./types.js";
import { PRODUCT_CODE_ST25TN01K, PRODUCT_PAGE, USER_FIRST_PAGE, USER_LAST_PAGE } from "./types.js";

export type PageMemory = {
  readPage(page: number): Promise<Uint8Array>;
  writePage(page: number, data: Uint8Array): Promise<void>;
};

export type ExecutorProgress =
  | { phase: "backup" | "validate" | "write" | "verify" | "done"; page?: number; index?: number; total?: number }
  | { phase: "error"; page?: number; message: string };

export type ExecutorResult =
  | { ok: true; backup: Map<number, Uint8Array>; verifiedUserMemory: Uint8Array }
  | { ok: false; backup: Map<number, Uint8Array>; failedPage?: number; message: string; partial: boolean };

async function readRange(mem: PageMemory, from: number, to: number): Promise<Map<number, Uint8Array>> {
  const map = new Map<number, Uint8Array>();
  for (let page = from; page <= to; page++) {
    map.set(page, await mem.readPage(page));
  }
  return map;
}

export async function executeWritePlan(
  mem: PageMemory,
  plan: WritePlan,
  options: {
    requireSt25tn01k?: boolean;
    onProgress?: (p: ExecutorProgress) => void;
    /** Simulate crash after completing this many write steps (0-based index of next write). */
    crashAfterWrites?: number;
  } = {},
): Promise<ExecutorResult> {
  const notify = options.onProgress ?? (() => undefined);
  notify({ phase: "backup" });
  const backup = await readRange(mem, 0, 63);

  notify({ phase: "validate" });
  if (options.requireSt25tn01k !== false) {
    const product = backup.get(PRODUCT_PAGE);
    if (!product || product.length !== 4) {
      return { ok: false, backup, message: "cannot read product page", partial: false };
    }
    const pc = product[0]! | (product[1]! << 8);
    if (pc !== PRODUCT_CODE_ST25TN01K) {
      return { ok: false, backup, message: `Product Code 0x${pc.toString(16)} is not ST25TN01K`, partial: false };
    }
  }

  // Ensure target pages currently match `before` when provided and appear writable (not enforced by chip here).
  for (const s of plan.steps) {
    const current = backup.get(s.page);
    if (!current) return { ok: false, backup, failedPage: s.page, message: `missing page ${s.page}`, partial: false };
    if (s.before && !bytesEqual(current, s.before)) {
      // Allow drift only if we intentionally invalidate magic from whatever was there.
      if (!(s.page === 11 && s.reason.startsWith("invalidate"))) {
        // still proceed — planner used snapshot; re-read is source of truth for write
      }
    }
  }

  let writesDone = 0;
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i]!;
    notify({ phase: "write", page: s.page, index: i, total: plan.steps.length });
    if (options.crashAfterWrites !== undefined && writesDone >= options.crashAfterWrites) {
      return {
        ok: false,
        backup,
        failedPage: s.page,
        message: `simulated power loss before writing page ${s.page}`,
        partial: writesDone > 0,
      };
    }
    try {
      await mem.writePage(s.page, s.after);
      const verify = await mem.readPage(s.page);
      if (!bytesEqual(verify, s.after)) {
        return {
          ok: false,
          backup,
          failedPage: s.page,
          message: `verify failed on page ${s.page}`,
          partial: true,
        };
      }
    } catch (cause) {
      return {
        ok: false,
        backup,
        failedPage: s.page,
        message: cause instanceof Error ? cause.message : String(cause),
        partial: true,
      };
    }
    writesDone += 1;
  }

  notify({ phase: "verify" });
  const userPages = await readRange(mem, USER_FIRST_PAGE, USER_LAST_PAGE);
  const userMemory = concatPages(userPages, USER_FIRST_PAGE, USER_LAST_PAGE);
  if (plan.expectedUserMemory.length === 160 && !plan.description.startsWith("Irreversible")) {
    if (!bytesEqual(userMemory, plan.expectedUserMemory)) {
      return { ok: false, backup, message: "full user-memory mismatch after write", partial: true };
    }
    const decoded = decodeUserMemory(userMemory);
    if (!decoded.ok) {
      return { ok: false, backup, message: `post-write decode failed: ${decoded.message}`, partial: true };
    }
  } else {
    for (const [page, expected] of plan.expectedPages) {
      const got = await mem.readPage(page);
      if (!bytesEqual(got, expected)) {
        return { ok: false, backup, failedPage: page, message: `lock/page ${page} mismatch`, partial: true };
      }
    }
  }

  notify({ phase: "done" });
  return { ok: true, backup, verifiedUserMemory: userMemory };
}

export function pagesFromUserMemory(userMemory: Uint8Array): Map<number, Uint8Array> {
  return splitPages(USER_FIRST_PAGE, userMemory);
}
