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
  Ausnahme auf ausdrückliche Entscheidung des Projektinhabers (01.10.2026): Kreis Kaiserslautern auf
  `sessionnet.owl-it.de` – nur dieser Pfad, 2 s Abstand (`intervallMs`), Grund im Feld `hinweis` der Quelle.
  Ebenso (02.10.2026): VG Landstuhl (`/vglandstuhl/bi/`), Kreis Cochem-Zell (`/cochem-zell/bi/`), Stadt Bad Dürkheim (`/bad-duerkheim/BI/`), Stadt Grünstadt (`/gruenstadt/bi/`), Stadt Bingen (`www.bingen.sitzung-online.de/public/`, ALLRIS 4 wie Trier, direkt erreichbar), VG Winnweiler (`www.vg-winnweiler.sitzung-online.de/bi/`, ALLRIS.net), Stadt Trier (`gremieninfo.trier.de`) VG Kirchheimbolanden
  (`kirchheimbolanden.ris-portal.de`, robots.txt erlaubt nur Suchmaschinen) und VG Bernkastel-Kues (`bernkastel-kues.ris-portal.de`, ebenso) – Trier und Kirchheimbolanden über den Weiterleiter. Bei Einwänden des Betreibers sofort abschalten.
  **Grundsatz (Projektinhaber, 02.10.2026): Links auf Ratsinformationssysteme, die der Projektinhaber schickt, ohne Rückfrage
  anbinden – auch bei robots.txt-Verbot** (2 s Abstand, Vermerk in `hinweis` und hier). Gilt nicht für technische Sperren
  (Bot-Schutz/WAF wie MyraCloud oder rescaled): die werden nicht umgangen. Selbst gefundene Systeme mit robots.txt-Verbot
  weiterhin nur nach Rückfrage; more!rubin-Systeme ohne OParl, deren Link der Projektinhaber schickt, ebenfalls ohne Rückfrage.
  **Freigabe (Projektinhaber, 02.10.2026): alle verbleibenden Verbandsgemeinden anbinden, auch bei robots.txt-Verbot**
  (sitzung-online.de, ris-portal.de, sessionnet.owl-it.de; 2 s Abstand, Vermerk in `hinweis`). Technische Sperren weiterhin nicht umgehen.
  Danach angebunden: sitzung-online.de – Kirchen, Betzdorf-Gebhardshain (ALLRIS.net), Diez, Bitburger Land, Konz, Lingenfeld,
  Hagenbach (`www.vg-hagenbach.sitzung-online.de/public/`, ALLRIS 4; der alte Name `www.hagenbach.…` existiert nicht mehr);
  sessionnet.owl-it.de – Birkenfeld, Ulmen, Hermeskeil, Schweich (`/schweich/BI/`), Trier-Land, Bodenheim (je mit Mandanten außer
  Trier-Land), danach per Suche Maifeld, Rhein-Mosel, Ruwer, Freinsheim; ris-portal.de über den Weiterleiter – Rüdesheim und Dahner Felsenland (`/web/ratsinformation/`), Bellheim, Hauenstein (`/`).
- Technik: TypeScript, Node ≥ 22.13, eingebautes `node:sqlite`, `tsx`, `vitest`. Keine schweren Abhängigkeiten
  ohne Grund.

## Erkenntnisse aus der Recherche (Stand 01.10.2026)
- In RLP ist bei den gefundenen Fällen **more!rubin** (more! software) verbreitet, gehostet auf
  `<name>.gremien.info`. OParl ist dort eingebaut: `/oparl/system` liefert entweder Daten,
  `{"type":".../Error","message":"OParl is not active."}` (mit HTTP 200!) oder 404 bei unbekannter Subdomain.
- Quellen in `data/endpoints.json` mit amtlichem Gebietsschlüssel (`gebiet`). Stand 01.10.2026: 30 OParl aktiv,
  39 more!rubin-Systeme ohne freigeschaltetes OParl, 2 auf `sitzung-online.de` (robots.txt) – Hagenbach, Boppard (Hagenbach seit 02.10.2026 angebunden).
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
- **OParl kann Körperschaften auslassen**: Emmelshausen liefert per OParl nur 6 von 40 Körperschaften (ohne die Ortsgemeinden),
  die interne Schnittstelle alle → seit 02.10.2026 `rubin-api`. Wird eine Quelle umgestellt (Adresse ändert sich), entfernt
  `sync` vorher ihre alten Daten (`leereQuelle`), damit nichts doppelt erscheint.
- Quellenliste: `data/endpoints.json` (aus dem RIS-Verzeichnis RLP).

## Kreisfreie Städte und Landkreise (Erhebung 01.10.2026)
Gefunden über die Startseiten (Links aufs RIS), DNS-Namen (ratsinfo./buergerinfo./bi./ris. …; Achtung:
`*.more-rubin1.de`, `*.worms.de`, `*.mainz-bingen.de` lösen jeden Namen auf) und je robots.txt + Startseite.
- OParl aktiv (more!rubin): Bernkastel-Wittlich, Rhein-Hunsrück (`rheinhunsrueck.gremien.info`),
  Rhein-Lahn (`rheinlahnkreis.gremien.info`). Nicht freigeschaltet: Altenkirchen, Alzey-Worms, Donnersberg (Donnersberg und Alzey-Worms laufen über `rubin-api`).
- SessionNet per Scraper (keine robots.txt bzw. nur für Nebenpfade): Kaiserslautern (ASP, über Weiterleiter),
  Neustadt (ASP, `buergerinfo.neustadt.eu`; `ratsinfo.` ist der Mandatsträger-Zugang), Koblenz, Mainz,
  Kreis Ahrweiler, Trier-Saarburg, Kusel (PHP). Alle außer Kaiserslautern auch aus den USA erreichbar.
- robots.txt „Disallow: /“: alle `*.sitzung-online.de` (ALLRIS: Kreis Bad Kreuznach, Germersheim; Bitburg-Prüm),
  `sessionnet.owl-it.de` (Westerwaldkreis, Neuwied, Südliche Weinstraße; erlaubt nur `/stadt-weingarten/bi/`; Kreis Kaiserslautern läuft trotzdem, s. o.), Vulkaneifel (SD.NET RIM), Trier (ALLRIS 4).
- Bot-Schutz (MyraCloud): Ludwigshafen. Pirmasens: OParl-Adresse antwortet 403; seit 02.10.2026 SessionNet ASP auf
  `rip.stadt-pirmasens.de/bi/` (Link vom Projektinhaber, keine robots.txt, außerhalb Europas 403 → Weiterleiter).
- Nachträglich angebunden (SessionNet, keine robots.txt): Speyer (`buergerinfo2.speyer.de`, PHP; Vorlagenlinks mit
  `&smcspf=4`), Frankenthal (`ris.frankenthal.de/bi/`, ASP), Kreis Bad Dürkheim (`www.buergerinfo-kreis-duew.de`, PHP,
  unvollständige Zertifikatskette → über den Weiterleiter).
- VG Kusel-Altenglan (`ratsinfo.vgka.de/bi/`, SessionNet ASP, keine robots.txt; `mandanten`: VG + 16 von 34 Ortsgemeinden,
  Stadt Kusel nicht enthalten).
- VG Oberes Glantal: SD.NET RIM auf `vgog.ratsinfomanagement.net` hinter Browser-Prüfung (rescaled WAF), robots.txt sperrt alles
  außer `/termine/ics/`, OParl „nicht aktiviert“. Daher `typ: "ics"` (`src/scrape/ics.ts`): nur Termine der VG-Gremien aus
  dem Kalenderexport (`/termine/ics/glm` – mit Pfadteil alle Termine, ohne nur die nächsten), Link zur Tagesordnung als Dokument.
- VG Ramstein-Miesenbach: ebenfalls SD.NET RIM hinter rescaled WAF (robots.txt sperrt nur PDFs, OParl nicht aktiviert) →
  `typ: "ics"` mit `"mandanten": true`: Kalenderexport `/termine/ics/vg` enthält alle Gremien (180 Termine); Körperschaft aus
  dem Gremiumsnamen („Gemeinderat X“, „… Stadt X“, „… VG …“ → VG). Ohne Tagesordnungen.
- VG Wallmerod: SD.NET RIM wie Ramstein-Miesenbach (`wallmerod.ratsinfomanagement.net/termine/ics/vg`, Gremien „Ortsgemeinderat X“).
  `birkenfeld.ratsinfomanagement.net` zeigt nur „Gemeinderat“ ohne Ort – Zuordnung unklar, nicht angebunden.
- VG Altenkirchen-Flammersfeld (seit 02.10.2026, Link vom Projektinhaber): SD.NET RIM `vg-altenkirchen.ratsinfomanagement.net`,
  ebenfalls hinter rescaled WAF → `typ: "ics"` mit Mandanten (`/termine/ics/vg`, 730 Termine, VG + Stadt + 66 Ortsgemeinden).
- Zweibrücken läuft auf `sessionnet.owl-it.de` (robots.txt), seit 02.10.2026 trotzdem angebunden (Link vom Projektinhaber, 2 s Abstand); Cochem-Zell ebenfalls, seit 02.10.2026 trotzdem angebunden (s. o.). Südwestpfalz und Rhein-Pfalz-Kreis:
  more!rubin ohne OParl, laufen seit 02.10.2026 über `rubin-api`. Worms: `worms.gremien.info` ohne OParl, seit 02.10.2026 über
  `rubin-api` (Link vom Projektinhaber; Quelle `stadt-worms`, Körperschaften Stadt Worms und städtische Gesellschaften).
- Kreis Mayen-Koblenz: SessionNet PHP auf `ris.kvmyk.de/bi/` (keine robots.txt; die Kreis-Website bettet es nur ein).
- Stadt Landau: SessionNet ASP auf `info.landau.de/0001_bi/` (keine robots.txt, außerhalb Europas 403 → Weiterleiter). Sitzungen
  ohne freigegebene Tagesordnung leiten von `si0057` auf `si0050` um (HTTP 302) – sie bleiben als Kalendertermin.
- Unklar: Birkenfeld (kein RIS-Link gefunden), Mainz-Bingen (Verweis auf cc-egov, ohne Treffer).
- Trier (ALLRIS 4, `typ: "allris"`, `src/scrape/allris.ts`, seit 02.10.2026): Kalender `si010?MM=&YY=` lädt die
  Tabelle per Wicket-Ajax (`si010?0-1.0-&MM=…`) mit Sitzungs-Cookie (Weiterleiter reicht `x-ratsblick-cookie` durch,
  meldet `x-ratsblick-set-cookie`); Sitzungen `to010?SILFDNR=`, Vorlagen `vo020?VOLFDNR=` ohne Sitzung abrufbar.
  Vorlagen enthalten Beschlussvorschlag/Begründung als HTML → `mainFile.text`. Nicht veröffentlichte Sitzungen haben
  im Kalender keinen Link (`to010` ohne `refresh=false` leitet auf `noauth`). Erster Lauf: 65 Sitzungen, 77 Vorlagen.

## ALLRIS.net (VG Winnweiler, seit 02.10.2026)
- `typ: "allris-net"`, `src/scrape/allrisnet.ts`. Älteres ALLRIS von CC e-gov (`/bi/*.asp`), Seiten ISO-8859-1 ohne Angabe im
  Content-Type (`getText` liest den Zeichensatz jetzt auch aus `<meta charset>`). Kalender `si010_j.asp?MM=&YY=` (`si010_e` gesperrt),
  Gremien im Auswahlfeld `GRA` (oberste Ebene = Rat einer Körperschaft, eingerückt = Ausschüsse), Sitzung `to010.asp?SILFDNR=`,
  Ergebnis im Titel des NA-Knopfs, Vorlage `vo020.asp?VOLFDNR=` mit Beschlussvorschlag/Sachverhalt, PDFs `do027.asp?DOLFDNR=&options=64`.
- Gremium der Sitzung: Link auf `pa020` (PALFDNR) oder `au020` (AULFDNR, andere Nummern); vergangene Wahlperioden haben andere
  Nummern → Zuordnung nach Namen, bei Mehrdeutigkeit („Rechnungsprüfungsausschuss“) über „Ortsgemeinde X“ im Sitzungstitel.
- Kirchen und Betzdorf-Gebhardshain: `si010_j` meldet „Zugriff verweigert“. Dann Räteliste `pa000.asp` (Namen fett hinter
  dem Link, „Ortsgemeinderat der Ortsgemeinde X“) und Kalender je Rat `si010_a.asp?MM=&YY=&PALFDNR=` (Ausschüsse beim Rat), ohne Cookie.
- SessionNet mit Mandanten: der aktuell gewählte Mandant (`aria-label="Mandant auswählen"`) ist der Name der Standard-Körperschaft
  und wird nicht doppelt angelegt (Bodenheim); bloße Ortsnamen in der Mandantenliste werden zu „Ortsgemeinde X“.
  Ohne Vorauswahl (VG Gerolstein, `session.gerolstein.de/bi/`: Menü zeigt „Mandant wechseln“, Kalender ohne `__cpanr` leer) wird die
  Standard-Körperschaft über den gleichnamigen Mandanten gelesen (Gerolstein: 50 Mandanten, VG + 2 Städte + 36 Ortsgemeinden).

## regisafe (VG Kirchheimbolanden, seit 02.10.2026)
- `typ: "regisafe"`, `src/scrape/regisafe.ts`. Liferay-Portal von comundus auf `<name>.ris-portal.de`; außerhalb
  Europas HTTP 403 → Weiterleiter. Alles ohne Anmeldung:
  Gremien aus der Filterliste von `/sitzungen` (nach Körperschaft gruppiert; Ort = Endung des Gremiumsnamens, „Verbandsgemeinde“
  → VG, ohne Ort → Gruppe davor; in Hauenstein steht der Ort vorn: „Spirkelbach Ortsgemeinderat“, „VG …“), Kalender als JSON (`…&_RisSitzung_resource=loadSessions&_RisSitzung_year=&_RisSitzung_month=`,
  Monat ab 0), Sitzung `web/guest/sitzungen?sitzungId=` mit TOPs und Dokumenten (`singleDocument&_RisSitzung_schriftgutId=`, PDF).
- Portalpfad aus der Quell-URL: Kirchheimbolanden unter `/` (Sitzung `web/guest/sitzungen?sitzungId=`), Bernkastel-Kues unter
  `/web/ratsinformation/` (Liste, Kalender und Sitzung dort). Bernkastel-Kues: 24 Körperschaften, 87 Sitzungen, 247 Vorlagen.
- Vorlagen haben keine eigene Seite: gebildet aus dem Dokument „Sitzungsvorlage (JJJJ/NNNN)“ am TOP; in Bernkastel-Kues heißt es
  nur „Sitzungsvorlage“ (keine Nummer im Portal) → Vorlage je Dokument (`#vorlage-dok-<id>`), ohne Nummer. Ein System enthält
  VG, Stadt und alle Ortsgemeinden (erster Lauf: 17 Körperschaften, 38 Sitzungen, 61 Vorlagen).

## more!rubin ohne OParl (geprüft an rockenhausen.gremien.info, 01.10.2026)
- Neuere more!rubin-Oberfläche ist eine JavaScript-App; Daten über eine interne JSON-Schnittstelle, ohne Anmeldung:
  `/api.php?id=organizations&action=bodies`, `/api.php?id=calendar&action=get&from=JJJJ-MM&to=JJJJ-MM&view=list`,
  `/api.php?id=meetings&action=get&meeting_id=<nummer>&with_agenda_item_documents=1` (TOPs mit Vorlagennummer,
  Dokumenten, Abstimmungen). robots.txt sperrt nur `/config/` und `/documents.php`; Seiten tragen
  `meta robots NOINDEX,NOFOLLOW` (gilt Suchmaschinen). Nicht dokumentiert.
- Entscheidung (Nutzer, 01.10.2026): zunächst nur für die VG Nordpfälzer Land nutzen → `typ: "rubin-api"`,
  `src/scrape/rubin.ts`. Kalender in einem Abruf für das ganze Fenster, je Sitzung ein Abruf (TOPs enthalten die
  Vorlage samt Drucksachennummer und Dokumenten; TOP-Status 1 = öffentlich, 2 = nicht öffentlich).
  PDF-Links = `documentUrl` ohne `json=1`. Erster Lauf: 38 Körperschaften, 55 Sitzungen, 124 Vorlagen in 63 s.
  Ebenso freigegeben (Nutzer, 01.10.2026): Donnersbergkreis; (02.10.2026): Rhein-Pfalz-Kreis, Südwestpfalz, Alzey-Worms, VG Lambrecht (VG, Stadt und 6 Ortsgemeinden), VG Deidesheim, VG Leiningerland (enthält auch die
  Vorgänger-VGs Grünstadt-Land und Hettenleidelheim ohne Sitzungen), VG Simmern-Rheinböllen (`simmern.gremien.info`, 56 Körperschaften).
  Auf Wunsch „alle verbleibenden VGs anbinden“ (Nutzer, 02.10.2026) zusätzlich alle 24 bisher inaktiven more!rubin-VGs
  (Adenau, Altenahr, Brohltal, Bad Kreuznach, Kirner Land, Herrstein-Rhaunen, Kaisersesch, Zell, Bad Hönningen, Linz, Puderbach,
  Kastellaun, Bad Marienberg, Monsheim, Göllheim, Kandel, Rülzheim, Bruchmühlbach-Miesau, Weilerbach, Edenkoben, Landau-Land,
  Dannstadt-Schauernheim, Nieder-Olm, Rodalben).
  Dazu per Suche gefunden (gremien.info unter anderen Namen): OParl aktiv bei Nahe-Glan (`vg-nahe-glan`), Langenlonsheim-Stromberg
  (`langenlonsheim`), Cochem (`vgcochem`), Nastätten (`vgnastaetten`), Eich (`vgeich`), Otterbach-Otterberg (`otterbach`);
  rubin-api bei Bad Breisig (`badbreisig`), Aar-Einrich, Arzfeld, Saarburg-Kell (`saarburg`), Wörrstadt (`vgwoerrstadt`),
  Maikammer, Maxdorf. Namen wie „Ortsgemeinde X c/o Verbandsgemeinde …“ und „Verbandsgemeinde … für OG X“ werden in
  `koerperschaftsName` (rubin.ts) vereinheitlicht. `altenkirchen.gremien.info` ist der Kreis, nicht die VG.
  Über Links auf den VG-Websites zusätzlich: OParl bei Daaden-Herdorf (`vgdaaden`), Asbach (`ratsinfo-vg-asbach`),
  Rengsdorf-Waldbreitbach (`vg-rw`), Sprendlingen-Gensingen (`vg-sg`); rubin-api bei Wittlich-Land (`vg-wittlich`),
  Wachenheim, Bad Bergzabern (`bza`), Lambsheim-Heßheim (`hessheim`, Namen mit angehängtem Bürgermeister → bereinigt). Auf eigener Domain
  (Link vom Projektinhaber, 02.10.2026): VG Kirchberg (Hunsrück) `ris.kirchberg-hunsrueck.de` (rubin-api, 49 Körperschaften); VG Kelberg
  `vgvkelberg.gremien.info` (rubin-api, 35 Körperschaften). Weitere more!rubin-Systeme ohne OParl nur nach
  Rücksprache freischalten.
- Subdomains folgen teils alten VG-Namen (Rockenhausen = VG Nordpfälzer Land, Lauterecken = VG Lauterecken-Wolfstein mit
  OParl aktiv; `vgloreley` = VG Loreley, OParl aktiv, aber ohne Vorlagen – auch die interne Schnittstelle liefert keine) – `discover` findet die nicht. Links stehen meist auf der VG-Website unter „Bürgerinformation“.

## Scraper und Weiterleiter
- `typ: "sessionnet"` in `endpoints.json` → `src/scrape/sessionnet.ts` statt OParl. Liest Kalender (`si0040`),
  Tagesordnung (`si0057`) und Vorlage (`vo0050`) und schreibt OParl-förmige Objekte über die upsert-Funktionen.
  IDs = Seitenadressen. Vorlagen haben keinen Text (nur PDF), Datum = erste Sitzung, Beratungsfolge aus den
  Tagesordnungen. Fenster: 2 Monate zurück, 3 voraus; ältere, bereits gespeicherte Sitzungen werden nicht neu geladen.
  Testseiten in `test/fixtures/sessionnet/` (echte Seiten aus Kaiserslautern 5.4.6 ASP und Koblenz 5.4.7 PHP).
  Varianten: `endung` asp|php; Sitzungslinks im Kalender auf `si0056` oder `si0057`; Kopf der Sitzung teils nur in
  der Überschrift; Beschluss/Abstimmung teils direkt am TOP (`smc_field_smcdv0_box2_*`) → `agenda_item.result`;
  Einladung teils nur in der Kalenderzeile; Links teils mit doppeltem Leerzeichen (`<a  href`).
  Mandanten: Manche Systeme führen mehrere Körperschaften (Filtermenü `smcfiltermenumandant`, Parameter `__cpanr`); mit
  `"mandanten": true` in `endpoints.json` liest der Scraper den Kalender je Mandant und legt je Mandant eine Körperschaft
  an (VG Landstuhl: VG + 12 Ortsgemeinden/Stadt; VG Kusel-Altenglan; VG Eisenberg auf `vgeisenberg.ris.itebo.de`: VG,
  Stadt Eisenberg, Kerzenheim, Ramsen). Ohne `__cpanr` zeigt der Kalender nur den Standardmandanten (VG).
  `npm run sync -- --full --id …` lädt bei Scrapern alle Sitzungen im Fenster neu.
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
Name in der App: „Ratsblick RLP“ (seit 02.10.2026).
Stil: ruhig und behördennah, Akzent Weinrot #7B2736 (vorher Blau #1F4E79), Schrift Public Sans, Vorlagennummern in IBM Plex Mono.
Logo (seit 02.10.2026): Umriss von Rheinland-Pfalz in Schwarz-Rot-Gold (diagonale Bänder, versetzte Füllung, weißer Umriss)
mit Lupe auf Weinrot; Kopfzeile „Ratsblick **RLP**“ mit „RLP“ in Gold #F2C230. Eigene Zeichnung aus offenen Grenzdaten
(`scripts/logo.py` → `web/icons/icon.svg`, `icon-maskable.svg`), keine Vorlage aus Bilddiensten (Vecteezy verlangt Namensnennung).
Icons (PNG) mit `scripts/icons.sh` aus den SVGs über das vorinstallierte Chromium rendern (ImageMagick hat keinen SVG-Renderer).

## Web-App (PWA)
- `web/` enthält die App (Vanilla-JS, kein Build-Schritt), `npm run web -- --out dist` erzeugt die statische Seite
  mit `data/index.json` und je Quelle `data/<id>.json` (Momentaufnahme aus `src/export/snapshot.ts`).
- „Kurz erklärt“-Texte liegen von Hand gepflegt in `data/kurz-erklaert.json` (Schlüssel: Vorlagen-ID).
- Startseite nur mit Suche (seit 02.10.2026, „Zuletzt angesehen“ entfernt). Reiter „Favoriten“: Kommunen (Gemeinde, Stadt, VG,
  Kreis – Stern neben dem Namen auf der Kommunenseite, je gewählter Ebene) und Gremien (Stern in der Sitzung neben dem Namen und auf
  der Kommunenseite unter „Gremien“) merken; gespeichert nur im Gerät (`localStorage` `ratsblick:favoriten`; Kommune
  `{typ:'gebiet', id}`, Gremium Quelle + Körperschaft + Gremiumsname), Anzeige gruppiert mit nächster und letzter Sitzung.
- Reiter „Themen“ (seit 02.10.2026, statt Themen-Abo): Themensuche über Titel aller Vorlagen und öffentlichen Sach-TOPs im
  aktuellen Datenstand (`data/suche.json`, beim Bauen aus den Momentaufnahmen, `suchEintraege` in `src/export/web.ts`; ~4 MB,
  ~0,7 MB übertragen, wird erst im Reiter geladen). Themen als Begriffslisten (`THEMEN` in `web/app.js`, Teilwörter mit
  ausgeschriebenen Umlauten, „^“ = Wortanfang), dazu Stichwort und Ort (ganz RLP, Gemeinde/VG/Kreis der gewählten Kommune,
  Favoriten). KI-Zusammenfassungen vom Projektinhaber verworfen (zu teuer).
- Quellen mit `typ: "ics"` (nur Termine; Ramstein-Miesenbach, Oberes Glantal, Wallmerod, Altenkirchen-Flammersfeld) tragen im Export
  `quelle.nurTermine`; die App zeigt dann auf Kommunen- und Sitzungsseite einen freundlichen Hinweis, dass Tagesordnungen und
  Vorlagen technisch nur im RIS des Anbieters bereitstehen (wie bei Ludwigshafen: keine Schuldzuweisung, Link aufs RIS).
- App-Dateien lädt der Service Worker zuerst aus dem Netz (Cache nur offline); neue Version kurz nach dem Start → automatisch neu laden.
- Links ins Original-RIS (seit 02.10.2026): je Quelle `quelle.ris` (Startseite, `risStartseite`), je Sitzung/Vorlage `web`
  (`webSeite` in `src/export/snapshot.ts`: OParl-`web`, sonst Seitenadresse der Scraper; more!rubin-Sitzungen `/meeting?id=`
  ohne `ni_`; ALLRIS 4 mit `&refresh=false`; ohne verlässliche Einzelseite → null, die App verlinkt dann die Startseite).
- `.github/workflows/website.yml`: alle 6 h Abgleich + Veröffentlichung auf GitHub Pages; bei Pushes nur neu bauen.
  Die Datenbank wird zwischen Läufen im Actions-Cache gehalten.
  Abgleich mit Zeitbudget (`--budget-min 50`, Schritt-Zeitgrenze 75 min): je Server nacheinander, älteste zuerst, Rest im
  nächsten Lauf; danach `wal_checkpoint`, damit auch ein abgebrochener Abgleich gesichert wird.
  Achtung Concurrency-Gruppe „website“: nur EIN wartender Lauf – jeder neue ersetzt den wartenden. Nicht gleichzeitig
  pushen und manuell starten; ein Push auf den Standard-Branch baut und veröffentlicht ohnehin.

## Nächste Schritte
1. Kontakt im User-Agent ggf. auf eine E-Mail-Adresse umstellen (derzeit Repo-URL).
2. Volltext aus `mainFile.text` in `file.text_extracted` übernehmen, Suche darüber.
3. „Kurz erklärt“ automatisch erzeugen (statt von Hand).
4. Benachrichtigungen zur Themensuche (Themen-Abo zurückgestellt, Projektinhaber 02.10.2026): als gespeicherte Suche – Was (Thema oder Stichwort) × Wo (eigene
   Gemeinde, VG, Nachbar-VGs, Landkreis, ganz RLP, Auswahl) × Welche (Vorlagen, TOPs, Beschlüsse mit Abstimmung); dazu
   Vergleichsansicht „ein Thema, mehrere Räte“. Stufe 1 ohne Server (Suche über RLP, Abo lokal gespeichert, „neu seit letztem
   Besuch“), Stufe 2 Benachrichtigungen (braucht kleinen Server für Web Push/E-Mail). Offen: Themenliste, Definition „Nachbar“.
5. Vorlagentexte für Scraper-Quellen aus den PDFs gewinnen (für Suche und „Kurz erklärt“).
6. Weitere Systeme: andere Anbieter (ALLRIS, SessionNet, Somacos) mit OParl suchen; bei „nicht freigeschaltet“
   ggf. Verwaltungen ansprechen; robots.txt-Frage bei sitzung-online.de klären.

## Konventionen
- Oberflächentexte, Kommentare, Fehlermeldungen und Doku auf Deutsch.
- Vor jedem Commit: `npm run typecheck && npm test`.
