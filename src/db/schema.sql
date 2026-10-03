-- Ratsblick: Datenmodell. Nah am OParl-Standard, damit weitere Quellen (Scraper) dasselbe Ziel befüllen.
-- IDs sind die OParl-URLs der Objekte; sie sind weltweit eindeutig.
-- Jede Tabelle führt das Originalobjekt in `raw` mit, damit kein Feld verloren geht.

CREATE TABLE IF NOT EXISTS source (
  id                TEXT PRIMARY KEY,           -- z. B. vg-montabaur
  name              TEXT NOT NULL,
  ebene             TEXT,
  landkreis         TEXT,
  system_url        TEXT NOT NULL,
  status            TEXT,                       -- aktiv | inaktiv | liste | ...
  vendor            TEXT,
  oparl_version     TEXT,
  last_probe_at     TEXT,
  last_probe_result TEXT,
  last_sync_at      TEXT
);

-- Körperschaft (Gemeinde, Verbandsgemeinde, Kreis). Ein System kann mehrere enthalten,
-- z. B. eine Verbandsgemeinde samt ihrer Ortsgemeinden.
CREATE TABLE IF NOT EXISTS body (
  id         TEXT PRIMARY KEY,
  source_id  TEXT NOT NULL REFERENCES source(id),
  name       TEXT,
  short_name TEXT,
  ags        TEXT,                              -- Amtlicher Gemeindeschlüssel, falls geliefert
  website    TEXT,
  modified   TEXT,
  raw        TEXT NOT NULL
);

-- Gremium (Rat, Ausschuss, Fraktion …)
CREATE TABLE IF NOT EXISTS organization (
  id                TEXT PRIMARY KEY,
  body_id           TEXT NOT NULL REFERENCES body(id),
  name              TEXT,
  short_name        TEXT,
  organization_type TEXT,
  classification    TEXT,
  start_date        TEXT,
  end_date          TEXT,
  deleted           INTEGER NOT NULL DEFAULT 0,
  modified          TEXT,
  raw               TEXT NOT NULL
);

-- Sitzung
CREATE TABLE IF NOT EXISTS meeting (
  id        TEXT PRIMARY KEY,
  body_id   TEXT NOT NULL REFERENCES body(id),
  name      TEXT,
  state     TEXT,
  cancelled INTEGER NOT NULL DEFAULT 0,
  start     TEXT,
  end       TEXT,
  location  TEXT,
  deleted   INTEGER NOT NULL DEFAULT 0,
  modified  TEXT,
  raw       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS meeting_body_start ON meeting(body_id, start);

CREATE TABLE IF NOT EXISTS meeting_organization (
  meeting_id      TEXT NOT NULL REFERENCES meeting(id),
  organization_id TEXT NOT NULL,
  PRIMARY KEY (meeting_id, organization_id)
);

-- Tagesordnungspunkt (in OParl in die Sitzung eingebettet)
CREATE TABLE IF NOT EXISTS agenda_item (
  id              TEXT PRIMARY KEY,
  meeting_id      TEXT NOT NULL REFERENCES meeting(id),
  number          TEXT,
  ord             INTEGER,
  name            TEXT,
  public          INTEGER,
  result          TEXT,
  resolution_text TEXT,
  consultation_id TEXT,
  raw             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agenda_item_meeting ON agenda_item(meeting_id, ord);

-- Vorlage / Drucksache
CREATE TABLE IF NOT EXISTS paper (
  id           TEXT PRIMARY KEY,
  body_id      TEXT NOT NULL REFERENCES body(id),
  name         TEXT,
  reference    TEXT,                            -- Vorlagennummer
  date         TEXT,
  paper_type   TEXT,
  main_file_id TEXT,
  deleted      INTEGER NOT NULL DEFAULT 0,
  modified     TEXT,
  raw          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS paper_body_date ON paper(body_id, date);

-- Beratungsfolge einer Vorlage (in OParl in die Vorlage eingebettet)
CREATE TABLE IF NOT EXISTS consultation (
  id              TEXT PRIMARY KEY,
  paper_id        TEXT NOT NULL REFERENCES paper(id),
  meeting_id      TEXT,
  agenda_item_id  TEXT,
  organization_id TEXT,
  authoritative   INTEGER,
  role            TEXT,
  raw             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS consultation_paper ON consultation(paper_id);

-- Datei (PDF o. Ä.). Volltext folgt in einem späteren Schritt.
CREATE TABLE IF NOT EXISTS file (
  id             TEXT PRIMARY KEY,
  body_id        TEXT NOT NULL REFERENCES body(id),
  name           TEXT,
  file_name      TEXT,
  mime_type      TEXT,
  date           TEXT,
  size           INTEGER,
  access_url     TEXT,
  download_url   TEXT,
  text_extracted TEXT,
  modified       TEXT,
  raw            TEXT NOT NULL
);

-- Welche Datei gehört wozu (Hauptdokument, Anlage, Einladung, Protokoll)
CREATE TABLE IF NOT EXISTS file_link (
  file_id    TEXT NOT NULL,
  owner_type TEXT NOT NULL,                     -- paper | meeting
  owner_id   TEXT NOT NULL,
  role       TEXT NOT NULL,                     -- main | auxiliary | invitation | resultsProtocol | verbatimProtocol
  PRIMARY KEY (file_id, owner_type, owner_id, role)
);
CREATE INDEX IF NOT EXISTS file_link_owner ON file_link(owner_type, owner_id);

-- Stand des inkrementellen Abgleichs je Körperschaft und Liste
CREATE TABLE IF NOT EXISTS sync_state (
  body_id        TEXT NOT NULL,
  list           TEXT NOT NULL,                 -- organization | meeting | paper
  modified_since TEXT NOT NULL,
  PRIMARY KEY (body_id, list)
);

-- Protokoll jedes Abgleichs je Quelle (für Status-Dashboard und Warnungen)
CREATE TABLE IF NOT EXISTS sync_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id  TEXT NOT NULL,
  at         TEXT NOT NULL,
  ok         INTEGER NOT NULL,
  error      TEXT,
  dauer_s    INTEGER,
  sitzungen  INTEGER,                              -- Stand nach dem Abgleich
  kuenftig   INTEGER,
  vorlagen   INTEGER
);
CREATE INDEX IF NOT EXISTS sync_log_quelle ON sync_log (source_id, id);
