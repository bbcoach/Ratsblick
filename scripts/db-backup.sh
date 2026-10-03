#!/usr/bin/env bash
# Sichert die Datenbank komprimiert (zstd) und verschlüsselt (AES-256, PBKDF2) als Asset eines GitHub-Releases „db-backup“.
# Warum verschlüsselt: das Repository ist öffentlich, die Datenbank ist eine Massenkopie der Ratsinformationssysteme.
# Es bleiben die letzten 3 Sicherungen. Aufruf im Workflow (website.yml); Passwort im Secret BACKUP_PASSWORT.
#
# Wiederherstellen (lokal):
#   gh release download db-backup --pattern 'ratsblick-JJJJ-MM-TT.sqlite.zst.enc' --repo bbcoach/Ratsblick
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSWORT -in ratsblick-JJJJ-MM-TT.sqlite.zst.enc | zstd -d -o data/ratsblick.sqlite
#
# Umgebung: BACKUP_PASSWORT (nötig), GH_TOKEN (nötig außer bei BACKUP_TROCKEN=1), BACKUP_DB (Standard data/ratsblick.sqlite)
set -euo pipefail

db="${BACKUP_DB:-data/ratsblick.sqlite}"
: "${BACKUP_PASSWORT:?BACKUP_PASSWORT fehlt}"
[ -f "$db" ] || { echo "Datenbank $db nicht gefunden"; exit 1; }

tag=db-backup
datei="ratsblick-$(date -u +%F).sqlite.zst.enc"
ziel="${BACKUP_ZIEL:-${RUNNER_TEMP:-/tmp}}/$datei"

echo "Sichere $db ($(du -h "$db" | cut -f1)) → $datei"
zstd -T0 -6 -q -c "$db" | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_PASSWORT > "$ziel"
echo "Fertig: $(du -h "$ziel" | cut -f1)"

if [ "${BACKUP_TROCKEN:-0}" = 1 ]; then echo "Trockenlauf: kein Upload ($ziel)"; exit 0; fi

: "${GH_TOKEN:?GH_TOKEN fehlt}"
gh release view "$tag" >/dev/null 2>&1 || gh release create "$tag" --title "Datenbank-Backup (verschlüsselt)" --prerelease \
  --notes "Verschlüsselte Sicherungen der Datenbank (wöchentlich, letzte 3). Wiederherstellung: siehe scripts/db-backup.sh."
gh release upload "$tag" "$ziel" --clobber

# nur die letzten 3 behalten (Namen enthalten das Datum, also sortierbar)
gh release view "$tag" --json assets --jq '.assets | map(.name) | sort | .[:-3][]' | while read -r alt; do
  [ -n "$alt" ] && gh release delete-asset "$tag" "$alt" -y && echo "Alte Sicherung gelöscht: $alt"
done
echo "Sicherung hochgeladen: $datei"
