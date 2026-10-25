#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
node bin/fows.js doctor
printf 'Folder yang ingin dipindai: '
IFS= read -r ROOT
node bin/fows.js scan --root "$ROOT"
node bin/fows.js types --root "$ROOT" --limit 15
printf 'Watch selama 30 detik? [y/N] '
IFS= read -r REPLY
case "$REPLY" in
 y|Y|yes|YES) node bin/fows.js watch --root "$ROOT" --seconds 30; node bin/fows.js diff --session latest ;;
 *) printf 'Selesai.\n' ;;
esac
