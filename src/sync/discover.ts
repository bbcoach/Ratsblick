import { OParlClient, OParlHttpError, OParlServerError } from '../oparl/client.js';
import type { OParlSystem } from '../oparl/types.js';

/**
 * Sucht more!rubin-Systeme (`<name>.gremien.info`) für Kommunen aus dem Gemeindeverzeichnis.
 * Unbekannte Subdomains liefern 404, vorhandene entweder ein System-Objekt oder „OParl is not active.“
 * Je Kandidat genau eine Anfrage auf `/oparl/system` (laut robots.txt erlaubt), gedrosselt wie jeder Abruf.
 */

export interface Gebiete {
  kreise: Array<{ id: string; name: string; art: string }>;
  verbandsgemeinden: Array<{ id: string; name: string; kreis: string }>;
  gemeinden: Array<{ id: string; name: string; art: string; kreis: string | null; vg: string | null }>;
}

export interface Kandidat {
  gebiet: string;
  name: string;
  url: string;
}

export interface Fund extends Kandidat {
  status: 'aktiv' | 'inaktiv';
  detail?: string;
}

/** Schreibweisen für Subdomains, z. B. „Altenkirchen (Westerwald)“ → altenkirchen-westerwald, altenkirchen. */
export function slugs(name: string): string[] {
  const basis = name
    .replace(/^(Verbandsgemeinde|Landkreis|Stadt) /, '')
    .toLowerCase()
    .replace(/ß/g, 'ss');
  const ohneKlammer = basis.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const out = new Set<string>();
  for (const b of [basis, ohneKlammer]) {
    const dash = (s: string) => s.replace(/[^a-z0-9äöü]+/g, '-').replace(/^-+|-+$/g, '');
    out.add(dash(b.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')));
    out.add(dash(b.replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u')));
  }
  return [...out].filter(Boolean);
}

export function kandidaten(g: Gebiete, bekannt: Set<string>): Kandidat[] {
  const out: Kandidat[] = [];
  const add = (gebiet: string, name: string, subs: string[]) => {
    for (const sub of new Set(subs)) {
      const url = `https://${sub}.gremien.info/oparl/system`;
      if (!bekannt.has(url)) out.push({ gebiet, name, url });
    }
  };
  for (const vg of g.verbandsgemeinden) add(vg.id, vg.name, slugs(vg.name));
  for (const k of g.kreise) {
    const s = slugs(k.name);
    if (k.art === 'Landkreis') add(k.id, k.name, [...s, ...s.map((x) => `kreis-${x}`)]);
    else add(k.id, k.name, [...s, ...s.map((x) => `${x}-stadt`), ...s.map((x) => `stadt-${x}`)]);
  }
  // Verbandsfreie Gemeinden und Städte haben ein eigenes Ratsinformationssystem
  for (const gem of g.gemeinden.filter((x) => !x.vg && x.art !== 'Kreisfreie Stadt')) {
    const s = slugs(gem.name);
    add(gem.id, gem.name, [...s, ...s.map((x) => `${x}-stadt`)]);
  }
  return out;
}

export async function pruefe(client: OParlClient, k: Kandidat): Promise<Fund | null> {
  try {
    const sys = await client.get<OParlSystem>(k.url);
    return { ...k, status: 'aktiv', detail: sys.name ?? undefined };
  } catch (err) {
    if (err instanceof OParlServerError) return { ...k, status: 'inaktiv', detail: err.message };
    if (err instanceof OParlHttpError && err.status === 404) return null;
    throw err;
  }
}
