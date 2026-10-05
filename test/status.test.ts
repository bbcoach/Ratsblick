import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.js';
import { baueStatus, schreibeLog, warnungenMarkdown } from '../src/status/status.js';
import { dashboardHtml, entschluessele, huelle, verschluessele } from '../src/status/admin.js';

function db() {
  const d = openDb(':memory:');
  d.exec(`INSERT INTO source (id, name, ebene, landkreis, system_url, status) VALUES ('a', 'Quelle A', 'VG', 'X', 'https://a', 'aktiv'), ('b', 'Quelle B', 'VG', 'X', 'https://b', 'aktiv')`);
  d.exec(`INSERT INTO body (id, source_id, name, raw) VALUES ('ba', 'a', 'A', '{}'), ('bb', 'b', 'B', '{}')`);
  return d;
}
const sitzungen = (d: ReturnType<typeof db>, body: string, n: number, start = '2026-12-01T10:00:00+01:00') => {
  for (let i = 0; i < n; i++) d.prepare('INSERT INTO meeting (id, body_id, name, start, raw) VALUES (?, ?, ?, ?, ?)').run(`${body}-${i}-${Math.random()}`, body, 'S', start, '{}');
};

describe('Quellenstatus', () => {
  it('meldet Fehler, leere und veraltete Quellen, lässt gesunde in Ruhe', () => {
    const d = db();
    sitzungen(d, 'ba', 10);
    schreibeLog(d, 'a', { ok: true, dauerS: 5 }, new Date('2026-10-03T10:00:00Z'));
    schreibeLog(d, 'b', { ok: false, fehler: 'HTTP 503', dauerS: 1 }, new Date('2026-10-03T10:00:00Z'));
    const st = baueStatus(d, [{ id: 'a', name: 'Quelle A' }, { id: 'b', name: 'Quelle B' }], new Date('2026-10-03T12:00:00Z'));
    expect(st.quellen[0]!.ampel).toBe('ok');
    expect(st.quellen[1]!.ampel).toBe('fehler');
    expect(st.warnungen.map((w) => `${w.id}:${w.art}`)).toEqual(['b:fehler']);
    const spaeter = baueStatus(d, [{ id: 'a', name: 'Quelle A' }], new Date('2026-10-06T10:00:00Z'));
    expect(spaeter.warnungen[0]).toMatchObject({ id: 'a', art: 'veraltet' });
  });
  it('erkennt Einbrüche und rechnet Veränderungen gegenüber dem vorigen Abgleich', () => {
    const d = db();
    sitzungen(d, 'ba', 20);
    schreibeLog(d, 'a', { ok: true, dauerS: 1 }, new Date('2026-10-03T04:00:00Z'));
    d.exec("DELETE FROM meeting WHERE rowid IN (SELECT rowid FROM meeting WHERE body_id = 'ba' LIMIT 12)");
    schreibeLog(d, 'a', { ok: true, dauerS: 1 }, new Date('2026-10-03T10:00:00Z'));
    const st = baueStatus(d, [{ id: 'a', name: 'Quelle A' }], new Date('2026-10-03T11:00:00Z'));
    expect(st.quellen[0]!.delta).toEqual({ sitzungen: -12, vorlagen: 0 });
    expect(st.warnungen[0]).toMatchObject({ art: 'einbruch' });
    expect(warnungenMarkdown(st)).toContain('kennung:a:einbruch');
  });
  it('liefert keinen Text, wenn alles in Ordnung ist', () => {
    const d = db();
    sitzungen(d, 'ba', 3);
    schreibeLog(d, 'a', { ok: true, dauerS: 1 }, new Date('2026-10-03T10:00:00Z'));
    expect(warnungenMarkdown(baueStatus(d, [{ id: 'a', name: 'Quelle A' }], new Date('2026-10-03T11:00:00Z')))).toBe('');
  });
});

describe('Admin-Seite', () => {
  it('verschlüsselt und entschlüsselt nur mit dem richtigen Passwort', async () => {
    const c = await verschluessele('<p>geheim</p>', 'ein sehr langes passwort für den test', 1000);
    expect(await entschluessele(c, 'ein sehr langes passwort für den test')).toBe('<p>geheim</p>');
    await expect(entschluessele(c, 'falsch')).rejects.toThrow();
    expect(JSON.stringify(c)).not.toContain('geheim');
  });
  it('die öffentliche Hülle enthält keine Klartextdaten', async () => {
    const d = db();
    sitzungen(d, 'ba', 2);
    schreibeLog(d, 'a', { ok: false, fehler: 'Geheimer Fehlertext', dauerS: 1 });
    const html = dashboardHtml(baueStatus(d, [{ id: 'a', name: 'Quelle A' }]));
    expect(html).toContain('Geheimer Fehlertext');
    const seite = huelle(await verschluessele(html, 'ein sehr langes passwort für den test', 1000));
    expect(seite).not.toContain('Geheimer Fehlertext');
    expect(seite).not.toContain('Quelle A');
    expect(seite).toContain('noindex');
  });
});

describe('Zugriffe (eigener Zähler)', () => {
  it('liest die Auswertung und rechnet 7/30 Tage nach Berliner Datum', async () => {
    const { holeZugriffe } = await import('../src/status/zugriffe.js');
    const aufrufe: string[] = [];
    const f = (async (url: string, init: { headers: Record<string, string> }) => {
      aufrufe.push(url);
      expect(init.headers.authorization).toBe('Bearer ' + (await import('node:crypto')).createHash('sha256').update('geheim').digest('hex'));
      return { ok: true, status: 200, json: async () => ({ tage: [{ tag: '2026-10-03', n: 12 }, { tag: '2026-10-02', n: 6 }, { tag: '2026-09-20', n: 5 }], seiten: [{ pfad: '/g/07134005/vg', n: 9 }] }) };
    }) as unknown as typeof fetch;
    const z = await holeZugriffe({ url: 'https://z.example.workers.dev/', token: 'geheim' }, new Date('2026-10-03T15:00:00Z'), f);
    expect(aufrufe[0]).toBe('https://z.example.workers.dev/lesen?tage=30');
    expect(z.heute).toBe(12);
    expect(z.sieben).toBe(18);
    expect(z.dreissig).toBe(23);
    expect(z.tage).toHaveLength(30);
    expect(z.seiten).toEqual([{ pfad: '/g/07134005/vg', aufrufe: 9 }]);
    expect(z.arten).toEqual([{ name: 'Kommunenseite', aufrufe: 9 }]);
    expect(z.kommunen).toEqual([{ name: 'Gebiet 07134005', aufrufe: 9 }]);
  });
  it('meldet HTTP-Fehler verständlich', async () => {
    const { holeZugriffe } = await import('../src/status/zugriffe.js');
    const f = (async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(holeZugriffe({ url: 'https://z.example', token: 'falsch' }, new Date(), f)).rejects.toThrow('HTTP 401');
  });
  it('das Dashboard zeigt Zugriffe oder den Fehler', async () => {
    const d = db();
    const st = baueStatus(d, [{ id: 'a', name: 'Quelle A' }]);
    expect(dashboardHtml(st, { fehler: 'Zähler: HTTP 401' })).toContain('HTTP 401');
    expect(dashboardHtml(st, null)).toContain('"zd"');
  });
});

describe('Zugriffe: Klarnamen', () => {
  it('fasst Seitenarten und Kommunen (alle Ebenen) zusammen', async () => {
    const { holeZugriffe, gebietNamen } = await import('../src/status/zugriffe.js');
    const namen = gebietNamen();
    expect(namen.get('07335004')).toBe('Enkenbach-Alsenborn');
    const f = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        tage: [],
        seiten: [
          { pfad: '/', n: 10 },
          { pfad: '/g/07335004', n: 5 },
          { pfad: '/g/07335004/vg', n: 3 },
          { pfad: '/s', n: 2 },
        ],
      }),
    })) as unknown as typeof fetch;
    const z = await holeZugriffe({ url: 'https://z.example', token: 'x' }, new Date('2026-10-05T10:00:00Z'), f, namen);
    expect(z.arten).toEqual([
      { name: 'Startseite (Suche)', aufrufe: 10 },
      { name: 'Kommunenseite', aufrufe: 8 },
      { name: 'Sitzung (Einzelansicht)', aufrufe: 2 },
    ]);
    expect(z.kommunen).toEqual([{ name: 'Enkenbach-Alsenborn', aufrufe: 8 }]);
  });
});

describe('Quellenstatus: stille Veränderungen', () => {
  const tops = (d: ReturnType<typeof db>, body: string, n: number, mitTops: number, mitDok: number, start: string) => {
    for (let i = 0; i < n; i++) {
      const id = `${body}-${start}-${i}`;
      d.prepare('INSERT INTO meeting (id, body_id, name, start, raw) VALUES (?, ?, ?, ?, ?)').run(id, body, 'S', start, '{}');
      if (i < mitTops) d.prepare("INSERT INTO agenda_item (id, meeting_id, raw) VALUES (?, ?, '{}')").run(`ai-${id}`, id);
      if (i < mitDok) d.prepare("INSERT INTO file (id, body_id, raw) VALUES (?, ?, '{}')").run(`f-${id}`, body) && d.prepare("INSERT INTO file_link (file_id, owner_type, owner_id, role) VALUES (?, 'meeting', ?, 'invitation')").run(`f-${id}`, id);
    }
  };
  it('warnt, wenn der Anteil der Sitzungen mit Tagesordnung stark fällt', () => {
    const d = db();
    tops(d, 'ba', 10, 9, 0, '2026-09-20T10:00:00+02:00');
    for (const h of [1, 2, 3]) schreibeLog(d, 'a', { ok: true, dauerS: 5 }, new Date(`2026-10-0${h}T10:00:00Z`));
    expect(baueStatus(d, [{ id: 'a', name: 'A' }], new Date('2026-10-03T12:00:00Z')).warnungen).toEqual([]);
    d.exec("DELETE FROM agenda_item");
    schreibeLog(d, 'a', { ok: true, dauerS: 5 }, new Date('2026-10-04T10:00:00Z'));
    const st = baueStatus(d, [{ id: 'a', name: 'A' }], new Date('2026-10-04T12:00:00Z'));
    expect(st.warnungen[0]).toMatchObject({ id: 'a', art: 'inhalt' });
    expect(st.warnungen[0]!.text).toContain('Tagesordnungen');
    expect(st.quellen[0]!.anteilTops).toBe(0);
  });
  it('warnt nicht, wenn Quellen nie Tagesordnungen hatten (nur Termine)', () => {
    const d = db();
    tops(d, 'ba', 10, 0, 0, '2026-09-20T10:00:00+02:00');
    for (const h of [1, 2, 3, 4]) schreibeLog(d, 'a', { ok: true, dauerS: 5 }, new Date(`2026-10-0${h}T10:00:00Z`));
    expect(baueStatus(d, [{ id: 'a', name: 'A' }], new Date('2026-10-04T12:00:00Z')).warnungen).toEqual([]);
  });
  it('meldet Umleitungen und Versionswechsel', () => {
    const d = db();
    sitzungen(d, 'ba', 6);
    schreibeLog(d, 'a', { ok: true, dauerS: 5, version: 'SessionNet 5.5.1' }, new Date('2026-10-03T10:00:00Z'));
    schreibeLog(d, 'a', { ok: true, dauerS: 5, version: 'SessionNet 5.6.0', umleitung: 'https://neu.example/bi' }, new Date('2026-10-04T10:00:00Z'));
    const st = baueStatus(d, [{ id: 'a', name: 'A' }], new Date('2026-10-04T12:00:00Z'));
    expect(st.warnungen.map((w) => w.art).sort()).toEqual(['adresse', 'version']);
    expect(st.quellen[0]).toMatchObject({ version: 'SessionNet 5.6.0', umleitung: 'https://neu.example/bi' });
  });
});

