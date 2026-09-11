#!/bin/sh
# Open the Micro Flow Editor in the default browser.
# Starts `make up-d` if nothing is already listening on the editor port.
# Not a desktop wrapper — the app stays a Vite web app (Web Serial, Docker HMR).
set -e
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

PORT=5173
if [ -f "$ROOT/.env" ]; then
	env_port=$(sed -n 's/^MICRO_FLOW_EDITOR_PORT=//p' "$ROOT/.env" | tail -n 1)
	if [ -n "$env_port" ]; then
		PORT=$env_port
	fi
fi
if [ -n "${MICRO_FLOW_EDITOR_PORT:-}" ]; then
	PORT=$MICRO_FLOW_EDITOR_PORT
fi

URL="http://127.0.0.1:${PORT}"

port_open() {
	if command -v lsof >/dev/null 2>&1; then
		lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
		return $?
	fi
	python3 -c "import socket; s=socket.socket(); s.settimeout(0.4); s.connect(('127.0.0.1', int('$PORT')))" 2>/dev/null
}

if ! port_open; then
	echo "Avvio dell'editor su $URL ..."
	make up-d
	i=0
	while [ "$i" -lt 90 ]; do
		if port_open; then
			break
		fi
		i=$((i + 1))
		sleep 1
	done
	if ! port_open; then
		echo "L'editor non è ancora in ascolto su $URL. Riprova tra poco o controlla: docker compose logs -f micro-flow-editor" >&2
		exit 1
	fi
fi

echo "Apertura $URL"
if command -v open >/dev/null 2>&1; then
	open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then
	xdg-open "$URL"
else
	echo "Apri $URL nel browser."
fi
