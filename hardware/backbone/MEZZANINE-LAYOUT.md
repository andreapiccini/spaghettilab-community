# Carrier + AG32-LAB — disposizione PCB, 31 ottobre 2026

**Disposizione aggiornata, PCB ancora senza piste. Non è un rilascio per produzione.** Revisione sul branch `hardware/mezzanine-ag32`.

## File attivi

- Carrier: `backbone.kicad_pcb`.
- Modulo: `mezzanine/ag32-lab/ag32-lab.kicad_pcb`, progetto autonomo.
- [Render e controlli](bom/mezzanine-v1/layout.html), [contratto elettrico](MEZZANINE-V1.md).

## Ingombri e accesso

Carrier mantenuta a41,5 ×77,7mm circa, contorno esterno identico al file locale dell'utente; rimossa soltanto la vecchia asola FPC interna. Conservati posizione, rotazione e lato degli elementi bloccati U1/J1/J140/J3/J2; conservati anche J9, quattro fissaggi, Qwiic e sei LED allineati. Nessuna pista aggiunta o rimossa: il file iniziale era già senza piste.

Modulo35,0 ×44,4mm, con finestra centrale16,5 ×20,1mm sopra J1/J140. J3 resta sopra il bordo del modulo, con1,095mm nominali dal corpo Harwin. La finestra lascia0,63mm minimi dal corpo nominale15,24 ×7,20mm dei due Harwin: margine nominale, da verificare con tolleranze e prototipo prima della fabbricazione. L'accesso ai fori resta aperto; non è garantita la compatibilità con qualsiasi scheda sensore con corpo più largo del connettore. Inserimento dal bottom della carrier invariato.

Due rientranze nel modulo lasciano liberi i fissaggi H3/H4; non sono stati aggiunti fori nella carrier. I due connettori guidano l'accoppiamento ma non sostituiscono una prova di ritenzione sotto trazione sui cavi. Non sono stati progettati nuovi distanziali/viti specifici per il modulo.

Coppie BergStak da60 contatti: J10 centro(155,0;111,8)mm e J11(179,9;111,8)mm, nel riferimento condiviso carrier/modulo. Carrier femmine sul top, maschi sul bottom modulo. Orientamento fisico opposto per allineare tutti i120 numeri di contatto1:1; verifica automatica posizione/net eseguita. Altezza nominale di accoppiamento **5mm tra top carrier e bottom modulo**, combinazione Recept1/Plug1 del disegno Amphenol61082. Con PCB modulo1,6mm il top è a6,6mm dalla carrier; gli Harwin sono alti3,75mm sopra PCB. È una verifica dimensionale nominale, non una qualifica fisica della pila.

AG32 e strumenti principali sul top del modulo; clock e12 condensatori di bypass sul bottom vicino al controllore, oltre ai test pad. Il corpo dell'oscillatore è circa1mm; i componenti carrier sotto tale regione sono a basso profilo. Il render usa modelli VRML posizionati e spessore nominale: non è stata eseguita una verifica volumetrica automatica di tutte le mesh/tolleranze.

Flat J5 sul bordo corto inferiore del modulo, uscita rivolta verso l'esterno; J12 AUX sul lato sinistro, **header2×12 passo2,54mm SMT** per evitare code passanti contro il connettore mezzanina sottostante. Il pinout è invariato. L'header AUX resta un'impronta generica, MPN/altezza del componente finale da scegliere. I due piolini BergStak passano dentro la PCB sotto il corpo plastico di J12: disegno nominale0,7mm, PCB1,6mm; questa sovrapposizione genera due errori `npth_inside_courtyard`, non soppressi, da confermare sul campione del connettore/header scelto.

USB-C spostata sullo stesso lato destro da y120,35 a81,5mm, centrox184,725mm: la posizione precedente sovrapponeva le piazzole del connettore mezzanina destro. Sagoma carrier invariata. L'accessibilità con case/backbone adiacenti va verificata sulla meccanica completa, non soltanto con un cavo ideale nel render. Vecchia asola FPC sulla carrier rimossa, insieme al contorno serigrafico bottom, su richiesta successiva dell’utente: il flat è sul modulo.

## CAD importato e correzioni

LCSC/EasyEDA: C25469661082-061402LF femmina, C46461061083-061402LF maschio, C128396TS3USB221ARSER. Libreria locale `hardware/libraries/LCSC_Mezzanine.pretty`, modelli `.3dshapes`, riferimenti corretti per entrambi i progetti.

- Fori piolini importati come PTH senza rame corretti in **NPTH**.
- Land maschio61083 corretti a0,50 ×2,00mm, file produttore61083 sheet6, passo0,8mm e file a±2,20mm. Fori0,8/1,2mm ai capi±14,10mm.
- U31 land allineati all'esempio TI RSE0010A:0,25 ×0,55mm sulle file,0,60 ×0,30mm sui lati; interassi1,35/1,80mm. Pinout elettrico invariato.
- Serigrafie del modulo tagliate dai fori/bordi ripulite nel PCB; tre differenze da impronta sorgente rimangono segnalate dal DRC.
- Il STEP sostitutivo grezzo dei connettori mostrava un'origine incoerente rispetto al VRML; **non usarlo per approvare l'assemblaggio; le copie STEP BergStak non sono distribuite accanto ai VRML per evitare la sostituzione automatica**. Render assemblato fornito attraverso export VRML KiCad con origine/spessore controllati. La verifica120 contatti usa le vere piazzole PCB, non il modello estetico.

## Controlli e limiti

979 confronti piazzola/rete passati (542carrier,437modulo);120 contatti accoppiati e reti corrispondenti; bloccati, fori, LED, magnetici e Qwiic verificati; contorno esterno carrier invariato. Zero piste su entrambe le schede.

DRC modulo: nessun corto, violazione di clearance rame o rame/bordo; restano2errori NPTH sotto courtyard AUX e3avvisi di differenza libreria dopo pulizia serigrafia. Carrier: nessun nuovo corto o violazione di clearance tra piazzole dopo la disposizione; rimangono40annular-width dei FlexyPin,20copper-edge (magnetici) e segnalazioni serigrafia/libreria presenti nel progetto. Queste non sono state nascoste né derogate per dichiarare il progetto pronto. Dettagli nei reportJSON. Sbroglio, decoupling/ritorni/USB, supporto meccanico e prova di accoppiamento restano da completare.

Fonti: [Harwin M20-7810645R](https://www.harwin.com/products/M20-7810645R), [Amphenol61083](https://cdn.amphenol-cs.com/media/wysiwyg/files/drawing/61083.pdf), [disegno Amphenol61082 copia](https://www.rxelectronics.kr/datasheet/03/61082-202002.pdf), [TI TS3USB221A](https://www.ti.com/lit/ds/symlink/ts3usb221a.pdf), [LCSC femmina](https://www.lcsc.com/product-detail/C254696.html), [LCSC maschio](https://www.lcsc.com/product-detail/C464610.html).

## Rimozione asola FPC — aggiornamento successivo
Rimossi4segmenti/archi Edge.Cuts e74segmenti B.SilkS della sola vecchia asola. Tutti gli altri nodi PCB identici prima/dopo. Ricalcolato DRC con le impostazioni locali correnti: nessun corto/clearance rame aggiunto; rilevati anche13courtyard mancanti su impronte esistenti. Render aggiornati; progetto ancora senza piste.
