import { describe, expect, it } from 'vitest';
import { gemeinsamerAnfang, suchEintraege, teileSuche, type SuchEintrag } from '../src/export/web.js';

describe('Themensuche', () => {
  it('nimmt Vorlagen und öffentliche Sach-TOPs auf, ohne Formalien und doppelte Vorlagen', () => {
    const e = suchEintraege(
      3,
      '073355011',
      new Map([['k-bann', '07335002']]),
      [{ id: 's1', k: 'k-bann', start: '2026-10-05T19:00:00+02:00', tops: [
        { name: 'Eröffnung und Begrüßung', oeffentlich: true, vorlage: null },
        { name: 'Bauantrag Hauptstraße', oeffentlich: true, vorlage: 'v1' },
        { name: 'Sanierung des Spielplatzes', oeffentlich: true, vorlage: null },
        { name: 'Grundstücksangelegenheiten', oeffentlich: false, vorlage: null },
      ] }],
      [{ id: 'v1', k: 'k-bann', name: 'Bauantrag Hauptstraße', nr: 'BA/1/2026', datum: '2026-10-05' }],
    );
    expect(e).toEqual([
      [0, 'Bauantrag Hauptstraße', '2026-10-05', 3, '07335002', 'v1', 'BA/1/2026'],
      [1, 'Sanierung des Spielplatzes', '2026-10-05', 3, '07335002', 's1', null],
    ]);
  });
});

describe('Themensuche in Teilen', () => {
  it('findet den gemeinsamen Anfang', () => {
    expect(gemeinsamerAnfang(['https://a.de/m/1', 'https://a.de/m/22'])).toBe('https://a.de/m/');
    expect(gemeinsamerAnfang(['x'])).toBe('x');
    expect(gemeinsamerAnfang([])).toBe('');
  });
  it('teilt nach Kreis und kürzt die Kennungen je Quelle', () => {
    const e: SuchEintrag[] = [
      [0, 'A', '2026-01-01', 0, '07140064', 'https://q0/v/1', 'N1'],
      [1, 'B', '2026-01-02', 0, '071405003', 'https://q0/s/9', null],
      [0, 'C', '2026-01-03', 1, '07335002', 'https://q1/v/1', null],
      [0, 'D', null, 1, null, 'https://q1/v/2', null],
    ];
    const { praefix, teile } = teileSuche(e, 2);
    expect(praefix).toEqual(['https://q0/', 'https://q1/v/']);
    expect(teileSuche([[0, 'Z', null, 0, null, 'abc', null]], 1).teile.get('00000')![0]![5]).toBe('c');
    expect([...teile.keys()].sort()).toEqual(['00000', '07140', '07335']);
    expect(teile.get('07140')).toEqual([
      [0, 'A', '2026-01-01', 0, '07140064', 'v/1', 'N1'],
      [1, 'B', '2026-01-02', 0, '071405003', 's/9', null],
    ]);
    expect(teile.get('07335')![0]![5]).toBe('1');
  });
});
