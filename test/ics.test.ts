import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseIcs } from '../src/scrape/ics.js';

describe('Kalenderexport (iCalendar)', () => {
  it('liest Termine aus SD.NET RIM (Oberes Glantal)', () => {
    const t = parseIcs(readFileSync(new URL('./fixtures/ics/oberes-glantal.ics', import.meta.url), 'utf8'));
    expect(t).toHaveLength(46);
    const r = t.find((x) => x.uid === '2024102912')!;
    expect(r).toMatchObject({
      titel: 'Rechnungsprüfungsausschuss Oberes Glantal',
      start: '2024-10-24T19:05:00+02:00',
      ende: '2024-10-24T20:30:00+02:00',
      ort: 'Rathaus Waldmohr, 66914 Waldmohr, Sitzungssaal',
    });
    expect(r.link).toMatch(/^https:\/\/vgog\.ratsinfomanagement\.net\/tops\/\?__=/);
  });

  it('fügt gefaltete Zeilen zusammen und entschlüsselt Sonderzeichen', () => {
    const ics = 'BEGIN:VEVENT\r\nUID:1\r\nDTSTART:20261103T180000Z\r\nSUMMARY:Rat\\, Sitzung mit sehr\r\n  langem Titel\r\nEND:VEVENT\r\n';
    expect(parseIcs(ics.replace('END:VEVENT', 'LOCATION:in Klärung\\, \\, in Klärung\r\nEND:VEVENT'))[0]!.ort).toBe('in Klärung');
    expect(parseIcs(ics)[0]).toMatchObject({ titel: 'Rat, Sitzung mit sehr langem Titel', start: '2026-11-03T18:00:00.000Z', link: null });
  });
});
