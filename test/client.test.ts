import { describe, expect, it } from 'vitest';
import { serverKey, OParlClient, OParlHttpError, OParlServerError } from '../src/oparl/client.js';
import { fakeServer } from './fixtures.js';

const noSleep = async () => {};
const U = 'https://x.example/oparl';

describe('OParlClient', () => {
  it('folgt links.next über mehrere Seiten', async () => {
    const { fetchImpl } = fakeServer({
      [`${U}/list`]: { data: [{ id: 'a' }, { id: 'b' }], links: { next: `${U}/list?page=2` } },
      [`${U}/list?page=2`]: { data: [{ id: 'c' }], links: {} },
    });
    const client = new OParlClient({ fetchImpl, sleep: noSleep, minIntervalMs: 0 });
    const ids: string[] = [];
    for await (const x of client.paginate<{ id: string }>(`${U}/list`)) ids.push(x.id);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('bricht ab, wenn ein Server auf eine bereits gelesene Seite verweist', async () => {
    const { fetchImpl, calls } = fakeServer({
      [`${U}/list`]: { data: [{ id: 'a' }], links: { next: `${U}/list` } },
    });
    const client = new OParlClient({ fetchImpl, sleep: noSleep, minIntervalMs: 0 });
    const ids: string[] = [];
    for await (const x of client.paginate<{ id: string }>(`${U}/list`)) ids.push(x.id);
    expect(ids).toEqual(['a']);
    expect(calls).toHaveLength(1);
  });

  it('hängt modified_since an die erste Seite', async () => {
    const { fetchImpl, calls } = fakeServer({ [`${U}/list`]: { data: [], links: {} } });
    const client = new OParlClient({ fetchImpl, sleep: noSleep, minIntervalMs: 0 });
    for await (const _ of client.paginate(`${U}/list`, { modifiedSince: '2026-09-01T00:00:00Z' })) void _;
    expect(new URL(calls[0]!).searchParams.get('modified_since')).toBe('2026-09-01T00:00:00Z');
  });

  it('erkennt „OParl is not active“ auch bei HTTP 200', async () => {
    const { fetchImpl } = fakeServer({
      [`${U}/system`]: { type: 'https://schema.oparl.org/1.0/Error', message: 'OParl is not active.', debug: 'Error-Code 1' },
    });
    const client = new OParlClient({ fetchImpl, sleep: noSleep, minIntervalMs: 0 });
    await expect(client.get(`${U}/system`)).rejects.toBeInstanceOf(OParlServerError);
  });

  it('wiederholt bei 503 und hat dann Erfolg', async () => {
    let n = 0;
    const { fetchImpl } = fakeServer({
      [`${U}/system`]: () => (++n < 3 ? { status: 503, body: {} } : { body: { id: 'ok' } }),
    });
    const client = new OParlClient({ fetchImpl, sleep: noSleep, minIntervalMs: 0 });
    await expect(client.get<{ id: string }>(`${U}/system`)).resolves.toEqual({ id: 'ok' });
    expect(n).toBe(3);
  });

  it('wiederholt 404 nicht', async () => {
    const { fetchImpl, calls } = fakeServer({});
    const client = new OParlClient({ fetchImpl, sleep: noSleep, minIntervalMs: 0 });
    await expect(client.get(`${U}/missing`)).rejects.toBeInstanceOf(OParlHttpError);
    expect(calls).toHaveLength(1);
  });

  it('hält den Mindestabstand je Host ein', async () => {
    const waits: number[] = [];
    const { fetchImpl } = fakeServer({ [`${U}/a`]: { id: 'a' }, [`${U}/b`]: { id: 'b' } });
    const client = new OParlClient({ fetchImpl, minIntervalMs: 1000, sleep: async (ms) => void waits.push(ms) });
    await client.get(`${U}/a`);
    await client.get(`${U}/b`);
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThan(900);
  });

  it('drosselt Subdomains desselben Anbieters gemeinsam, auch bei parallelen Anfragen', async () => {
    const waits: number[] = [];
    const routes = {
      'https://a.gremien.info/oparl/system': { id: 'a' },
      'https://b.gremien.info/oparl/system': { id: 'b' },
      'https://c.gremien.info/oparl/system': { id: 'c' },
    };
    const { fetchImpl } = fakeServer(routes);
    const client = new OParlClient({ fetchImpl, minIntervalMs: 1000, sleep: async (ms) => void waits.push(ms) });
    await Promise.all(Object.keys(routes).map((u) => client.get(u)));
    expect(waits).toHaveLength(2);
    expect(waits[1]! - waits[0]!).toBeGreaterThan(900);
  });

  it('ermittelt den Server aus der URL', () => {
    expect(serverKey('https://montabaur.gremien.info/oparl/system')).toBe('gremien.info');
    expect(serverKey('https://oparl.stadt-pirmasens.de/oparl/system')).toBe('stadt-pirmasens.de');
  });

  it('hält einen größeren Abstand für einzelne Server ein', async () => {
    const waits: number[] = [];
    const { fetchImpl } = fakeServer({ [`${U}/a`]: { id: 'a' }, [`${U}/b`]: { id: 'b' } });
    const client = new OParlClient({ fetchImpl, minIntervalMs: 1000, sleep: async (ms) => void waits.push(ms) });
    client.setzeIntervall(`${U}/a`, 2000);
    await client.get(`${U}/a`);
    await client.get(`${U}/b`);
    expect(waits[0]).toBeGreaterThan(1900);
  });
});

describe('OParlClient: Beobachtungen', () => {
  const seite = (url: string, html: string, redirected = false) =>
    (async () => ({ ok: true, status: 200, redirected, url, headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }), arrayBuffer: async () => new TextEncoder().encode(html).buffer, text: async () => html })) as unknown as typeof fetch;
  it('erkennt die Softwareversion aus dem Seitenkopf', async () => {
    const html = '<head><meta name="author" content="Somacos GmbH &amp; Co. KG, SessionNet Version 5.5.6 KP3 bi (Layout 6)"/></head>';
    const client = new OParlClient({ fetchImpl: seite('https://sessionnet.example/mayen/bi/si0040.asp', html), sleep: noSleep, minIntervalMs: 0 });
    await client.getText('https://sessionnet.example/mayen/bi/si0040.asp');
    expect(client.beobachtung('https://sessionnet.example/mayen/bi/')).toEqual({ version: 'SessionNet 5.5.6 KP3' });
    expect(client.beobachtung('https://sessionnet.example/anderes/bi/')).toEqual({});
  });
  it('meldet Umleitungen auf anderen Host, aber nicht http→https oder Seitenumleitungen', async () => {
    const a = new OParlClient({ fetchImpl: seite('https://neu.example/bi/x', '<p>x</p>', true), sleep: noSleep, minIntervalMs: 0 });
    await a.getText('https://alt.example/bi/x');
    expect(a.beobachtung('https://alt.example/bi/')).toEqual({ umleitung: 'https://neu.example/bi/x' });
    const b = new OParlClient({ fetchImpl: seite('https://alt.example/bi/si0050', '<p>x</p>', true), sleep: noSleep, minIntervalMs: 0 });
    await b.getText('http://alt.example/bi/si0057');
    expect(b.beobachtung('http://alt.example/bi/')).toEqual({});
  });
});

