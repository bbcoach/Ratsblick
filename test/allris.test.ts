import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { kalenderAjaxPfad, parseKalender, parseSitzung, parseVorlage, orteAusGremien, ortAusGremium } from '../src/scrape/allris.js';

const seite = (f: string) => readFileSync(new URL(`./fixtures/allris/${f}`, import.meta.url), 'utf8');

describe('ALLRIS 4 (Trier)', () => {
  it('liest den Kalender aus der Ajax-Antwort, nur veröffentlichte Sitzungen', () => {
    const k = parseKalender(seite('trier-si010-2026-10.xml'));
    expect(k.length).toBeGreaterThan(5);
    expect(k[0]).toEqual({
      silfdnr: '1000686',
      name: 'Sitzung des Dezernatsausschusses III - Haushaltsberatung',
      datum: '01.10.2026',
      zeit: '17:00',
      raum: 'Rathaus, Großer Rathaussaal',
    });
    expect(k.some((e) => e.silfdnr === '1000649')).toBe(false); // ohne Link (noch nicht veröffentlicht)
  });

  it('nimmt die Ajax-Adresse aus der Seite und baut sonst eine', () => {
    expect(kalenderAjaxPfad('{"u":"./si010?2-1.0-&amp;MM=10&amp;YY=2026"}', 10, 2026)).toBe('si010?2-1.0-&MM=10&YY=2026');
    expect(kalenderAjaxPfad('', 8, 2026)).toBe('si010?0-1.0-&MM=8&YY=2026');
  });

  it('liest Kopf und Tagesordnung einer Sitzung', () => {
    const s = parseSitzung(seite('trier-to010-1000264.html'));
    expect(s).toMatchObject({ gremium: 'Stadtrat', grlfdnr: '1', datum: '21.10.2026', zeit: '17:00', status: 'Sitzung eingeladen' });
    expect(s.ort).toBe('Rathaus, Großer Rathaussaal, Am Augustinerhof 3, 54290 Trier');
    expect(s.tops[0]).toMatchObject({ tolfdnr: '1008602', nr: '1', oeffentlich: true, betreff: 'Mitteilungen des Oberbürgermeisters', vorlage: null });
    expect(s.tops.find((t) => t.nr === '2.1')?.vorlage).toEqual({ volfdnr: '1001540', nr: '469/2026' });
    expect(s.tops.some((t) => !t.oeffentlich)).toBe(true);
  });

  it('liest eine Vorlage mit Text und Dokumenten', () => {
    const v = parseVorlage(seite('trier-vo020-1001540.html'));
    expect(v).toMatchObject({ nr: '469/2026', art: 'Antrag', federfuehrung: 'Büro Oberbürgermeister - Sitzungsdienst' });
    expect(v.betreff).toMatch(/^Antrag "Resolution zur Unterstützung/);
    expect(v.dokumente.map((d) => d.name)).toEqual(['Vorlage', 'Sammeldokument']);
    expect(v.dokumente[0]!.url).toBe('wicket/resource/org.apache.wicket.Application/doc1502509.pdf');
    expect(v.text).toMatch(/^Beschlussvorschlag: Die Stadt Trier bekennt sich/);
    expect(v.text).toMatch(/Begründung: /);
    expect(v.text).not.toMatch(/Beratungsfolge/);
  });
});

describe('ALLRIS 4: Körperschaft aus dem Gremiumsnamen', () => {
  const namen = [
    'Gemeinderat der Ortsgemeinde Aull',
    'Stadtrat der Stadt Diez',
    'Haupt- und Finanzausschuss der Stadt Diez',
    'Bauausschuss der Ortsgemeinde Balduinstein',
    'Gemeinderat der Ortsgemeinde Balduinstein',
    'Haupt- und Finanzausschuss der Verbandsgemeinde Diez',
    'Verbandsgemeinderat Diez',
    'Ortsgemeinderat Wiltingen',
    'Kinder-, Jugend- und Familienausschuss Wiltingen',
    'Stadtrat Konz',
    'Ortsbeirat Konz-Könen',
    'Ortsgemeinderat Berg (Pfalz)',
    'Bauausschuss OG Berg',
    'Werks- und Bauausschuss VG Hagenbach',
    'Forstverband Lahn-Aar',
  ];
  const orte = orteAusGremien(namen);
  it('findet die Orte der Räte und erkennt Städte', () => {
    expect([...orte]).toEqual([
      ['Aull', false],
      ['Diez', true],
      ['Balduinstein', false],
      ['Wiltingen', false],
      ['Konz', true],
      ['Berg (Pfalz)', false],
    ]);
  });
  it('ordnet Ausschüsse ihrem Ort zu, VG-Gremien und Unklares der VG', () => {
    expect(namen.map((n) => ortAusGremium(n, orte))).toEqual([
      'Aull', 'Diez', 'Diez', 'Balduinstein', 'Balduinstein', null, null, 'Wiltingen', 'Wiltingen', 'Konz', 'Konz', 'Berg (Pfalz)', 'Berg (Pfalz)', null, null,
    ]);
  });
});
