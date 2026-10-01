import { describe, expect, it } from 'vitest';
import { relayConfigAusUmgebung, relayFetch } from '../src/net/relay.js';

type Abruf = (req: Request, env: Record<string, string>, f: typeof fetch) => Promise<Response>;
const pfad: string = '../relay/api/abruf.js';
const { abruf } = (await import(pfad)) as { abruf: Abruf };

const SCHLUESSEL = 'x'.repeat(32);
const env = { RELAY_SCHLUESSEL: SCHLUESSEL, RELAY_HOSTS: 'ris.kaiserslautern.de' };
const anfrage = (ziel: string, auth = `Bearer ${SCHLUESSEL}`) =>
  new Request(`https://relay.example/api/abruf?url=${encodeURIComponent(ziel)}`, { headers: { authorization: auth } });

describe('Weiterleiter (relay/api/abruf.js)', () => {
  const ziel = 'https://ris.kaiserslautern.de/buergerinfo/si0040.asp';
  const ok: typeof fetch = async () => new Response('<html>Kalender</html>', { headers: { 'content-type': 'text/html' } });

  it('leitet freigegebene Hosts mit Schlüssel weiter', async () => {
    let gesehen: { url: string; ua: string | null } | undefined;
    const f: typeof fetch = async (u, i) => {
      gesehen = { url: String(u), ua: new Headers(i?.headers).get('User-Agent') };
      return ok(u, i);
    };
    const r = await abruf(anfrage(ziel), env, f);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('<html>Kalender</html>');
    expect(gesehen?.url).toBe(ziel);
    expect(gesehen?.ua).toMatch(/^Ratsblick/);
  });

  it('lehnt falschen Schlüssel ab', async () => {
    expect((await abruf(anfrage(ziel, 'Bearer falsch'), env, ok)).status).toBe(401);
    expect((await abruf(anfrage(ziel, ''), env, ok)).status).toBe(401);
  });

  it('lehnt fremde Hosts ab (kein offener Proxy)', async () => {
    expect((await abruf(anfrage('https://example.com/'), env, ok)).status).toBe(403);
    expect((await abruf(anfrage('https://ris.kaiserslautern.de.evil.example/'), env, ok)).status).toBe(403);
    expect((await abruf(anfrage('file:///etc/passwd'), env, ok)).status).toBe(403);
  });

  it('verweigert den Dienst ohne konfigurierten Schlüssel', async () => {
    expect((await abruf(anfrage(ziel), { RELAY_HOSTS: 'ris.kaiserslautern.de' }, ok)).status).toBe(500);
  });
});

describe('relayFetch', () => {
  it('schickt nur freigegebene Hosts über den Weiterleiter', async () => {
    const aufrufe: Array<{ url: string; auth: string | null }> = [];
    const base = async (url: string, init?: RequestInit) => {
      aufrufe.push({ url, auth: new Headers(init?.headers).get('Authorization') });
      return new Response('ok');
    };
    const cfg = relayConfigAusUmgebung({
      RATSBLICK_RELAY_URL: 'https://relay.example/',
      RATSBLICK_RELAY_SCHLUESSEL: SCHLUESSEL,
    })!;
    const f = relayFetch(cfg, base);
    await f('https://ris.kaiserslautern.de/buergerinfo/info.asp');
    await f('https://montabaur.gremien.info/oparl/system');
    expect(aufrufe[0]).toEqual({
      url: 'https://relay.example/api/abruf?url=' + encodeURIComponent('https://ris.kaiserslautern.de/buergerinfo/info.asp'),
      auth: `Bearer ${SCHLUESSEL}`,
    });
    expect(aufrufe[1]).toEqual({ url: 'https://montabaur.gremien.info/oparl/system', auth: null });
  });

  it('ergänzt https:// bei einer Adresse ohne Schema', () => {
    const cfg = relayConfigAusUmgebung({ RATSBLICK_RELAY_URL: 'ratsblick-relay.vercel.app ', RATSBLICK_RELAY_SCHLUESSEL: SCHLUESSEL });
    expect(cfg?.url).toBe('https://ratsblick-relay.vercel.app');
  });

  it('geht ohne Konfiguration direkt', () => {
    expect(relayConfigAusUmgebung({})).toBeNull();
  });
});
