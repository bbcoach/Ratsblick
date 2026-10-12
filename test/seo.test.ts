import { describe, expect, it } from 'vitest';
import { ortText, seitenListe, slug } from '../src/export/seo.js';

describe('Suchmaschinen-Seiten', () => {
  it('bildet lesbare Adressen', () => {
    expect(slug('Bad Münster am Stein-Ebernburg')).toBe('bad-muenster-am-stein-ebernburg');
    expect(slug('Neustadt an der Weinstraße')).toBe('neustadt-an-der-weinstrasse');
    expect(slug('Frankenthal (Pfalz)')).toBe('frankenthal-pfalz');
  });
  it('vergibt eindeutige Adressen, gleichnamige Orte mit Verbandsgemeinde', () => {
    const s = seitenListe({
      kreise: [{ id: '07140', name: 'Rhein-Hunsrück-Kreis', art: 'Landkreis' }, { id: '07111', name: 'Koblenz', art: 'Kreisfreie Stadt' }],
      verbandsgemeinden: [{ id: '071405003', name: 'Verbandsgemeinde Kastellaun', kreis: '07140' }, { id: '071405004', name: 'Verbandsgemeinde Simmern', kreis: '07140' }],
      gemeinden: [
        { id: '07140064', name: 'Kastellaun', art: 'Stadt', kreis: '07140', vg: '071405003' },
        { id: '07140001', name: 'Bell', art: 'Ortsgemeinde', kreis: '07140', vg: '071405003' },
        { id: '07140002', name: 'Bell', art: 'Ortsgemeinde', kreis: '07140', vg: '071405004' },
        { id: '07111000', name: 'Koblenz', art: 'Kreisfreie Stadt', kreis: null, vg: null },
      ],
    });
    const pfade = s.map((x) => x.pfad);
    expect(new Set(pfade).size).toBe(pfade.length);
    expect(pfade).toEqual(expect.arrayContaining(['rhein-hunsrueck-kreis', 'vg-kastellaun', 'kastellaun', 'bell-kastellaun', 'bell-simmern', 'koblenz']));
    expect(s.find((x) => x.id === '07140064')?.rat).toBe('Stadtrat');
    expect(s.find((x) => x.id === '07140001')?.rat).toBe('Ortsgemeinderat');
    expect(s.some((x) => x.id === '07111')).toBe(false); // kreisfreie Stadt nur einmal (als Gemeinde)
  });
  it('bereinigt Ortsangaben', () => {
    expect(ortText('(siehe Dokument), ,')).toBe('siehe Dokument');
    expect(ortText(' , ')).toBeNull();
    expect(ortText('Rathaus, Hauptstr. 1')).toBe('Rathaus, Hauptstr. 1');
  });
});
