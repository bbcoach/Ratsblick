import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gremiumName, parseProtokolle } from '../src/scrape/protokolle.js';

const lies = (n: string) => readFileSync(new URL(`./fixtures/protokolle/${n}`, import.meta.url), 'utf8');

describe('Protokolllisten auf Websites (Stadt Kusel)', () => {
  it('macht aus Gremienbezeichnungen die Gremiumsnamen', () => {
    expect(gremiumName('Stadtrates')).toBe('Stadtrat');
    expect(gremiumName('Haupt-, Bau und Finanzausschusses')).toBe('Haupt-, Bau und Finanzausschuss');
    expect(gremiumName('Bauausschusses')).toBe('Bauausschuss');
  });

  it('liest Datum, Gremium und PDF-Adresse aus der Stadtratsliste', () => {
    const p = parseProtokolle(lies('kusel-stadtrat.html'), 'https://stadt.kusel.de/buergerservice/stadtrat/sitzungsprotokolle-stadtratsitzungen');
    expect(p.length).toBeGreaterThanOrEqual(6);
    expect(p[0]).toEqual({
      gremium: 'Stadtrat',
      datum: '2026-04-23',
      url: 'https://stadt.kusel.de/fileadmin/Stadt/News/2026/Protokoll_23.04.2026_oeffentl.pdf',
    });
    // Tippfehler („Satdt“) und fehlende Klammer in der Quelle stören nicht; Links ohne PDF werden ignoriert
    expect(p.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.datum) && x.url.endsWith('.pdf'))).toBe(true);
  });

  it('liest die Ausschussliste', () => {
    const p = parseProtokolle(lies('kusel-ausschuss.html'), 'https://stadt.kusel.de/buergerservice/stadtrat/sitzungsprotokolle-bauausschuss');
    expect(p.map((x) => x.gremium).sort()).toEqual(['Bauausschuss', 'Haupt-, Bau und Finanzausschuss']);
  });

  it('liest die einfache Liste „Niederschrift vom …“ (Ortsgemeinde Betteldorf)', () => {
    const p = parseProtokolle(lies('betteldorf-niederschriften.html'), 'https://betteldorf.de/niederschriften/');
    expect(p.length).toBe(9);
    expect(p.every((x) => x.gremium === 'Gemeinderat')).toBe(true);
    expect(p.find((x) => x.datum === '2026-08-27')?.url).toBe('https://betteldorf.de/download/niederschrift-vom-27-08-2026/');
    expect(parseProtokolle(lies('betteldorf-niederschriften.html'), 'https://betteldorf.de/', 'Ortsgemeinderat')[0]!.gremium).toBe('Ortsgemeinderat');
  });
});
