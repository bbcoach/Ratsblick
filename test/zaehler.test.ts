import { describe, expect, it } from 'vitest';
import worker, { gueltigerPfad, type Env } from '../zaehler/src/index.js';

/** Minimale D1-Attrappe: zählt je (tag, pfad). */
function fakeDb() {
  const zeilen = new Map<string, number>();
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const st = {
        bind(...a: unknown[]) { args = a; return st; },
        async run() {
          if (sql.startsWith('INSERT')) { const k = `${args[0]}|${args[1]}`; zeilen.set(k, (zeilen.get(k) ?? 0) + 1); }
          return {};
        },
        async all() {
          if (sql.includes('GROUP BY tag')) {
            const m = new Map<string, number>();
            for (const [k, n] of zeilen) { const t = k.split('|')[0]!; m.set(t, (m.get(t) ?? 0) + n); }
            return { results: [...m].map(([tag, n]) => ({ tag, n })) };
          }
          const m = new Map<string, number>();
          for (const [k, n] of zeilen) { const p = k.split('|')[1]!; m.set(p, (m.get(p) ?? 0) + n); }
          return { results: [...m].map(([pfad, n]) => ({ pfad, n })) };
        },
      };
      return st;
    },
  };
  return { db, zeilen };
}

const HERKUNFT = 'https://wahlheimat-rlp.de';
const post = (pfad: string, kopf: Record<string, string> = { origin: HERKUNFT, 'user-agent': 'Mozilla/5.0 iPhone' }) =>
  new Request('https://z.example/z', { method: 'POST', body: pfad, headers: kopf });

describe('Zähler-Worker', () => {
  it('lässt nur App-Seitenarten zu', () => {
    for (const p of ['/', '/fav', '/themen', '/g/07134005', '/g/07134005/vg', '/g/071340050/kreis']) expect(gueltigerPfad(p), p).toBe(true);
    for (const p of ['/g/abc', '/suche?q=müll', '/g/07134005/../x', '/s/ni_123', '', '/g/07134005/vg/extra']) expect(gueltigerPfad(p), p).toBe(false);
  });
  it('zählt Aufrufe von der eigenen Seite und speichert nichts außer Tag und Seitenart', async () => {
    const { db, zeilen } = fakeDb();
    const env = { DB: db, LESE_TOKEN: 'geheim' } as unknown as Env;
    expect((await worker.fetch(post('/g/07134005/vg'), env)).status).toBe(204);
    await worker.fetch(post('/g/07134005/vg'), env);
    expect([...zeilen.values()]).toEqual([2]);
    expect([...zeilen.keys()][0]).toMatch(/^\d{4}-\d{2}-\d{2}\|\/g\/07134005\/vg$/);
  });
  it('verwirft fremde Herkunft, Bots und ungültige Pfade', async () => {
    const { db, zeilen } = fakeDb();
    const env = { DB: db } as unknown as Env;
    await worker.fetch(post('/fav', { origin: 'https://evil.example', 'user-agent': 'x' }), env);
    await worker.fetch(post('/fav', { origin: HERKUNFT, 'user-agent': 'Googlebot/2.1' }), env);
    await worker.fetch(post('/g/x/y'), env);
    expect(zeilen.size).toBe(0);
  });
  it('liefert die Auswertung nur mit Token', async () => {
    const { db } = fakeDb();
    const env = { DB: db, LESE_TOKEN: 'geheim' } as unknown as Env;
    await worker.fetch(post('/themen'), env);
    expect((await worker.fetch(new Request('https://z.example/lesen'), env)).status).toBe(401);
    expect((await worker.fetch(new Request('https://z.example/lesen', { headers: { authorization: 'Bearer falsch' } }), env)).status).toBe(401);
    const ok = await worker.fetch(new Request('https://z.example/lesen?tage=7', { headers: { authorization: 'Bearer geheim' } }), env);
    expect(ok.status).toBe(200);
    const d = (await ok.json()) as { tage: Array<{ n: number }>; seiten: Array<{ pfad: string }> };
    expect(d.tage[0]!.n).toBe(1);
    expect(d.seiten[0]!.pfad).toBe('/themen');
  });
  it('ohne gesetztes Token ist die Auswertung gesperrt', async () => {
    const { db } = fakeDb();
    const r = await worker.fetch(new Request('https://z.example/lesen', { headers: { authorization: 'Bearer ' } }), { DB: db } as unknown as Env);
    expect(r.status).toBe(401);
  });
  it('ignoriert Leerzeichen und Zeilenumbruch am Token', async () => {
    const { db } = fakeDb();
    const env = { DB: db, LESE_TOKEN: 'geheim\n' } as unknown as Env;
    const r = await worker.fetch(new Request('https://z.example/lesen', { headers: { authorization: 'Bearer geheim' } }), env);
    expect(r.status).toBe(200);
  });
});
