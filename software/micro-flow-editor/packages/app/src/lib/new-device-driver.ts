import type { ProjectV1 } from "@spaghettilab/domain";
import { DEVICE_RECIPE_DRAFT_META_KEY, DEVICE_RECIPE_PENDING_CREATE_META_KEY, parseDeviceRecipeDraft } from "./device-recipe-draft.js";
import { saveDriverMetadata } from "./device-driver-library.js";
import { NFC_CONTEXT_META } from "./nfc-workspace.js";

/** Sidebar entry starts creation; opening an installed driver keeps its dedicated editor. */
export function newDeviceDriverMetadata(metadata: ProjectV1["authoringMetadata"]): ProjectV1["authoringMetadata"] {
  const previous = parseDeviceRecipeDraft(metadata[DEVICE_RECIPE_DRAFT_META_KEY]?.comment);
  return {
    ...(previous ? saveDriverMetadata(metadata, previous) : metadata),
    [DEVICE_RECIPE_DRAFT_META_KEY]: { comment: "" },
    [DEVICE_RECIPE_PENDING_CREATE_META_KEY]: { comment: "" },
    [NFC_CONTEXT_META]: { comment: "" },
  };
}
