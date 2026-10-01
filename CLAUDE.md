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
- Quellen in `data/endpoints.json` mit amtlichem Gebietsschlüssel (`gebiet`). Stand 01.10.2026: 30 aktiv,
  39 more!rubin-Systeme ohne freigeschaltetes OParl, 2 auf `sitzung-online.de` (robots.txt) – Hagenbach, Boppard.
  Gefunden über `npm run discover` (prüft `<name>.gremien.info/oparl/system` für alle VGs, Kreise, verbandsfreien
  Gemeinden; unbekannte Subdomains liefern 404) und die OParl-Endpunktliste (github.com/OParl/resources).
- Alle Gebietskörperschaften des Landes: `data/gebiete-rlp.json` aus dem Destatis-Gemeindeverzeichnis
  (`scripts/gemeindeverzeichnis.py`): 2 300 Gemeinden, 129 VGs, 24 Landkreise, 12 kreisfreie Städte.
  Zuordnung OParl-Körperschaft → Gebiet in `src/export/gebiete.ts` (nur innerhalb des Gebiets der Quelle,
  erstes Wort exakt, weitere dürfen abgekürzt sein: „Auw b. Prüm“ ↔ „Auw bei Prüm“).
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

## Kreisfreie Städte und Landkreise (Erhebung 01.10.2026)
Gefunden über die Startseiten (Links aufs RIS), DNS-Namen (ratsinfo./buergerinfo./bi./ris. …; Achtung:
`*.more-rubin1.de`, `*.worms.de`, `*.mainz-bingen.de` lösen jeden Namen auf) und je robots.txt + Startseite.
- OParl aktiv (more!rubin): Bernkastel-Wittlich, Rhein-Hunsrück (`rheinhunsrueck.gremien.info`),
  Rhein-Lahn (`rheinlahnkreis.gremien.info`). Nicht freigeschaltet: Altenkirchen, Alzey-Worms, Donnersberg.
- SessionNet, Abruf erlaubt (keine robots.txt) → `status: geplant`: Koblenz, Mainz, Ahrweiler,
  Trier-Saarburg, Kusel (PHP-Variante: `si0040.php` usw.), Neustadt (ASP wie Kaiserslautern).
  Kaiserslautern läuft bereits (Scraper + Weiterleiter).
- robots.txt „Disallow: /“: alle `*.sitzung-online.de` (ALLRIS: Kreis Bad Kreuznach, Germersheim; Bitburg-Prüm),
  `sessionnet.owl-it.de` (Westerwaldkreis, Neuwied, Südliche Weinstraße), Vulkaneifel (SD.NET RIM), Trier (ALLRIS 4).
- Bot-Schutz (MyraCloud): Ludwigshafen. Pirmasens: OParl-Adresse antwortet 403.
- Unklar (nicht gefunden oder nicht erreichbar): Frankenthal, Landau, Speyer, Worms, Zweibrücken, Birkenfeld,
  Cochem-Zell, Mayen-Koblenz, Bad Dürkheim, Kreis Kaiserslautern, Rhein-Pfalz-Kreis, Mainz-Bingen, Südwestpfalz.

## Scraper und Weiterleiter
- `typ: "sessionnet"` in `endpoints.json` → `src/scrape/sessionnet.ts` statt OParl. Liest Kalender (`si0040`),
  Tagesordnung (`si0057`) und Vorlage (`vo0050`) und schreibt OParl-förmige Objekte über die upsert-Funktionen.
  IDs = Seitenadressen. Vorlagen haben keinen Text (nur PDF), Datum = erste Sitzung, Beratungsfolge aus den
  Tagesordnungen. Fenster: 2 Monate zurück, 3 voraus; ältere, bereits gespeicherte Sitzungen werden nicht neu geladen.
  Testseiten in `test/fixtures/sessionnet/` (echte Seiten aus Kaiserslautern, SessionNet 5.4.6).
- Kaiserslautern (`ris.kaiserslautern.de`) sperrt Zugriffe außerhalb Europas (GitHub Actions läuft in den USA) und
  schickt sein Zwischenzertifikat nicht mit. Lösung: Weiterleiter `relay/` bei Vercel in Frankfurt
  (`ratsblick-relay.vercel.app`), lädt fehlende Zwischenzertifikate per AIA nach. Nutzung über
  `RATSBLICK_RELAY_URL`/`_SCHLUESSEL`/`_HOSTS` (siehe `relay/README.md`); in Actions als Variable/Secret.
- Prüfen, ob ein Host aus Europa/USA erreichbar ist: check-host.net; Workflow „Erreichbarkeit“ prüft von GitHub aus.

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
5. SessionNet-Scraper um die PHP-Variante erweitern und die sechs „geplant“-Quellen anbinden
   (Koblenz, Mainz, Neustadt, Ahrweiler, Trier-Saarburg, Kusel); robots.txt vorher erneut prüfen.
6. Weitere Systeme: andere Anbieter (ALLRIS, SessionNet, Somacos) mit OParl suchen; bei „nicht freigeschaltet“
   ggf. Verwaltungen ansprechen; robots.txt-Frage bei sitzung-online.de klären.

## Konventionen
- Oberflächentexte, Kommentare, Fehlermeldungen und Doku auf Deutsch.
- Vor jedem Commit: `npm run typecheck && npm test`.
