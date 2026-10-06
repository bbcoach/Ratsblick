import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dateiDatum, gremienSeiten, parseGremium } from '../src/scrape/ionas.js';

const lies = (n: string) => readFileSync(new URL(`./fixtures/ionas/${n}`, import.meta.url), 'utf8');
const UEBER = 'https://www.budenheim.de/verwaltung/rathaus/sitzungsunterlagen-ab-01-01-2023/';

describe('IONAS-Website (Gemeinde Budenheim)', () => {
  it('findet die Gremienseiten unterhalb der Übersicht', () => {
    const s = gremienSeiten(lies('budenheim-uebersicht.html'), UEBER);
    expect(s).toContain(`${UEBER}gemeinderat/`);
    expect(s).toContain(`${UEBER}hauptausschuss/`);
    expect(s.length).toBe(11);
    expect(s.some((u) => /%7B|\{/i.test(u))).toBe(false);
    expect(s.every((u) => u.startsWith(UEBER) && !u.slice(UEBER.length).replace(/\/$/, '').includes('/'))).toBe(true);
  });

  it('liest Datum aus Dateiname oder Linktext', () => {
    expect(dateiDatum('https://x.de/a/gr-20260826-einladung.pdf?cid=1', '')).toBe('2026-08-26');
    expect(dateiDatum('https://x.de/a/GR_20260617_T1.pdf', '')).toBe('2026-06-17');
    expect(dateiDatum('https://x.de/a/einladung.pdf', 'Microsoft Word - Einladung 2024-09-11 GR Presse')).toBe('2024-09-11');
    expect(dateiDatum('https://x.de/a/GR_2023022 - Einladung.pdf', '')).toBeNull(); // Tippfehler im Dateinamen: nicht raten
  });

  it('liest die Gemeinderatsseite: Gremium, Abschnitte, Daten', () => {
    const g = parseGremium(lies('budenheim-gemeinderat.html'), `${UEBER}gemeinderat/`);
    expect(g.name).toBe('Gemeinderat');
    const einl = g.dateien.filter((d) => /einladung/i.test(d.abschnitt));
    expect(einl.length).toBeGreaterThan(15);
    expect(einl[0]!.datum).toBe('2026-08-26');
    expect(einl[0]!.url).toMatch(/^https:\/\/www\.budenheim\.de\/.*\.pdf/);
    expect(g.dateien.some((d) => /vorlage/i.test(d.abschnitt))).toBe(true);
    expect(g.dateien.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.datum))).toBe(true);
  });
});
