import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { koerperschaftsName, parseGremien, parseRaete, parseKalender, parseSitzung, parseVorlage } from '../src/scrape/allrisnet.js';

const seite = (f: string) => readFileSync(new URL(`./fixtures/allrisnet/${f}`, import.meta.url), 'utf8');

describe('ALLRIS.net (VG Winnweiler)', () => {
  it('liest Gremien samt Zugehörigkeit zum Rat', () => {
    const g = new Map(parseGremien(seite('winnweiler-si010_j-2026-10.html')).map((x) => [x.id, x]));
    expect(g.get('2')).toEqual({ id: '2', name: 'Ortsgemeinderat Börrstadt', rat: '2' });
    expect(g.get('23')?.rat).toBe('2'); // Rechnungsprüfungsausschuss Börrstadt
    expect(g.get('9')).toMatchObject({ name: 'Ortsbeirat Alsenbrück-Langmeil', rat: '8' }); // Ortsgemeinde Winnweiler
    expect(g.get('43')?.rat).toBe('1'); // Werkausschuss → Verbandsgemeinderat
    expect(g.has('99999999')).toBe(false);
    expect(koerperschaftsName('Ortsgemeinderat Börrstadt')).toBe('Ortsgemeinde Börrstadt');
    expect(koerperschaftsName('Verbandsgemeinderat Winnweiler')).toBe('Verbandsgemeinde Winnweiler');
  });

  it('liest den Monatskalender', () => {
    const k = parseKalender(seite('winnweiler-si010_j-2026-10.html'), 10, 2026);
    expect(k).toContainEqual({
      silfdnr: '2269',
      datum: '08.10.2026',
      zeit: '19:00',
      name: 'Sitzung des Ortsgemeinderates Börrstadt',
      raum: 'Sitzungssaal, Gemeindehalle Börrstadt',
    });
    expect(parseKalender(seite('winnweiler-si010_j-2026-08.html'), 8, 2026).length).toBeGreaterThan(5);
  });

  it('liest Kopf, Tagesordnung, Ergebnisse und Vorlagen einer Sitzung', () => {
    const s = parseSitzung(seite('winnweiler-to010-2169.html'));
    expect(s).toMatchObject({ gremiumId: '12', gremium: 'Ortsgemeinderat Sippersfeld' }); // Nummer der damaligen Wahlperiode
    const top = s.tops.find((t) => t.vorlage?.nr === '2026/946')!;
    expect(top).toMatchObject({ nr: '2', oeffentlich: true, ergebnis: 'ungeändert beschlossen', vorlage: { volfdnr: '1922' } });
    expect(top.betreff).toMatch(/^Vollzug des BauGB; Bebauungsplan "Auf der Bühne"/);
    expect(s.tops.some((t) => !t.oeffentlich)).toBe(true);
    const b = parseSitzung(seite('winnweiler-to010-2269.html'));
    expect(b.ort).toBe('Sitzungssaal, Gemeindehalle Börrstadt, Am Sportplatz 11, 67725 Börrstadt');
    expect(b.dokumente).toEqual([{ id: '135441', name: 'Bekanntmachung' }]);
    expect(b.tops[0]).toMatchObject({ nr: '1', betreff: 'Eröffnung der Sitzung', vorlage: null });
  });

  it('liest eine Vorlage mit Text', () => {
    const v = parseVorlage(seite('winnweiler-vo020-1922.html'));
    expect(v).toMatchObject({ nr: '2026/946', art: 'Beschlussvorlage' });
    expect(v.betreff).toMatch(/^Vollzug des BauGB; Bebauungsplan "Auf der Bühne" hier:/);
    expect(v.dokumente.map((d) => d.name)).toEqual(['Vorlage', 'Vorlage-Sammeldokument']);
    expect(v.text).toMatch(/^Beschlussvorschlag: Nach Abwägung/);
    expect(v.text).toMatch(/Sachverhalt: Die Gemeindevertretung/);
  });

  it('erkennt Ausschuss-Links (au020) und den Titel der Sitzung', () => {
    const s = parseSitzung(seite('winnweiler-to010-2270.html'));
    expect(s).toMatchObject({ gremium: 'Ortsbeirat Alsenbrück-Langmeil', bezeichnung: 'Sitzung des Ortsbeirates Alsenbrück-Langmeil' });
  });
});

describe('ALLRIS.net mit Kalender je Rat (VG Kirchen)', () => {
  it('liest die Räteliste aus pa000.asp', () => {
    const raete = parseRaete(readFileSync(new URL('./fixtures/allrisnet/kirchen-pa000.html', import.meta.url), 'latin1'));
    expect(raete).toHaveLength(7);
    expect(raete[0]).toEqual({ id: '1', name: 'Verbandsgemeinderat der Verbandsgemeinde Kirchen (Sieg)', rat: '1' });
    expect(raete.map((r) => koerperschaftsName(r.name))).toContain('Stadt Kirchen (Sieg)');
    expect(koerperschaftsName('Ortsgemeinderat der Ortsgemeinde Brachbach')).toBe('Ortsgemeinde Brachbach');
    expect(koerperschaftsName('Verbandsgemeinderat der Verbandsgemeinde Kirchen (Sieg)')).toBe('Verbandsgemeinde Kirchen (Sieg)');
  });
});
