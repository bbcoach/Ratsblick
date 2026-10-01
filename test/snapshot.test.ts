import { describe, expect, it } from 'vitest';
import { cleanText, ohneKopf } from '../src/export/snapshot.js';

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
});
