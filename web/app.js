// Wahlheimat (vormals Ratsblick) – Web-App. Liest die statischen Datendateien aus data/ (erzeugt mit `npm run web`).
(() => {
  'use strict';
  const TZ = 'Europe/Berlin';
  const $view = document.getElementById('view');
  const $title = document.getElementById('title');
  const $toast = document.getElementById('toast');
  const $offline = document.getElementById('offline');

  // Reichweitenmessung mit GoatCounter. Leer = aus (kein Skript, keine Anfrage, Datenschutz-Absatz erscheint nicht).
  // Einschalten: Adresse der Zähl-Schnittstelle eintragen, z. B. 'https://wahlheimat.goatcounter.com/count'.
  const ZAEHLER = '';

  const store = {
    get(k, d) { try { const v = localStorage.getItem('ratsblick:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('ratsblick:' + k, JSON.stringify(v)); } catch {} },
  };

  let INDEX = null;                    // Verzeichnis: Gebiete, Zuordnung zu Quellen, Quellen
  const G = new Map();                 // Gebiets-ID → { id, name, art, typ, plz, kreis, vg, ew, q?, b? }
  const gebietVonBody = new Map();     // Körperschafts-ID → Gebiets-ID
  const loaded = new Map();            // Quellen-ID → aufbereitete Daten
  let kommune = store.get('kommune', null);
  let q = '';
  let depth = 0;                       // Navigationstiefe innerhalb der App (für „Zurück“)

  // ---------- Hilfen ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (iso, o) => (iso ? new Intl.DateTimeFormat('de-DE', { timeZone: TZ, ...o }).format(new Date(iso)) : '');
  const datum = (iso) => fmt(iso, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const uhr = (iso) => fmt(iso, { hour: '2-digit', minute: '2-digit' });
  const langDatum = (iso) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  // Quellen ohne Uhrzeit (nur Datum, z. B. edith) speichern 00:00 – dann auf die Einladung verweisen
  const uhrText = (iso) => (uhr(iso) === '00:00' ? 'Uhrzeit siehe Dokument' : `${uhr(iso)} Uhr`);
  const stand = (iso) => (iso ? `${datum(iso)}, ${uhr(iso)} Uhr` : 'unbekannt');
  const kurzName = (name) => String(name || '').replace(/^(Ortsgemeinde|Ortsbezirk|Verbandsgemeinde|Stadt) /, '');
  const gremiumKurz = (g) => String(g || '').replace(/\s+/g, ' ')
    .replace(/ (der|des) (Ortsgemeinde|Verbandsgemeinde|VG|Stadt|Ortsgemeinderates der Ortsgemeinde|Stadtrates der Stadt) .+$/, '')
    .replace(/ des Kindergartenzweckverbandes .+$/, '');
  const ortKurz = (o) => String(o || '').split(',')[0];
  const chev = '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
  const rolleLabel = { main: 'Vorlage', invitation: 'Einladung / Bekanntmachung', resultsProtocol: 'Ergebnisprotokoll', verbatimProtocol: 'Niederschrift', auxiliary: 'Anlage' };
  const now = () => new Date().toISOString();

  function statusPill(m) {
    if (m.abgesagt) return '<span class="pill bad">abgesagt</span>';
    if (m.status === 'eingeladen') return '<span class="pill">eingeladen</span>';
    if (m.status === 'terminiert') return '<span class="pill plain">terminiert</span>';
    if (m.status === 'durchgeführt') return '<span class="pill ok">durchgeführt</span>';
    return m.status ? `<span class="pill plain">${esc(m.status)}</span>` : '';
  }
  const dateBox = (iso) => `<div class="date" aria-hidden="true"><div class="m">${esc(fmt(iso, { month: 'short' }).replace('.', ''))}</div><div class="d">${esc(fmt(iso, { day: 'numeric' }))}</div><div class="w">${esc(fmt(iso, { weekday: 'short' }).replace('.', ''))}</div></div>`;

  function toast(html, action) {
    $toast.innerHTML = html + (action ? `<button type="button">${esc(action.label)}</button>` : '');
    $toast.hidden = false;
    if (action) $toast.querySelector('button').onclick = action.run;
    else setTimeout(() => ($toast.hidden = true), 3500);
  }

  // ---------- Darstellung: nachts dunkel (window.nachtModus in index.html), sonst wie im Gerät ----------
  function darstellung() {
    const dunkel = window.nachtModus?.() || matchMedia('(prefers-color-scheme: dark)').matches;
    document.querySelector('meta[name="theme-color"]').content = dunkel ? '#5c1d29' : '#7b2736';
  }
  darstellung();
  setInterval(darstellung, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) darstellung(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', darstellung);

  // ---------- Daten ----------
  async function getJson(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status} für ${url}`);
    $offline.hidden = r.headers.get('x-ratsblick-cache') !== 'offline';
    return r.json();
  }

  async function quelle(id) {
    if (loaded.has(id)) return loaded.get(id);
    const D = await getJson(`data/${encodeURIComponent(id)}.json`);
    const x = { D, k: new Map(), s: new Map(), v: new Map(), sByK: new Map(), vByK: new Map() };
    for (const k of D.koerperschaften) { x.k.set(k.id, k); x.sByK.set(k.id, []); x.vByK.set(k.id, []); }
    for (const m of D.sitzungen) { x.s.set(m.id, m); x.sByK.get(m.k)?.push(m); }
    for (const v of D.vorlagen) { x.v.set(v.id, v); x.vByK.get(v.k)?.push(v); }
    loaded.set(id, x);
    return x;
  }

  /** Findet die Quelle zu einer OParl-ID über den Hostnamen. */
  function quelleFuerObjekt(id) {
    // Bereits geladene Quelle, die das Objekt enthält (häufigster Fall: Klick innerhalb einer Kommune)
    for (const [qid, x] of loaded) if (x.s.has(id) || x.v.has(id)) return qid;
    // Sonst über die Adresse: mehrere Quellen können auf einem Server liegen (sessionnet.owl-it.de, sitzung-online.de) –
    // dann die mit dem längsten gemeinsamen Pfad zur Systemadresse („…/vglandstuhl/bi/“)
    try {
      const host = new URL(id).hostname;
      const gemeinsam = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
      const kandidaten = INDEX.quellen.filter((qq) => qq.host === host);
      kandidaten.sort((a, b) => gemeinsam(b.system || '', id) - gemeinsam(a.system || '', id));
      return kandidaten[0]?.id ?? null;
    } catch { return null; }
  }


  // ---------- Navigation über die Adresse (#/…) ----------
  const enc = encodeURIComponent;
  function link(...parts) { return '#/' + parts.map(enc).join('/'); }
  function go(hash) { depth++; location.hash = hash; }
  function back() { if (depth > 0) { depth--; history.back(); } else location.hash = kommune ? link('g', kommune) : '#/'; }
  // Logo: immer zur Startseite (Suche), Eingabe zurücksetzen
  document.getElementById('home').addEventListener('click', (e) => {
    e.preventDefault(); depth = 0; q = '';
    if (location.hash === '#/' || location.hash === '') route(); else location.hash = '#/';
  });
  window.addEventListener('hashchange', () => route());

  // Reichweitenmessung (nur wenn ZAEHLER gesetzt): meldet je Seitenwechsel nur die Art der App-Seite, nie Suchbegriffe oder Sitzungs-/Vorlagen-IDs
  function starteZaehler() {
    if (!ZAEHLER) return;
    window.goatcounter = { no_onload: true, endpoint: ZAEHLER };
    const pfad = () => {
      const r = parse();
      if (r.v === 'g' && r.a) return '/g/' + r.a + (r.b ? '/' + r.b : '');
      return '/' + (r.v || '');
    };
    const zaehle = () => { try { window.goatcounter.count({ path: pfad(), title: pfad() }); } catch {} };
    const sk = document.createElement('script');
    sk.async = true;
    sk.src = 'https://gc.zgo.at/count.js';
    sk.dataset.goatcounter = ZAEHLER;
    sk.onload = () => { zaehle(); window.addEventListener('hashchange', zaehle); };
    document.head.appendChild(sk);
  }
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    depth = 0;
    const tab = b.dataset.tab;
    if (tab === 'fav') location.hash = link('fav');
    else if (tab === 'themen') location.hash = link('themen');
    else if (tab === 'info') location.hash = link('info');
    else location.hash = '#/';
  }));

  function parse() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    return { v: parts[0] || '', a: parts[1], b: parts[2] };
  }

  async function route() {
    const r = parse();
    let tab = 'wahl';
    try {
      if (r.v === 'k') {
        // ältere Links auf Körperschaften
        location.replace(link('g', gebietVonBody.get(r.a) ?? 'b:' + r.a, ...(r.b ? [r.b] : [])));
        return;
      } else if (r.v === 'g' && G.has(r.a)) {
        kommune = r.a; store.set('kommune', kommune); tab = 'wahl';
        await vGebiet(r.a, r.b);
      } else if (r.v === 's' || r.v === 'v') {
        tab = 'wahl';
        const qid = quelleFuerObjekt(r.a);
        if (!qid) throw new Error('Unbekannte Quelle');
        const x = await quelle(qid);
        if (r.v === 's') vSitzung(x, r.a); else vVorlage(x, r.a);
      } else if (r.v === 'fav') {
        tab = 'fav';
        await vFavoriten();
      } else if (r.v === 'info') {
        tab = 'info';
        vInfo();
      } else if (TEXTSEITEN[r.v]) {
        tab = 'info';
        vText(r.v);
      } else if (r.v === 'themen' || r.v === 'abo') {
        tab = 'themen';
        await vThemen();
      } else {
        vWahl();
      }
    } catch (err) {
      setTitle('');
      $view.innerHTML = `<div class="card empty">Das konnte nicht geladen werden (${esc(err.message)}). Prüfen Sie die Verbindung und laden Sie die Seite neu.</div>`;
    }
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
    window.scrollTo(0, 0);
  }

  function setTitle(text) { $title.textContent = text || ''; }
  const backLink = '<button class="backlink" type="button" data-back><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>Zurück</button>';

  // Klicks auf Einträge: Navigation über data-Attribute
  $view.addEventListener('click', (e) => {
    if (e.target.closest('[data-back]')) { e.preventDefault(); back(); return; }
    const stern = e.target.closest('[data-fav]');
    if (stern) { e.preventDefault(); favUmschalten(stern); return; }
    const el = e.target.closest('[data-go]');
    if (el) { e.preventDefault(); go(el.dataset.go); }
  });

  // ---------- Installationshinweis ----------
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; if (parse().v === 'wahl' || !parse().v) route(); });
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  function installCard() {
    if (standalone() || store.get('installHidden', false)) return '';
    if (installEvent) return `<div class="card install"><p>Wahlheimat als App auf dem Startbildschirm ablegen.</p><button class="btn" type="button" id="inst">Installieren</button><button class="x" type="button" id="instx" aria-label="Hinweis ausblenden">×</button></div>`;
    if (isIos()) return `<div class="card install"><p>Als App nutzen: in Safari auf <strong>Teilen</strong> tippen, dann <strong>Zum Home-Bildschirm</strong>.</p><button class="x" type="button" id="instx" aria-label="Hinweis ausblenden">×</button></div>`;
    return '';
  }
  function bindInstall() {
    document.getElementById('inst')?.addEventListener('click', async () => { installEvent.prompt(); await installEvent.userChoice; installEvent = null; route(); });
    document.getElementById('instx')?.addEventListener('click', () => { store.set('installHidden', true); route(); });
  }

  // ---------- Gebiete ----------
  const fmtZahl = (n) => (n == null ? '' : new Intl.NumberFormat('de-DE').format(n));
  const kreisKurz = (name) => String(name || '').replace(/^Landkreis /, '');
  /** Daten vorhanden: selbst oder über Verbandsgemeinde bzw. Kreis */
  const hatDaten = (g) => !!(g && (g.q || (g.vg && G.get(g.vg)?.q) || (g.kreis && G.get(g.kreis)?.q)));

  function ladeIndex(idx) {
    INDEX = idx;
    for (const [id, name, art] of idx.kreise) G.set(id, { id, name, art, typ: art === 'Kreisfreie Stadt' ? 'kreisfrei' : 'kreis' });
    for (const [id, name, kreis] of idx.vgs) G.set(id, { id, name, art: 'Verbandsgemeinde', typ: 'vg', kreis });
    for (const [id, name, art, plz, kreis, vg, ew] of idx.gemeinden) G.set(id, { id, name, art, typ: 'gemeinde', plz, kreis, vg, ew });
    for (const [id, [qid, bid]] of Object.entries(idx.daten)) {
      const g = G.get(id); if (g) { g.q = qid; g.b = bid; }
      gebietVonBody.set(bid, id);
    }
    // Körperschaften ohne Gebietskörperschaft (Zweckverbände u. a.)
    for (const qq of idx.quellen) for (const w of qq.weitere) {
      if (/^Verbandsgemeinde /.test(w.name)) continue; // ehemalige Verbandsgemeinden
      const id = 'b:' + w.id;
      G.set(id, { id, name: w.name, art: w.art, typ: 'body', plz: w.plz, q: qq.id, b: w.id, kreis: G.get(qq.gebiet)?.kreis ?? null, vg: G.get(qq.gebiet)?.typ === 'vg' ? qq.gebiet : null });
      gebietVonBody.set(w.id, id);
    }
    // frühere Auswahl (Körperschafts-ID) übernehmen
    const migr = (id) => (G.has(id) ? id : gebietVonBody.get(id) ?? null);
    kommune = kommune ? migr(kommune) : null;
    try { localStorage.removeItem('ratsblick:zuletzt'); } catch {} // „Zuletzt angesehen“ gibt es nicht mehr
  }

  function anzeigeName(g) {
    if (g.typ === 'gemeinde') return g.art === 'Ortsgemeinde' || g.art === 'Gemeinde' ? `${g.art} ${g.name}` : g.art === 'Stadt' ? `Stadt ${g.name}` : g.name;
    return g.name;
  }
  function untertitel(g) {
    const teile = [];
    if (g.typ === 'gemeinde') teile.push(g.plz);
    if (g.typ === 'gemeinde' && g.art === 'Kreisfreie Stadt') teile.push('kreisfreie Stadt');
    if (g.vg && g.typ !== 'vg') teile.push(G.get(g.vg)?.name.replace('Verbandsgemeinde', 'VG'));
    if (g.kreis) teile.push(G.get(g.kreis)?.name);
    if (g.typ === 'body') teile.unshift(g.art);
    return teile.filter(Boolean).join(' · ');
  }

  // ---------- Ansicht: Startseite (nur Suche) ----------
  const rang = { gemeinde: 0, kreisfrei: 0, vg: 1, kreis: 2, body: 3 };
  function suche(text) {
    const t = text.trim().toLowerCase();
    if (!t) return [];
    const plz = /^\d+$/.test(t);
    const hits = [];
    for (const g of G.values()) {
      if (g.typ === 'kreisfrei') continue; // die Stadt selbst steht bei den Gemeinden
      let score = -1;
      if (plz) { if (g.typ === 'gemeinde' && (g.plz || '').startsWith(t)) score = 10; }
      else {
        const name = g.name.toLowerCase(), kurz = kurzName(kreisKurz(g.name)).toLowerCase();
        if (kurz === t) score = 40;
        else if (kurz.startsWith(t)) score = 30;
        else if (name.includes(t)) score = 20;
      }
      if (score < 0) continue;
      hits.push({ g, score: score - rang[g.typ] * 2 + (hatDaten(g) ? 1 : 0) + Math.min((g.ew || 0) / 1e6, 0.5) });
    }
    return hits.sort((a, b) => b.score - a.score || a.g.name.localeCompare(b.g.name, 'de')).slice(0, 8).map((h) => h.g);
  }
  function gebietRow(g) {
    return `<button class="row" type="button" data-go="${esc(link('g', g.id))}"><div class="body"><span class="title">${esc(anzeigeName(g))}</span><span class="meta">${esc(untertitel(g))}</span></div>${hatDaten(g) ? '' : '<span class="pill plain">ohne Daten</span>'}${chev}</button>`;
  }
  function vWahl() {
    setTitle('');
    const gemeinden = INDEX.gemeinden.length;
    const mitDaten = INDEX.gemeinden.filter(([id]) => hatDaten(G.get(id))).length;
    $view.innerHTML = `
      <div class="home">
        ${installCard()}
        <section class="hero">
          <p class="slogan">Guter Rat ist nicht teuer.</p>
          <h3>Was beschließt mein Gemeinderat?</h3>
          <p class="lead">Sitzungen, Tagesordnungen und Vorlagen meiner Kommune – verständlich an einem Ort.</p>
        </section>
        <form class="searchbox" id="sf" role="search" autocomplete="off">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
          <input id="q" type="search" inputmode="search" enterkeyhint="search" placeholder="Kommune oder Postleitzahl" value="${esc(q)}" aria-label="Kommune oder Postleitzahl">
        </form>
        <div id="hits"></div>
        <p class="coverage">Alle ${fmtZahl(gemeinden)} Gemeinden in Rheinland-Pfalz · Sitzungsdaten für ${fmtZahl(mitDaten)} davon<br>Datenstand ${esc(stand(INDEX.erstellt))}</p>
      </div>`;
    const input = document.getElementById('q');
    const $hits = document.getElementById('hits');
    const show = () => {
      q = input.value;
      const hits = suche(q);
      $hits.innerHTML = !q.trim() ? '' : hits.length
        ? `<div class="list suggest">${hits.map(gebietRow).join('')}</div>`
        : `<div class="card empty">Keine Kommune in Rheinland-Pfalz gefunden für „${esc(q.trim())}“.</div>`;
    };
    input.addEventListener('input', show);
    document.getElementById('sf').addEventListener('submit', (e) => {
      e.preventDefault();
      const first = suche(input.value)[0];
      if (first) { input.blur(); go(link('g', first.id)); }
    });
    show();
    bindInstall();
  }

  // ---------- Ebenen ----------
  function ebenen(g) {
    if (g.typ === 'body') {
      return [
        { key: 'gemeinde', label: 'Verband', sub: kurzName(g.name), g, off: false },
        { key: 'vg', label: 'VG', sub: g.vg ? kurzName(G.get(g.vg).name) : '–', g: g.vg ? G.get(g.vg) : null, off: !g.vg },
        { key: 'kreis', label: 'Kreis', sub: g.kreis ? kreisKurz(G.get(g.kreis).name) : '–', g: g.kreis ? G.get(g.kreis) : null, off: !g.kreis },
      ];
    }
    const gem = g.typ === 'gemeinde' ? g : null;
    const vg = g.typ === 'vg' ? g : g.vg ? G.get(g.vg) : null;
    const kreis = g.typ === 'kreis' ? g : g.kreis ? G.get(g.kreis) : null;
    return [
      { key: 'gemeinde', label: gem?.art === 'Kreisfreie Stadt' || gem?.art === 'Stadt' ? 'Stadt' : 'Gemeinde', sub: gem ? gem.name : '–', g: gem, off: !gem },
      { key: 'vg', label: 'VG', sub: vg ? kurzName(vg.name) : gem ? 'verbandsfrei' : '–', g: vg, off: !vg },
      { key: 'kreis', label: 'Kreis', sub: kreis ? kreisKurz(kreis.name) : gem?.art === 'Kreisfreie Stadt' ? 'kreisfrei' : '–', g: kreis, off: !kreis },
    ];
  }

  // ---------- Favoriten (Gremien, nur auf diesem Gerät gespeichert) ----------
  // Gremium: { q: Quelle, k: Körperschaft, g: Gremiumsname, kn: Name der Körperschaft, ort: Gebiet für die Rückkehr }
  // Kommune (Gemeinde, Stadt, VG, Kreis): { typ: 'gebiet', id: Gebiets-ID }
  const favKey = (f) => (f.typ === 'gebiet' ? `gebiet|${f.id}` : `${f.q}|${f.k}|${f.g}`);
  const favName = (f) => (f.typ === 'gebiet' ? (G.has(f.id) ? anzeigeName(G.get(f.id)) : f.id) : gremiumKurz(f.g));
  function favoriten() { return store.get('favoriten', []); }
  function istFav(f) { return favoriten().some((x) => favKey(x) === favKey(f)); }
  function sternKnopf(f) {
    const an = istFav(f);
    return `<button class="stern" type="button" data-fav="${esc(JSON.stringify(f))}" aria-pressed="${an}" aria-label="${an ? 'Aus Favoriten entfernen' : 'Als Favorit merken'}: ${esc(favName(f))}">
      <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg></button>`;
  }
  function favUmschalten(el) {
    const f = JSON.parse(el.dataset.fav);
    const an = istFav(f);
    store.set('favoriten', an ? favoriten().filter((x) => favKey(x) !== favKey(f)) : [...favoriten(), f]);
    el.setAttribute('aria-pressed', String(!an));
    el.setAttribute('aria-label', `${!an ? 'Aus Favoriten entfernen' : 'Als Favorit merken'}: ${favName(f)}`);
    toast(!an ? `<span>„${esc(favName(f))}“ unter Favoriten gemerkt</span>` : 'Aus den Favoriten entfernt');
    if (an && parse().v === 'fav') route(); // entfernter Favorit verschwindet aus der Liste
  }
  function gremienVon(sitz) {
    // Gremien einer Körperschaft, nach Zahl der Sitzungen
    const n = new Map();
    for (const m of sitz) for (const g of m.gremien.length ? m.gremien : []) n.set(g, (n.get(g) || 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de')).map(([g]) => g);
  }

  async function vFavoriten() {
    setTitle('Favoriten');
    const favs = favoriten().filter((f) => f.typ !== 'gebiet' || G.has(f.id));
    if (!favs.length) {
      $view.innerHTML = `<section class="hero"><h3>Favoriten</h3></section>
        <div class="card empty">Noch keine Favoriten. Tippen Sie auf den Stern – neben dem Namen einer Gemeinde, Stadt, Verbandsgemeinde oder eines Kreises, bei einem Gremium in einer Sitzung oder auf der Seite Ihrer Kommune unter „Gremien“. Hier finden Sie dann jeweils die nächste und letzte Sitzung.</div>`;
      return;
    }
    const jetzt = now();
    const sitzungen = (sitz) => {
      const naechste = sitz.find((m) => m.start >= jetzt);
      const letzte = sitz.filter((m) => m.start < jetzt).at(-1);
      return [naechste, letzte].filter(Boolean);
    };
    const kommunen = [];
    const gremien = [];
    for (const f of favs) {
      if (f.typ === 'gebiet') {
        const g = G.get(f.id);
        let liste = [];
        if (g.q) {
          try { const x = await quelle(g.q); liste = sitzungen(x.sByK.get(g.b) || []); } catch { /* Quelle nicht erreichbar */ }
        }
        kommunen.push(`<section class="fav">
          <div class="favkopf"><button class="linkbtn favtitel" type="button" data-go="${esc(link('g', f.id))}"><h2>${esc(anzeigeName(g))}</h2><span class="muted small">${esc(untertitel(g))}</span></button>${sternKnopf(f)}</div>
          ${liste.length ? `<div class="list">${liste.map(sitzungRow).join('')}</div>` : `<div class="card empty">${g.q ? 'Im aktuellen Datenstand keine Sitzung.' : 'Für diese Kommune gibt es noch keine Sitzungsdaten.'}</div>`}
        </section>`);
      } else {
        let x = null;
        try { x = await quelle(f.q); } catch { /* Quelle nicht erreichbar */ }
        const liste = x ? sitzungen((x.sByK.get(f.k) || []).filter((m) => m.gremien.includes(f.g))) : [];
        gremien.push(`<section class="fav">
          <div class="favkopf"><div><h2>${esc(gremiumKurz(f.g))}</h2><span class="muted small">${esc(x?.k.get(f.k)?.name || f.kn || '')}</span></div>${sternKnopf(f)}</div>
          ${liste.length ? `<div class="list">${liste.map(sitzungRow).join('')}</div>` : '<div class="card empty">Im aktuellen Datenstand keine Sitzung dieses Gremiums.</div>'}
        </section>`);
      }
    }
    $view.innerHTML = `<section class="hero"><h3>Favoriten</h3><p class="muted small">Nur auf diesem Gerät gespeichert.</p></section>
      ${kommunen.length ? `<p class="favgruppe">Kommunen</p>${kommunen.join('')}` : ''}
      ${gremien.length ? `<p class="favgruppe">Gremien</p>${gremien.join('')}` : ''}`;
  }

  // ---------- Über Wahlheimat, Impressum, Datenschutz ----------
  // Angaben zum Betreiber – nur hier eintragen; fehlende Angaben erscheinen als „[wird ergänzt]“
  const BETREIBER = {
    name: 'Ralph Arnold',
    anschrift: 'St. Norbert Straße 1a\n67677 Enkenbach-Alsenborn\nDeutschland',  // Zeilen mit \n trennen
    email: 'info@wahlheimat-rlp.de',
    paypal: 'https://www.paypal.com/paypalme/RalphArnold973/5',  // PayPal.Me-Link des Betreibers; leer = Unterstützen-Button und PayPal-Absatz im Datenschutz entfallen
  };
  const ang = (v) => (v ? esc(v).replace(/\n/g, '<br>') : '<span class="fehlt">[wird ergänzt]</span>');
  const mail = () => (BETREIBER.email ? `<a href="mailto:${esc(BETREIBER.email)}">${esc(BETREIBER.email)}</a>` : ang(null));
  const extern = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text || url)}</a>`;

  const TEXTSEITEN = {
    ueber: () => ({
      titel: 'Über Wahlheimat',
      html: `<p class="lead">Wahlheimat zeigt an einem Ort, was in den Räten Ihrer Kommune beraten und beschlossen wird – Sitzungen, Tagesordnungen, Vorlagen und Beschlüsse aus ganz Rheinland-Pfalz.</p>
        <h4>Ein unabhängiges Angebot</h4>
        <p>Wahlheimat ist ein privates, unabhängiges Projekt. Es ist <strong>kein Angebot des Landes Rheinland-Pfalz, der Kommunen oder der Anbieter der Ratsinformationssysteme</strong> und wird von ihnen weder betrieben noch beauftragt.</p>
        <h4>Woher die Daten kommen</h4>
        <p>Alle Inhalte stammen aus den öffentlich zugänglichen Ratsinformationssystemen der Gemeinden, Städte, Verbandsgemeinden und Kreise – soweit möglich über die Standardschnittstelle OParl, sonst über die öffentlichen Seiten. Der Abgleich läuft etwa alle sechs Stunden und geht mit den Servern der Kommunen schonend um. Dokumente (PDF) werden nicht kopiert, sondern im Original-System verlinkt.</p>
        <p>Die Sitzverteilung der Räte stammt aus den Ergebnissen der Kommunalwahl 2024 des ${extern('https://www.wahlen.rlp.de/kommunalwahlen/ergebnisse-1', 'Landeswahlleiters Rheinland-Pfalz')}.</p>
        <h4>Ohne Gewähr</h4>
        <p>Wir geben uns Mühe, alles vollständig und richtig darzustellen. Fehler beim Übernehmen oder Zuordnen lassen sich aber nicht ausschließen. <strong>Maßgeblich ist immer das Ratsinformationssystem der Kommune</strong> – jede Sitzung und Vorlage ist dorthin verlinkt.</p>
        <h4>Urheberrecht</h4>
        <p>Vorlagen, Beschlüsse und Bekanntmachungen sind in der Regel amtliche Werke (§ 5 UrhG). Die Rechte an Dokumenten bleiben bei den jeweiligen Stellen. Das Logo ist eine eigene Gestaltung und kein Hoheitszeichen des Landes.</p>`,
    }),
    impressum: () => ({
      titel: 'Impressum',
      html: `<h4>Angaben gemäß § 5 DDG</h4>
        <p>${ang(BETREIBER.name)}<br>${ang(BETREIBER.anschrift)}</p>
        <h4>Kontakt</h4>
        <p>E-Mail: ${mail()}</p>
        <h4>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h4>
        <p>${ang(BETREIBER.name)}, Anschrift wie oben</p>
        <h4>Hinweis</h4>
        <p>Wahlheimat ist ein unabhängiges, nicht kommerzielles Angebot und kein Angebot des Landes Rheinland-Pfalz oder der Kommunen. Für die Inhalte verlinkter Seiten, insbesondere der Ratsinformationssysteme, sind deren Betreiber verantwortlich.</p>`,
    }),
    datenschutz: () => ({
      titel: 'Datenschutz',
      html: `<p class="lead">${ZAEHLER
          ? 'Kurz gesagt: Wahlheimat braucht keine Anmeldung, setzt keine Cookies, legt keine Profile an und zeigt keine Werbung. Gezählt wird nur anonym, wie oft App-Seiten aufgerufen werden (Abschnitt 3a). Was Sie sich merken, bleibt auf Ihrem Gerät.'
          : 'Kurz gesagt: Wahlheimat braucht keine Anmeldung, setzt keine Cookies, verwendet kein Tracking und keine Analyse- oder Werbedienste. Was Sie sich merken, bleibt auf Ihrem Gerät.'}</p>
        <h4>1. Verantwortlich</h4>
        <p>${ang(BETREIBER.name)}, ${ang(BETREIBER.anschrift)}, E-Mail: ${mail()}</p>
        <h4>2. Bereitstellung der Website (Hosting)</h4>
        <p>Die Website liegt bei GitHub Pages (GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, USA). Beim Aufruf verarbeitet GitHub technisch notwendige Daten wie IP-Adresse, Zeitpunkt, abgerufene Datei und Browser-Kennung, um die Seite auszuliefern und vor Missbrauch zu schützen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einer sicheren, funktionierenden Website). GitHub ist nach dem EU-US Data Privacy Framework zertifiziert. Einzelheiten: ${extern('https://docs.github.com/de/site-policy/privacy-policies/github-general-privacy-statement', 'Datenschutzerklärung von GitHub')}.</p>
        <p>Schriften und alle übrigen Bestandteile der App werden von dieser Website selbst geladen, nicht von Dritten${ZAEHLER ? ' (einzige Ausnahme: das Zählskript, siehe 3a)' : ''}.</p>
        <h4>3. Speicher auf Ihrem Gerät</h4>
        <p>Die App speichert im Speicher Ihres Browsers (<em>localStorage</em>) Ihre Favoriten, die zuletzt gewählte Kommune und die Einstellungen der Themensuche, außerdem App-Dateien und den zuletzt geladenen Datenstand für die Nutzung ohne Verbindung. Diese Angaben verlassen Ihr Gerät nicht und werden nicht an uns übertragen. Sie dienen ausschließlich Funktionen, die Sie selbst nutzen (§ 25 Abs. 2 Nr. 2 TDDDG); eine Einwilligung ist dafür nicht erforderlich. Sie können sie jederzeit löschen, indem Sie die Websitedaten in Ihrem Browser entfernen.</p>
        ${ZAEHLER ? `<h4>3a. Reichweitenmessung (GoatCounter)</h4>
        <p>Um zu verstehen, wie Wahlheimat genutzt wird, zählen wir Seitenaufrufe mit GoatCounter (Martin Tournoij, Irland; Betrieb auf Servern der Hetzner Online GmbH in Finnland und Deutschland). Dafür lädt Ihr Browser ein kleines Skript von gc.zgo.at und meldet bei jedem Seitenwechsel, welche Art von App-Seite aufgerufen wurde (zum Beispiel eine Kommune, nie Ihre Suchbegriffe), dazu die Verweisseite, Browser und Betriebssystem in groben Kategorien, die Bildschirmbreite, die Sprache und – aus der IP-Adresse abgeleitet – das Land. Nach Angaben des Anbieters werden dabei weder Ihre IP-Adresse noch die vollständige Browserkennung noch eine Nutzerkennung gespeichert, und es wird nichts auf Ihrem Gerät abgelegt; ausgewertet wird nur in Summen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einer bedarfsgerechten Weiterentwicklung). Sie können der Messung widersprechen (Art. 21 DSGVO), etwa indem Sie Skripte für diese Seite blockieren oder uns schreiben. Weitere Angaben: ${extern('https://www.goatcounter.com/privacy', 'Datenschutzerklärung von GoatCounter')}.</p>` : ''}
        <h4>4. Links zu Ratsinformationssystemen</h4>
        <p>Wenn Sie einen Link zu einem Ratsinformationssystem oder Dokument antippen, verbindet sich Ihr Browser direkt mit dem Server der jeweiligen Kommune bzw. ihres Anbieters. Dafür gelten deren Datenschutzhinweise.${BETREIBER.paypal ? ` Dasselbe gilt für den freiwilligen Unterstützen-Button auf der Info-Seite: Erst wenn Sie ihn antippen, wechseln Sie zu PayPal (PayPal (Europe) S.à r.l. et Cie, S.C.A., Luxemburg); vorher werden keine Daten an PayPal übertragen. Bei einer Zahlung erhalten wir nur die Angaben, die PayPal uns dazu mitteilt (etwa Name, Betrag und Zeitpunkt), und verwenden sie nur zur Abwicklung und Dokumentation (Art. 6 Abs. 1 lit. b und c DSGVO). Es gelten die Datenschutzhinweise von PayPal.` : ''}</p>
        <h4>5. Personenbezogene Angaben in Ratsunterlagen</h4>
        <p>Wahlheimat gibt öffentlich bekannt gemachte Informationen aus den Ratsinformationssystemen wieder, darunter Titel von Tagesordnungspunkten und Vorlagen, in denen Namen vorkommen können. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (öffentliches Interesse an nachvollziehbarer Kommunalpolitik). Sie können dem jederzeit widersprechen (Art. 21 DSGVO); wir prüfen das und entfernen die Angaben.</p>
        <h4>6. Kontakt per E-Mail</h4>
        <p>Wenn Sie uns schreiben, verwenden wir Ihre Angaben nur, um Ihre Anfrage zu bearbeiten (Art. 6 Abs. 1 lit. b bzw. f DSGVO), und löschen sie, sobald sie dafür nicht mehr nötig sind.</p>
        <h4>7. Ihre Rechte</h4>
        <p>Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18) und Widerspruch (Art. 21). Außerdem können Sie sich bei einer Datenschutz-Aufsichtsbehörde beschweren, etwa beim ${extern('https://www.datenschutz.rlp.de', 'Landesbeauftragten für den Datenschutz und die Informationsfreiheit Rheinland-Pfalz')}, Hintere Bleiche 34, 55116 Mainz.</p>
        <p class="muted small">Stand: Oktober 2026</p>`,
    }),
  };

  // Reiter „Info“: Übersicht der Textseiten
  function vInfo() {
    setTitle('Info');
    const zeile = (art, text) => `<button class="row" type="button" data-go="${esc(link(art))}"><div class="body"><span class="title">${esc(TEXTSEITEN[art]().titel)}</span><span class="meta">${esc(text)}</span></div>${chev}</button>`;
    const spende = `<section class="card spende" aria-labelledby="spende-t">
        <h4 id="spende-t">Guter Rat ist nicht teuer – für dich.</h4>
        <p>Für mich allerdings schon. Demokratie und Transparenz gehören zusammen. Großes fängt oft im Kleinen an, deshalb soll Wahlheimat wachsen. Das ist kostspielig und zeitintensiv: Alles hier wird in meiner Freizeit gepflegt, gewartet und weiterentwickelt. Auch in Zeiten von KI müssen Entscheidungen getroffen, abgewogen und gestaltet werden – und das ist aufwendig.</p>
        <p>Wenn du möchtest, dass Projekte wie dieses weitergeführt werden können, tippe auf den Button und hilf mit, Demokratie erlebbar und transparent zu machen. <strong>5 € sind für dich nicht viel, machen unser Land aber zu einem besseren Ort.</strong></p>
        ${BETREIBER.paypal ? `<a class="btn spendenknopf" href="${esc(BETREIBER.paypal)}" target="_blank" rel="noopener">Mit PayPal unterstützen</a>` : ''}
        <p class="muted small">Freiwillige Unterstützung eines privaten Projekts; keine Spendenbescheinigung. Du verlässt dafür die App und wechselst zu PayPal.</p>
      </section>`;
    $view.innerHTML = `<section class="hero"><h3>Info</h3><p class="muted small">Wahlheimat ist ein unabhängiges Angebot – kein Angebot des Landes oder der Kommunen.</p></section>
      <div class="list">
        ${zeile('ueber', 'Was Wahlheimat ist, woher die Daten kommen, Kontakt')}
        ${zeile('impressum', 'Anbieterkennzeichnung')}
        ${zeile('datenschutz', ZAEHLER ? 'Keine Cookies, keine Profile – die Einzelheiten' : 'Keine Cookies, kein Tracking – die Einzelheiten')}
      </div>
      ${spende}
      <p class="stand">Datenstand ${esc(stand(INDEX.erstellt))}</p>`;
  }

  function vText(art) {
    const t = TEXTSEITEN[art]();
    setTitle(t.titel);
    $view.innerHTML = `${backLink}<section class="hero"><h3>${esc(t.titel)}</h3></section><div class="card textseite">${t.html}</div>`;
  }

  // ---------- Ansicht: Kommune (eine Ebene) ----------
  const ERKLAERUNG = {
    vg: 'Die Verbandsgemeinde entscheidet u. a. über Grundschulen, Feuerwehr, Wasser, Abwasser und den Flächennutzungsplan.',
    kreis: 'Der Kreis ist u. a. zuständig für weiterführende Schulen, Kreisstraßen, Abfall, Rettungsdienst und Soziales.',
  };
  async function vGebiet(id, ebene) {
    let g = G.get(id);
    if (g.typ === 'kreisfrei') { location.replace(link('g', id + '000')); return; }
    const eb = ebenen(g);
    const sel = eb.find((e) => e.key === ebene && !e.off)
      || eb.find((e) => !e.off && e.g.q) || eb.find((e) => !e.off);
    setTitle(kurzName(kreisKurz(g.name)));
    const seg = `<div class="seg" role="group" aria-label="Ebene">${eb.map((e) => `<button type="button" ${e.off ? 'disabled' : `data-go="${esc(link('g', id, e.key))}"`} aria-pressed="${e.key === sel.key}" class="${!e.off && !e.g.q ? 'nodata' : ''}">${e.label}<small>${esc(e.sub)}</small></button>`).join('')}</div>`;
    const t = sel.g;
    const kopf = `<section class="hero"><div class="favkopf"><h3>${esc(anzeigeName(t))}</h3>${sternKnopf({ typ: 'gebiet', id: t.id })}</div><p class="muted small">${esc([t.ew ? fmtZahl(t.ew) + ' Einwohner' : '', sel.key !== 'gemeinde' ? ERKLAERUNG[sel.key] : untertitel(t)].filter(Boolean).join(' · '))}</p></section>`;

    if (!t.q) {
      $view.innerHTML = seg + kopf + SITZE_PLATZ + ohneDaten(t, eb);
      sitzverteilung(t);
      return;
    }
    const x = await quelle(t.q);
    const sitz = x.sByK.get(t.b) || [];
    const jetzt = now();
    const kommend = sitz.filter((m) => m.start >= jetzt);
    const vergangen = sitz.filter((m) => m.start < jetzt).reverse().slice(0, 6);
    const vorl = (x.vByK.get(t.b) || []).slice(0, 10);
    const gremien = gremienVon(sitz);
    $view.innerHTML = `${seg}${kopf}${SITZE_PLATZ}${nurTermineHinweis(x)}
      <section class="spalte"><h2>Nächste Sitzungen</h2>
        ${kommend.length ? `<div class="list">${kommend.map(sitzungRow).join('')}</div>` : '<div class="card empty">Zurzeit sind keine Sitzungen angekündigt.</div>'}
      </section>
      ${x.D.quelle.nurTermine ? '' : `<section class="spalte"><h2>Neue Vorlagen</h2>
        ${vorl.length ? `<div class="list">${vorl.map(vorlageRow).join('')}</div>` : '<div class="card empty">Keine aktuellen Vorlagen.</div>'}
      </section>`}
      ${vergangen.length ? `<section><h2>Zuletzt getagt</h2><div class="list">${vergangen.map(sitzungRow).join('')}</div></section>` : ''}
      ${gremien.length ? `<section><details class="gremien"><summary>Gremien (${gremien.length}) – mit dem Stern als Favorit merken</summary>
        <div class="list">${gremien.map((g) => `<div class="row static"><div class="body"><span class="title">${esc(gremiumKurz(g))}</span></div>${sternKnopf({ q: t.q, k: t.b, g, kn: x.k.get(t.b)?.name || '', ort: id })}</div>`).join('')}</div>
      </details></section>` : ''}
      ${risLink(null, x.D.quelle.ris, '', x.D.quelle.ohneRis)}
      <p class="stand">Abgleich mit ${esc(x.D.quelle.name)}: ${esc(stand(x.D.quelle.abgleich))}</p>`;
    sitzverteilung(t);
  }

  // ---------- Sitzverteilung (Kommunalwahl 2024, data/sitze.json) ----------
  const SITZE_PLATZ = '<section id="sitze" hidden></section>';
  let SITZE = null;
  // Übliche Parteifarben [hell, dunkel]; CDU im Dunkeln grau, damit der Bogen sichtbar bleibt
  const PARTEIFARBE = {
    CDU: ['#2b2b2b', '#a3a3a3'], SPD: ['#e3000f', '#ff5a64'], 'GRÜNE': ['#1aa037', '#4cc06a'], FDP: ['#f5d300', '#f5d300'],
    'FREIE WÄHLER': ['#f29400', '#f5a733'], AfD: ['#009ee0', '#38b6ec'], 'DIE LINKE': ['#be3075', '#dc5f95'],
    BSW: ['#792351', '#b25586'], Volt: ['#502379', '#9270c4'], 'ÖDP': ['#ff6400', '#ff8a3d'], 'Die PARTEI': ['#870e2f', '#c84a6a'],
    PIRATEN: ['#e46c0a', '#f08a3a'], Tierschutzpartei: ['#506928', '#86a352'],
  };
  // Wählergruppen: feste Reihenfolge (geprüft auf Farbsehschwäche), ab der vierten grau – jede steht mit Namen in der Liste
  const WG_FARBEN = [['#2a9d8f', '#2a9d8f'], ['#a0522d', '#a0522d'], ['#6a5acd', '#6a5acd']];
  const WG_REST = ['#9a9a9a', '#6a6a6a'];
  const RAT_ART = { Gemeinderat: 'Gemeinderat', Stadtrat: 'Stadtrat', Verbandsgemeinderat: 'Verbandsgemeinderat', Kreistag: 'Kreistag' };

  async function sitzverteilung(t) {
    const el = document.getElementById('sitze');
    if (!el) return;
    try { SITZE = SITZE || await getJson('data/sitze.json'); } catch { return; }
    // Kreisfreie Städte: Stadtrat unter dem Kreisschlüssel
    const r = SITZE.raete[t.id] || (t.id.length === 8 && t.id.endsWith('000') ? SITZE.raete[t.id.slice(0, 5)] : null);
    if (!r || !document.body.contains(el)) return;
    let rat = r.rat;
    if (rat === 'Gemeinderat' && /Stadt/.test(t.art || '')) rat = 'Stadtrat';
    if (rat === 'Gemeinderat' && t.art === 'Ortsgemeinde') rat = 'Ortsgemeinderat';
    el.hidden = false;
    if (r.mehrheitswahl) {
      // Oben auf der Seite nur eine dezente Zeile statt eines Kastens
      el.innerHTML = `<p class="muted small sitz-mw">${esc(rat)}: 2024 per Mehrheitswahl gewählt (nur eine oder keine Liste) – keine Sitzverteilung nach Parteien.</p>`;
      return;
    }
    let wg = 0;
    const listen = r.listen.filter((l) => l[1] > 0).map(([name, sitze, prozent, vorher, lang]) => {
      const p = String(name).startsWith('#') ? SITZE.parteien[String(name).slice(1)] : null;
      // Die Quelle kürzt Namen auf 20 Zeichen („FWG Trier-Saarburg e“) – dann den vollen Namen zeigen
      const kurz = p ? p.name : String(name).length >= 20 && lang ? lang : name;
      const farbe = PARTEIFARBE[kurz] || (wg < WG_FARBEN.length ? WG_FARBEN[wg++] : WG_REST);
      return { kurz, lang: p ? p.lang : lang, sitze, prozent, vorher, farbe, wg: !p };
    });
    const weg = r.listen.filter((l) => l[1] === 0).map(([name]) => (String(name).startsWith('#') ? SITZE.parteien[String(name).slice(1)]?.name : name)).filter(Boolean);
    const summe = listen.reduce((a, l) => a + l.sitze, 0) || 1;
    // Halbkreis: von links (180°) nach rechts (0°), Mittelpunkt 100/100, Ring 56–92
    const R = 92, r0 = 56, pt = (rad, w) => `${(100 + rad * Math.cos(w)).toFixed(2)},${(100 - rad * Math.sin(w)).toFixed(2)}`;
    let w0 = Math.PI;
    const boegen = listen.map((l, i) => {
      const w1 = w0 - Math.PI * (l.sitze / summe);
      const gross = w0 - w1 > Math.PI ? 1 : 0;
      const d = `M${pt(R, w0)} A${R},${R} 0 ${gross} 1 ${pt(R, w1)} L${pt(r0, w1)} A${r0},${r0} 0 ${gross} 0 ${pt(r0, w0)} Z`;
      w0 = w1;
      return `<path d="${d}" data-i="${i}" style="--c:${l.farbe[0]};--cd:${l.farbe[1]}"><title>${esc(l.kurz)}: ${l.sitze} ${l.sitze === 1 ? 'Sitz' : 'Sitze'}</title></path>`;
    }).join('');
    // Wählergruppen haben 2024 neue Kennungen – ohne Vorwert kein Vergleich; bei Parteien heißt das „neu im Rat“
    const diff = (l) => (l.vorher == null ? (l.wg ? '<span title="Vergleich nicht verfügbar">–</span>' : '<span class="neu">neu</span>') : l.sitze === l.vorher ? '±0' : (l.sitze > l.vorher ? '+' : '−') + Math.abs(l.sitze - l.vorher));
    // Kompakt oben auf der Kommunenseite: Halbkreis und Kurzlegende, die Tabelle zum Aufklappen
    el.innerHTML = `<h2>Sitzverteilung im ${esc(rat)}</h2>
      <div class="card sitz">
        <div class="sitz-oben">
          <svg viewBox="0 0 200 108" role="img" aria-label="Sitzverteilung im ${esc(rat)}: ${esc(listen.map((l) => `${l.kurz} ${l.sitze}`).join(', '))}">${boegen}
            <text x="100" y="88" class="summe">${summe}</text><text x="100" y="102" class="summe-l">Sitze</text></svg>
          <ul class="sitz-kurz" aria-hidden="true">${listen.map((l, i) => `<li data-i="${i}"><i style="--c:${l.farbe[0]};--cd:${l.farbe[1]}"></i><span title="${esc(l.lang || l.kurz)}">${esc(l.kurz)}</span> <b>${l.sitze}</b></li>`).join('')}</ul>
        </div>
        <details class="sitz-mehr"><summary>Alle Zahlen</summary>
          <div class="sitzliste" role="table" aria-label="Sitze je Liste">
            <div class="kopf" role="row"><span role="columnheader">Liste</span><span role="columnheader">Sitze</span><span role="columnheader" title="Veränderung gegenüber 2019">ggü. 2019</span><span role="columnheader">Stimmen</span></div>
            ${listen.map((l, i) => `<div class="zeile" role="row" data-i="${i}"><span role="cell"><i style="--c:${l.farbe[0]};--cd:${l.farbe[1]}"></i><span title="${esc(l.lang || l.kurz)}">${esc(l.kurz)}</span></span><span role="cell" class="zahl">${l.sitze}</span><span role="cell" class="zahl muted">${diff(l)}</span><span role="cell" class="zahl muted">${l.prozent != null ? l.prozent.toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' %' : ''}</span></div>`).join('')}
          </div>
          ${weg.length ? `<p class="muted small">2024 nicht mehr im Rat: ${esc(weg.join(', '))}</p>` : ''}
          <p class="muted small">Kommunalwahl 9. Juni 2024 · Quelle: <a href="https://www.wahlen.rlp.de/kommunalwahlen/ergebnisse-1" target="_blank" rel="noopener">Landeswahlleiter Rheinland-Pfalz</a></p>
        </details>
      </div>`;
    // Hover: Bogen und Zeile gemeinsam hervorheben
    const an = (i) => el.querySelectorAll('[data-i]').forEach((x) => x.classList.toggle('aktiv', i != null && x.dataset.i === i));
    el.querySelectorAll('[data-i]').forEach((x) => {
      x.addEventListener('mouseenter', () => an(x.dataset.i));
      x.addEventListener('mouseleave', () => an(null));
      x.addEventListener('click', () => an(x.dataset.i));
    });
  }

  // Hinweis für Quellen, die nur Termine liefern (Kalenderexport); freundlich, die Gründe liegen beim Anbieter
  function nurTermineHinweis(x) {
    if (!x.D.quelle.nurTermine) return '';
    const name = String(x.D.quelle.name || '').replace(/^VG /, 'Verbandsgemeinde ');
    return `<div class="card empty-state"><p><strong>Hier sehen Sie die Sitzungstermine</strong></p>
      <p class="muted">Tagesordnungen, Vorlagen und Beschlüsse stellt die ${esc(name)} technisch bisher nur in ihrem eigenen Ratsinformationssystem bereit – eine vollständige Übernahme in andere Angebote wie Wahlheimat ist dort leider noch nicht vorgesehen. Die vollständigen Unterlagen finden Sie direkt im Ratsinformationssystem.</p>
      ${x.D.quelle.ris ? `<a class="btn ghost" href="${esc(x.D.quelle.ris)}" target="_blank" rel="noopener">Ratsinformationssystem öffnen</a>` : ''}</div>`;
  }

  function ohneDaten(t, eb) {
    const ris = INDEX.ris[t.id] || (t.typ === 'gemeinde' && t.vg ? INDEX.ris[t.vg] : null);
    let grund;
    if (ris?.status === 'inaktiv') grund = 'Das Ratsinformationssystem hat eine Standardschnittstelle (OParl), sie ist aber nicht freigeschaltet. Sobald die Verwaltung sie freischaltet, können wir die Daten hier zeigen.';
    else if (ris?.status === 'robots') grund = 'Der Anbieter des Ratsinformationssystems untersagt automatische Abrufe. Wir zeigen die Daten erst, wenn das geklärt ist.';
    else if (ris?.status === 'blockiert') grund = `${anzeigeName(t)} stellt die Ratsinformationen bisher nur zum Lesen im eigenen Ratsinformationssystem bereit – eine Übernahme in andere Angebote wie Wahlheimat ist dort leider noch nicht vorgesehen. Sobald die Stadt das ermöglicht, zeigen wir die Sitzungen gern auch hier. Bis dahin finden Sie alle Unterlagen direkt beim Ratsinformationssystem der Stadt.`;
    else if (ris?.status === 'geplant') grund = 'Das Ratsinformationssystem erlaubt automatische Abrufe. Die Anbindung ist geplant.';
    else if (t.art === 'Ortsgemeinde') grund = 'Ortsgemeinden veröffentlichen ihre Sitzungen meist im Ratsinformationssystem der Verbandsgemeinde. Für diese ist noch keine offene Schnittstelle bekannt.';
    else grund = 'Für dieses Ratsinformationssystem ist noch keine offene Schnittstelle bekannt.';
    const andere = eb.filter((e) => !e.off && e.g.q && e.g !== t);
    return `<div class="card empty-state">
        <p><strong>Noch keine Sitzungsdaten</strong></p>
        <p class="muted">${esc(grund)}</p>
        ${ris ? `<a class="btn ghost" href="${esc(ris.url)}" target="_blank" rel="noopener">Ratsinformationssystem öffnen</a>` : ''}
      </div>
      ${andere.length ? `<section><h2>Mit Daten</h2><div class="list">${andere.map((e) => `<button class="row" type="button" data-go="${esc(link('g', kommune, e.key))}"><div class="body"><span class="title">${esc(anzeigeName(e.g))}</span><span class="meta">${esc({ gemeinde: 'Gemeinde', vg: 'Verbandsgemeinde', kreis: 'Kreis' }[e.key])}</span></div>${chev}</button>`).join('')}</div></section>` : ''}`;
  }
  // Die Ebenen-Schalter navigieren ohne Verlaufseintrag
  $view.addEventListener('click', (e) => {
    const b = e.target.closest('.seg [data-go], .empty-state ~ section [data-go]');
    if (b) { e.stopImmediatePropagation(); e.preventDefault(); location.replace(b.dataset.go); }
  }, true);

  /** Link ins Original-Ratsinformationssystem: zur Einzelseite, sonst zur Startseite des RIS. */
  function risLink(seite, startseite, was, ohneRis, kalender) {
    const url = seite || startseite;
    if (!url) return '';
    const system = ohneRis ? 'auf der Website' : 'im Ratsinformationssystem';
    if (kalender && seite) {
      return `<section class="ris"><a class="btn ghost" href="${esc(seite)}" target="_blank" rel="noopener">Kalender ${system} öffnen ↗</a>
      <p class="muted small">Für diese Sitzung gibt es dort noch keine eigene Seite – das System zeigt sie erst, wenn die Tagesordnung veröffentlicht ist. Im Kalender sehen Sie den Termin.</p></section>`;
    }
    const text = seite ? `${was} ${system} öffnen` : ohneRis ? 'Zur Website der Kommune' : 'Zum Ratsinformationssystem';
    return `<section class="ris"><a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener">${esc(text)} ↗</a>
      <p class="muted small">${ohneRis ? 'Dort finden Sie die veröffentlichten Protokolle und Unterlagen, auch älterer Sitzungen.' : 'Dort finden Sie alle veröffentlichten Unterlagen, auch ältere Sitzungen und Vorlagen.'}</p></section>`;
  }

  function sitzungRow(m) {
    const n = m.tops.length;
    return `<button class="row" type="button" data-go="${esc(link('s', m.id))}">${dateBox(m.start)}<div class="body"><span class="title">${esc(gremiumKurz(m.gremien[0] || m.name || 'Sitzung'))}</span><span class="meta">${esc(uhrText(m.start))}${m.ort ? ' · ' + esc(ortKurz(m.ort)) : ''}</span><span class="meta">${statusPill(m)}${n ? `<span>${n} TOP${n > 1 ? 's' : ''}</span>` : ''}</span></div>${chev}</button>`;
  }
  function vorlageRow(v) {
    return `<button class="row" type="button" data-go="${esc(link('v', v.id))}"><div class="body"><span class="meta"><span class="mono">${esc(v.nr)}</span><span>${esc(datum(v.datum))}</span>${v.kurz ? '<span class="pill">Kurz erklärt</span>' : ''}</span><span class="title">${esc(v.name)}</span><span class="meta">${esc(v.art || '')}</span></div>${chev}</button>`;
  }
  function docRow(f) {
    const label = f.rolle !== 'auxiliary' && rolleLabel[f.rolle] ? rolleLabel[f.rolle] : f.name;
    return `<a class="doc" href="${esc(f.url)}" target="_blank" rel="noopener"><span class="ico">${f.seite ? 'WEB' : 'PDF'}</span><span class="body"><span>${esc(label)}</span><span class="muted small">${esc(f.rolle === 'auxiliary' ? 'Anlage' : f.name)}${f.dl ? ' · wird heruntergeladen' : ''}</span></span>${chev}</a>`;
  }
  /** Hinweis unter der Dokumentenliste, wenn das System die Dateien nur als Download liefert */
  const dlHinweis = (docs) => (docs.some((f) => f.dl)
    ? '<p class="muted small dlhinweis">Dieses Ratsinformationssystem liefert Dokumente nur als Download. Auf dem Handy öffnet sich danach Ihre PDF-App, oder Sie finden die Datei im Download-Ordner.</p>'
    : '');

  // ---------- Ansicht: Sitzung ----------
  function vSitzung(x, id) {
    const m = x.s.get(id);
    if (!m) throw new Error('Diese Sitzung ist nicht im aktuellen Datenstand');
    setTitle(kurzName(x.k.get(m.k)?.name));
    const docs = m.dateien.filter((f) => f.url);
    $view.innerHTML = `
      ${backLink}
      <section class="hero">
        <span class="meta">${statusPill(m)}<span>${esc(x.k.get(m.k)?.name)}</span></span>
        <div class="favkopf"><h3>${esc(String(m.gremien[0] || m.name).replace(/\s+/g, ' '))}</h3>${m.gremien[0] ? sternKnopf({ q: x.D.quelle.id, k: m.k, g: m.gremien[0], kn: x.k.get(m.k)?.name || '', ort: kommune || '' }) : ''}</div>
        <p>${esc(langDatum(m.start))}, ${esc(uhrText(m.start))}${m.ende && m.status === 'durchgeführt' ? ' bis ' + esc(uhr(m.ende)) + ' Uhr' : ''}</p>
        ${m.ort ? `<p class="muted">${esc(m.ort)}</p>` : ''}
      </section>
      ${docs.length ? `<section><h2>Dokumente</h2><div class="list">${docs.map(docRow).join('')}</div>${dlHinweis(docs)}</section>` : ''}
      <section><h2>Tagesordnung</h2>
        ${m.tops.length ? `<div class="list">${m.tops.map((t) => {
          const v = t.vorlage && x.v.get(t.vorlage);
          return `<div class="top ${t.oeffentlich === false ? 'np' : ''}"><span class="nr">${esc(t.nr || '')}</span><div class="body">
            <span class="name">${esc(t.name)}</span>
            ${t.oeffentlich === false ? '<span class="meta"><span class="pill plain">nicht öffentlich</span></span>' : ''}
            ${v ? `<button class="linkbtn" type="button" data-go="${esc(link('v', v.id))}">Vorlage <span class="mono">${esc(v.nr)}</span> ansehen${v.kurz ? ' · Kurz erklärt' : ''}</button>` : ''}
            ${t.beschluss ? `<details class="beschluss"><summary>Beschluss</summary><p>${esc(t.beschluss)}</p></details>` : ''}
          </div></div>`;
        }).join('')}</div>` : x.D.quelle.nurTermine ? nurTermineHinweis(x) : m.start < now() ? `<div class="card empty">Zu dieser Sitzung liegen hier keine einzelnen Tagesordnungspunkte vor${docs.length ? ' – siehe Dokumente.' : '.'}</div>` : '<div class="card empty">Die Tagesordnung ist noch nicht veröffentlicht.</div>'}
      </section>
      ${risLink(m.web, x.D.quelle.ris, 'Sitzung', x.D.quelle.ohneRis, m.webKalender)}`;
  }

  // ---------- Ansicht: Vorlage ----------
  function vVorlage(x, id) {
    const v = x.v.get(id);
    if (!v) throw new Error('Diese Vorlage ist nicht im aktuellen Datenstand');
    setTitle(kurzName(x.k.get(v.k)?.name));
    const docs = v.dateien.filter((f) => f.url);
    const steps = v.beratung.filter((b) => b.gremium || b.datum);
    const t = now();
    $view.innerHTML = `
      ${backLink}
      <section class="hero">
        <span class="meta"><span class="mono">${esc(v.nr)}</span><span>${esc(v.art || '')}</span><span>${esc(datum(v.datum))}</span></span>
        <h3>${esc(v.name)}</h3>
        <p class="muted small">${esc(x.k.get(v.k)?.name)}</p>
      </section>
      ${v.kurz ? `<section class="kurz" aria-label="Kurz erklärt">
        <div class="head"><strong>Kurz erklärt</strong><span class="pill">automatisch erstellt</span></div>
        <p>${esc(v.kurz.text)}</p>
        ${v.kurz.punkte?.length ? `<ul>${v.kurz.punkte.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
        <p class="hint">Von einer KI aus dem Vorlagentext zusammengefasst. Maßgeblich ist das Original-Dokument.</p>
      </section>` : ''}
      ${steps.length ? `<section><h2>Beratungsfolge</h2><ol class="steps card">${steps.map((b) => {
        const done = b.datum && b.datum < t;
        const m = b.sitzung && x.s.get(b.sitzung);
        return `<li class="${done ? 'done' : ''}"><span class="body"><span style="font-weight:600">${esc(gremiumKurz(b.gremium || 'Gremium'))}</span><span class="meta">${b.datum ? esc(datum(b.datum)) : 'Termin offen'}${b.entscheidend ? '<span class="pill">entscheidet</span>' : b.rolle ? `<span>${esc(b.rolle)}</span>` : ''}${done ? '' : '<span class="pill plain">anstehend</span>'}</span>${m ? `<button class="linkbtn small" type="button" data-go="${esc(link('s', m.id))}">Zur Sitzung</button>` : ''}</span></li>`;
      }).join('')}</ol></section>` : ''}
      ${v.text ? `<section><h2>Aus der Vorlage</h2><div class="card"><div class="excerpt" id="ex">${esc(v.text)}</div><button class="more" type="button" id="exb">Ganzen Auszug zeigen</button></div></section>` : ''}
      ${docs.length ? `<section><h2>Dokumente</h2><div class="list">${docs.map(docRow).join('')}</div>${dlHinweis(docs)}</section>` : ''}
      ${risLink(v.web, x.D.quelle.ris, 'Vorlage')}`;
    document.getElementById('exb')?.addEventListener('click', (e) => {
      const open = document.getElementById('ex').classList.toggle('open');
      e.target.textContent = open ? 'Auszug einklappen' : 'Ganzen Auszug zeigen';
    });
  }

  // ---------- Ansicht: Themensuche ----------
  // Suchbegriffe je Thema (Teilwörter, klein, Umlaute ausgeschrieben); „^“ = nur am Wortanfang
  const THEMEN = {
    'Klima & Energie': ['klima', 'photovolt', 'solar', 'windkraft', 'windenerg', 'windpark', 'waermeplan', 'waermenetz', 'nahwaerme', 'fernwaerme', 'energie', 'ladesaeul', 'ladeinfrastruktur', 'e-mobil', '^pv'],
    'Verkehr & Straßen': ['verkehr', 'strassenausbau', 'ausbaubeitr', 'gehweg', 'radweg', 'fahrrad', 'parkplatz', 'parkraum', 'bushaltestell', 'oepnv', 'nahverkehr', 'tempo', 'geschwindigkeit', 'kreisel', 'bruecke', 'schulweg', 'strassenbeleucht', 'winterdienst'],
    'Bauen & Wohnen': ['bebauungsplan', 'flaechennutzungsplan', 'bauantrag', 'bauvoranfrage', 'bauleitplan', 'baugebiet', 'wohnbau', 'wohnraum', 'wohnungs', 'einvernehmen', 'abrundungssatzung', 'veraenderungssperre', 'dorferneuerung', 'staedtebau'],
    'Schule & Kita': ['schule', 'grundschul', 'schultraeger', 'schulbau', 'schulhof', 'schulbus', 'schulsozial', 'schulzweckverband', 'kita', 'kindertages', 'kindergarten', 'krippe', '^hort', 'ganztag', 'jugend'],
    'Haushalt & Finanzen': ['haushalt', 'jahresabschluss', 'jahresrechnung', 'steuer', 'hebesa', 'gebuehr', 'beitragssatzung', 'kredit', 'darlehen', 'finanz', 'rechnungspruef'],
    'Wasser & Abwasser': ['wasser', 'kanal', 'klaeranlage', 'starkregen', 'hochwasser'],
    'Feuerwehr & Sicherheit': ['feuerwehr', 'brandschutz', 'katastrophenschutz', 'rettung', 'sirene'],
    'Natur & Umwelt': ['gemeindewald', 'stadtwald', 'waldweg', 'waldbrand', 'waldwirtschaft', 'forst', 'naturschutz', 'umwelt', 'baeume', 'baumpflanz', 'baumfaell', 'baumschutz', 'biotop', 'artenschutz', 'gruenflaeche', 'landschaft', 'jagd'],
    'Soziales & Gesundheit': ['senior', 'sozial', '^pflege', 'altenpflege', 'aerzt', 'arzt', 'gesundheit', 'fluechtl', 'asyl', 'integration', 'inklusion', 'barrierefrei'],
    'Sport, Kultur & Freizeit': ['^sport', 'sportplatz', 'sporthalle', 'sportanlage', '^kultur', 'museum', 'buecherei', 'bibliothek', 'schwimmbad', 'freibad', 'hallenbad', 'spielplatz', 'kirmes', 'tourismus', 'dorfgemeinschaftshaus', 'buergerhaus', 'mehrzweckhalle'],
    'Digitales': ['digital', 'breitband', 'glasfaser', 'wlan', 'mobilfunk', 'internet'],
    'Wirtschaft & Gewerbe': ['gewerbe', 'wirtschaftsfoerder', 'wirtschaftsstandort', 'einzelhandel', 'innenstadt', 'leerstand', 'ansiedlung'],
    'Friedhof': ['friedhof', 'bestattung', '^urnen'],
  };
  const norm = (t) => String(t || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  // Begriffe enthalten nur Buchstaben und Bindestriche; „^“ = nur am Wortanfang (z. B. „PV“, nicht „Pvc“ in Wörtern)
  const begriffRegex = (b) => new RegExp(b.startsWith('^') ? `(?:^|[^a-z0-9])${b.slice(1)}` : b);
  let SUCHE = null;
  async function sucheLaden() {
    if (!SUCHE) {
      const d = await getJson('data/suche.json');
      SUCHE = { quellen: d.quellen, eintraege: d.eintraege.map((e) => ({ art: e[0], titel: e[1], datum: e[2], q: d.quellen[e[3]], gebiet: e[4], id: e[5], nr: e[6], n: norm(e[1]) })) };
    }
    return SUCHE;
  }
  // Gebiete für den Ortsfilter: die gewählte Kommune mit VG und Kreis, dazu die Favoriten
  function gebietsfilter() {
    const opt = [{ key: 'alle', label: 'Ganz Rheinland-Pfalz' }];
    const g = kommune && G.get(kommune);
    if (g) for (const e of ebenen(g)) if (!e.off && e.g && e.g.typ !== 'body') opt.push({ key: 'g:' + e.g.id, label: anzeigeName(e.g), id: e.g.id });
    const favs = favoriten().filter((f) => f.typ === 'gebiet' && G.has(f.id));
    if (favs.length) opt.push({ key: 'fav', label: 'Meine Favoriten', ids: favs.map((f) => f.id) });
    return opt;
  }
  // Liegt die Gebietskörperschaft „gebiet“ in „ziel“ (gleich, oder Gemeinde/VG im Kreis bzw. Gemeinde in der VG)?
  function liegtIn(gebiet, ziel) {
    if (!gebiet) return false;
    if (gebiet === ziel) return true;
    const g = G.get(gebiet);
    return !!g && (g.vg === ziel || g.kreis === ziel);
  }

  async function vThemen() {
    setTitle('Themen');
    const zustand = store.get('themensuche', { thema: '', text: '', ort: 'alle' });
    const filter = gebietsfilter();
    if (!filter.some((f) => f.key === zustand.ort)) zustand.ort = 'alle';
    $view.innerHTML = `
      <section class="hero"><h3>Was wird zu meinem Thema beraten?</h3>
        <p class="muted small">Vorlagen und Tagesordnungspunkte aller angebundenen Räte – in Ihrer Kommune, im Kreis oder in ganz Rheinland-Pfalz.</p></section>
      <form class="searchbox" id="tf" role="search" autocomplete="off">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
        <input id="tq" type="search" enterkeyhint="search" placeholder="Stichwort, z. B. Windkraft oder Freibad" value="${esc(zustand.text)}" aria-label="Stichwort">
      </form>
      <div class="chips" role="group" aria-label="Themen">${Object.keys(THEMEN).map((t) => `<button type="button" class="chip" data-thema="${esc(t)}" aria-pressed="${zustand.thema === t}">${esc(t)}</button>`).join('')}</div>
      <section class="field"><label for="tort">Wo</label><select id="tort">${filter.map((f) => `<option value="${esc(f.key)}" ${f.key === zustand.ort ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select></section>
      <div id="treffer"><div class="card empty">Lade Suchverzeichnis …</div></div>`;
    let S;
    try { S = await sucheLaden(); } catch (err) {
      document.getElementById('treffer').innerHTML = `<div class="card empty">Die Suche konnte nicht geladen werden (${esc(err.message)}).</div>`;
      return;
    }
    const zeigen = () => {
      store.set('themensuche', zustand);
      const $t = document.getElementById('treffer');
      const begriffe = [...(zustand.thema ? THEMEN[zustand.thema] : []).map(begriffRegex)];
      const woerter = norm(zustand.text).split(/\s+/).filter((w) => w.length >= 2);
      if (!begriffe.length && !woerter.length) {
        $t.innerHTML = '<div class="card empty">Wählen Sie ein Thema oder geben Sie ein Stichwort ein.</div>';
        return;
      }
      const f = filter.find((x) => x.key === zustand.ort);
      const imGebiet = (e) => !f || f.key === 'alle' || (f.id ? liegtIn(e.gebiet, f.id) : (f.ids || []).some((id) => liegtIn(e.gebiet, id)));
      const treffer = S.eintraege.filter((e) =>
        (!begriffe.length || begriffe.some((r) => r.test(e.n))) && woerter.every((w) => e.n.includes(w)) && imGebiet(e));
      const ort = (e) => { const g = e.gebiet && G.get(e.gebiet); return g ? anzeigeName(g) : (INDEX.quellen.find((q) => q.id === e.q)?.name || ''); };
      const zeige = treffer.slice(0, 150);
      $t.innerHTML = treffer.length
        ? `<p class="muted small">${fmtZahl(treffer.length)} Treffer${treffer.length > zeige.length ? `, die neuesten ${zeige.length}` : ''} · neueste zuerst</p>
          <div class="list">${zeige.map((e) => `<button class="row" type="button" data-go="${esc(link(e.art === 0 ? 'v' : 's', e.id))}"><div class="body">
            <span class="meta">${e.art === 0 ? `<span class="pill plain">Vorlage</span>${e.nr ? `<span class="mono">${esc(e.nr)}</span>` : ''}` : '<span class="pill plain">Tagesordnung</span>'}${e.datum ? `<span>${esc(datum(e.datum))}</span>` : ''}</span>
            <span class="title">${esc(e.titel)}</span><span class="meta">${esc(ort(e))}</span></div>${chev}</button>`).join('')}</div>`
        : '<div class="card empty">Keine Treffer im aktuellen Datenstand.</div>';
    };
    const input = document.getElementById('tq');
    let warte;
    input.addEventListener('input', () => { clearTimeout(warte); warte = setTimeout(() => { zustand.text = input.value; zeigen(); }, 200); });
    document.getElementById('tf').addEventListener('submit', (e) => { e.preventDefault(); input.blur(); zustand.text = input.value; zeigen(); });
    $view.querySelectorAll('[data-thema]').forEach((el) => el.addEventListener('click', () => {
      zustand.thema = zustand.thema === el.dataset.thema ? '' : el.dataset.thema;
      $view.querySelectorAll('[data-thema]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.thema === zustand.thema)));
      zeigen();
    }));
    document.getElementById('tort').addEventListener('change', (e) => { zustand.ort = e.target.value; zeigen(); });
    zeigen();
  }


  // ---------- Service Worker: offline nutzbar, Hinweis bei neuer Version ----------
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      // Kurz nach dem Start sofort neu laden (sonst läuft bis zum nächsten Start die alte Version), später nur anbieten
      if (performance.now() < 15000) location.reload();
      else toast('Neue Daten oder Funktionen verfügbar.', { label: 'Neu laden', run: () => location.reload() });
    });
  }

  // ---------- Start ----------
  getJson('data/index.json').then((idx) => {
    ladeIndex(idx);
    route();
    starteZaehler();
  }).catch((err) => {
    $view.innerHTML = `<div class="card empty">Die Daten konnten nicht geladen werden (${esc(err.message)}). Prüfen Sie die Verbindung und laden Sie die Seite neu.</div>`;
  });
})();
