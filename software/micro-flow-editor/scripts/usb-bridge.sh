#!/bin/sh
# Host-side USB Protocol V1 bridge for Safari / browsers without Web Serial.
# Docker on macOS cannot see /dev/cu.usbmodem*; the browser talks to
# Vite :5173 `/usb-bridge`, which proxies to 127.0.0.1:8766 on this machine.
# Started by `make up-d`. On macOS, launchd KeepAlive outlives Cursor/make.
set -e

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
CORE=$(CDPATH= cd -- "$SCRIPT_DIR/../../../firmware/backbone" && pwd)
RUN="$CORE/.run"
PIDFILE="$RUN/usb-bridge.pid"
LOG="$RUN/usb-bridge.log"
PLIST="$RUN/usb-bridge.plist"
LISTEN_HOST=127.0.0.1
LISTEN_PORT=8766
LAUNCH_LABEL=lab.spaghetti.usb-bridge

port_open() {
	if command -v lsof >/dev/null 2>&1; then
		lsof -nP -iTCP:"$LISTEN_PORT" -sTCP:LISTEN >/dev/null 2>&1
		return $?
	fi
	python3 -c "import socket; s=socket.socket(); s.settimeout(0.4); s.connect(('$LISTEN_HOST', $LISTEN_PORT))" 2>/dev/null
}

python_bin() {
	if [ -x "$CORE/.venv/bin/python" ]; then
		printf '%s\n' "$CORE/.venv/bin/python"
		return 0
	fi
	if [ -x "$CORE/.venv/Scripts/python.exe" ]; then
		printf '%s\n' "$CORE/.venv/Scripts/python.exe"
		return 0
	fi
	return 1
}

launch_domain() {
	printf 'gui/%s\n' "$(id -u)"
}

write_plist() {
	py=$(python_bin) || return 1
	mkdir -p "$RUN"
	cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$LAUNCH_LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>$py</string>
		<string>-m</string>
		<string>tools.usb_bridge</string>
		<string>--listen</string>
		<string>$LISTEN_HOST:$LISTEN_PORT</string>
	</array>
	<key>WorkingDirectory</key>
	<string>$CORE</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PYTHONPATH</key>
		<string>$CORE</string>
	</dict>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>$LOG</string>
	<key>StandardErrorPath</key>
	<string>$LOG</string>
</dict>
</plist>
EOF
}

wait_listening() {
	i=0
	while [ "$i" -lt 50 ]; do
		if port_open; then
			printf 'USB bridge on ws://%s:%s\n' "$LISTEN_HOST" "$LISTEN_PORT"
			return 0
		fi
		sleep 0.1
		i=$((i + 1))
	done
	printf 'USB bridge did not open %s:%s; see %s\n' "$LISTEN_HOST" "$LISTEN_PORT" "$LOG" >&2
	return 1
}

start_nohup() {
	py=$(python_bin) || {
		printf 'host Python venv missing after make host-tools\n' >&2
		return 1
	}
	(
		CDPATH= cd -- "$CORE" || exit 1
		export PYTHONPATH="$CORE${PYTHONPATH:+:$PYTHONPATH}"
		exec nohup "$py" -m tools.usb_bridge --listen "$LISTEN_HOST:$LISTEN_PORT"
	) >>"$LOG" 2>&1 &
	echo $! >"$PIDFILE"
	wait_listening
}

cmd_status() {
	if port_open; then
		printf 'USB bridge listening on ws://%s:%s\n' "$LISTEN_HOST" "$LISTEN_PORT"
		return 0
	fi
	printf 'USB bridge is not running\n'
	return 1
}

cmd_stop() {
	if [ "$(uname -s)" = Darwin ] && command -v launchctl >/dev/null 2>&1; then
		launchctl bootout "$(launch_domain)/$LAUNCH_LABEL" >/dev/null 2>&1 || true
	fi
	if [ -f "$PIDFILE" ]; then
		pid=$(cat "$PIDFILE" 2>/dev/null || true)
		if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
			kill "$pid" 2>/dev/null || true
			i=0
			while [ "$i" -lt 20 ] && kill -0 "$pid" 2>/dev/null; do
				sleep 0.1
				i=$((i + 1))
			done
			kill -9 "$pid" 2>/dev/null || true
		fi
		rm -f "$PIDFILE"
	fi
	if port_open; then
		printf 'USB bridge port %s is still in use by another process\n' "$LISTEN_PORT" >&2
		return 1
	fi
	printf 'USB bridge stopped\n'
}

cmd_start() {
	if port_open; then
		printf 'USB bridge already on ws://%s:%s\n' "$LISTEN_HOST" "$LISTEN_PORT"
		return 0
	fi
	mkdir -p "$RUN"
	make -C "$CORE" host-tools
	python_bin >/dev/null || {
		printf 'host Python venv missing after make host-tools\n' >&2
		return 1
	}
	if [ "$(uname -s)" = Darwin ] && command -v launchctl >/dev/null 2>&1; then
		write_plist
		launchctl bootout "$(launch_domain)/$LAUNCH_LABEL" >/dev/null 2>&1 || true
		if launchctl bootstrap "$(launch_domain)" "$PLIST" >>"$LOG" 2>&1; then
			wait_listening
			return $?
		fi
		printf 'launchctl bootstrap failed; falling back to nohup (see %s)\n' "$LOG" >&2
	fi
	start_nohup
}

case "${1:-start}" in
start) cmd_start ;;
stop) cmd_stop ;;
restart)
	cmd_stop || true
	cmd_start
	;;
status) cmd_status ;;
*)
	printf 'usage: %s start|stop|restart|status\n' "$0" >&2
	exit 2
	;;
esac
