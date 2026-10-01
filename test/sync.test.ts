import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.js';
import { OParlClient } from '../src/oparl/client.js';
import { probeSource } from '../src/sync/probe.js';
import { syncSource, type SourceRecord } from '../src/sync/sync.js';
import * as fx from './fixtures.js';

const H = fx.HOST;
const source: SourceRecord = { id: 'vg-test', name: 'VG Test', ebene: 'Verbandsgemeinde', url: `${H}/system`, status: 'aktiv' };

function routes(overrides: Record<string, unknown> = {}) {
  return {
    [`${H}/system`]: fx.system,
    [`${H}/Body`]: fx.bodies,
    [`${H}/Body/1/Organization`]: fx.organizations1,
    [`${H}/Body/1/Meeting`]: fx.meetingsPage1,
    [`${H}/Body/1/Meeting?page=2`]: fx.meetingsPage2,
    [`${H}/Body/1/Paper`]: fx.papers,
    [`${H}/Body/2/Organization`]: fx.organizations2,
    [`${H}/Body/2/Meeting`]: fx.meetings2,
    ...overrides,
  };
}

const newClient = (fetchImpl: ReturnType<typeof fx.fakeServer>['fetchImpl']) =>
  new OParlClient({ fetchImpl, minIntervalMs: 0, sleep: async () => {} });

describe('syncSource', () => {
  it('schreibt Körperschaften, Gremien, Sitzungen, TOPs, Vorlagen, Beratungen und Dateien', async () => {
    const db = openDb(':memory:');
    const { fetchImpl } = fx.fakeServer(routes());
    const stats = await syncSource(db, newClient(fetchImpl), source);

    expect(stats).toMatchObject({ bodies: 2, organizations: 3, meetings: 2, agendaItems: 2, papers: 1, consultations: 2 });

    const src = db.prepare('SELECT vendor, oparl_version FROM source WHERE id = ?').get('vg-test');
    expect(src).toEqual({ vendor: 'https://www.more-rubin.de/', oparl_version: 'https://schema.oparl.org/1.0/' });

    const m = db.prepare('SELECT name, location FROM meeting WHERE id = ?').get(`${H}/Meeting/100`);
    expect(m).toEqual({ name: 'Sitzung des Verbandsgemeinderates', location: 'Sitzungssaal Rathaus' });
    const m2 = db.prepare('SELECT location FROM meeting WHERE id = ?').get(`${H}/Meeting/101`);
    expect(m2).toEqual({ location: 'Kleiner Sitzungssaal' });

    const tops = db.prepare('SELECT number, name FROM agenda_item WHERE meeting_id = ? ORDER BY ord').all(`${H}/Meeting/100`);
    expect(tops.map((t) => t.name)).toEqual(['Mitteilungen', 'Sanierung Grundschule']);

    const beratung = db
      .prepare('SELECT role, authoritative FROM consultation WHERE paper_id = ? ORDER BY id')
      .all(`${H}/Paper/500`);
    expect(beratung).toEqual([
      { role: 'Vorberatung', authoritative: null },
      { role: 'Entscheidung', authoritative: 1 },
    ]);

    const links = db
      .prepare(`SELECT role FROM file_link WHERE owner_type = 'paper' AND owner_id = ? ORDER BY role`)
      .all(`${H}/Paper/500`);
    expect(links.map((l) => l.role)).toEqual(['auxiliary', 'main']);

    const ortsgemeinde = db.prepare('SELECT COUNT(*) AS n FROM organization WHERE body_id = ?').get(`${H}/Body/2`);
    expect(ortsgemeinde).toEqual({ n: 1 });
  });

  it('gleicht beim zweiten Lauf inkrementell ab und ersetzt geänderte Tagesordnungen', async () => {
    const db = openDb(':memory:');
    await syncSource(db, newClient(fx.fakeServer(routes()).fetchImpl), source);

    const changed = {
      data: [{ ...fx.meetingsPage1.data[0]!, agendaItem: [{ id: `${H}/AgendaItem/1001`, number: '1', order: 1, name: 'Mitteilungen' }] }],
      links: {},
    };
    const { fetchImpl, calls } = fx.fakeServer(routes({ [`${H}/Body/1/Meeting`]: changed }));
    const stats = await syncSource(db, newClient(fetchImpl), source);

    const meetingCall = calls.find((c) => c.startsWith(`${H}/Body/1/Meeting`))!;
    expect(new URL(meetingCall).searchParams.get('modified_since')).toBeTruthy();
    expect(stats.meetings).toBe(1);

    const tops = db.prepare('SELECT name FROM agenda_item WHERE meeting_id = ?').all(`${H}/Meeting/100`);
    expect(tops).toEqual([{ name: 'Mitteilungen' }]);
    // Die nicht erneut gelieferte Sitzung bleibt erhalten.
    expect(db.prepare('SELECT COUNT(*) AS n FROM meeting').get()).toEqual({ n: 2 });
  });

  it('merkt sich keinen Stand für Listen, die wegen maxPages abgeschnitten wurden', async () => {
    const db = openDb(':memory:');
    const { fetchImpl } = fx.fakeServer(routes());
    const client = new OParlClient({ fetchImpl, minIntervalMs: 0, sleep: async () => {}, maxPages: 1 });
    await syncSource(db, client, source);

    const stand = db.prepare('SELECT list FROM sync_state WHERE body_id = ? ORDER BY list').all(`${H}/Body/1`);
    // Sitzungen haben zwei Seiten und wurden abgeschnitten; Gremien und Vorlagen passen auf eine Seite.
    expect(stand.map((r) => r.list)).toEqual(['organization', 'paper']);
  });

  it('ist bei wiederholtem Vollabgleich idempotent', async () => {
    const db = openDb(':memory:');
    for (let i = 0; i < 2; i++) {
      await syncSource(db, newClient(fx.fakeServer(routes()).fetchImpl), source, { full: true });
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM agenda_item').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM consultation').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM file').get()).toEqual({ n: 3 });
  });
});

describe('probeSource', () => {
  it('meldet aktive Schnittstellen mit Version und Anzahl Körperschaften', async () => {
    const { fetchImpl } = fx.fakeServer(routes());
    const r = await probeSource(newClient(fetchImpl), source);
    expect(r).toMatchObject({ status: 'aktiv', oparlVersion: '1.0', bodies: 2 });
  });

  it('meldet nicht freigeschaltete Schnittstellen', async () => {
    const { fetchImpl } = fx.fakeServer({
      [`${H}/system`]: { type: 'https://schema.oparl.org/1.0/Error', message: 'OParl is not active.' },
    });
    const r = await probeSource(newClient(fetchImpl), source);
    expect(r.status).toBe('nicht freigeschaltet');
  });

  it('meldet „teilweise“, wenn nur das System-Objekt antwortet', async () => {
    const { fetchImpl } = fx.fakeServer({ [`${H}/system`]: fx.system, [`${H}/Body`]: () => ({ status: 500, body: {} }) });
    const r = await probeSource(newClient(fetchImpl), source);
    expect(r.status).toBe('teilweise');
  });
});
