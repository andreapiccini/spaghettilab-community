import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { ConfigDiff } from "@spaghettilab/config-deployment";
import { ConfigDiffView } from "../../components/deploy-diff/ConfigDiffView.js";
import { changedConfigFields, formatConfigDiffValue } from "../config-diff-values.js";

it("renders the deploy diff after changing RGB properties containing bigint", () => {
  const empty = { added: [], removed: [], changed: [] };
  const diff = {
    modules: { ...empty, changed: [{
      before: { key: 1, properties: { 1: 16724838n, 2: { value: 9007199254740993n } } },
      after: { key: 1, properties: { 1: 3407681n, 2: { value: 9007199254740993n } } },
    }] },
    schedules: empty, rules: empty, blocks: empty, edges: empty, policyChanged: false,
  } as unknown as ConfigDiff;
  const html = renderToStaticMarkup(createElement(ConfigDiffView, { diff }));
  expect(html).toContain("Module #1");
  expect(html).toContain("Vedi campi");
});

it("compares and displays nested bigint properties without losing precision", () => {
  const before = { config: [9007199254740993n], removed: true, same: 12n };
  const after = { config: [9007199254740994n], added: 1n, same: 12n };
  expect(changedConfigFields(before, after)).toEqual(["config", "removed", "added"]);
  expect(formatConfigDiffValue(before.config)).toBe('["9007199254740993n"]');
  expect(formatConfigDiffValue(undefined)).toBe("—");
  expect(changedConfigFields({ value: 1n }, { value: 1 })).toEqual(["value"]);
});
