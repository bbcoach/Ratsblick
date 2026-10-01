import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { openDb } from './db/index.js';
import { relayConfigAusUmgebung, relayFetch } from './net/relay.js';
import { OParlClient } from './oparl/client.js';
import { writeSnapshot } from './export/snapshot.js';
import { buildWeb } from './export/web.js';
import { kandidaten, pruefe, type Gebiete } from './sync/discover.js';
import { probeSource, saveProbe } from './sync/probe.js';
import { syncSource, type SourceRecord } from './sync/sync.js';

const USAGE = `Ratsblick – Datenebene

  npm run probe                       alle Endpunkte prüfen
  npm run sync -- --id vg-montabaur   eine Quelle abgleichen
  npm run sync                        alle Quellen mit Status "aktiv" abgleichen
  npm run snapshot -- --id vg-montabaur --out x.json
                                      Momentaufnahme einer Quelle als JSON (für Prototypen)
  npm run web -- --out dist           Web-App mit Daten aller Quellen bauen (GitHub Pages)
  npm run discover                    gremien.info-Systeme zu allen Kommunen im Gemeindeverzeichnis suchen

Optionen:
  --id <id>          nur diese Quelle (mehrfach möglich)
  --db <pfad>        Datenbank (Standard: data/ratsblick.sqlite)
  --full             Stand ignorieren, alles neu laden
  --max-pages <n>    höchstens n Seiten je Liste (zum Ausprobieren)
  --interval <ms>    Mindestabstand je Server (Standard: 1000)
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
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const cmd = positionals[0];
  if (values.help || !cmd || !['probe', 'sync', 'snapshot', 'web', 'discover'].includes(cmd)) {
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
    for (const s of sources) {
      const r = await probeSource(client, s);
      saveProbe(db, s, r);
      rows.push({ id: r.id, status: r.status, version: r.oparlVersion ?? '', detail: r.detail });
      console.log(`${r.status.padEnd(20)} ${r.id}  ${r.detail}`);
    }
    console.log(`\n${rows.filter((r) => r.status === 'aktiv').length} von ${rows.length} Quellen lesbar.`);
    return;
  }

  const targets = values.id?.length ? sources : sources.filter((s) => s.status === 'aktiv');
  // Quellen liegen auf verschiedenen Servern; die Drosselung gilt je Server, daher parallel abgleichen.
  await Promise.all(
    targets.map(async (s) => {
      const log = (msg: string) => console.log(`[${s.id}] ${msg}`);
      log(`▶ ${s.name}`);
      const t0 = Date.now();
      try {
        const st = await syncSource(db, client, s, { full: values.full, log });
        log(
          `✓ ${st.bodies} Körperschaften, ${st.organizations} Gremien, ${st.meetings} Sitzungen, ` +
            `${st.agendaItems} TOPs, ${st.papers} Vorlagen, ${st.consultations} Beratungen, ${st.files} Dateien ` +
            `in ${Math.round((Date.now() - t0) / 1000)} s`,
        );
      } catch (err) {
        log(`✗ ${(err as Error).message}`);
        process.exitCode = 1;
      }
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
