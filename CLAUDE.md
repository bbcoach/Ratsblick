# Wahlheimat (vormals Ratsblick) – Projektkontext für Claude Code

## Ziel
Ein einheitliches Portal (Website und später App), das nach Eingabe der eigenen Kommune die öffentlichen
Inhalte der Ratsinformationssysteme (RIS) zeigt: Sitzungen, Tagesordnungen, Vorlagen, Beschlüsse.
Start mit Rheinland-Pfalz. Name seit 02.10.2026: **„Wahlheimat“**, Slogan „Guter Rat ist nicht teuer“ (bis 03.10.2026 „…nicht mehr teuer“; Überschriften der App persönlich: „Was beschließt mein Gemeinderat?“; vorher Arbeitstitel
„Ratsblick“ – Name ist durch ein Projekt unter ratsblick.de belegt). Interne Bezeichner (Repo, `localStorage`-Schlüssel
`ratsblick:*`, Cache-Namen, Weiterleiter-Header `x-ratsblick-*`, Quell-IDs) bleiben unverändert, damit nichts verloren geht.

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
  **Freigabe Landkreise (Projektinhaber, 02.10.2026)**, auch bei robots.txt-Verbot: Altenkirchen (rubin-api), Bad Kreuznach und
  Germersheim (ALLRIS 4, sitzung-online), Bitburg-Prüm (ALLRIS.net, sitzung-online), Neuwied, Westerwaldkreis, Südliche Weinstraße
  (SessionNet, owl-it), Vulkaneifel (SD.NET RIM ohne WAF, vorerst nur Kalenderexport `/termine/ics/kv`).
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
- VG Baumholder (Link vom Projektinhaber, 02.10.2026): Website `vgv-baumholder.de` zeigt Sitzungstermine über ein eingebautes RIS-Modul,
  Daten kommen aus `vgv-baumholder.gremien.info` (more!rubin, OParl aktiv, 17 Körperschaften, kaum Tagesordnungen) → OParl-Quelle.
- VG Bad Ems-Nassau (Link vom Projektinhaber, 02.10.2026): SessionNet 5.5 PHP `www.rat-vgben.de/bi/` mit Mandanten (keine robots.txt);
  führt noch die Vorgänger-VGs Bad Ems und Nassau → `zuordnen` (gebiete.ts) lässt einen genauen Namen eine Kurzform verdrängen.
- VG Annweiler am Trifels (Link vom Projektinhaber, 02.10.2026): SessionNet 5.5 ASP `bi-annweiler.de/bi/` mit Mandanten (keine robots.txt).
- VG Vordereifel (Link vom Projektinhaber, 02.10.2026): SessionNet 5.4 PHP `sessionnet.vordereifel.de/bi/` mit Mandanten (keine
  robots.txt); Mandant „St. Johann“ ohne Vorsatz → `mandantName` erkennt „St.“/„Sankt“ als Teil eines Ortsnamens.
- VG Thalfang am Erbeskopf (Link vom Projektinhaber, 02.10.2026): kein RIS, sondern das Politik-Modul „edith“ der NetzWerkstatt
  (`erbeskopf.regio-data.de/edith-….php`, als iframe in erbeskopf.de; robots.txt erlaubt alles) → `typ: "edith"` (`src/scrape/edith.ts`):
  je Gremium Auswahllisten „Sitzungseinladungen“ und „Unterrichtungen“ (Datum → `pollink_…` → 302 auf PDF). Sitzungen ohne Uhrzeit
  (00:00, App zeigt „Uhrzeit laut Einladung“) und ohne TOPs; Ortsgemeinden über `…/ortsgemeinden/<ort>/politik.html` (`mandanten`).
  Letzte Einträge Juni 2026.
- VG Zweibrücken-Land (Link vom Projektinhaber, 02.10.2026, Seite mit Kurzberichten verlinkt das RIS): regisafe `vgzwland.ris-portal.de/`
  (wie Kirchheimbolanden unter `/`), robots.txt nur für Suchmaschinen, außerhalb Europas 403 → Weiterleiter. VG, Stadt Hornbach und
  14 Ortsgemeinden; Rosenkopf hat im Portal keine Gremien.
- Stadt Neuwied (Link vom Projektinhaber, 02.10.2026): ALLRIS 4 `sitzungsdienst.neuwied.de/public/` (robots.txt „Disallow: /“, trotzdem
  angebunden, 2 s Abstand), außerhalb Europas Verbindungsabbruch → Weiterleiter (seit 19:45 UTC mit neuer Host-Liste deployt).
- Stadt Wittlich (Link vom Projektinhaber, 03.10.2026): Website `wittlich.de` bettet more!rubin ein, `stadt-wittlich.gremien.info` mit
  aktivem OParl (eine Körperschaft „Stadtverwaltung Wittlich“, großes Archiv: 1 339 Sitzungen, 4 075 Vorlagen; Export nur aktuelles Fenster).
- Stadt Mayen (Link vom Projektinhaber, 03.10.2026): SessionNet 5.5 ASP `sessionnet.owl-it.de/mayen/bi/` (robots.txt „Disallow: /“, trotzdem
  angebunden, 2 s Abstand), ein Mandant. VG Kusel-Altenglan (erneut geschickt): das System führt nur 16 Mandanten, die übrigen 18
  Gemeinden (u. a. Altenglan, Kusel) sind dort nicht vertreten.
- VG Rüdesheim, Ortsgemeinden (05.10.2026, selbst gefunden, auf Zustimmung des Projektinhabers angebunden): die Website `vg-ruedesheim.de` hat einen Sitzungskalender mit
  iCalendar-Export (`/kalender/sitzungskalender/event.ics?weekends=false&tagMode=ALL`, Anbieter IONAS) mit den Gemeinderatssitzungen der Ortsgemeinden
  („Sitzung des Gemeinderates X“, Einladungstext mit Tagesordnung in DESCRIPTION, derzeit nur 7 Termine, nur Zeitraum um heute) → zweite Quelle `vg-ruedesheim-termine`
  (`typ: "ics"`, `mandanten`), gleiches `gebiet` wie `vg-ruedesheim`; die VG bleibt bei der ris-portal-Quelle (erste Quelle nach Name gewinnt in `daten`), die Ortsgemeinden
  kommen aus dem Kalender. robots.txt der Seite nicht lesbar (Verbindungsabbruch). Wie Hachenburg (9 fehlende) und Nastätten (13): deren Systeme führen die übrigen Ortsgemeinden nicht, die Zuordnung ist korrekt.
  Daun (`daun.gremien.info`) und Kastellaun enthalten keine bzw. nur 3 Ortsgemeinden.
- Stadt Kusel (Link vom Projektinhaber, 03.10.2026): kein RIS, sondern Listen von Sitzungsprotokollen (PDF) auf `stadt.kusel.de`
  (Stadtrat 2018–2026, dazu Haupt-/Bau-/Finanzausschuss) → `typ: "protokolle"` (`src/scrape/protokolle.ts`, weitere Listenseiten in
  `seiten`): je Protokoll eine abgeschlossene Sitzung mit dem PDF als Niederschrift, ohne Uhrzeit/TOPs; Fenster 2 Jahre. robots.txt erlaubt
  Seiten und PDFs. Export `quelle.ohneRis` (auch edith/Thalfang): Links sprechen von „Website“ statt „Ratsinformationssystem“; Sitzungen ohne
  Uhrzeit zeigen „Uhrzeit siehe Dokument“, vergangene ohne TOPs „keine einzelnen Tagesordnungspunkte“.
- VG Traben-Trarbach (Link vom Projektinhaber, 03.10.2026): `vgtt.gremien.info` (more!rubin, OParl nicht aktiv) → `rubin-api`, 23 Körperschaften
  (VG, Stadt, 14 Ortsgemeinden + Zweckverbände), erster Lauf 82 Sitzungen, 167 Vorlagen.
- VG Selters (Westerwald) (Link vom Projektinhaber, 03.10.2026): `selters-ww.gremien.info`, more!rubin mit aktivem OParl, 26 Körperschaften
  (alle, OParl = interne Schnittstelle), großes Archiv (2 106 Sitzungen, keine Vorlagen).
- VG Thaleischweiler-Wallhalben (Link vom Projektinhaber, 03.10.2026): Website `vgtw.de` bettet more!rubin ein (Ergebnisliste nur per JS, ohne
  sichtbare Adresse) → `vgtw.gremien.info` per Namensraten gefunden; OParl aktiv mit 27 Körperschaften (intern nur 25), 1 910 Sitzungen, 9 412 TOPs.
  Tipp: bei Websites mit „integration-ris“ zuerst `<kürzel>.gremien.info/oparl/system` probieren.
- Per Namensraten (`<kürzel>.gremien.info/oparl/system`, mit Zustimmung des Projektinhabers, 03.10.2026) gefunden und angebunden: VG Offenbach an der
  Queich (`offenbach-queich`, OParl, 2 031 Sitzungen, 10 156 Vorlagen), VG Römerberg-Dudenhofen (`vgrd`, OParl), VG Rhein-Nahe (`vgrn`,
  rubin-api, 17 Körperschaften; heißt „Verbandsgemeindeverwaltung Rhein-Nahe“ → `PRAEFIX` in gebiete.ts). Kein gremien.info gefunden für Rennerod,
  Hamm (Sieg), Ransbach-Baumbach, Waldfischbach-Burgalben, Pellenz, Mendig, Vallendar, Weißenthurm, Jockgrim (andere Anbieter, Links nötig).
- VG Waldfischbach-Burgalben (Link vom Projektinhaber, 03.10.2026): `vg-wabu.gremien.info` (Kürzel mit Bindestrich: `vg-<kürzel>`), more!rubin ohne
  OParl → `rubin-api`, 10 Körperschaften, 29 Sitzungen, 59 Vorlagen.
- VG Hamm (Sieg) (Link vom Projektinhaber, 03.10.2026): SessionNet 5.5 ASP `sessionnet.owl-it.de/hamm-sieg/bi/` (robots.txt „Disallow: /“, trotzdem
  angebunden, 2 s Abstand), Mandanten: VG + 12 Ortsgemeinden.
- VG Ransbach-Baumbach (Link vom Projektinhaber, 03.10.2026): der Link `ratsinfo.ransbach-baumbach.de` ist das Anmeldeportal für Mandatsträger (nicht abgerufen); öffentlich ist SessionNet 5.4.8 PHP `buergerinfo.ransbach-baumbach.de` (robots.txt „Disallow: /“, trotzdem angebunden, 2 s Abstand), Mandanten: VG, Stadt, 10 Ortsgemeinden, AÖR, 2 Zweckverbände; erster Lauf 63 Sitzungen, 17 Vorlagen.
- VG Weißenthurm (Link vom Projektinhaber, 03.10.2026): SessionNet 5.5.3 ASP `sessionnet.owl-it.de/verbandsgemeindeweissenthurm/bi/` (robots.txt „Disallow: /“, trotzdem angebunden, 2 s Abstand), Mandanten: VG + 7 Gemeinden (alle zugeordnet); erster Lauf 76 Sitzungen, 144 Vorlagen.
- VG Mendig (Link vom Projektinhaber, 03.10.2026): SessionNet 5.5.1 ASP `buergerinfo.mendig.de` (keine robots.txt), Mandanten: VG, Stadt Mendig, Bell, Rieden, Thür, Volkesfeld (alle zugeordnet) + 4 Zweckverbände; erster Lauf 45 Sitzungen, 50 Vorlagen.
- VG Rennerod (Link vom Projektinhaber, 03.10.2026): der Link `ratsinfo-vg-rennerod.digitalfabrix.de` ist das Anmeldeportal für Mandatsträger (SessionNet „ri“, nicht abgerufen); öffentlich ist SessionNet 5.4.5 ASP `buergerinfo-vg-rennerod.digitalfabrix.de` (keine robots.txt; `digitalfabrix.de` löst jeden Namen auf, 503 = unbekannt), Mandanten: VG, Stadt Rennerod, 22 Ortsgemeinden (alle zugeordnet) + 2 Zweckverbände; erster Lauf nur 10 Sitzungen, 34 TOPs, keine Vorlagen (`client.rlpdirekt.de` auf der VG-Website ist nur das Bürgerservice-Portal des Landes, kein RIS).
- Stadt Remagen (Link vom Projektinhaber, 03.10.2026): SessionNet 5.5.3 PHP `www.remagen-ratsinformation.de/bi/` (ein Mandant, robots.txt fehlt), erster Lauf 22 Sitzungen, 78 Vorlagen.
- VG Pellenz (Link vom Projektinhaber, 03.10.2026): SessionNet 5.5.0 ASP `gremien.pellenz.de/smcbi/` (Pfad `/smcbi/`, keine robots.txt), Mandanten: VG, Kretz, Kruft, Nickenich, Plaidt, Saffig (alle zugeordnet), Öko-Stiftung Plaidt, Zweckverband Frei- und Hallenbad; erster Lauf 85 Sitzungen, 85 Vorlagen.
- VG Vallendar (Link vom Projektinhaber, 03.10.2026): SessionNet 5.5.0 PHP `buergerinfo.vg-vallendar.de` (keine robots.txt), Mandanten: VG, Stadt Vallendar, Niederwerth, Urbar, Weitersburg (alle zugeordnet) + Forstzweckverband; erster Lauf 63 Sitzungen, 96 Vorlagen.
- VG Jockgrim (Link vom Projektinhaber, 03.10.2026): SessionNet 5.5.4 PHP `bi.vg-jockgrim.de` (robots.txt „Disallow: /“, trotzdem angebunden, 2 s Abstand), Mandanten: VG, Hatzenbühl, Jockgrim, Neupotz, Rheinzabern (Menü „Mandant wechseln“, Standard über gleichnamigen Mandanten); erster Lauf 37 Sitzungen, 92 Vorlagen.
- Landkreis Birkenfeld (Link vom Projektinhaber, 03.10.2026): `nationalparklandkreis.gremien.info`, more!rubin ohne OParl → `rubin-api` (Kreis + WFG BIR GmbH), erster Lauf 20 Sitzungen, 71 Vorlagen. Die Website `landkreis-birkenfeld.de` liefert automatischen Abrufen leere Seiten (technische Sperre, robots.txt blockt KI-Crawler) – nicht abgerufen. Die VG Birkenfeld ist über `sessionnet.owl-it.de/birkenfeld/bi/` angebunden. Mainz-Bingen: `www.landkreis-mainz-bingen.sitzung-online.de/bi/` (seit 02.10.2026).
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
- Kalender der Reihe nach `si010_j` → `si010_e` → `si010` → je Rat (je Einrichtung ist nur eine Ansicht freigegeben).
  Landkreis Mainz-Bingen (Link vom Projektinhaber, sitzung-online, robots.txt): nur `si010_e.asp` frei.
  Eifelkreis Bitburg-Prüm: `si010_j` gesperrt, aber der einfache Kalender `si010.asp?MM=&YY=` geht (gleiches Format, ohne Gremienliste;
  Gremien dann aus der Sitzung). Kirchen und Betzdorf-Gebhardshain: auch `si010` gesperrt („Zugriff verweigert“). Dann Räteliste `pa000.asp` (Namen fett hinter
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
  `vgvkelberg.gremien.info` (rubin-api, 35 Körperschaften); Stadt Andernach `andernach.gremien.info` (rubin-api). Weitere more!rubin-Systeme ohne OParl nur nach
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
Name in der App: „Wahlheimat RLP“ (Kopfzeile seit 03.10.2026 Wortmarke „A“ in Großbuchstaben (Projektinhaber, 03.10.2026): Nunito (`web/fonts/nunito-latin.woff2`, abgerundet), „WAHL“ Black + „HEIMAT“ Light, Laufweite .06em, 20 px (ab ≤ 360 px 16 px), „RLP“ klein in Gold, darunter 4 px Streifen Schwarz-Rot-Gold, dessen Farben ineinander laufen und den Wörtern folgen (Schwarz unter WAHL, Rot unter HEIMAT, Gold unter RLP; Mischtöne an den Wortgrenzen; Breite über unsichtbaren Zweittext `.bars`); Projektinhaber bevorzugt serifenlose Marken, Varianten B–L als Entwürfe im Gespräch, nicht im Repo), Slogan „Guter Rat ist nicht teuer.“ auf der Startseite; vorher „Ratsblick RLP“.
Heller Modus bleibt kühl (Grund `#f6f4f4`, Karten weiß): ein Creme-Entwurf (`#f6f0e6`/`#fbf8f2`) wurde am 03.10.2026 getestet und vom Projektinhaber verworfen („wirkt nicht professionell“). Stil: ruhig und behördennah, Akzent Weinrot #7B2736 (vorher Blau #1F4E79), Schrift Public Sans, Vorlagennummern in IBM Plex Mono.
Logo (seit 02.10.2026): Umriss von Rheinland-Pfalz in Schwarz-Rot-Gold (diagonale Bänder, versetzte Füllung, weißer Umriss)
mit Lupe auf Weinrot; Kopfzeile „Wahlheimat **RLP**“ mit „RLP“ in Gold #F2C230. Eigene Zeichnung aus offenen Grenzdaten
(`scripts/logo.py` → `web/icons/icon.svg`, `icon-maskable.svg`), keine Vorlage aus Bilddiensten (Vecteezy verlangt Namensnennung).
App-Icon (seit 03.10.2026, Entwurf 2 des Projektinhabers): Karte größer (Gruppe aus Karte + Lupe, mittig gesetzt, ~81 % der Kachelhöhe) – `scripts/logo.py` erzeugt `icon.svg` (rund), `icon-maskable.svg` (Android, 80 %-Sicherheitszone) und `icon-apple.svg` (iOS rundet selbst, Motiv groß; Quelle für `apple-touch-icon.png`; vorher aus der maskierbaren Fassung → wirkte klein); `AUSGLEICH` in logo.py gleicht die Mitte nach Messung aus.
Icons (PNG) mit `scripts/icons.sh` aus den SVGs über das vorinstallierte Chromium rendern (ImageMagick hat keinen SVG-Renderer).

## Web-App (PWA)
- `web/` enthält die App (Vanilla-JS, kein Build-Schritt), `npm run web -- --out dist` erzeugt die statische Seite
  mit `data/index.json` und je Quelle `data/<id>.json` (Momentaufnahme aus `src/export/snapshot.ts`).
- „Kurz erklärt“-Texte liegen von Hand gepflegt in `data/kurz-erklaert.json` (Schlüssel: Vorlagen-ID).
- Bildband auf der Startseite (seit 05.10.2026, Idee des Projektinhabers): Slider mit 13 Fotos aus RLP (Kaiserslautern, Mainz, Cochem, Bernkastel-Kues, Annweiler am Trifels, Donnersbergkreis, Pirmasens, Saarburg, Worms, Mutterstadt, Trier, Koblenz, Neustadt an der Weinstraße) über der Überschrift; je Start werden höchstens 10 (`BANNER_MAX`) zufällig aus dem ganzen Bestand ausgewählt, in zufälliger Reihenfolge (nicht immer dieselbe Stadt zuerst), `BANNER_BILDER` in `web/app.js` (neue Bilder dort anhängen; der Bildnachweis im Impressum listet die Orte automatisch), Bilder in `web/img/` (1100 px, ~620 KB gesamt, nur das erste sofort geladen). CSS Scroll-Snap, Format 9:4 (ab 700 px 3:1), Abstand oben 8 px/Lücken 18 px (Mittelweg, vom Projektinhaber so gewählt), Wechsel alle 5,5 s, pausiert bei Berührung, aus bei `prefers-reduced-motion`. Alle Fotos von Adobe Stock; Lizenzhinweis auf Wunsch **nur** im Impressum (Abschnitt „Bildnachweis“, seit 05.10.2026; vorher auf der Info-Übersicht), Urhebernamen liegen nicht vor. Jedes Bild ist ein Link auf die Kommunenseite (`id` = Gebiets-ID in `BANNER_BILDER`; kreisfreie Städte leiten auf die Kreisebene, Cochem/Saarburg/Mutterstadt sind Gemeinde-IDs, Donnersbergkreis eine Kreis-ID). Neue Bilder: `id` und `pos` (object-position) je Bild anpassen.
- Startseite nur mit Suche (seit 02.10.2026, „Zuletzt angesehen“ entfernt). Reiter „Favoriten“: Kommunen (Gemeinde, Stadt, VG,
  Kreis – Stern neben dem Namen auf der Kommunenseite, je gewählter Ebene) und Gremien (Stern in der Sitzung neben dem Namen und auf
  der Kommunenseite unter „Gremien“) merken; gespeichert nur im Gerät (`localStorage` `ratsblick:favoriten`; Kommune
  `{typ:'gebiet', id}`, Gremium Quelle + Körperschaft + Gremiumsname), Anzeige gruppiert mit nächster und letzter Sitzung.
- Reiter „Themen“ (seit 02.10.2026, statt Themen-Abo): Themensuche über Titel aller Vorlagen und öffentlichen Sach-TOPs im
  aktuellen Datenstand (`data/suche.json`, beim Bauen aus den Momentaufnahmen, `suchEintraege` in `src/export/web.ts`; ~4 MB,
  ~0,7 MB übertragen, wird erst im Reiter geladen). Themen als Begriffslisten (`THEMEN` in `web/app.js`, Teilwörter mit
  ausgeschriebenen Umlauten, „^“ = Wortanfang), dazu Stichwort und Ort (ganz RLP, Gemeinde/VG/Kreis der gewählten Kommune,
  Favoriten). KI-Zusammenfassungen vom Projektinhaber verworfen (zu teuer).
- Leere „Nächste Sitzungen“ (seit 03.10.2026): Hinweis „keine künftigen Sitzungen eingetragen“ mit Datum der letzten Sitzung und Erklärung, dass die Verwaltung Termine erst kurz vor der Sitzung einträgt (Anlass: VG/Stadt Kirchheimbolanden, im RIS nur Ortsgemeinden mit künftigen Terminen; Abruf nach Kalender geprüft, App stimmt).
- Quellen mit `typ: "ics"` (nur Termine; Ramstein-Miesenbach, Oberes Glantal, Wallmerod, Altenkirchen-Flammersfeld) tragen im Export
  `quelle.nurTermine`; die App zeigt dann auf Kommunen- und Sitzungsseite einen freundlichen Hinweis, dass Tagesordnungen und
  Vorlagen technisch nur im RIS des Anbieters bereitstehen (wie bei Ludwigshafen: keine Schuldzuweisung, Link aufs RIS).
- Darstellung (seit 02.10.2026, kein Umschaltknopf – Projektinhaber): nachts dunkel nach Tageszeit des Geräts (zwischen Ende und
  Beginn der bürgerlichen Dämmerung, berechnet für RLP, `nachtModus` im `<head>`, minütlich geprüft), tagsüber wie im Gerät eingestellt. Breite: Kopfzeile/Reiter über die ganze Breite, Inhaltsspalte `--w` 640/840/1120 px;
  ab 1180 px „Nächste Sitzungen“ und „Neue Vorlagen“ nebeneinander (`section.spalte`). Domain: wahlheimat-rlp.de (GitHub Pages).
- Sitzverteilung (seit 02.10.2026, Idee des Projektinhabers): Kommunalwahl 2024 je Rat (Gemeinde-, Stadt-, VG-Rat, Kreistag) als
  kompakter Halbkreis mit Kurzlegende direkt unter dem Kopf der Kommunenseite (vor den Sitzungen, Projektinhaber), Tabelle (Sitze,
  ggü. 2019, Stimmenanteil) unter „Alle Zahlen“ zum Aufklappen; bei Mehrheitswahl nur eine dezente Zeile. Daten: `npm run sitze` (scripts/sitzverteilung.ts)
  liest die statischen JSON-Dateien der Ergebnis-App des Landeswahlleiters (`rlp-kw24.wahlen.23degrees.eu/assets/`:
  `wahlen-vec-tree.json` = Gebietsbaum, `json/wahlen/<WAHL>/<geoId>.json`; geoId = KKK VV GGG 00, Gemeinde-Schlüssel = 07+KKK+GGG,
  VGs über ihre Gemeinden) → `data/sitze-2024.json` (im Repo, Rohdateien in `.cache/kw24/`). „PRESTART_ONE_LIST“ = Mehrheitswahl.
  Wählergruppen haben 2024 neue IDs → kein Vergleich zu 2019 („–“); die Quelle kürzt Kurznamen auf 20 Zeichen → Langname.
  Stand 02.10.2026: 2 453 Räte (2 288 Gemeinderäte, davon 1 546 Mehrheitswahl; 129 VG-Räte, 24 Kreistage, 12 Stadträte kreisfreier
  Städte unter dem Kreisschlüssel). Gemeinden mit neuem Schlüssel nach der Wahl über den Namen (Obergeckler; Niedergeckler entfällt).
  Farben: übliche Parteifarben, Wählergruppen #2a9d8f/#a0522d/#6a5acd (mit dem dataviz-Validator geprüft), danach grau.
- Unterstützen-Block (seit 03.10.2026) auf der Info-Seite (`vInfo`, Text vom Projektinhaber, Du-Form): „Guter Rat ist nicht teuer – für dich.“ mit PayPal-Button. Der Link (`https://www.paypal.com/paypalme/RalphArnold973/5` (5 € vorbelegt), eingetragen 03.10.2026) steht in `BETREIBER.paypal` (app.js); ist er leer, erscheint der Block ohne Button und der PayPal-Absatz im Datenschutz fehlt. Hinweis „keine Spendenbescheinigung“ (privates Projekt, nicht gemeinnützig).
- Spendenhinweis (seit 05.10.2026, Wunsch des Projektinhabers): einmaliges Fenster nach `SPENDENHINWEIS_NACH` = 10 geöffneten Ansichten (`zaehleAnsicht` in `route()`, gleiche Adresse hintereinander zählt einmal; Zähler `ratsblick:ansichten`, Merkzeichen `ratsblick:spendenhinweis` mit Datum, beides nur im Gerät). Erscheint 1,5 s nach dem Öffnen, nicht auf Info-/Rechtsseiten, nur wenn `BETREIBER.paypal` gesetzt ist; Merkzeichen wird vor dem Anzeigen gesetzt (kommt nie wieder, auch nicht nach Tippen auf PayPal). Schließen per Knopf, Tipp daneben, Escape oder Seitenwechsel; Fokus wird gehalten. Datenschutz Abschnitt 3 nennt Zähler und Merkzeichen. Texte des Fensters aus dem Unterstützen-Block der Info-Seite gekürzt.
- Admin und Quellenstatus (seit 03.10.2026): jeder Abgleich schreibt je Quelle eine Zeile in `sync_log` (Tabelle in schema.sql: ok/Fehler, Dauer, Sitzungen/kommende/Vorlagen, letzte 200 je Quelle). `src/status/status.ts` (`baueStatus`, `warnungenMarkdown`) macht daraus Ampel, Veränderungen gegenüber dem vorigen Abgleich und Warnungen (Fehler, > 36 h ohne Erfolg, keine Sitzung, Einbruch ≥ 30 % und ≥ 5). `npm run status -- --warnungen w.md` und `npm run admin -- --out dist/admin`. Die Admin-Seite (`src/status/admin.ts`) ist **verschlüsselt** (PBKDF2-SHA256, 600 000 Runden → AES-256-GCM, Entschlüsselung im Browser; auf GitHub Pages ohne Server gibt es keinen echten Passwortschutz): Passwort im GitHub-Secret `ADMIN_PASSWORT` (≥ 16 Zeichen, besser langer Satz; ohne Secret wird `/admin/` nicht erzeugt), Seite `noindex`, vom Service Worker ausgenommen. Im Workflow legt der Schritt „Warnung per Issue“ bei Auffälligkeiten ein Issue mit Label `quellenstatus` an (GitHub schickt E-Mail), kommentiert bei Änderung und schließt bei Entwarnung (Issues sind öffentlich: nur Quellennamen und Fehlertexte, keine Geheimnisse). Zugriffszahlen stehen im Dashboard **ganz oben** (seit 05.10.2026), die Aufstellung „Meistgenutzte Seiten“ ist in einem aufklappbaren Bereich mit Klarnamen: nach Seitenart (Startseite, Info, Kommunenseite, Sitzung …) und die 20 meistbesuchten Kommunen (alle Ebenen zusammen; Namen aus `data/gebiete-rlp.json` über `gebietNamen`, `seitenArt` in `src/status/zugriffe.ts`); der Worker liefert dafür die 300 häufigsten Pfade statt 15. Zugriffszahlen (**eigener Zähler** statt Drittanbieter, Entscheidung Projektinhaber 03.10.2026; **seit 03.10.2026 eingeschaltet** (Worker `https://wahlheimat-zaehler.ralph-arnold.workers.dev`, auf Anweisung des Projektinhabers, rechtliche Prüfung des Datenschutztexts steht noch aus): Cloudflare Worker + D1 in `zaehler/` (Konto des Projektinhabers, zweiter Worker neben basketballprocoach, **eigener** API-Token), Veröffentlichung per `.github/workflows/deploy-zaehler.yml` (nur mit Variable `ZAEHLER_AKTIV=ja`). Gespeichert wird nur je Tag und Seitenart eine Zahl (keine IP/Hash/Kennung/UA/Verweis, Aufbewahrung 400 Tage); `POST /z` nur von `https://wahlheimat-rlp.de`, Pfadliste gegen IDs/Suchbegriffe, Bots verworfen; `GET /lesen` mit dem SHA-256-Hash des `LESE_TOKEN`. In der App `ZAEHLER` (web/app.js, gesetzt = an, leer = aus; Wert `<Worker>/z`) schaltet `sendBeacon` (DNT/GPC respektiert) und Datenschutz-Absatz 3a samt Lead ein; Dashboard liest über `src/status/zugriffe.ts` mit Variable `ZAEHLER_URL` und Secret `ZAEHLER_LESETOKEN`. Einrichtung: `zaehler/README.md`. Offen: rechtliche Prüfung des Datenschutztexts (Cloudflare als Auftragsverarbeiter, USA/DPF).
- Datenbank-Backup (seit 03.10.2026): wöchentlich (sonntags, erster Lauf) oder manuell (`backup` im Workflow-Start) sichert `scripts/db-backup.sh` die Datenbank (3 GB, komprimiert ~220 MB) mit zstd + AES-256 (PBKDF2) als Asset des Releases `db-backup` (letzte 3; verschlüsselt, weil das Repo öffentlich und die Datenbank eine Massenkopie der RIS ist). Passwort im GitHub-Secret `BACKUP_PASSWORT` (ohne Secret wird übersprungen; **Passwort zusätzlich sicher außerhalb von GitHub aufbewahren**, sonst ist die Sicherung wertlos). Wiederherstellung steht im Kopf des Skripts. Tags lösen keinen Bau aus (`tags-ignore`).
- Zahlen (seit 03.10.2026): Startseite nennt ehrlich „eigene Sitzungsdaten für 2 110 von 2 300 Gemeinden, bei weiteren 189 nur über die Verbandsgemeinde oder den Kreis“; in der Suche Hinweis „über VG/Kreis“ bzw. „ohne Daten“. Doppelte more!rubin-Sitzungen (`…/meeting/ni_X` und `…/meeting/X`, 30 Fälle) entfernt `entferneZwillinge` im Export; übrige Doppelte (24, u. a. Thalfang Einladung/Unterrichtung am selben Tag, Kreisausschuss in Kusel, Trier-Saarburg) stammen aus den RIS selbst.
- Lange Wörter (seit 05.10.2026): ein Titel ohne Trennstelle („Stadtvorstand/Verwaltungsbesprechung“ in Mainz) machte die Seite auf dem iPhone breiter als den Bildschirm (Safari zoomt heraus, Kopfzeile und Tab-Leiste rutschen). Abhilfe: `overflow-wrap: anywhere` und `min-width: 0` an `h1`, `.favkopf`, `.hero`. Neue Flex-/Grid-Kinder mit Fließtext brauchen `min-width: 0`.
- Überschriften (seit 05.10.2026): jede Ansicht hat genau eine `<h1>` (Seitentitel, bisher `<h3>`), Abschnitte `<h2>`; Optik unverändert. Zweckverbände/sonstige Körperschaften stehen in der Suche deutlich hinter Gemeinden, VGs und Kreisen (`rang.body`).
- Suche (seit 03.10.2026): `suchSchluessel` in app.js gleicht Schreibweisen ab (Umlaute als ae/oe/ue/ss und ohne Akzent, „St.“/„Sankt“, Bindestrich = Leerzeichen): „Muenchweiler“, „Munchweiler“, „St. Johann“ finden die richtigen Orte.
- VG-Seite (seit 03.10.2026): unter „Nächste Sitzungen“ der Abschnitt „In den Gemeinden der Verbandsgemeinde“ (Sitzungen der anderen Körperschaften derselben Quelle, 8 sichtbar, Rest aufklappbar, mit Name der Körperschaft). Gemeinde/Stadt ohne eigene künftige Termine verweisen darauf („In der Verbandsgemeinde gibt es N künftige Sitzungen anderer Gemeinden“). Anlass: Rockenhausen zeigte nichts, das RIS zählt die Termine zur VG.
- Links ins RIS (Ergänzung 03.10.2026): Sitzungen, die nur als Kalendereintrag existieren (Id mit `#`: SessionNet-Kalender, SD.NET RIM; zusammen ~1 000), bekommen `web` = Monatskalender (SessionNet, mit `__cpanr` bei Mandanten) bzw. Terminliste (`/termine`) und `webKalender` (`kalenderEintragLink`). Vorlagen ohne eigene Seite (more!rubin, ~15 000) verlinken die Sitzung, auf deren Tagesordnung sie stehen („Sitzung mit dieser Vorlage …“). Beratungen, die auf eine entfernte Zwillings-Id zeigen, werden auf die behaltene umgelenkt (`behalteSitzungsId`).
- Dokument-Links (seit 03.10.2026): more!rubin-PDFs (`…gremien.info/api.php?document_type_id=…`) bekommen im Export `&inline=1` (sonst `Content-Disposition: attachment` → Android lädt nur herunter; 24 000 Links); SessionNet `getfile.asp|php` liefert immer als Download (Kusel-Altenglan, Koblenz gemessen) → Feld `dl`, App zeigt „wird heruntergeladen“ und einen Hinweis; ALLRIS-PDFs sind inline.
- Rechtliches (seit 02.10.2026): Seiten `#/ueber`, `#/impressum`, `#/datenschutz` (`TEXTSEITEN` in web/app.js), erreichbar über den
  vierten Reiter „Info“ (`#/info`, Übersicht); keine Fußzeile auf Start-/Favoritenseite (Projektinhaber). Betreiberangaben nur in `BETREIBER` (app.js) pflegen (eingetragen 03.10.2026: Ralph Arnold, Enkenbach-Alsenborn, info@wahlheimat-rlp.de); fehlende erscheinen als „[wird ergänzt]“.
  Kein Cookie-Banner nötig (keine Cookies/Tracking; localStorage nur für Nutzerfunktionen, § 25 Abs. 2 Nr. 2 TDDDG). Schriften liegen
  in `web/fonts/` (keine Google-Fonts-Abrufe, LG München 2022); App lädt nichts von fremden Servern. Design bewusst nicht wie rlp.de
  (keine Verwechslung mit einem Landesangebot), Unabhängigkeit auf „Über Wahlheimat“ und im Impressum.
- App-Dateien lädt der Service Worker zuerst aus dem Netz (Cache nur offline); neue Version kurz nach dem Start → automatisch neu laden.
- SessionNet-Sitzungen ohne Tagesordnung und ohne Unterlagen (seit 03.10.2026): die Einzelseite `si0057`/`si0056` ist im RIS nicht öffentlich (Kaiserslautern: „Zum Öffnen des Vorgangs fehlt die Berechtigung“, Code 1104) → Export verlinkt den Monatskalender `si0040…?__cjahr=&__cmonat=` (`sessionnetKalender` in snapshot.ts, Feld `webKalender`), die App zeigt „Kalender im Ratsinformationssystem öffnen“ mit Erklärung. Gilt für alle SessionNet-Quellen mit leerer Sitzung; nicht an jedem System geprüft.
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
