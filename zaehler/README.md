# Wahlheimat-Zähler (Cloudflare Worker + D1)

Eigener, minimaler Seitenaufruf-Zähler statt eines Drittanbieter-Dienstes. Gespeichert wird je Tag und Seitenart **nur eine Zahl**
(`2026-10-03 | /g/07134005/vg | 12`). Keine IP-Adresse, kein Hash, keine Kennung, kein User-Agent, kein Verweis, keine Cookies.
Nur Aufrufe von `https://wahlheimat-rlp.de` werden gezählt, Bots verworfen, Pfade gegen eine Liste der App-Routen geprüft
(nie Suchbegriffe oder Sitzungs-/Vorlagen-IDs). Aufbewahrung 400 Tage (täglicher Cron).

- `POST /z` – Text-Body = Seitenart (die App sendet per `sendBeacon`)
- `GET /lesen?tage=30` – Auswertung, nur mit `Authorization: Bearer <SHA-256-Hex des LESE_TOKEN>` (Hash, damit Umlaute/Sonderzeichen im Token nicht an der Header-Kodierung scheitern); das Admin-Dashboard ruft das beim Bauen ab

Kostenloser Tarif reicht (D1: 100 000 geschriebene Zeilen/Tag; je Aufruf wird eine Zeile erhöht).

## Einrichten (einmalig)
1. In Cloudflare einen **eigenen** API-Token anlegen (nicht den aus dem anderen Projekt): Berechtigungen *Account · Workers Scripts · Edit*
   und *Account · D1 · Edit*, sonst nichts.
2. GitHub-Repo → Settings → Secrets and variables → Actions:
   - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ZAEHLER_LESETOKEN` (langer Zufallswert, ≥ 32 Zeichen)
   - Variablen: `ZAEHLER_AKTIV` = `ja`, danach `ZAEHLER_URL` = Adresse des Workers (steht im Lauf „Zähler veröffentlichen“,
     Form `https://wahlheimat-zaehler.<konto>.workers.dev`)
3. Workflow „Zähler veröffentlichen“ von Hand starten.
4. Zählen einschalten (erst nach rechtlicher Prüfung und Freigabe des Betreibers): in `web/app.js` `ZAEHLER` auf
   `<Worker-Adresse>/z` setzen. Dann erscheint automatisch der Datenschutz-Abschnitt 3a.
