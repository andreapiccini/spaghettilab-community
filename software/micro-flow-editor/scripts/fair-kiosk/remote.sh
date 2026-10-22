#!/bin/sh
set -eu
case "${1:-}" in
  italiano|inglese|demo|dashboard|svuota|questionario|salva-base|ripristina|stop|stato) ;;
  *) echo 'Uso: remote.sh italiano|inglese|demo|dashboard|svuota|questionario|salva-base|ripristina|stop|stato' >&2; exit 2 ;;
esac
exec ssh "${SPAGHETTILAB_PI:-spaghettilab@spaghettilab.local}" ".local/bin/spaghettilab-fiera $1"
