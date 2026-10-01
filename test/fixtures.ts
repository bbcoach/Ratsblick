import type { FetchLike } from '../src/oparl/client.js';

/** Nachgebauter OParl-Server: URL (ohne Query) → Antwort. Protokolliert alle Aufrufe. */
export function fakeServer(routes: Record<string, unknown | ((url: URL) => { status?: number; body: unknown })>) {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const url = new URL(input);
    calls.push(url.toString());
    const key = url.origin + url.pathname + (url.searchParams.get('page') ? `?page=${url.searchParams.get('page')}` : '');
    const route = routes[key];
    if (route === undefined) return new Response('not found', { status: 404 });
    const { status = 200, body } =
      typeof route === 'function' ? (route as (u: URL) => { status?: number; body: unknown })(url) : { body: route };
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

const H = 'https://vg-test.gremien.info/oparl';

/** System-Objekt im Aufbau einer echten more!rubin-Antwort (VG Montabaur, 01.10.2026). */
export const system = {
  id: `${H}/system`,
  type: 'https://schema.oparl.org/1.0/System',
  oparlVersion: 'https://schema.oparl.org/1.0/',
  body: `${H}/Body`,
  name: 'OParl-Schnittstelle "Bürgerinfosystem VG Test"',
  contactEmail: 'info@more-rubin.de',
  contactName: 'more! software GmbH',
  website: 'https://vg-test.gremien.info',
  vendor: 'https://www.more-rubin.de/',
  web: 'https://www.more-rubin.de/',
};

export const bodies = {
  data: [
    {
      id: `${H}/Body/1`,
      name: 'Verbandsgemeinde Test',
      shortName: 'VG Test',
      organization: `${H}/Body/1/Organization`,
      meeting: `${H}/Body/1/Meeting`,
      paper: `${H}/Body/1/Paper`,
    },
    {
      id: `${H}/Body/2`,
      name: 'Ortsgemeinde Beispieldorf',
      organization: `${H}/Body/2/Organization`,
      meeting: `${H}/Body/2/Meeting`,
    },
  ],
  links: {},
};

export const organizations1 = {
  data: [
    { id: `${H}/Organization/10`, name: 'Verbandsgemeinderat', organizationType: 'Gremium' },
    { id: `${H}/Organization/11`, name: 'Bau- und Umweltausschuss', organizationType: 'Gremium' },
  ],
  links: {},
};

export const organizations2 = {
  data: [{ id: `${H}/Organization/20`, name: 'Ortsgemeinderat Beispieldorf' }],
  links: {},
};

export const meetingsPage1 = {
  data: [
    {
      id: `${H}/Meeting/100`,
      name: 'Sitzung des Verbandsgemeinderates',
      start: '2026-10-08T18:00:00+02:00',
      location: { id: `${H}/Location/1`, description: 'Sitzungssaal Rathaus' },
      organization: [`${H}/Organization/10`],
      invitation: { id: `${H}/File/900`, name: 'Einladung', mimeType: 'application/pdf', accessUrl: `${H}/File/900/access` },
      agendaItem: [
        { id: `${H}/AgendaItem/1001`, number: '1', order: 1, name: 'Mitteilungen', public: true },
        { id: `${H}/AgendaItem/1002`, number: '2', order: 2, name: 'Sanierung Grundschule', public: true, consultation: `${H}/Consultation/5001` },
      ],
    },
  ],
  links: { next: `${H}/Body/1/Meeting?page=2` },
};

export const meetingsPage2 = {
  data: [
    {
      id: `${H}/Meeting/101`,
      name: 'Bau- und Umweltausschuss',
      start: '2026-10-14T17:30:00+02:00',
      location: 'Kleiner Sitzungssaal',
      organization: [`${H}/Organization/11`],
    },
  ],
  links: {},
};

export const meetings2 = { data: [], links: {} };

export const papers = {
  data: [
    {
      id: `${H}/Paper/500`,
      name: 'Sanierung der Grundschule: Vergabe der Planungsleistungen',
      reference: '2026/118',
      date: '2026-09-15',
      paperType: 'Beschlussvorlage',
      mainFile: { id: `${H}/File/901`, name: 'Beschlussvorlage', mimeType: 'application/pdf', accessUrl: `${H}/File/901/access` },
      auxiliaryFile: [{ id: `${H}/File/902`, name: 'Anlage 1', mimeType: 'application/pdf' }],
      consultation: [
        { id: `${H}/Consultation/5000`, meeting: `${H}/Meeting/99`, organization: [`${H}/Organization/11`], role: 'Vorberatung' },
        { id: `${H}/Consultation/5001`, meeting: `${H}/Meeting/100`, agendaItem: `${H}/AgendaItem/1002`, organization: [`${H}/Organization/10`], authoritative: true, role: 'Entscheidung' },
      ],
    },
  ],
  links: {},
};

export const HOST = H;
