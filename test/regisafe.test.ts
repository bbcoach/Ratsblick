import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gremiumAusTermin, parseGremien, parseSitzung, vorlagenNummer, type RegisafeTermin } from '../src/scrape/regisafe.js';

const seite = (f: string) => readFileSync(new URL(`./fixtures/regisafe/${f}`, import.meta.url), 'utf8');

describe('regisafe (Kirchheimbolanden)', () => {
  it('ordnet Gremien ihrer Körperschaft zu', () => {
    const g = new Map(parseGremien(seite('kirchheimbolanden-gremien.html')).map((x) => [x.name, x.ort]));
    expect(g.get('Gemeinderat Ilbesheim')).toBe('Ilbesheim');
    expect(g.get('Rechnungsprüfungsausschuss Marnheim')).toBe('Marnheim');
    expect(g.get('Stadtrat Kirchheimbolanden')).toBe('Kirchheimbolanden');
    expect(g.get('Ausschuss für Bauen und Umwelt')).toBe('Kirchheimbolanden'); // ohne Ort: Gruppe davor
    expect(g.get('Verbandsgemeinderat Kirchheimbolanden')).toBeNull();
    expect(g.get('Kitaträgerausschuss')).toBeNull();
    expect(g.get('Ortsbürgermeisterbesprechung')).toBeNull();
    expect(g.get('Ausschuss für Ortsentwicklung und Ortsgestaltung Marnheim')).toBe('Marnheim'); // „bis 01/2025“ entfernt
  });

  it('liest den Gremiumsnamen aus dem Kalender', () => {
    const k = JSON.parse(seite('kirchheimbolanden-kalender-2026-10.json')) as RegisafeTermin[];
    const t = k.find((x) => x.sitzungId === 221058)!;
    expect(t.start).toBe('2026-09-29T19:30');
    expect(gremiumAusTermin(t)).toBe('Gemeinderat Ilbesheim');
  });

  it('liest Tagesordnung, Vorlagen und Sitzungsdokumente', () => {
    const s = parseSitzung(seite('kirchheimbolanden-sitzung-221058.html'));
    expect(s.titel).toBe('Sitzung Gemeinderat Ilbesheim am 29.09.2026');
    expect(s.tops.map((t) => t.nr)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    const nummern = s.tops.flatMap((t) => t.dokumente.map(vorlagenNummer).filter(Boolean));
    expect(nummern).toContain('2026/0023');
    expect(s.dokumente.some((d) => d.typ === 'Sitzungsbekanntmachung')).toBe(true);
    const d = s.tops.flatMap((t) => t.dokumente)[0]!;
    expect(d.url).toMatch(/^https:\/\/kirchheimbolanden\.ris-portal\.de\/sitzungen\?.*_RisSitzung_resource=singleDocument&_RisSitzung_schriftgutId=\d+$/);
  });

  it('erkennt nicht öffentliche Punkte', () => {
    const s = parseSitzung(seite('kirchheimbolanden-sitzung-223573.html'));
    expect(s.tops).toMatchObject([
      { nr: '1', oeffentlich: false, betreff: 'Prüfung des Jahresabschlusses 2024' },
      { nr: '2', oeffentlich: true },
    ]);
    expect(vorlagenNummer(s.tops[1]!.dokumente[0]!)).toBe('2026/0029');
  });
});
