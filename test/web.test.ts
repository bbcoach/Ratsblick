import { describe, expect, it } from 'vitest';
import { suchEintraege } from '../src/export/web.js';

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
