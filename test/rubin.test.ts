import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.js';
import { OParlClient } from '../src/oparl/client.js';
import { syncRubinApi } from '../src/scrape/rubin.js';

const json = (f: string) => readFileSync(new URL(`./fixtures/rubin/${f}`, import.meta.url), 'utf8');
const BASE = 'https://rockenhausen.gremien.info/';

describe('more!rubin-Schnittstelle (echte Antworten aus Rockenhausen)', () => {
  it('schreibt Körperschaften, Sitzungen, TOPs und Vorlagen mit Beratungsfolge und PDF-Links', async () => {
    const aufrufe: string[] = [];
    const fetchImpl = async (url: string) => {
      aufrufe.push(url);
      const u = new URL(url);
      const id = u.searchParams.get('id');
      let body: string | null = null;
      if (id === 'organizations') body = json('bodies.json');
      else if (id === 'calendar') body = json('calendar-2026-09-10.json');
      else if (id === 'meetings' && u.searchParams.get('meeting_id') === '2026-VGRATNPL-61') body = json('meeting-2026-VGRATNPL-61.json');
      else if (id === 'meetings') body = JSON.stringify({ agenda_items: [], committees: [] });
      return body === null ? new Response('', { status: 404 }) : new Response(body, { headers: { 'content-type': 'application/json' } });
    };
    const client = new OParlClient({ fetchImpl, minIntervalMs: 0, sleep: async () => {} });
    const db = openDb(':memory:');
    const src = { id: 'vg-nordpfaelzer-land', name: 'VG Nordpfälzer Land', url: BASE, typ: 'rubin-api' as const };
    const st = await syncRubinApi(db, client, src, { now: new Date('2026-10-01T10:00:00Z') });

    expect(st.bodies).toBe(38);
    // Kalender wird für das ganze Fenster in einem Abruf geholt
    expect(aufrufe.filter((u) => u.includes('id=calendar'))).toHaveLength(1);

    const mid = `${BASE}meeting?id=2026-VGRATNPL-61`;
    const m = db.prepare('SELECT name, start, location, state, body_id FROM meeting WHERE id = ?').get(mid);
    expect(m).toEqual({
      name: 'Verbandsgemeinderat Nordpfälzer Land',
      start: '2026-09-21T18:30:00+02:00',
      location: 'Roter Saal der Donnersberghalle, Obermühle 1, 67806 Rockenhausen',
      state: 'durchgeführt',
      body_id: `${BASE}#koerperschaft-VGNPL`,
    });
    const tops = db.prepare('SELECT number, name, public FROM agenda_item WHERE meeting_id = ? ORDER BY ord').all(mid) as Array<{ public: number }>;
    expect(tops).toHaveLength(17);
    expect(tops.filter((t) => t.public === 0)).toHaveLength(5);

    const p = db.prepare('SELECT reference, date, paper_type, name FROM paper WHERE id = ?').get(`${BASE}submission?id=202620109100436`);
    expect(p).toMatchObject({ reference: '420/2026', date: '2026-09-01', paper_type: 'Beschlussvorlage' });
    const b = db.prepare('SELECT a.meeting_id AS m FROM consultation c JOIN agenda_item a ON a.id = c.agenda_item_id WHERE c.paper_id = ?')
      .get(`${BASE}submission?id=202620109100436`);
    expect(b).toEqual({ m: mid });
    const f = db.prepare(`SELECT f.access_url FROM file f JOIN file_link l ON l.file_id = f.id WHERE l.owner_id = ? AND l.role = 'main'`)
      .get(`${BASE}submission?id=202620109100436`) as { access_url: string };
    expect(f.access_url).toMatch(/^https:\/\/rockenhausen\.gremien\.info\/api\.php\?document_type_id=4&/);
    expect(f.access_url).not.toMatch(/json=1/);
  });
});
