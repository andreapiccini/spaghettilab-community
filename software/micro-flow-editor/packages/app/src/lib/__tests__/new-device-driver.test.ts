import { expect, it } from "vitest";
import { newDeviceDriverMetadata } from "../new-device-driver.js";
import { rgbModuleDraft } from "../rgb-module.js";
import { DEVICE_RECIPE_DRAFT_META_KEY, DEVICE_RECIPE_PENDING_CREATE_META_KEY, serializeDeviceRecipeDraft } from "../device-recipe-draft.js";
import { savedDeviceDrivers } from "../device-driver-library.js";
import { NFC_CONTEXT_META } from "../nfc-workspace.js";

it("opens generic driver creation from the sidebar while preserving the previous RGB driver", () => {
  const draft = rgbModuleDraft();
  const original = { [DEVICE_RECIPE_DRAFT_META_KEY]: { comment: serializeDeviceRecipeDraft(draft) }, [DEVICE_RECIPE_PENDING_CREATE_META_KEY]: { comment: "1" }, [NFC_CONTEXT_META]: { comment: "pending tag" }, unrelated: { comment: "keep" } };
  const next = newDeviceDriverMetadata(original);
  expect(next[DEVICE_RECIPE_DRAFT_META_KEY]?.comment).toBe("");
  expect(next[DEVICE_RECIPE_PENDING_CREATE_META_KEY]?.comment).toBe("");
  expect(next[NFC_CONTEXT_META]?.comment).toBe("");
  expect(next.unrelated).toEqual(original.unrelated);
  expect(savedDeviceDrivers(next).find(item => item.id === draft.id)?.rgbModule).toEqual(draft.rgbModule);
  expect(original[DEVICE_RECIPE_PENDING_CREATE_META_KEY].comment).toBe("1");
});
