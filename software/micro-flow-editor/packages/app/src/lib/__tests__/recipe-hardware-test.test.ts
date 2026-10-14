import { describe, expect, it } from "vitest";
import { createI2cGenericExample } from "../device-recipe-draft.js";
import { buildRecipeTestPlan } from "../recipe-hardware-test.js";

const labels = { init: "Init", task: "Task", action: "Azione" };

describe("buildRecipeTestPlan", () => {
  it("runs Task alone without Init", () => {
    const draft = createI2cGenericExample();
    const plan = buildRecipeTestPlan(draft, { target: { kind: "task" }, runInitFirst: false }, labels);
    expect(plan.steps.every((s) => s.phase === "sample")).toBe(true);
    expect(plan.steps.length).toBe(draft.phases.sample.length);
  });

  it("prepends Init when requested", () => {
    const draft = createI2cGenericExample();
    const withInit = {
      ...draft,
      phases: {
        ...draft.phases,
        init: [{ id: "init-wait", type: "wait" as const, ms: 10 }],
        command: [{ id: "act-wait", type: "wait" as const, ms: 5 }],
      },
    };
    const plan = buildRecipeTestPlan(
      withInit,
      { target: { kind: "action" }, runInitFirst: true },
      labels,
    );
    expect(plan.steps[0]?.phase).toBe("init");
    expect(plan.steps.some((s) => s.phase === "command")).toBe(true);
  });

  it("picks a single Action, never both Task and Action", () => {
    const draft = createI2cGenericExample();
    const plan = buildRecipeTestPlan(draft, { target: { kind: "action" }, runInitFirst: false }, labels);
    expect(plan.steps.every((s) => s.phase === "command")).toBe(true);
    expect(plan.steps.some((s) => s.phase === "sample")).toBe(false);
  });
});
