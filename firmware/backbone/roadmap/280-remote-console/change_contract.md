# Change contract — fase 280

## Contratti aggiunti

- Remote Console è un adapter Communication TLS 1.2 PSK, non una shell Telnet.
- La PSK console è separata dalla PSK OTA e si provisiona solo con Maintenance
  attiva: tramite Maintenance Link UART sull'hardware finale o Shell USB fisica
  durante lo sviluppo.
- Il listener esiste soltanto in modalità Normal con credenziale presente.
- Una sessione, timeout di inattività e code statiche bounded sono invarianti.
- I log scartano il frammento più vecchio invece di bloccare il producer.
- Il client host non offre modalità non autenticata.
- La discovery host richiede credenziali valide e sonda solo un CIDR IPv4 esplicito;
  non annuncia la console con discovery non autenticata.

## Compatibilità

`make monitor` senza variabili conserva l'autodetect seriale. Il nuovo trasporto si
seleziona esplicitamente con `TRANSPORT=network`, `HOST`, `PORT` e `CREDENTIALS`.
