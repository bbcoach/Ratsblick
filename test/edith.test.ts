import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { edithAdresse, ortsgemeindeSeiten, parseEdith } from '../src/scrape/edith.js';

const seite = readFileSync(new URL('./fixtures/edith/berglicht.html', import.meta.url), 'utf8');

describe('edith (Politik-Modul der NetzWerkstatt, VG Thalfang)', () => {
  it('liest Körperschaft, Gremien, Einladungen und Unterrichtungen', () => {
    const p = parseEdith(seite, 'https://erbeskopf.regio-data.de/edith-politik-294.php');
    expect(p.koerperschaft).toBe('Ortsgemeinde Berglicht');
    expect(p.gremien.map((g) => g.name)).toEqual(['Ortsgemeinderat', 'Bau- und Liegenschaftsausschuss', 'Haupt- und Finanzausschuss', 'Rechnungsprüfungsausschuss']);
    const rat = p.gremien[0]!;
    expect(rat.einladungen[0]).toEqual({ datum: '2026-04-16', url: 'https://erbeskopf.regio-data.de/pollink_ansicht_142_2110_berichte_anzeige.html' });
    expect(rat.niederschriften.length).toBe(4);
    expect(p.gremien[3]!.niederschriften).toEqual([]);
  });

  it('findet die eingebettete Seite und die Politik-Seiten der Ortsgemeinden', () => {
    expect(edithAdresse('<iframe id="edith-iframe" src="https://erbeskopf.regio-data.de/edith-politik-294.php" frameborder="0">'))
      .toBe('https://erbeskopf.regio-data.de/edith-politik-294.php');
    expect(ortsgemeindeSeiten('<a href="verwaltung-politik/ortsgemeinden/berglicht.html">Berglicht</a>', 'https://www.erbeskopf.de/'))
      .toEqual(['https://www.erbeskopf.de/de/verwaltung-politik/ortsgemeinden/berglicht/politik.html']);
  });
});
