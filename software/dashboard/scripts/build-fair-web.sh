#!/bin/sh
# Build once on the development computer; the Raspberry serves static files only.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"
docker compose run --rm -T --entrypoint bash dashboard-ci -lc \
  'cd /workspace/app && flutter pub get && flutter build web --release --no-web-resources-cdn --pwa-strategy=none --target=lib/main_fair.dart'
printf '%s\n' "Dashboard da presentazione: $ROOT/app/build/web"
