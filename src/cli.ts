import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { openDb } from './db/index.js';
import { OParlClient } from './oparl/client.js';
import { probeSource, saveProbe } from './sync/probe.js';
import { syncSource, type SourceRecord } from './sync/sync.js';

const USAGE = `Ratsblick – Datenebene

  npm run probe                       alle Endpunkte prüfen
  npm run sync -- --id vg-montabaur   eine Quelle abgleichen
  npm run sync                        alle Quellen mit Status "aktiv" abgleichen

Optionen:
  --id <id>          nur diese Quelle (mehrfach möglich)
  --db <pfad>        Datenbank (Standard: data/ratsblick.sqlite)
  --full             Stand ignorieren, alles neu laden
  --max-pages <n>    höchstens n Seiten je Liste (zum Ausprobieren)
  --interval <ms>    Mindestabstand je Server (Standard: 1000)
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
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const cmd = positionals[0];
  if (values.help || !cmd || !['probe', 'sync'].includes(cmd)) {
    console.log(USAGE);
    process.exitCode = cmd && !values.help ? 1 : 0;
    return;
  }

  const client = new OParlClient({
    minIntervalMs: Number(values.interval),
    maxPages: values['max-pages'] ? Number(values['max-pages']) : undefined,
  });
  const db = openDb(values.db!);
  let sources = loadSources();
  if (values.id?.length) {
    sources = sources.filter((s) => values.id!.includes(s.id));
    if (!sources.length) throw new Error(`Keine Quelle mit id ${values.id.join(', ')} in data/endpoints.json`);
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
  for (const s of targets) {
    console.log(`\n▶ ${s.name} (${s.id})`);
    const t0 = Date.now();
    try {
      const st = await syncSource(db, client, s, { full: values.full, log: console.log });
      console.log(
        `✓ ${st.bodies} Körperschaften, ${st.organizations} Gremien, ${st.meetings} Sitzungen, ` +
          `${st.agendaItems} TOPs, ${st.papers} Vorlagen, ${st.consultations} Beratungen, ${st.files} Dateien ` +
          `in ${Math.round((Date.now() - t0) / 1000)} s`,
      );
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
