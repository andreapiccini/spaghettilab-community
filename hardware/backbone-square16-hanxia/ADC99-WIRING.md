# Revisione 9 ADC / 9 ADC

ADC sulle righe: S3 A1-A5 e B1-B4 (9 ADC1); S31 A1/A6-A8 e B1/B5-B8 (6 ADC1 + 3 ADC2). Comuni A1 e B1. Banco A: 5/4; banco B: 4/5 (S3/S31). DAC S31 su A3/A4. I2C_INT_SDA sul pad25 (S3 GPIO48 / S31 GPIO40); il pad4 diventa A5. Vedere dual-mcu-rows.csv. I GPIO delle derivazioni J26/J27 e FFC60 J32 seguono le nuove righe.

Il foglio ports16 contiene i contatti reali U1B..Q e i contatti A..H dei connettori Hanxia, collegati tramite fili continui attraverso gli isolatori. U1A sul foglio principale contiene alimentazione e servizi. Non sono componenti aggiuntivi: sono unità degli stessi componenti fisici. Le etichette restanti indicano derivazioni verso mezzanine/FFC e comandi/power.

S3: solo variante N8R2 compatibile con i pad 28-30; non usare varianti octal PSRAM. S31: WROOM-1 con contatti laterali; non WROOM-3. USB sul socket: Serial/JTAG su entrambi, OTG solo S3. Firmware da aggiornare secondo i profili, incluso SDA interno GPIO48/40; niente JTAG esterno sul pad35.

Verifica statica dei collegamenti, non collaudo elettrico. PCB ancora da sbrogliare e correggere secondo DRC; non inviare in produzione questa revisione come scheda finita. I report e gli studi precedenti alla revisione sono storici.

## Misura VCC senza ponticelli

R930/R931 (91 kΩ / 10 kΩ) e C930 filtrano 3V3_ROWS. R932/R933 portano la misura ai pad 9 e 35. Configurare il pad inattivo come ingresso senza pull prima di campionare. Misurare prima del Wi-Fi; verificare boot, precisione e assenza di backfeed prima di applicare alimentazioni esterne. I pad J25.9/13, J26.26, J27.24 e J32.49/50 sono NC. Questa revisione riserva il circuito di misura sul ramo da 3,3 V esistente. Il ramo EXT 20 V e il comparatore di blocco non sono implementati qui.
