import { createModuleProgramDraft } from "./new-module-program.js";
import type { ProjectV1 } from "@spaghettilab/domain";
import { DEVICE_RECIPE_DRAFT_META_KEY, DEVICE_RECIPE_PENDING_CREATE_META_KEY, parseDeviceRecipeDraft } from "./device-recipe-draft.js";
import { saveDriverMetadata } from "./device-driver-library.js";
import { NFC_CONTEXT_META } from "./nfc-workspace.js";

/** Module catalog entry starts creation; opening an installed driver keeps its dedicated editor. */
export function newDeviceDriverMetadata(metadata: ProjectV1["authoringMetadata"]): ProjectV1["authoringMetadata"] {
  const previous = parseDeviceRecipeDraft(metadata[DEVICE_RECIPE_DRAFT_META_KEY]?.comment);
  return {
    ...(previous ? saveDriverMetadata(metadata, previous) : metadata),
    [DEVICE_RECIPE_DRAFT_META_KEY]: { comment: JSON.stringify(createModuleProgramDraft()) },
    [DEVICE_RECIPE_PENDING_CREATE_META_KEY]: { comment: "" },
    [NFC_CONTEXT_META]: { comment: "" },
    [MODULE_EDITOR_CONTEXT]: { comment: "library" },
  };
}

export const MODULE_EDITOR_CONTEXT = "__moduleEditorContext";
export function editModuleMetadata(metadata: ProjectV1["authoringMetadata"], draft: import("./device-recipe-draft.js").DeviceRecipeDraft, duplicate = false): ProjectV1["authoringMetadata"] {
  const editable = structuredClone(draft);
  const copy = duplicate ? { ...editable, id: `module-${crypto.randomUUID()}`, name: `${editable.name} · copia`, updatedAt: Date.now() } : editable;
  return { ...metadata,
    [DEVICE_RECIPE_DRAFT_META_KEY]: { comment: JSON.stringify(copy) },
    [DEVICE_RECIPE_PENDING_CREATE_META_KEY]: { comment: "" },
    [NFC_CONTEXT_META]: { comment: "" },
    [MODULE_EDITOR_CONTEXT]: { comment: "library" },
  };
}
