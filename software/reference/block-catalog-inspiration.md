# Riferimento — categorie funzionali comuni per un catalogo Rule/Block

Non un catalogo da implementare ora — una nota per quando si arriverà alla fase
firmware 340/342 ("Data, Runtime e regole V2" / "Blocchi elaborazione") e al
compatibility engine dell'app (S042). Nessun contenuto qui è copiato da alcuna
piattaforma specifica: sono categorie funzionali generiche che compaiono in
sostanza in ogni editor a blocchi per automazione (Node-RED, Blockly-style
tool, piattaforme IoT commerciali) — osservate come riferimento di design, non
come lista da trascrivere 1:1.

## Perché questa nota esiste

Il nostro compatibility engine (S042) deriva i blocchi **dinamicamente dal
catalogo dichiarato dal Core**, mai da una lista hardcoded nell'app — vedi
`REACT_FLOW_ARCHITECTURE.md`. Questa nota non prescrive blocchi concreti da
aggiungere: aiuta a non dimenticare categorie funzionali comuni quando si
progetta *cosa il firmware può dichiarare* nel proprio catalogo Rule/Block
driver (fase 342), così l'app le scopre come qualunque altro tipo.

## Categorie funzionali osservate come comuni nel settore

| Categoria | Cosa copre in generale | Dove finirebbe nella nostra architettura |
|---|---|---|
| Logica | condizioni, soglie, if/else, comparatori | Rule driver (fase 340) |
| Timer/Schedule | intervalli, cron-like, debounce, wait bounded | Schedule (già in `ProjectV1`) + Rule driver |
| Dati | trasformazioni, scaling, cast, aggregazione | Block driver di elaborazione (fase 342) |
| Comms | trasporto/serializzazione verso altri sistemi | Port/transport (già coperto da fase 300) o System Automation Graph (S110) se cross-Core |
| Variabili/Stato | memorizzazione locale di stato fra cicli | Rule driver con context persistente |
| Periferiche di output (es. display) | driver hardware specifico | Module Driver (fase 320/325), mai un Block generico |
| Cloud/Remoto | integrazione con sistemi esterni | Node-RED (S110/S112), non firmware locale |

## Come usarla

Quando si apre la fase 342 (Firmware) o si progetta un nuovo Rule driver
concreto (fase 340), rileggere questa tabella come checklist di "categorie che
probabilmente servono", non come specifica — ogni singolo blocco reale va
comunque progettato secondo i vincoli già stabiliti (bounded, senza formule
libere, schema-driven) descritti in `firmware/backbone/roadmap/340-*` e
`342-*` quando esisteranno con contenuto.
