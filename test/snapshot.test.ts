import { describe, expect, it } from 'vitest';
import { cleanText, ohneKopf, webSeite } from '../src/export/snapshot.js';

describe('Textauszug', () => {
  it('beginnt beim Sachverhalt statt beim Formularkopf', () => {
    const text = 'Beschlussvorlage VERBANDSGEMEINDEVERWALTUNG Drucksache-Nr. 1/2026 Betreff: Friedhof Sachverhalt/Begründung: Die Arbeiten …';
    expect(ohneKopf(text)).toBe('Sachverhalt/Begründung: Die Arbeiten …');
    expect(ohneKopf('Inhalt der Mitteilung: Bericht')).toBe('Inhalt der Mitteilung: Bericht');
    expect(ohneKopf('Ohne Gliederung')).toBe('Ohne Gliederung');
  });

  it('glättet Umbrüche und kürzt an Wortgrenzen', () => {
    expect(cleanText('a\r\n\fb   c', 100)).toBe('a b c');
    expect(cleanText('eins zwei drei', 9)).toBe('eins …');
  });

  it('verlinkt Sitzungen und Vorlagen im Original-RIS', () => {
    expect(webSeite('https://x.de/oparl/meeting/1', { web: 'https://x.de/si0057?x=1' }, 'sitzung')).toBe('https://x.de/si0057?x=1');
    expect(webSeite('https://montabaur.gremien.info/oparl/meeting/ni_2017-44RPA-0', {}, 'sitzung')).toBe(
      'https://montabaur.gremien.info/meeting?id=2017-44RPA-0',
    );
    expect(webSeite('https://montabaur.gremien.info/oparl/paper/44', {}, 'vorlage')).toBeNull();
    expect(webSeite('https://rockenhausen.gremien.info/submission?id=7', {}, 'vorlage')).toBeNull();
    expect(webSeite('https://buergerinfo.koblenz.de/si0057.php?__ksinr=9850', {}, 'sitzung')).toBe('https://buergerinfo.koblenz.de/si0057.php?__ksinr=9850');
    expect(webSeite('https://vgog.ratsinfomanagement.net/termine#2024102912', {}, 'sitzung')).toBeNull();
    expect(webSeite('https://gremieninfo.trier.de/public/to010?SILFDNR=1', {}, 'sitzung')).toBe('https://gremieninfo.trier.de/public/to010?SILFDNR=1&refresh=false');
    expect(webSeite('https://www.vg-winnweiler.sitzung-online.de/bi/to010.asp?SILFDNR=2', {}, 'sitzung')).toBe('https://www.vg-winnweiler.sitzung-online.de/bi/to010.asp?SILFDNR=2');
  });
});
