# Ratsblick – Datenebene

Ratsblick soll die öffentlichen Inhalte kommunaler Ratsinformationssysteme an einem Ort zugänglich machen.
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
```

Die Daten landen in `data/ratsblick.sqlite`. Ansehen lässt sich die Datei z. B. mit dem
kostenlosen „DB Browser for SQLite“.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `data/endpoints.json` | Quellen aus dem RIS-Verzeichnis RLP (Stand 01.10.2026) |
| `src/oparl/client.ts` | OParl-Client: Seitenweises Lesen, Wiederholung bei Serverfehlern, Drosselung je Server |
| `src/db/schema.sql` | Datenmodell |
| `src/sync/sync.ts` | Abgleich System → Körperschaften → Gremien, Sitzungen, Vorlagen |
| `src/sync/probe.ts` | Schnelltest einer Schnittstelle |
| `src/cli.ts` | Befehle `probe` und `sync` |
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

- Höchstens eine Anfrage pro Sekunde je Server (`--interval` ändert das).
- Nach dem ersten Vollabgleich werden nur geänderte Objekte geholt (`modified_since`).
- Der User-Agent nennt das Projekt. **Vor dem ersten echten Lauf** in `src/oparl/client.ts`
  `[KONTAKT-E-MAIL]` durch eine echte Kontaktadresse ersetzen, damit Verwaltungen sich melden können.

## Stand und nächste Schritte

- [x] OParl-Client, Datenmodell, Abgleich, Schnelltest, Tests
- [ ] Erster Lauf gegen die echten Server (siehe unten)
- [ ] Volltext aus PDFs (`file.text_extracted`)
- [ ] Programmierschnittstelle für Website und App
- [ ] Website nach den Entwürfen „Ratsblick – Kernansichten“

**Noch ungeprüft gegen echte Server:** In der Entwicklungsumgebung waren die kommunalen Server
nicht erreichbar. Beim Test der Schnittstellen von außen antworteten die System-Objekte, die
Körperschaftsliste (`/oparl/Body`) lieferte aber Fehler. Der erste `npm run probe` zeigt, ob das
dauerhaft so ist; der Status „teilweise“ steht genau für diesen Fall.
