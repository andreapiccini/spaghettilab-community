export type DeployProblem = {
  bindingId?: string;
  nodeId?: string;
  code?: string;
  technical: string;
  phase?: string;
};
export function uniqueDeployProblems(
  problems: readonly DeployProblem[],
): DeployProblem[] {
  return [
    ...new Map(
      problems.map((p) => [`${p.bindingId}:${p.nodeId}:${p.technical}`, p]),
    ).values(),
  ];
}
export function describeDeployProblem(problem: DeployProblem, it = true) {
  const message = problem.technical.replace(/^[0-9a-f]{32,}:\s*/i, "");
  if (problem.code === "upload-unconfirmed")
    return {
      title: it ? "Caricamento non confermato" : "Upload unconfirmed",
      body:
        it && /timeout|timed out/i.test(message)
          ? problem.phase
            ? `La Backbone non ha risposto durante: ${problem.phase.replace(/…$/, "")}.`
            : "La Backbone non ha risposto in tempo durante il caricamento. L’esito deve essere verificato."
          : message,
      remedy: it
        ? "Premi Ricontrolla per leggere lo stato della Backbone prima di inviare nuovamente il programma."
        : "Check the Backbone status before sending the program again.",
    };
  if (problem.code === "wave-stepper-start")
    return {
      title: it
        ? "Onda quadra e Start non sono compatibili"
        : "Square wave and Start are incompatible",
      body: it
        ? "Start avvia la rotazione continua: basta un impulso di avvio, non un’onda quadra."
        : "Start begins continuous rotation: it needs a start event, not a square wave.",
      remedy: it
        ? "Rimuovi questo collegamento e usa un evento di avvio per comandare Start."
        : "Remove this connection and use a start event to trigger Start.",
    };
  if (problem.code === "wave-trigger" || /collega l’onda.*HIGH e LOW/.test(message))
    return {
      title: it
        ? "Questo ingresso non accetta un’onda quadra"
        : "This input does not accept a square wave",
      body: it
        ? "Il collegamento richiede un ingresso comando con due azioni associate ai livelli HIGH e LOW."
        : "This connection needs a command input with actions mapped to HIGH and LOW.",
      remedy: it
        ? "Scegli un ingresso compatibile o modifica la mappatura nel driver del dispositivo."
        : "Choose a compatible input or update the device driver mapping.",
    };
  if (
    problem.code === "offline" ||
    /non disponibile|scollegat|non risponde|nessuna Backbone rilevata|not connected|not available/i.test(
      message,
    )
  )
    return {
      title: it ? "La Backbone non è disponibile" : "Backbone unavailable",
      body: it
        ? "Non è possibile controllare o caricare il programma su questa scheda."
        : "This board cannot be checked or programmed right now.",
      remedy: it
        ? "Collega la Backbone, poi premi Ricontrolla."
        : "Connect the Backbone, then check again.",
    };
  return {
    title: it
      ? "Il programma richiede una correzione"
      : "The program needs a correction",
    body: message,
    remedy: it
      ? "Controlla il blocco e i suoi collegamenti nel canvas, poi riprova."
      : "Check the block and its connections on the canvas, then try again.",
  };
}
