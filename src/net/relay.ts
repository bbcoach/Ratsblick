import type { FetchLike } from '../oparl/client.js';

/**
 * Leitet Abrufe an Server, die nur aus Europa erreichbar sind, über den Ratsblick-Weiterleiter
 * (Vercel, Frankfurt; siehe relay/). Alle anderen Abrufe gehen direkt.
 *
 * Umgebung:
 *   RATSBLICK_RELAY_URL         z. B. https://ratsblick-relay.vercel.app
 *   RATSBLICK_RELAY_SCHLUESSEL  derselbe Wert wie RELAY_SCHLUESSEL beim Weiterleiter
 *   RATSBLICK_RELAY_HOSTS       kommagetrennt (Standard: die Liste in relay/lib/erlaubt.js)
 */
export interface RelayConfig {
  url: string;
  schluessel: string;
  hosts: string[];
}

export function relayConfigAusUmgebung(env: NodeJS.ProcessEnv = process.env): RelayConfig | null {
  if (!env.RATSBLICK_RELAY_URL || !env.RATSBLICK_RELAY_SCHLUESSEL) return null;
  return {
    url: env.RATSBLICK_RELAY_URL.replace(/\/+$/, ''),
    schluessel: env.RATSBLICK_RELAY_SCHLUESSEL,
    // Standard wie relay/lib/erlaubt.js
    hosts: (env.RATSBLICK_RELAY_HOSTS || 'ris.kaiserslautern.de,gremieninfo.trier.de')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  };
}

export function relayFetch(cfg: RelayConfig | null, base: FetchLike = (u, i) => fetch(u, i)): FetchLike {
  if (!cfg) return base;
  return (url, init) => {
    if (!cfg.hosts.includes(new URL(url).hostname.toLowerCase())) return base(url, init);
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${cfg.schluessel}`);
    headers.delete('User-Agent'); // setzt der Weiterleiter
    return base(`${cfg.url}/api/abruf?url=${encodeURIComponent(url)}`, { ...init, headers });
  };
}
