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
- Offener Punkt: Bei Abrufen von außen antwortete `/oparl/system`, aber `/oparl/Body` lieferte Fehler.
  Mit `npm run probe` klären (Status „teilweise“).
- Quellenliste: `data/endpoints.json` (aus dem RIS-Verzeichnis RLP).

## Design
Entwürfe „Ratsblick – Kernansichten“ (Claude Design): Kommune wählen → Startseite der Kommune
(Ebenen-Umschalter Gemeinde/VG/Landkreis, nächste Sitzungen, neue Vorlagen) → Vorlage im Detail
(„Kurz erklärt“ in einfacher Sprache, als automatisch erstellt gekennzeichnet, Beratungsfolge, Dokumente)
→ Themen-Abo (Themen, Stichwort, eigene Straße, Push/E-Mail).
Stil: ruhig und behördennah, Akzent #1F4E79, Schrift Public Sans, Vorlagennummern in IBM Plex Mono.

## Nächste Schritte
1. `[KONTAKT-E-MAIL]` in `src/oparl/client.ts` ersetzen.
2. `npm run probe`, dann `npm run sync -- --id vg-montabaur --max-pages 2`; Abgleich an echte Antworten anpassen.
3. Volltext aus PDFs in `file.text_extracted`.
4. Programmierschnittstelle (API) für Website und App.
5. Website nach den Entwürfen.

## Konventionen
- Oberflächentexte, Kommentare, Fehlermeldungen und Doku auf Deutsch.
- Vor jedem Commit: `npm run typecheck && npm test`.
