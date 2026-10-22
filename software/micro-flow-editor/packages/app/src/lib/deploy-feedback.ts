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
export function isStaleDeployProblem(problem: DeployProblem): boolean {
  return problem.code === "config-deployment.stale_generation" ||
    /Config changed since this candidate was prepared/i.test(problem.technical);
}
export function canReconfigureDeployProblem(problem: DeployProblem): boolean {
  return problem.code === "backbone-topology-changed" ||
    /Variazione delle Backbone rilevata|Backbone topology changed/i.test(problem.technical);
}
export function canRecheckDeployProblem(problem: DeployProblem): boolean {
  return ["offline", "upload-unconfirmed"].includes(problem.code ?? "") || isStaleDeployProblem(problem);
}
export function describeDeployProblem(problem: DeployProblem, it = true) {
  const message = problem.technical.replace(/^[0-9a-f]{32,}:\s*/i, "");
  if (canReconfigureDeployProblem(problem)) return {
    title: it ? "Le Backbone devono essere riconfigurate" : "Backbones need reconfiguration",
    body: it ? "È cambiata la disposizione delle Backbone collegate rispetto al progetto." : "The connected Backbone layout has changed since the project was configured.",
    remedy: it ? "Premi Riconfigura per controllare la nuova disposizione e preparare moduli e pin sulle schede attuali. Dopo il caricamento il programma resterà fermo." : "Press Reconfigure to review the new layout and prepare modules and pins on the current boards. The program will remain stopped after upload.",
  };
  if (/phase activate_module, errno -133, rollback 0/.test(message)) return {
    title: it ? "I pin del modulo non sono configurati sulla Backbone" : "Module pins are not configured on the Backbone",
    body: it ? "Il modulo non può essere inizializzato con la configurazione attuale dei pin. Il programma precedente è stato ripristinato." : "The module cannot initialize with the current pin configuration. The previous program was restored.",
    remedy: it ? "Apri Physical Composition, controlla le assegnazioni e premi Configura. Poi riprova il caricamento." : "Open Physical Composition, check the assignments and press Configure. Then retry the upload.",
  };
  if (isStaleDeployProblem(problem)) return {
    title: it ? "La configurazione della Backbone è cambiata" : "The Backbone configuration has changed",
    body: it ? "La Backbone contiene una configurazione più recente di quella usata per preparare il caricamento. Il nuovo programma non è stato applicato." : "The Backbone has a newer configuration than the one used to prepare this upload. The new program was not applied.",
    remedy: it ? "Premi Ricontrolla per rileggere la configurazione e aggiornare il confronto. Poi controlla le modifiche e conferma nuovamente il caricamento. Il canvas resta invariato." : "Check again to read the current configuration and update the comparison. Then review the changes and confirm the upload again. Your canvas stays unchanged.",
  };
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
