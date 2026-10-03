import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { openDb } from './db/index.js';
import { relayConfigAusUmgebung, relayFetch } from './net/relay.js';
import { OParlClient, serverKey } from './oparl/client.js';
import { writeSnapshot } from './export/snapshot.js';
import { buildWeb } from './export/web.js';
import { kandidaten, pruefe, type Gebiete } from './sync/discover.js';
import { probeSource, saveProbe } from './sync/probe.js';
import { syncAllris } from './scrape/allris.js';
import { syncAllrisNet } from './scrape/allrisnet.js';
import { syncIcs } from './scrape/ics.js';
import { syncEdith } from './scrape/edith.js';
import { syncProtokolle } from './scrape/protokolle.js';
import { syncRegisafe } from './scrape/regisafe.js';
import { syncRubinApi } from './scrape/rubin.js';
import { syncSessionNet } from './scrape/sessionnet.js';
import { baueStatus, schreibeLog, warnungenMarkdown } from './status/status.js';
import { holeZugriffe, type Zugriffe, type ZugriffeFehler } from './status/zugriffe.js';
import { dashboardHtml, huelle, verschluessele } from './status/admin.js';
import { gespeicherteAdresse, leereQuelle, syncSource, type SourceRecord } from './sync/sync.js';

const USAGE = `Ratsblick – Datenebene

  npm run probe                       alle Endpunkte prüfen
  npm run sync -- --id vg-montabaur   eine Quelle abgleichen
  npm run sync                        alle Quellen mit Status "aktiv" abgleichen
  npm run snapshot -- --id vg-montabaur --out x.json
                                      Momentaufnahme einer Quelle als JSON (für Prototypen)
  npm run web -- --out dist           Web-App mit Daten aller Quellen bauen (GitHub Pages)
  npm run discover                    gremien.info-Systeme zu allen Kommunen im Gemeindeverzeichnis suchen
  npm run status -- --warnungen w.md  Quellenstatus ausgeben, Auffälligkeiten als Markdown (leer = alles in Ordnung)
  npm run admin -- --out dist/admin   verschlüsseltes Admin-Dashboard (Passwort in ADMIN_PASSWORT; ohne Passwort: übersprungen)

Optionen:
  --id <id>          nur diese Quelle (mehrfach möglich)
  --db <pfad>        Datenbank (Standard: data/ratsblick.sqlite)
  --full             Stand ignorieren, alles neu laden
  --max-pages <n>    höchstens n Seiten je Liste (zum Ausprobieren)
  --interval <ms>    Mindestabstand je Server (Standard: 1000)
  --budget-min <n>   sync: nach n Minuten keine weitere Quelle mehr beginnen (Rest im nächsten Lauf;
                     zuerst die am längsten nicht abgeglichenen)
  --out <pfad>       Zieldatei für snapshot bzw. Zielordner für web
`;

function loadSources(): SourceRecord[] {
  const raw = JSON.parse(readFileSync(new URL('../data/endpoints.json', import.meta.url), 'utf8')) as {
    endpoints: SourceRecord[];
  };
  return raw.endpoints;
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      id: { type: 'string', multiple: true },
      db: { type: 'string', default: 'data/ratsblick.sqlite' },
      full: { type: 'boolean', default: false },
      'max-pages': { type: 'string' },
      interval: { type: 'string', default: '1000' },
      'budget-min': { type: 'string' },
      out: { type: 'string' },
      warnungen: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const cmd = positionals[0];
  if (values.help || !cmd || !['probe', 'sync', 'snapshot', 'web', 'discover', 'status', 'admin'].includes(cmd)) {
    console.log(USAGE);
    process.exitCode = cmd && !values.help ? 1 : 0;
    return;
  }

  if (cmd === 'snapshot') {
    if (values.id?.length !== 1 || !values.out) throw new Error('snapshot braucht genau eine --id und --out <pfad>');
    const snap = writeSnapshot(openDb(values.db!), values.id[0]!, values.out);
    console.log(
      `${snap.koerperschaften.length} Körperschaften, ${snap.sitzungen.length} Sitzungen, ` +
        `${snap.vorlagen.length} Vorlagen → ${values.out}`,
    );
    return;
  }

  if (cmd === 'web') {
    const r = buildWeb(openDb(values.db!), values.out ?? 'dist');
    console.log(
      `Web-App: ${r.quellen} Quellen, ${r.gebiete} Gebietskörperschaften mit eigenen Daten, ` +
        `${r.gemeindenMitDaten} von ${r.gemeinden} Gemeinden mit Daten (selbst oder über die VG) → ${values.out ?? 'dist'}`,
    );
    return;
  }

  if (cmd === 'status' || cmd === 'admin') {
    const db = openDb(values.db!);
    const quellen = loadSources().filter((q) => q.status === 'aktiv').map((q) => ({ id: q.id, name: q.name, typ: q.typ ?? 'oparl', ebene: q.ebene ?? undefined }));
    const st = baueStatus(db, quellen);
    const z = st.zusammenfassung;
    console.log(`Quellenstatus: ${z.quellen} Quellen, ${z.ok} in Ordnung, ${z.warnung} Warnung, ${z.fehler} Fehler; ${z.sitzungen} Sitzungen, ${z.vorlagen} Vorlagen`);
    for (const w of st.warnungen) console.log(`  ! ${w.id}: ${w.text}`);
    if (cmd === 'status') {
      if (values.warnungen) writeFileSync(values.warnungen, warnungenMarkdown(st));
      return;
    }
    const passwort = process.env.ADMIN_PASSWORT;
    if (!passwort) {
      console.log('ADMIN_PASSWORT nicht gesetzt – Admin-Seite wird nicht erzeugt.');
      return;
    }
    if (passwort.length < 16) throw new Error('ADMIN_PASSWORT ist zu kurz (mindestens 16 Zeichen, besser ein langer Satz)');
    const ziel = `${values.out ?? 'dist/admin'}/index.html`;
    mkdirSync(dirname(ziel), { recursive: true });
    // Zugriffszahlen (optional): ZAEHLER_URL = Adresse des Zähler-Workers, ZAEHLER_LESETOKEN = Lese-Token
    let zugriffe: Zugriffe | ZugriffeFehler | null = null;
    if (process.env.ZAEHLER_URL && process.env.ZAEHLER_LESETOKEN) {
      try {
        console.log(`Zähler: Lese-Token mit ${process.env.ZAEHLER_LESETOKEN.trim().length} Zeichen`);
        zugriffe = await holeZugriffe({ url: process.env.ZAEHLER_URL, token: process.env.ZAEHLER_LESETOKEN.trim() });
        console.log(`Zugriffe: ${zugriffe.dreissig} Seitenaufrufe in 30 Tagen`);
      } catch (err) {
        zugriffe = { fehler: (err as Error).message };
        console.log(`Zugriffe nicht abrufbar: ${(err as Error).message}`);
      }
    }
    writeFileSync(ziel, huelle(await verschluessele(dashboardHtml(st, zugriffe), passwort)));
    console.log(`Admin-Seite (verschlüsselt) → ${ziel}`);
    return;
  }

  const client = new OParlClient({
    fetchImpl: relayFetch(relayConfigAusUmgebung()),
    minIntervalMs: Number(values.interval),
    maxPages: values['max-pages'] ? Number(values['max-pages']) : undefined,
  });
  const db = openDb(values.db!);
  let sources = loadSources();
  if (values.id?.length) {
    sources = sources.filter((s) => values.id!.includes(s.id));
    if (!sources.length) throw new Error(`Keine Quelle mit id ${values.id.join(', ')} in data/endpoints.json`);
  }

  if (cmd === 'discover') {
    const gebiete = JSON.parse(readFileSync(new URL('../data/gebiete-rlp.json', import.meta.url), 'utf8')) as Gebiete;
    const bekannt = new Set(loadSources().map((s) => s.url));
    const liste = kandidaten(gebiete, bekannt);
    console.log(`${liste.length} Kandidaten, Dauer etwa ${Math.ceil(liste.length / 60)} min`);
    for (const k of liste) {
      try {
        const f = await pruefe(client, k);
        if (f) console.log(JSON.stringify(f));
      } catch (err) {
        console.log(JSON.stringify({ ...k, fehler: (err as Error).message }));
      }
    }
    return;
  }

  if (cmd === 'probe') {
    const rows = [];
    for (const s of sources.filter((x) => !x.typ || x.typ === 'oparl')) {
      const r = await probeSource(client, s);
      saveProbe(db, s, r);
      rows.push({ id: r.id, status: r.status, version: r.oparlVersion ?? '', detail: r.detail });
      console.log(`${r.status.padEnd(20)} ${r.id}  ${r.detail}`);
    }
    console.log(`\n${rows.filter((r) => r.status === 'aktiv').length} von ${rows.length} Quellen lesbar.`);
    return;
  }

  const targets = values.id?.length ? sources : sources.filter((s) => s.status === 'aktiv');
  for (const s of targets) if (s.intervallMs) client.setzeIntervall(s.url, s.intervallMs);
  // Am längsten nicht abgeglichene Quellen zuerst
  const stand = new Map(
    (db.prepare('SELECT id, last_sync_at FROM source').all() as Array<{ id: string; last_sync_at: string | null }>).map((r) => [
      r.id,
      r.last_sync_at ?? '',
    ]),
  );
  targets.sort((a, b) => (stand.get(a.id) ?? '').localeCompare(stand.get(b.id) ?? ''));
  const start = Date.now();
  const budgetMs = values['budget-min'] ? Number(values['budget-min']) * 60_000 : Infinity;
  const verschoben: string[] = [];
  // Quellen liegen auf verschiedenen Servern; die Drosselung gilt je Server. Daher je Server nacheinander,
  // die Server untereinander parallel.
  const gruppen = new Map<string, SourceRecord[]>();
  for (const s of targets) gruppen.set(serverKey(s.url), [...(gruppen.get(serverKey(s.url)) ?? []), s]);
  await Promise.all(
    [...gruppen.values()].map(async (gruppe) => {
      for (const s of gruppe) {
        if (Date.now() - start > budgetMs) {
          verschoben.push(s.id);
          continue;
        }
        await syncEine(s);
      }
    }),
  );
  if (verschoben.length) console.log(`Zeitbudget erreicht – im nächsten Lauf: ${verschoben.join(', ')}`);

  async function syncEine(s: SourceRecord): Promise<void> {
    const log = (msg: string) => console.log(`[${s.id}] ${msg}`);
    log(`▶ ${s.name}`);
    const t0 = Date.now();
    // Quelle auf einen anderen Zugang umgestellt (neue Adresse, andere IDs): alte Daten entfernen
    const vorher = gespeicherteAdresse(db, s.id);
    if (vorher && vorher !== s.url) log(`  Adresse geändert (${vorher} → ${s.url}): ${leereQuelle(db, s.id)} Körperschaften entfernt`);
    try {
      const st =
        s.typ === 'sessionnet'
          ? await syncSessionNet(db, client, s, { log, alles: values.full })
          : s.typ === 'rubin-api'
            ? await syncRubinApi(db, client, s, { log, alles: values.full })
            : s.typ === 'allris'
              ? await syncAllris(db, client, s, { log, alles: values.full })
              : s.typ === 'allris-net'
                ? await syncAllrisNet(db, client, s, { log, alles: values.full })
              : s.typ === 'regisafe'
                ? await syncRegisafe(db, client, s, { log, alles: values.full })
                : s.typ === 'ics'
                  ? await syncIcs(db, client, s, { log })
                  : s.typ === 'edith'
                    ? await syncEdith(db, client, s, { log })
                    : s.typ === 'protokolle'
                      ? await syncProtokolle(db, client, s, { log })
                      : await syncSource(db, client, s, { full: values.full, log });
      schreibeLog(db, s.id, { ok: true, dauerS: Math.round((Date.now() - t0) / 1000) });
      log(
        `✓ ${st.bodies} Körperschaften, ${st.organizations} Gremien, ${st.meetings} Sitzungen, ` +
          `${st.agendaItems} TOPs, ${st.papers} Vorlagen, ${st.consultations} Beratungen, ${st.files} Dateien ` +
          `in ${Math.round((Date.now() - t0) / 1000)} s`,
      );
    } catch (err) {
      log(`✗ ${(err as Error).message}`);
      schreibeLog(db, s.id, { ok: false, fehler: (err as Error).message, dauerS: Math.round((Date.now() - t0) / 1000) });
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
