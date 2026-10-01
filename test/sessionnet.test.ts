import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.js';
import { OParlClient } from '../src/oparl/client.js';
import { berlinIso, parseKalender, parseSitzung, parseVorlage, syncSessionNet, text } from '../src/scrape/sessionnet.js';

const seite = (f: string) => readFileSync(new URL(`./fixtures/sessionnet/${f}`, import.meta.url), 'utf8');
const BASE = 'https://ris.kaiserslautern.de/buergerinfo/';

describe('SessionNet: Seiten lesen (echte Seiten aus Kaiserslautern)', () => {
  it('liest den Sitzungskalender inkl. mehrerer Sitzungen am selben Tag', () => {
    const k = parseKalender(seite('si0040-2026-09.html'), 2026, 9);
    expect(k.length).toBeGreaterThan(10);
    const hufa = k.find((e) => e.ksinr === '2331')!;
    expect(hufa).toMatchObject({ datum: '2026-09-08', beginn: '09:30', gremium: 'Haupt- und Finanzausschuss', verlinkt: true });
    expect(k.find((e) => e.gremium === 'Personalausschuss')?.datum).toBe('2026-09-08');
    expect(k.find((e) => e.gremium === 'Jugendhilfeausschuss')).toMatchObject({ beginn: '15:00', ende: '17:18' });
  });

  it('nimmt angekündigte Sitzungen ohne Tagesordnung über den Kalendertermin auf', () => {
    const k = parseKalender(seite('si0040-2026-10.html'), 2026, 10);
    expect(k[0]).toMatchObject({ ksinr: '2421', datum: '2026-10-02', gremium: 'Arbeitskreis Haushalt', verlinkt: false });
  });

  it('liest Tagesordnung, Vorlagen und Dokumente einer Sitzung', () => {
    const s = parseSitzung(seite('si0057-2331.html'));
    expect(s).toMatchObject({ gremium: 'Haupt- und Finanzausschuss', datum: '08.09.2026', zeit: '09:30' });
    expect(s.dokumente).toEqual([{ id: '128711', name: 'Öffentliche Bekanntmachung', kuerzel: 'B' }]);
    expect(s.tops).toHaveLength(7);
    expect(s.tops[0]).toMatchObject({ nr: 'Ö 1', oeffentlich: true, vorlage: null });
    expect(s.tops[3]).toMatchObject({ betreff: 'Beschlussempfehlung zum Entwurf des Stellenplanes 2027', vorlage: { kvonr: '19902', nr: '0463/2026' } });
  });

  it('liest eine Vorlage', () => {
    const v = parseVorlage(seite('vo0050-19902.html'));
    expect(v).toMatchObject({ nr: '0463/2026', art: 'Beschlussvorlage', betreff: 'Beschlussempfehlung zum Entwurf des Stellenplanes 2027' });
    expect(v.dokumente.map((d) => d.kuerzel)).toEqual(['VO', null, null]);
  });

  it('wandelt Text und Zeiten korrekt', () => {
    expect(text('Gro&#223;er <b>Ratssaal</b>&nbsp;&amp; Foyer')).toBe('Großer Ratssaal & Foyer');
    expect(berlinIso('08.09.2026', '09:30')).toBe('2026-09-08T09:30:00+02:00');
    expect(berlinIso('2026-12-10', '18:00')).toBe('2026-12-10T18:00:00+01:00');
  });
});

describe('SessionNet: Abgleich', () => {
  it('schreibt Sitzungen, TOPs, Vorlagen mit Beratungsfolge und Dokumente ins Datenmodell', async () => {
    const leer = '<html><table id="smc_page_si0040_contenttable1"></table></html>';
    const routen = (url: string) => {
      if (url.includes('si0040.asp')) return url.includes('__cmonat=9&') ? seite('si0040-2026-09.html') : leer;
      if (url.endsWith('si0057.asp?__ksinr=2331')) return seite('si0057-2331.html');
      if (url.includes('si0057.asp')) return '<html></html>';
      if (url.includes('vo0050.asp?__kvonr=19902')) return seite('vo0050-19902.html');
      if (url.includes('vo0050.asp')) return '<html><div class="smc-table-cell vobetr">X</div><div class="smc-table-cell voname">1/2026</div></html>';
      return null;
    };
    const fetchImpl = async (url: string) => {
      const body = routen(url);
      return body === null ? new Response('', { status: 404 }) : new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    };
    const client = new OParlClient({ fetchImpl, minIntervalMs: 0, sleep: async () => {} });
    const db = openDb(':memory:');
    const src = { id: 'stadt-kaiserslautern', name: 'Stadt Kaiserslautern', url: BASE, typ: 'sessionnet' as const };
    const st = await syncSessionNet(db, client, src, { now: new Date('2026-10-01T10:00:00Z'), monateZurueck: 1, monateVoraus: 0 });

    expect(st.meetings).toBeGreaterThan(10);
    const m = db.prepare('SELECT name, start, state FROM meeting WHERE id = ?').get(`${BASE}si0057.asp?__ksinr=2331`);
    expect(m).toEqual({ name: 'Haupt- und Finanzausschuss', start: '2026-09-08T09:30:00+02:00', state: 'durchgeführt' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM agenda_item WHERE meeting_id = ?').get(`${BASE}si0057.asp?__ksinr=2331`)).toEqual({ n: 7 });

    const p = db.prepare('SELECT reference, date, paper_type FROM paper WHERE id = ?').get(`${BASE}vo0050.asp?__kvonr=19902`);
    expect(p).toEqual({ reference: '0463/2026', date: '2026-09-08', paper_type: 'Beschlussvorlage' });
    // Beratung verknüpft Vorlage und TOP (so findet der Export die Sitzung)
    const b = db.prepare(`SELECT a.meeting_id AS m FROM consultation c JOIN agenda_item a ON a.id = c.agenda_item_id WHERE c.paper_id = ?`)
      .get(`${BASE}vo0050.asp?__kvonr=19902`);
    expect(b).toEqual({ m: `${BASE}si0057.asp?__ksinr=2331` });
    const datei = db.prepare(`SELECT access_url FROM file f JOIN file_link l ON l.file_id = f.id WHERE l.owner_id = ? AND l.role = 'main'`)
      .get(`${BASE}vo0050.asp?__kvonr=19902`);
    expect(datei).toEqual({ access_url: `${BASE}getfile.asp?id=128429&type=do` });
  });
});
