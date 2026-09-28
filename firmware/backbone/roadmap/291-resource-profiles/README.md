# 291 — Profili di risorse e capability

Questa fase rende espliciti i limiti del firmware per Core con quantità di RAM
differenti. Il profilo è scelto a build-time dalla variante Core e viene comunicato ai
client; non viene dedotto dalla memoria libera durante l'esecuzione.

Ogni capacità pubblica è anche l'unica sorgente usata da Config, Manager, codec, queue,
slab e cataloghi: i profili non possono essere soltanto etichette descrittive.

Apri [TASK-291-01](TASK-291-01-introdurre-profili-risorse-e-capability.md).
