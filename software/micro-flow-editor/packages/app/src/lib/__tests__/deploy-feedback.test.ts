import { describe, expect, it } from "vitest";
import { describeDeployProblem, uniqueDeployProblems, canRecheckDeployProblem, canReconfigureDeployProblem } from "../deploy-feedback.js";
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

it("offers a config refresh instead of blaming the canvas for a stale generation", () => {
  const problem = { code: "config-deployment.stale_generation", technical: "the Core's Config changed since this candidate was prepared — the candidate is untouched; choose import-live, rebase, or cancel" };
  const text = describeDeployProblem(problem);
  expect(text.title).toContain("configurazione");
  expect(text.body).toContain("non è stato applicato");
  expect(text.body).not.toContain("Core's");
  expect(text.remedy).toContain("Ricontrolla");
  expect(canRecheckDeployProblem(problem)).toBe(true);
  expect(canRecheckDeployProblem({ technical: "Errore blocco" })).toBe(false);
  expect(canRecheckDeployProblem({ technical: problem.technical })).toBe(true);
});

 it("explains pin initialization failures without claiming a newer configuration", () => {
  const result = describeDeployProblem({ technical: "SpaghettiClient PROTOCOL_ERROR (phase activate_module, errno -133, rollback 0)" });
  expect(result.title).toContain("pin");
  expect(result.remedy).toContain("Configura");
 });


it("routes topology changes to reconfiguration rather than canvas wiring", () => {
  const problem = { technical: "Variazione delle Backbone rilevata: riconfigura le schede prima di caricare il programma." };
  expect(canReconfigureDeployProblem(problem)).toBe(true);
  expect(canReconfigureDeployProblem({code: "backbone-topology-changed", technical: "Layout changed"})).toBe(true);
  expect(canReconfigureDeployProblem({technical: "Pin occupato"})).toBe(false);
  expect(canRecheckDeployProblem(problem)).toBe(false);
  expect(describeDeployProblem(problem).remedy).toContain("Premi Riconfigura");
  expect(describeDeployProblem(problem, false).remedy).toContain("Press Reconfigure");
});
