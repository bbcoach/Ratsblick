import type { OParlErrorObject, OParlListResponse } from './types.js';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  fetchImpl?: FetchLike;
  /** Mindestabstand zwischen zwei Anfragen an denselben Host. Rücksicht auf kommunale Server. */
  minIntervalMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
  userAgent?: string;
  /** Obergrenze für Seiten pro Liste; schützt vor Endlosschleifen fehlerhafter Server. */
  maxPages?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Der Server hat ein OParl-Fehlerobjekt geliefert (z. B. Schnittstelle nicht freigeschaltet). */
export class OParlServerError extends Error {
  constructor(
    public readonly url: string,
    message: string,
    public readonly debug?: string,
  ) {
    super(message);
    this.name = 'OParlServerError';
  }
}

/** Transport- oder HTTP-Fehler nach Ausschöpfen der Wiederholungen. */
export class OParlHttpError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'OParlHttpError';
  }
}

/**
 * Drosselung je Server statt je Subdomain: z. B. liegen alle `*.gremien.info` auf derselben Maschine.
 * Vereinfachung: die letzten zwei Namensteile (für .de/.info/.com ausreichend).
 */
export function serverKey(url: string): string {
  const host = new URL(url).hostname;
  if (/^[\d.]+$/.test(host) || host.includes(':')) return host;
  return host.split('.').slice(-2).join('.');
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isErrorObject(x: unknown): x is OParlErrorObject {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { type?: unknown }).type === 'string' &&
    /\/Error$/.test((x as { type: string }).type)
  );
}

export class OParlClient {
  private readonly fetchImpl: FetchLike;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly maxPages: number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Nächster freier Zeitpunkt je Server. */
  private readonly nextSlot = new Map<string, number>();
  requestCount = 0;

  constructor(opts: ClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.minIntervalMs = opts.minIntervalMs ?? 1000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.userAgent = opts.userAgent ?? 'Ratsblick/0.1 (OParl-Abgleich; Kontakt: https://github.com/bbcoach/Ratsblick)';
    this.maxPages = opts.maxPages ?? 10_000;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /**
   * Reserviert den nächsten freien Zeitpunkt für den Server. Die Reservierung geschieht synchron,
   * damit auch parallel laufende Abgleiche den Mindestabstand einhalten.
   */
  private async throttle(url: string): Promise<void> {
    const key = serverKey(url);
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot.get(key) ?? 0);
    this.nextSlot.set(key, slot + this.minIntervalMs);
    if (slot > now) await this.sleep(slot - now);
  }

  /** Holt ein OParl-Objekt. Wiederholt bei 429/5xx und Netzfehlern mit wachsender Pause. */
  async get<T>(url: string): Promise<T> {
    let lastError: OParlHttpError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await this.sleep(1000 * 2 ** (attempt - 1));
      await this.throttle(url);
      this.requestCount++;
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          headers: { Accept: 'application/json', 'User-Agent': this.userAgent },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        lastError = new OParlHttpError(url, null, `Netzwerkfehler: ${(err as Error).message}`);
        continue;
      }

      let body: unknown = undefined;
      const text = await res.text();
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = undefined;
      }

      // more!rubin u. a. liefern OParl-Fehlerobjekte teils mit Status 200 – zuerst prüfen.
      if (isErrorObject(body)) {
        throw new OParlServerError(url, body.message ?? 'OParl-Fehler ohne Meldung', body.debug);
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = new OParlHttpError(url, res.status, `HTTP ${res.status}`);
        continue;
      }
      if (!res.ok) {
        throw new OParlHttpError(url, res.status, `HTTP ${res.status}`);
      }
      if (body === undefined) {
        throw new OParlHttpError(url, res.status, 'Antwort ist kein JSON');
      }
      return body as T;
    }
    throw lastError ?? new OParlHttpError(url, null, 'Unbekannter Fehler');
  }

  /**
   * Holt eine HTML-Seite (für Scraper), mit derselben Drosselung und denselben Wiederholungen wie `get`.
   * Der Zeichensatz kommt aus dem Content-Type (Standard UTF-8; ISO-8859-1 wird als Windows-1252 gelesen).
   */
  async getText(url: string): Promise<string> {
    let lastError: OParlHttpError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await this.sleep(1000 * 2 ** (attempt - 1));
      await this.throttle(url);
      this.requestCount++;
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          headers: { Accept: 'text/html,*/*', 'User-Agent': this.userAgent },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        lastError = new OParlHttpError(url, null, `Netzwerkfehler: ${(err as Error).message}`);
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = new OParlHttpError(url, res.status, `HTTP ${res.status}`);
        continue;
      }
      if (!res.ok) throw new OParlHttpError(url, res.status, `HTTP ${res.status}`);
      const cs = (/charset=["']?([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1] ?? 'utf-8').toLowerCase();
      const buf = await res.arrayBuffer();
      return new TextDecoder(cs === 'iso-8859-1' || cs === 'latin1' ? 'windows-1252' : cs).decode(buf);
    }
    throw lastError ?? new OParlHttpError(url, null, 'Unbekannter Fehler');
  }

  /**
   * Durchläuft eine paginierte OParl-Liste über `links.next`.
   * `modifiedSince` nutzt den Standardfilter `modified_since` für inkrementelle Abgleiche.
   * `onTruncated` meldet, dass die Liste wegen `maxPages` nicht vollständig gelesen wurde.
   */
  async *paginate<T>(
    listUrl: string,
    params: { modifiedSince?: string; onTruncated?: () => void } = {},
  ): AsyncGenerator<T> {
    const first = new URL(listUrl);
    if (params.modifiedSince) first.searchParams.set('modified_since', params.modifiedSince);

    let next: string | undefined = first.toString();
    const seen = new Set<string>();
    let pages = 0;
    while (next) {
      if (seen.has(next)) break; // fehlerhafter Server verweist auf bereits gelesene Seite
      if (pages >= this.maxPages) {
        params.onTruncated?.();
        break;
      }
      seen.add(next);
      pages++;
      const page: OParlListResponse<T> = await this.get<OParlListResponse<T>>(next);
      for (const item of page.data ?? []) yield item;
      next = page.links?.next;
    }
  }
}
