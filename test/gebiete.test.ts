import { describe, expect, it } from 'vitest';
import { vergleiche, zuordnen } from '../src/export/gebiete.js';
import type { Gebiete } from '../src/sync/discover.js';

const g: Gebiete = {
  kreise: [{ id: '07143', name: 'Westerwaldkreis', art: 'Landkreis' }],
  verbandsgemeinden: [
    { id: '071435004', name: 'Verbandsgemeinde Montabaur', kreis: '07143' },
    { id: '071435009', name: 'Verbandsgemeinde Westerburg', kreis: '07143' },
    { id: '071415010', name: 'Verbandsgemeinde Bad Ems-Nassau', kreis: '07141' },
  ],
  gemeinden: [
    { id: '07143072', name: 'Stahlhofen', art: 'Ortsgemeinde', kreis: '07143', vg: '071435004' },
    { id: '07143293', name: 'Stahlhofen am Wiesensee', art: 'Ortsgemeinde', kreis: '07143', vg: '071435009' },
    { id: '07143048', name: 'Montabaur', art: 'Stadt', kreis: '07143', vg: '071435004' },
  ],
};

describe('Zuordnung zu Gebietskörperschaften', () => {
  it('übergeht angehängte Kürzel aus Einzelbuchstaben', () => {
    expect(vergleiche('Ortsgemeinde Herchweiler i.O.', 'Herchweiler')).toBe(1);
    expect(vergleiche('Ortsgemeinde Haschbach a.R.', 'Haschbach am Remigiusberg')).toBe(1);
    expect(vergleiche('Ortsgemeinde Herchweiler Nord', 'Herchweiler')).toBe(0);
    expect(vergleiche('Ortsgemeinde Beuren/Hw.', 'Beuren (Hochwald)')).toBe(1);
    expect(vergleiche('Ortsgemeinde Beuren/Hw.', 'Beuren (Eifel)')).toBe(0);
  });

  it('vergleicht Namen tolerant', () => {
    expect(vergleiche('Ortsgemeinde Girod', 'Girod')).toBe(2);
    expect(vergleiche('Ortsgemeinde Stahlhofen a.W.', 'Stahlhofen am Wiesensee')).toBe(1);
    expect(vergleiche('Ortsgemeinde Herxheim', 'Herxheim bei Landau/ Pfalz')).toBe(1);
    expect(vergleiche('Ortsgemeinde Herxheimweyher', 'Herxheim bei Landau/ Pfalz')).toBe(0);
    expect(vergleiche('Ortsgemeinde Herxheim', 'Herxheimweyher')).toBe(0);
    expect(vergleiche('Ortsgemeinde Auw b. Prüm', 'Auw bei Prüm')).toBe(1);
    expect(vergleiche('Ortsgemeinde St. Alban', 'Sankt Alban')).toBe(2);
    expect(vergleiche('Ortsgemeinde Niederhausen/Appel', 'Niederhausen an der Appel')).toBe(1);
    expect(vergleiche('Ortsgemeinde Niederhausen/Appel', 'Oberhausen an der Appel')).toBe(0);
  });

  it('ordnet nur innerhalb der Verbandsgemeinde der Quelle zu', () => {
    const montabaur = zuordnen(g, '071435004', [
      { id: 'b1', name: 'Ortsgemeinde Stahlhofen' },
      { id: 'b2', name: 'Stadt Montabaur' },
      { id: 'b3', name: 'Verbandsgemeinde Montabaur' },
      { id: 'b4', name: 'Kindergartenzweckverband Gackenbach-Horbach' },
    ]);
    expect(Object.fromEntries(montabaur)).toEqual({ '07143072': 'b1', '07143048': 'b2', '071435004': 'b3' });

    const westerburg = zuordnen(g, '071435009', [{ id: 'w1', name: 'Ortsgemeinde Stahlhofen a.W.' }]);
    expect(Object.fromEntries(westerburg)).toEqual({ '07143293': 'w1' });
  });

  it('bevorzugt den genauen Namen vor der Vorgänger-VG mit kürzerem Namen', () => {
    const r = zuordnen(g, '071415010', [
      { id: 'alt', name: 'Verbandsgemeinde Bad Ems' },
      { id: 'neu', name: 'Verbandsgemeinde Bad Ems-Nassau' },
      { id: 'alt2', name: 'Verbandsgemeinde Nassau' },
    ]);
    expect(r.get('071415010')).toBe('neu');
  });

  it('erkennt „Verbandsgemeindeverwaltung X“ als die Verbandsgemeinde X', () => {
    expect(vergleiche('Verbandsgemeindeverwaltung Montabaur', 'Verbandsgemeinde Montabaur')).toBe(2);
    const r = zuordnen(g, '071435004', [{ id: 'v1', name: 'Verbandsgemeindeverwaltung Montabaur' }]);
    expect(r.get('071435004')).toBe('v1');
  });

  it('ordnet Systeme einer einzelnen Stadt direkt zu', () => {
    const r = zuordnen(g, '07143048', [{ id: 's1', name: 'Stadtverwaltung Montabaur' }]);
    expect(Object.fromEntries(r)).toEqual({ '07143048': 's1' });
  });
});

describe('Links zu Ratsinformationssystemen', () => {
  it('leitet die Startseite aus der OParl-Adresse ab', async () => {
    const { risStartseite } = await import('../src/export/web.js');
    expect(risStartseite('https://adenau.gremien.info/oparl/system')).toBe('https://adenau.gremien.info/');
    expect(risStartseite('https://www.hagenbach.sitzung-online.de/bi/oparl/1.0/system.asp')).toBe('https://www.hagenbach.sitzung-online.de/bi/');
    expect(risStartseite('https://gremieninfo.trier.de/public/oparl/system')).toBe('https://gremieninfo.trier.de/public/');
    expect(risStartseite('https://vgog.ratsinfomanagement.net/termine/ics/glm')).toBe('https://vgog.ratsinfomanagement.net/');
    expect(risStartseite('https://session.kreis-ahrweiler.de/biaw/')).toBe('https://session.kreis-ahrweiler.de/biaw/');
  });
});
