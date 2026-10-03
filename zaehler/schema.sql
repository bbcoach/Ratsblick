-- Ein Zähler je Tag und Seitenart; sonst wird nichts gespeichert.
CREATE TABLE IF NOT EXISTS zaehler (
  tag  TEXT NOT NULL,        -- JJJJ-MM-TT (Europe/Berlin)
  pfad TEXT NOT NULL,        -- Seitenart, z. B. /g/07134005/vg
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tag, pfad)
);
