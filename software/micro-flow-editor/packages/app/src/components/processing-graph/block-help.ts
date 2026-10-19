import type { DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import type { NodePortLayout } from "./node-ports.js";
import type { BlockHelp } from "./BlockInfoButton.js";
export function blockHelp(data: DeviceProcessingNodeData, label: string, ports: NodePortLayout): BlockHelp {
  const type = data.kind === "block" ? data.blockTypeId : data.kind;
  const descriptions: Record<string,string> = {
    "ui.manual_trigger":"Avvia una volta le azioni collegate quando premi Invia trigger. Per usarlo, collega la Backbone e carica il programma per test manuali. Durante l’esecuzione continua il pulsante è disabilitato.",
    "ui.data_viewer":"Mostra l’ultimo valore ricevuto. Accetta numeri, testi, booleani e altri dati. Etichetta, unità e decimali si personalizzano nella configurazione.",
    "logic_and":"Memorizza l’ultimo valore di A e B. Restituisce vero solo se entrambi sono veri. Accetta booleani, segnali digitali, numeri e stringhe numeriche: zero è falso, ogni altro intero è vero.",
    "logic_or":"Memorizza l’ultimo valore di A e B. Restituisce vero se almeno uno dei due è vero. Accetta booleani, segnali digitali, numeri e stringhe numeriche: zero è falso, ogni altro intero è vero.",
    "logic_if":"Verifica la condizione sul valore ricevuto. Emette il livello Alto (1) o Basso (0) scelto per il risultato vero o falso. Accetta booleani, segnali digitali, numeri e stringhe numeriche.",
    "logic_while":"Verifica la condizione al primo valore e quando il valore cambia. Se è vera invia un trigger; valori identici non generano altri trigger. Non usa timer. Accetta booleani, segnali digitali, numeri e stringhe numeriche.",
    "schedule":"Ripete i blocchi trascinati al suo interno con l’intervallo configurato. Funziona durante l’esecuzione continua; Stop interrompe le ripetizioni.",
  };
  let description = descriptions[type] ?? `Esegue la funzione configurata di ${label}. Gli ingressi ricevono i comandi o i valori collegati; le uscite espongono i risultati indicati.`;
  if (/rel[èe]|relay/i.test(label)) description="Comanda il relè con le azioni configurate. Gli ingressi attivano i comandi; l’uscita di stato indica il livello del pin che lo controlla.";
  if (/RGB/i.test(label)) description="Controlla accensione e colore del LED RGB. Gli ingressi eseguono le azioni o ricevono i valori configurati; le uscite mostrano lo stato e il colore attuali.";
  if (/stepper/i.test(label)) description="Comanda il motore passo-passo con le azioni configurate. L’uscita Movimento terminato segnala la conclusione di uno spostamento.";
  if (/STATUS|LED di stato|LED interno/i.test(label)) description="Controlla il LED interno della Backbone in PWM. Alto lo accende al 100%, basso lo spegne. I trigger eseguono le azioni; l’ingresso intensità riceve un numero da 0 a 100. Le uscite mostrano stato e intensità. Doppio clic per inizializzazione, azioni e Input/Output.";
  if (/DS18B20|DHT11|DHT22/i.test(label)) description="Legge il sensore quando riceve un trigger e pubblica i valori misurati sulle uscite configurate.";
  const names=(side:"inputs"|"outputs")=>ports[side].map((port,index)=>port.label ?? `${side==="inputs"?"Valore":"Risultato"} ${index+1}`);
  return {description,inputs:type==="ui.manual_trigger"?[]:names("inputs"),outputs:type==="ui.manual_trigger"?["Trigger: avvia le azioni collegate"]:type==="ui.data_viewer"?[]:names("outputs")};
}
