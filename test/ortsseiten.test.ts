import { describe, expect, it } from 'vitest';
import { ortsDatum, parseOrtsseite } from '../src/scrape/ortsseiten.js';

describe('Ortsgemeinde-Websites: Dokumentlisten mit Datum', () => {
  it('erkennt Datumsformen aus Text und Adresse', () => {
    expect(ortsDatum('Niederschrift vom 27.08.2026')).toBe('2026-08-27');
    expect(ortsDatum('Niederschrift vom 14. August 2026')).toBe('2026-08-14');
    expect(ortsDatum('/download/niederschrift-vom-27-08-2026/')).toBe('2026-08-27');
    expect(ortsDatum('Niederschrift_2026-09-01')).toBe('2026-09-01');
    expect(ortsDatum('GR_20260826 - Einladung.pdf')).toBe('2026-08-26');
    expect(ortsDatum('19.01.23')).toBe('2023-01-19');
    expect(ortsDatum('Protokolle Gemeinderatssitzungen/2026/2026_02_03_Niederschrift.pdf')).toBe('2026-02-03');
    expect(ortsDatum('2026-09-29_Einladung-Gemeinderatssitzung_06-10-2026.pdf')).toBe('2026-10-06'); // Sitzungstag, nicht Hochladedatum
    expect(ortsDatum('Haushalt 2026')).toBeNull();
    expect(ortsDatum('31.02.2026')).toBeNull();
  });

  it('macht aus Links Einladungen und Niederschriften, ignoriert den Rest', () => {
    const html = `
      <a href="/niederschriften/">Niederschriften</a>
      <a href="https://x.de/download/niederschrift-vom-27-08-2026/">Niederschrift vom 27.08.2026</a>
      <a href="/wp-content/uploads/2026/10/2026-09-29_Einladung-Gemeinderatssitzung_06-10-2026.pdf"> </a>
      <a href="/2026/07/25/sitzung-des-ortsgemeinderates-30-07-2026/">Sitzung des Ortsgemeinderates – 30.07.2026</a>
      <a href="/x/niederschrift-20260301.pdf">Herunterladen</a>
      <a href="/x/niederschrift-20260301.pdf">Herunterladen</a>
      <a href="/2026/10/06/21-10-2021-gemeinderatsitzung/"><img src="x.jpg"></a>
      <a href="/2026/10/06/21-10-2021-gemeinderatsitzung/">07.10.2026 – Sitzung des Ortsgemeinderates</a>
      <a href="/impressum/">Impressum</a>`;
    const d = parseOrtsseite(html, 'https://x.de/seite/');
    expect(d.map((x) => `${x.datum} ${x.art}`)).toEqual([
      '2026-08-27 niederschrift',
      '2026-10-06 einladung',
      '2026-07-30 einladung',
      '2026-03-01 niederschrift',
      '2026-10-07 einladung', // Datum aus dem Titel, nicht aus der Adresse (Tippfehler 2021)
    ]);
    expect(d[1]!.url).toBe('https://x.de/wp-content/uploads/2026/10/2026-09-29_Einladung-Gemeinderatssitzung_06-10-2026.pdf');
    expect(d[3]!.name).toBe('niederschrift-20260301'); // „Herunterladen“ ersetzt durch den Dateinamen
  });
});
