# Display con emettitori nascosti: proposta ottica

Richiesta: nessun corpo LED visibile sul lato breadboard; luce dal lato opposto attraverso200finestrelle nella maschera, con serigrafia bianca perforata. Canale centrale della breadboard ripristinato.

La faccia visibile del file KiCad eB.Cu, la stessa di ESP32 e finestre delle funzioni. La faccia opposta richiesta per gli emettitori eF.Cu, dove si trovano i componenti di servizio. Questa corrispondenza evita equivoci con i nomi colloquiali top/bottom.

La proposta conserva40x5pixel a passo1,3mm e finestre quadrate0,45mm a45gradi. Serigrafia52x6,5mm con200aperture0,7mm. Aperture inF.Mask eB.Mask; regione ottica riservata senza rame suF.Cu/In1.Cu/In2.Cu/B.Cu. Nessun foro meccanico nel laminatoFR4 e nessun nuovo componente aggiunto al circuito principale.

Il file della proposta non contiene i200LED face-up della prima prova: il componente reverse deve essere ancora selezionato. Non e stato semplicemente capovolto il0402commerciale. I laterali1206non sono sostituti alla stessa densita. Gli attuali componenti di servizio che occupano la regione sono lasciati presenti e vengono segnalati dalDRC come conflitti: occorre riposizionarli prima di implementare emettitori e relativo driver. La proposta non e pronta per fabbricazione.

Simulazione: sole finestrelle accese, nessun terminale o package LED in vista; diffusione del PCB puramente illustrativa. Trasmissione, luminosita, dimensione effettiva degli aloni e separazione dei pixel a1,3mm dipendono da spessore/laminato/maschera/posizione emettitore e richiedono campione. La leggibilita mostrata non e una misura.

Il circuito principale riceve soltanto il ripristino della serigrafia centrale. Nessuna modifica a schema, nets, componenti o firmware.

Componenti di servizio da riposizionare per il volume ottico:
C1, C11, C140, C204, C206, C241, C300, C301, D6, Q100, Q105, Q106, Q111, Q47, R104, R111, R127, R132, R15, R17, R18, R201, R25, R300, R302, R303, R4, RN11, RN12, U63
