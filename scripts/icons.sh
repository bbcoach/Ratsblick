#!/bin/bash
# Rendert die PNG-Icons aus web/icons/icon.svg und icon-maskable.svg mit dem vorinstallierten Chromium
# (ImageMagick hat keinen SVG-Renderer). Pfad zu Chromium über CHROME überschreibbar.
set -euo pipefail
cd "$(dirname "$0")/../web/icons"
CHROME=${CHROME:-$(ls -d /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell | head -1)}
tmp=$(mktemp -d)
render() { # quelle größe ziel
  printf '<html><body style="margin:0"><img src="file://%s" width="%s" height="%s" style="display:block"></body></html>' \
    "$PWD/$1" "$2" "$2" > "$tmp/s.html"
  "$CHROME" --no-sandbox --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --window-size="$2,$2" --screenshot="$PWD/$3" "file://$tmp/s.html" 2>/dev/null
}
render icon.svg 512 icon-512.png
render icon.svg 192 icon-192.png
render icon-maskable.svg 180 apple-touch-icon.png
render icon-maskable.svg 512 icon-maskable-512.png
rm -rf "$tmp"
echo "PNG-Icons geschrieben"
