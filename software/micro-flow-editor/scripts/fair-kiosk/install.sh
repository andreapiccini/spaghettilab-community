#!/bin/sh
# Install only; restart Chromium explicitly after saving any open project.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
DEST="$HOME/.local/share/spaghettilab-kiosk"
CONF="$HOME/.config/spaghettilab-kiosk"
mkdir -p "$DEST/extension" "$CONF" "$HOME/.local/bin" "$HOME/.config/systemd/user"
chmod 700 "$CONF"
cp "$ROOT/scripts/fair-kiosk/kiosk.py" "$DEST/kiosk.py"
cp "$ROOT/scripts/fair-kiosk/extension/"*.js "$ROOT/scripts/fair-kiosk/extension/manifest.json" "$DEST/extension/"
python3 "$DEST/kiosk.py" init
python3 - "$CONF/token" "$DEST/extension/settings.js" <<'PY'
import json,sys
from pathlib import Path
settings={'token':Path(sys.argv[1]).read_text().strip(),'demoUrl':'http://localhost:5173/?fair=1'}
Path(sys.argv[2]).write_text('export const settings = '+json.dumps(settings)+';\n')
Path(sys.argv[2]).chmod(0o600)
PY
cat > "$HOME/.local/bin/spaghettilab-fiera" <<EOF
#!/bin/sh
exec python3 "$DEST/kiosk.py" "\$@"
EOF
chmod +x "$HOME/.local/bin/spaghettilab-fiera"
cat > "$HOME/.config/systemd/user/spaghettilab-kiosk.service" <<EOF
[Unit]
Description=SpaghettiLAB Maker Faire operator control
[Service]
ExecStart=/usr/bin/python3 $DEST/kiosk.py serve
Restart=on-failure
RestartSec=2
[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now spaghettilab-kiosk.service
LAUNCHER="$HOME/.local/bin/microflow-kiosk"
if [ ! -f "$LAUNCHER" ]; then
  echo "Controllo installato. Configura Chromium con --load-extension=$DEST/extension e URL http://localhost:5173/?fair=1" >&2
  exit 1
fi
python3 - "$LAUNCHER" "$DEST/extension" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text()
backup=p.with_name('microflow-kiosk.before-fair')
if not backup.exists():backup.write_text(s);backup.chmod(0o700)
if '--load-extension=' not in s:
 s=s.replace('exec chromium ', 'exec chromium --load-extension="'+sys.argv[2]+'" ')
s=s.replace('--kiosk http://localhost:5173', '--kiosk "http://localhost:5173/?fair=1"')
p.write_text(s)
PY
printf '%s\n' 'Installato. Il browser non è stato riavviato.' 'Comandi: spaghettilab-fiera italiano | inglese | demo | dashboard | svuota | questionario | salva-base | ripristina | stop | stato'
