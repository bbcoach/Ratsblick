# Ratsblick – Projektkontext für Claude Code

## Ziel
Ein einheitliches Portal (Website und später App), das nach Eingabe der eigenen Kommune die öffentlichen
Inhalte der Ratsinformationssysteme (RIS) zeigt: Sitzungen, Tagesordnungen, Vorlagen, Beschlüsse.
Start mit Rheinland-Pfalz. „Ratsblick“ ist ein Arbeitstitel.

## Wichtige Entscheidungen
- Datenquelle zuerst **OParl** (Standardschnittstelle für RIS). Scraper für Systeme ohne OParl kommen später
  und schreiben in dasselbe Datenmodell.
- Datenmodell nah an OParl (`src/db/schema.sql`), Originalobjekt immer in `raw` mitspeichern.
- Rheinland-Pfalz: Ortsgemeinden laufen meist über das RIS ihrer Verbandsgemeinde. Ein OParl-System kann
  mehrere Körperschaften (`body`) enthalten → immer alle Körperschaften eines Systems lesen.
- Rücksicht auf kommunale Server: höchstens 1 Anfrage/Sekunde je Server, inkrementell über `modified_since`,
  User-Agent mit Kontaktadresse.
- Hosts mit robots.txt-Verbot (z. B. `*.sitzung-online.de`) nicht automatisiert abrufen, bevor das geklärt ist.
- Technik: TypeScript, Node ≥ 22.13, eingebautes `node:sqlite`, `tsx`, `vitest`. Keine schweren Abhängigkeiten
  ohne Grund.

## Erkenntnisse aus der Recherche (Stand 01.10.2026)
- In RLP ist bei den gefundenen Fällen **more!rubin** (more! software) verbreitet, gehostet auf
  `<name>.gremien.info`. OParl ist dort eingebaut: `/oparl/system` liefert entweder Daten,
  `{"type":".../Error","message":"OParl is not active."}` (mit HTTP 200!) oder 404 bei unbekannter Subdomain.
- Aktiv: VG Montabaur, VG Westerburg, VG Herxheim, VG Enkenbach-Alsenborn, Emmelshausen, Stadt Bad Kreuznach.
- Vorhanden, nicht freigeschaltet: Donnersbergkreis, VG Edenkoben, VG Weilerbach.
- `npm run probe` (01.10.2026): alle sechs aktiven Systeme liefern auch die Körperschaftsliste; Pirmasens HTTP 403.
- Alle `*.gremien.info` liegen auf **einer** IP → Drosselung gilt je Server (Hauptdomain), nicht je Subdomain
  (`serverKey` in `src/oparl/client.ts`). Quellen laufen parallel, teilen sich aber diese Grenze.
- more!rubin setzt `created`/`modified` aller Objekte auf das heutige Datum → `modified_since` liefert immer alles;
  jeder Abgleich ist faktisch ein Vollabgleich (VG Montabaur ≈ 5 min).
- Listen kommen älteste zuerst; `--max-pages` liefert daher nur Altbestand.
- PDF-Volltext steckt bereits in `mainFile.text` (Vorlagen) bzw. `resolutionFile.text` (Beschlüsse je TOP).
- Beratungen verweisen auf Sitzungs-IDs ohne Präfix `ni_` (passt nicht); Verknüpfung über `agendaItem` nutzen.
- Ein System kann mehrere Verbandsgemeinden enthalten (Emmelshausen: VG Emmelshausen und Hunsrück-Mittelrhein
  nach Fusion 2020) – maßgeblich ist die mit den jüngsten Sitzungen.
- Quellenliste: `data/endpoints.json` (aus dem RIS-Verzeichnis RLP).

## Design
Entwürfe „Ratsblick – Kernansichten“ (Claude Design): Kommune wählen → Startseite der Kommune
(Ebenen-Umschalter Gemeinde/VG/Landkreis, nächste Sitzungen, neue Vorlagen) → Vorlage im Detail
(„Kurz erklärt“ in einfacher Sprache, als automatisch erstellt gekennzeichnet, Beratungsfolge, Dokumente)
→ Themen-Abo (Themen, Stichwort, eigene Straße, Push/E-Mail).
Stil: ruhig und behördennah, Akzent #1F4E79, Schrift Public Sans, Vorlagennummern in IBM Plex Mono.

## Web-App (PWA)
- `web/` enthält die App (Vanilla-JS, kein Build-Schritt), `npm run web -- --out dist` erzeugt die statische Seite
  mit `data/index.json` und je Quelle `data/<id>.json` (Momentaufnahme aus `src/export/snapshot.ts`).
- „Kurz erklärt“-Texte liegen von Hand gepflegt in `data/kurz-erklaert.json` (Schlüssel: Vorlagen-ID).
- `.github/workflows/website.yml`: alle 6 h Abgleich + Veröffentlichung auf GitHub Pages; bei Pushes nur neu bauen.
  Die Datenbank wird zwischen Läufen im Actions-Cache gehalten.

## Nächste Schritte
1. Kontakt im User-Agent ggf. auf eine E-Mail-Adresse umstellen (derzeit Repo-URL).
2. Volltext aus `mainFile.text` in `file.text_extracted` übernehmen, Suche darüber.
3. „Kurz erklärt“ automatisch erzeugen (statt von Hand).
4. Benachrichtigungen fürs Themen-Abo (braucht kleinen Server für Web Push/E-Mail).
5. Landkreise und weitere Systeme anbinden.

## Konventionen
- Oberflächentexte, Kommentare, Fehlermeldungen und Doku auf Deutsch.
- Vor jedem Commit: `npm run typecheck && npm test`.
