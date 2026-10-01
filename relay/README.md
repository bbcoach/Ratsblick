# Ratsblick – Weiterleiter (Vercel, Frankfurt)

Manche Ratsinformationssysteme (z. B. Kaiserslautern) sind nur aus Europa erreichbar. GitHub Actions läuft
in den USA. Diese kleine Funktion läuft bei Vercel in Frankfurt und ruft für den Abgleich einzelne Seiten ab.

- Nur `GET`, nur Hosts aus `RELAY_HOSTS`, nur mit Schlüssel (`Authorization: Bearer …`).
- Folgt keinen Weiterleitungen; der Abgleich drosselt weiterhin auf 1 Anfrage/Sekunde je Server.

## Einrichten (einmalig)

1. https://vercel.com → „Continue with GitHub“.
2. „Add New… → Project“ → Repository `bbcoach/Ratsblick` importieren.
3. Vor dem Deploy: **Root Directory** = `relay`, Framework Preset = „Other“.
   Environment Variables: `RELAY_SCHLUESSEL` (langer Zufallswert), `RELAY_HOSTS` = `ris.kaiserslautern.de`.
4. Deploy. Die Region Frankfurt (`fra1`) kommt aus `vercel.json`.
5. GitHub → Settings → Secrets and variables → Actions:
   Secret `RATSBLICK_RELAY_SCHLUESSEL` (derselbe Wert), Variable `RATSBLICK_RELAY_URL` (z. B. `https://ratsblick-relay.vercel.app`).

Weitere Hosts: in Vercel `RELAY_HOSTS` und im Abgleich `RATSBLICK_RELAY_HOSTS` ergänzen (kommagetrennt).

## Prüfen

```bash
curl -H "Authorization: Bearer $SCHLUESSEL" "https://<projekt>.vercel.app/api/abruf?url=https%3A%2F%2Fris.kaiserslautern.de%2Fbuergerinfo%2Finfo.asp"
```
