import type { Gebiete } from '../sync/discover.js';

/**
 * Ordnet OParl-Körperschaften den amtlichen Gebietskörperschaften (Gemeindeverzeichnis) zu.
 * Gesucht wird nur innerhalb des Gebiets der Quelle (z. B. der Verbandsgemeinde), damit gleichnamige
 * Gemeinden anderswo nicht verwechselt werden. Namen werden tolerant verglichen:
 * „Herxheim“ ↔ „Herxheim bei Landau/ Pfalz“, „Stahlhofen a.W.“ ↔ „Stahlhofen am Wiesensee“.
 */

export interface Koerperschaft {
  id: string;
  name: string;
}

const PRAEFIX = /^(ortsgemeinde|verbandsgemeinde|gemeindeverwaltung|gemeinde|stadtverwaltung|stadt|landkreis|kreisverwaltung|kreis)\s+/;

export function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(PRAEFIX, '')
    .replace(/\bst\.\s*/g, 'sankt ') // „St. Alban“ ↔ „Sankt Alban“
    .split(/[^a-z0-9äöü]+/)
    .filter(Boolean);
}

/**
 * 2 = gleich, 1 = Kurzform passt (erstes Wort gleich, weitere Wörter sind Anfänge der amtlichen),
 * 0 = passt nicht. Das erste Wort muss gleich sein, sonst passt „Herxheim“ auch auf „Herxheimweyher“.
 */
export function vergleiche(oparl: string, amtlich: string): number {
  const a = tokens(oparl);
  const b = tokens(amtlich);
  if (!a.length || !b.length) return 0;
  if (a.join(' ') === b.join(' ')) return 2;
  if (a.length > b.length) return 0;
  if (a[0] !== b[0]) return 0;
  // Weitere Wörter der Reihe nach als Anfänge amtlicher Wörter; amtliche Füllwörter dürfen fehlen
  // („Niederhausen/Appel“ ↔ „Niederhausen an der Appel“, „Auw b. Prüm“ ↔ „Auw bei Prüm“)
  let j = 1;
  for (const t of a.slice(1)) {
    while (j < b.length && !b[j]!.startsWith(t)) j++;
    if (j >= b.length) return 0;
    j++;
  }
  return 1;
}

/** Gebiets-IDs, in denen die Körperschaften einer Quelle liegen können. */
function bereich(g: Gebiete, gebiet: string) {
  const gemeinden = g.gemeinden.filter((x) => x.id === gebiet || x.vg === gebiet || x.kreis === gebiet);
  const vgs = g.verbandsgemeinden.filter((x) => x.id === gebiet || x.kreis === gebiet);
  const kreise = g.kreise.filter((x) => x.id === gebiet);
  return { gemeinden, vgs, kreise };
}

/** Liefert Gebiets-ID → Körperschafts-ID für eine Quelle. */
export function zuordnen(g: Gebiete, gebiet: string, bodies: Koerperschaft[]): Map<string, string> {
  const { gemeinden, vgs, kreise } = bereich(g, gebiet);
  const out = new Map<string, string>();
  for (const b of bodies) {
    const n = b.name.toLowerCase();
    let pool: Array<{ id: string; name: string }>;
    if (n.startsWith('verbandsgemeinde')) pool = vgs;
    else if (/^(ortsgemeinde|stadt|gemeinde)/.test(n)) pool = gemeinden;
    else if (/kreis/.test(n)) pool = kreise;
    else continue; // Zweckverbände, Ortsbezirke, Gesellschaften: keine Gebietskörperschaft
    const treffer = pool
      .map((x) => ({ x, s: vergleiche(b.name, x.name) }))
      .filter((t) => t.s > 0)
      .sort((p, q) => q.s - p.s);
    // Nur eindeutige Treffer übernehmen
    if (treffer.length && (treffer.length === 1 || treffer[0]!.s > treffer[1]!.s) && !out.has(treffer[0]!.x.id)) {
      out.set(treffer[0]!.x.id, b.id);
    }
  }
  // Systeme einer einzelnen Stadt oder eines Kreises: die einzige Körperschaft ist das Gebiet selbst
  const selbst = [...gemeinden, ...kreise].find((x) => x.id === gebiet);
  const einzig = bodies.filter((b) => !/zweckverband|verband|gmbh|aör|genossenschaft/i.test(b.name));
  if (selbst && !out.has(gebiet) && einzig.length === 1) out.set(gebiet, einzig[0]!.id);
  return out;
}
