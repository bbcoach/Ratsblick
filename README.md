# Wahlheimat (vormals Ratsblick) – Datenebene

*Guter Rat ist nicht mehr teuer.*

Wahlheimat soll die öffentlichen Inhalte kommunaler Ratsinformationssysteme an einem Ort zugänglich machen.
Dieses Repository enthält den ersten Baustein: Es liest Daten über die Standardschnittstelle **OParl**
und schreibt sie in eine einheitliche Datenbank. Website und App setzen später darauf auf.

## Voraussetzungen

- Node.js 22.13 oder neuer (für die eingebaute SQLite-Datenbank)
- Internetzugang zu den kommunalen Servern

## Schnellstart

```bash
npm install
npm test                                  # Tests mit nachgebauten OParl-Antworten
npm run probe                             # Welche Schnittstellen antworten gerade?
npm run sync -- --id vg-montabaur --max-pages 2   # kleiner Probelauf
npm run sync                              # alle Quellen mit Status "aktiv"
npm run web -- --out dist                 # Web-App mit allen Daten bauen
cd dist && python3 -m http.server 8000    # lokal ansehen: http://localhost:8000
```

Die Daten landen in `data/ratsblick.sqlite`. Ansehen lässt sich die Datei z. B. mit dem
kostenlosen „DB Browser for SQLite“.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `data/endpoints.json` | Ratsinformationssysteme mit Status und amtlichem Gebietsschlüssel |
| `data/gebiete-rlp.json` | Alle Gebietskörperschaften in RLP (Destatis-Gemeindeverzeichnis, `scripts/gemeindeverzeichnis.py`) |
| `src/scrape/sessionnet.ts` | Scraper für SessionNet-Systeme ohne OParl (z. B. Kaiserslautern) |
| `relay/` | Weiterleiter bei Vercel in Frankfurt für Server, die nur aus Europa erreichbar sind |
| `src/sync/discover.ts` | Suche nach gremien.info-Systemen für alle Kommunen (`npm run discover`) |
| `src/oparl/client.ts` | OParl-Client: Seitenweises Lesen, Wiederholung bei Serverfehlern, Drosselung je Server |
| `src/db/schema.sql` | Datenmodell |
| `src/sync/sync.ts` | Abgleich System → Körperschaften → Gremien, Sitzungen, Vorlagen |
| `src/sync/probe.ts` | Schnelltest einer Schnittstelle |
| `src/export/` | Momentaufnahme je Quelle und Bau der Web-App |
| `web/` | Web-App (PWA): Kommune wählen, Übersicht, Sitzung, Vorlage, Themen-Abo |
| `data/kurz-erklaert.json` | „Kurz erklärt“-Texte je Vorlage |
| `.github/workflows/website.yml` | Abgleich alle 6 Stunden und Veröffentlichung auf GitHub Pages |
| `src/cli.ts` | Befehle `probe`, `sync`, `snapshot` und `web` |
| `test/` | Tests |

## Datenmodell

Das Modell folgt OParl, damit später auch andere Quellen (z. B. Scraper für Systeme ohne OParl)
dieselben Tabellen befüllen können. Jede Tabelle speichert zusätzlich das Originalobjekt in `raw`.

| Tabelle | Bedeutung | in der App |
|---|---|---|
| `source` | angebundene Schnittstelle | Abdeckung („Daten verfügbar“) |
| `body` | Körperschaft: Gemeinde, VG, Kreis | Ebenen-Umschalter |
| `organization` | Gremium | Name der Sitzung |
| `meeting`, `agenda_item` | Sitzung und Tagesordnung | „Nächste Sitzungen“ |
| `paper`, `consultation` | Vorlage und Beratungsfolge | Vorlagen-Detail |
| `file`, `file_link` | PDFs und ihre Zuordnung | Dokumente |
| `sync_state` | Stand des inkrementellen Abgleichs | – |

Wichtig für Rheinland-Pfalz: Ein System kann mehrere Körperschaften enthalten, etwa eine
Verbandsgemeinde samt ihrer Ortsgemeinden. Der Abgleich liest deshalb alle Körperschaften eines Systems.

## Verhalten gegenüber den Servern

- Höchstens eine Anfrage pro Sekunde je Server (`--interval` ändert das). Subdomains zählen als ein
  Server – alle `*.gremien.info` liegen auf derselben Maschine.
- Abgleich mit `modified_since`. more!rubin meldet allerdings jedes Objekt als heute geändert,
  daher ist dort jeder Lauf ein Vollabgleich.
- Der User-Agent nennt das Projekt und als Kontakt dieses Repository.

## Web-App auf dem Handy

Die Web-App ist eine installierbare PWA: Sie läuft im Browser, lässt sich auf den Startbildschirm
legen und zeigt offline den zuletzt geladenen Stand. GitHub Actions gleicht alle 6 Stunden ab und
veröffentlicht sie auf GitHub Pages (`https://<konto>.github.io/Ratsblick/`).

Einmalig einrichten: im Repository unter **Settings → Pages → Build and deployment → Source**
„GitHub Actions“ wählen. Danach unter **Actions → Website → Run workflow** den ersten Lauf starten.

## Stand und nächste Schritte

- [x] OParl-Client, Datenmodell, Abgleich, Schnelltest, Tests
- [x] Erster Lauf gegen die echten Server: alle sechs aktiven Systeme lesbar
- [x] Web-App (PWA) nach den Entwürfen, automatisch aktualisiert
- [ ] Volltext für die Suche (more!rubin liefert ihn bereits in `mainFile.text`)
- [ ] Benachrichtigungen für das Themen-Abo
- [x] Alle 2 300 Gemeinden, VGs und Kreise in der Suche; 30 Systeme mit Daten
- [x] Scraper für SessionNet (Kaiserslautern) über Weiterleiter in Frankfurt
- [ ] Weitere Anbieter mit OParl (ALLRIS, SessionNet, Somacos)
