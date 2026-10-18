import { describe, expect, it } from "vitest";
import { describeDeployProblem, uniqueDeployProblems } from "../deploy-feedback.js";
describe("deploy feedback", () => {
  it("groups identical problems but preserves different boards and blocks", () => {
    const problem = { bindingId: "a", nodeId: "motor", technical: "Bad connection" };
    expect(
      uniqueDeployProblems([
        problem,
        problem,
        { ...problem, bindingId: "b" },
        { ...problem, nodeId: "other" },
      ]),
    ).toHaveLength(3);
  });
  it("explains square wave and Start with a concrete correction", () => {
    const text = describeDeployProblem({
      code: "wave-stepper-start",
      technical: "Stepper ULN2003: raw error",
    });
    expect(text.title).toContain("Start");
    expect(text.body).toContain("rotazione continua");
    expect(text.remedy).toContain("evento di avvio");
  });
  it("keeps machine identifiers out of the user explanation", () => {
    const text = describeDeployProblem({
      technical: `${"a".repeat(64)}: Collega il pin DATA.`,
    });
    expect(text.body).toBe("Collega il pin DATA.");
  });
  it("gives disconnected users an actionable connection check", () => {
    expect(
      describeDeployProblem({ code: "offline", technical: "USB timeout" }).remedy,
    ).toContain("Ricontrolla");
    expect(
      describeDeployProblem({ code: "offline", technical: "USB timeout" }, false).title,
    ).toBe("Backbone unavailable");
  });
});

it("keeps an unconfirmed upload out of canvas wiring instructions", () => {
 const text = describeDeployProblem({ code: "upload-unconfirmed", technical: "Nessuna conferma durante la verifica driver." });
 expect(text.title).toBe("Caricamento non confermato");
 expect(text.remedy).toContain("Ricontrolla");
 expect(text.remedy).not.toContain("canvas");
});
