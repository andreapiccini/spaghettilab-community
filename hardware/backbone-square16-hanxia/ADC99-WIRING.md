# Revisione 9 ADC / 9 ADC

ADC sulle righe: S3 A1-A5 e B1-B4 (9 ADC1); S31 A1/A6-A8 e B1/B5-B8 (6 ADC1 + 3 ADC2). Comuni A1 e B1. Banco A: 5/4; banco B: 4/5 (S3/S31). DAC S31 su A3/A4. I2C_INT_SDA spostato al pad35 (S3 GPIO42 / S31 GPIO55); il pad4 diventa A5. Vedere dual-mcu-rows.csv. I GPIO delle derivazioni J26/J27 e FFC60 J32 seguono le nuove righe.

Il foglio ports16 contiene i contatti reali U1B..Q e i contatti A..H dei connettori Hanxia, collegati tramite fili continui attraverso gli isolatori. U1A sul foglio principale contiene alimentazione e servizi. Non sono componenti aggiuntivi: sono unità degli stessi componenti fisici. Le etichette restanti indicano derivazioni verso mezzanine/FFC e comandi/power.

S3: solo variante N8R2 compatibile con i pad 28-30; non usare varianti octal PSRAM. S31: WROOM-1 con contatti laterali; non WROOM-3. USB sul socket: Serial/JTAG su entrambi, OTG solo S3. Firmware da aggiornare secondo i profili, incluso SDA interno GPIO42/55; niente JTAG esterno sul pad35.

Verifica statica dei collegamenti, non collaudo elettrico. PCB ancora da sbrogliare e correggere secondo DRC; non inviare in produzione questa revisione come scheda finita. I report e gli studi precedenti alla revisione sono storici.
