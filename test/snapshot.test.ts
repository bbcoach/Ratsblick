import { describe, expect, it } from 'vitest';
import { behalteSitzungsId, cleanText, dokumentUrl, entferneZwillinge, kalenderEintragLink, istDownload, ohneKopf, sessionnetKalender, webSeite } from '../src/export/snapshot.js';

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

describe('sessionnetKalender', () => {
  it('ersetzt die Sitzungsseite durch den Monatskalender desselben Systems', () => {
    expect(sessionnetKalender('https://ris.kaiserslautern.de/buergerinfo/si0057.asp?__ksinr=2370', '2026-10-29T17:00:00+01:00'))
      .toBe('https://ris.kaiserslautern.de/buergerinfo/si0040.asp?__cjahr=2026&__cmonat=10&__canz=1&__cselect=0');
    expect(sessionnetKalender('https://x.de/bi/si0056.php?__ksinr=9', '2026-03-02T09:00:00+01:00'))
      .toBe('https://x.de/bi/si0040.php?__cjahr=2026&__cmonat=3&__canz=1&__cselect=0');
  });
  it('lässt andere Systeme unberührt', () => {
    expect(sessionnetKalender('https://x.gremien.info/meeting?id=1', '2026-10-29T17:00:00+01:00')).toBeNull();
    expect(sessionnetKalender('https://x.de/bi/to010?SILFDNR=1', '2026-10-29T17:00:00+01:00')).toBeNull();
  });
});

describe('Dokument-Links', () => {
  it('hängt bei more!rubin-PDFs inline=1 an, damit sie im Browser statt als Download öffnen', () => {
    expect(dokumentUrl('javascript:alert(1)')).toBeNull();
    expect(dokumentUrl('data:text/html,x')).toBeNull();
    expect(dokumentUrl('https://emmelshausen.gremien.info/api.php?document_type_id=4&id=69')).toBe('https://emmelshausen.gremien.info/api.php?document_type_id=4&id=69&inline=1');
    expect(dokumentUrl('https://montabaur.gremien.info/api.php?id=69&inline=true&document_type_id=4')).toBe('https://montabaur.gremien.info/api.php?id=69&inline=true&document_type_id=4');
    expect(dokumentUrl('https://ratsinfo.vgka.de/bi/getfile.asp?id=1&type=do')).toBe('https://ratsinfo.vgka.de/bi/getfile.asp?id=1&type=do');
    expect(dokumentUrl(null)).toBeNull();
  });
  it('erkennt SessionNet-Downloads', () => {
    expect(istDownload('https://ratsinfo.vgka.de/bi/getfile.asp?id=1&type=do')).toBe(true);
    expect(istDownload('https://buergerinfo.koblenz.de/getfile.php?id=3&type=do')).toBe(true);
    expect(istDownload('https://x.gremien.info/api.php?document_type_id=4')).toBe(false);
  });
});

describe('entferneZwillinge', () => {
  it('behält bei more!rubin-Zwillingen nur die Adresse mit ni_', () => {
    const ids = ['https://x.gremien.info/oparl/meeting/ni_2026-GR_1', 'https://x.gremien.info/oparl/meeting/2026-GR_1', 'https://x.gremien.info/oparl/meeting/2026-GR_2'];
    expect(entferneZwillinge(ids)).toEqual(['https://x.gremien.info/oparl/meeting/ni_2026-GR_1', 'https://x.gremien.info/oparl/meeting/2026-GR_2']);
    expect(entferneZwillinge(['https://y.gremien.info/meeting?id=ni_5', 'https://y.gremien.info/meeting?id=5'])).toEqual(['https://y.gremien.info/meeting?id=ni_5']);
  });
  it('lässt andere Adressen unverändert', () => {
    const ids = ['https://k.de/si0057.php?__ksinr=1', 'https://k.de/si0057.php?__ksinr=2'];
    expect(entferneZwillinge(ids)).toEqual(ids);
  });
});

describe('Kalendereinträge und Zwillings-Verweise', () => {
  it('verlinkt SessionNet-Kalendereinträge auf den Monat, mit Mandant', () => {
    expect(kalenderEintragLink('https://sessionnet.owl-it.de/schweich/BI/si0040.asp#19-2026-08-31-haupt-und-finanzausschuss')).toBe(
      'https://sessionnet.owl-it.de/schweich/BI/si0040.asp?__cjahr=2026&__cmonat=8&__canz=1&__cselect=0&__cpanr=19',
    );
    expect(kalenderEintragLink('https://buergerinfo.koblenz.de/si0040.php#2026-10-20-forstausschuss')).toBe(
      'https://buergerinfo.koblenz.de/si0040.php?__cjahr=2026&__cmonat=10&__canz=1&__cselect=0',
    );
  });
  it('verlinkt SD.NET-RIM-Termine auf die Terminliste', () => {
    expect(kalenderEintragLink('https://vg-altenkirchen.ratsinfomanagement.net/termine#2024104862')).toBe('https://vg-altenkirchen.ratsinfomanagement.net/termine');
    expect(kalenderEintragLink('https://x.de/andere#seite')).toBeNull();
  });
  it('lenkt Beratungen von der entfernten Zwillingsadresse auf die behaltene um', () => {
    const da = new Set(['https://x.gremien.info/oparl/meeting/ni_A']);
    expect(behalteSitzungsId('https://x.gremien.info/oparl/meeting/A', da)).toBe('https://x.gremien.info/oparl/meeting/ni_A');
    expect(behalteSitzungsId('https://x.gremien.info/oparl/meeting/B', da)).toBe('https://x.gremien.info/oparl/meeting/B');
    expect(behalteSitzungsId(null, da)).toBeNull();
  });
});
