// Ratsblick – Web-App. Liest die statischen Datendateien aus data/ (erzeugt mit `npm run web`).
(() => {
  'use strict';
  const TZ = 'Europe/Berlin';
  const $view = document.getElementById('view');
  const $title = document.getElementById('title');
  const $toast = document.getElementById('toast');
  const $offline = document.getElementById('offline');

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
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    depth = 0;
    const tab = b.dataset.tab;
    if (tab === 'fav') location.hash = link('fav');
    else if (tab === 'themen') location.hash = link('themen');
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
    if (installEvent) return `<div class="card install"><p>Ratsblick RLP als App auf dem Startbildschirm ablegen.</p><button class="btn" type="button" id="inst">Installieren</button><button class="x" type="button" id="instx" aria-label="Hinweis ausblenden">×</button></div>`;
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
          <h3>Was beschließt Ihr Gemeinderat?</h3>
          <p class="lead">Sitzungen, Tagesordnungen und Vorlagen Ihrer Kommune – verständlich an einem Ort.</p>
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
      $view.innerHTML = seg + kopf + ohneDaten(t, eb);
      return;
    }
    const x = await quelle(t.q);
    const sitz = x.sByK.get(t.b) || [];
    const jetzt = now();
    const kommend = sitz.filter((m) => m.start >= jetzt);
    const vergangen = sitz.filter((m) => m.start < jetzt).reverse().slice(0, 6);
    const vorl = (x.vByK.get(t.b) || []).slice(0, 10);
    const gremien = gremienVon(sitz);
    $view.innerHTML = `${seg}${kopf}${nurTermineHinweis(x)}
      <section><h2>Nächste Sitzungen</h2>
        ${kommend.length ? `<div class="list">${kommend.map(sitzungRow).join('')}</div>` : '<div class="card empty">Zurzeit sind keine Sitzungen angekündigt.</div>'}
      </section>
      ${x.D.quelle.nurTermine ? '' : `<section><h2>Neue Vorlagen</h2>
        ${vorl.length ? `<div class="list">${vorl.map(vorlageRow).join('')}</div>` : '<div class="card empty">Keine aktuellen Vorlagen.</div>'}
      </section>`}
      ${vergangen.length ? `<section><h2>Zuletzt getagt</h2><div class="list">${vergangen.map(sitzungRow).join('')}</div></section>` : ''}
      ${gremien.length ? `<section><details class="gremien"><summary>Gremien (${gremien.length}) – mit dem Stern als Favorit merken</summary>
        <div class="list">${gremien.map((g) => `<div class="row static"><div class="body"><span class="title">${esc(gremiumKurz(g))}</span></div>${sternKnopf({ q: t.q, k: t.b, g, kn: x.k.get(t.b)?.name || '', ort: id })}</div>`).join('')}</div>
      </details></section>` : ''}
      ${risLink(null, x.D.quelle.ris)}
      <p class="stand">Abgleich mit ${esc(x.D.quelle.name)}: ${esc(stand(x.D.quelle.abgleich))}</p>`;
  }

  // Hinweis für Quellen, die nur Termine liefern (Kalenderexport); freundlich, die Gründe liegen beim Anbieter
  function nurTermineHinweis(x) {
    if (!x.D.quelle.nurTermine) return '';
    const name = String(x.D.quelle.name || '').replace(/^VG /, 'Verbandsgemeinde ');
    return `<div class="card empty-state"><p><strong>Hier sehen Sie die Sitzungstermine</strong></p>
      <p class="muted">Tagesordnungen, Vorlagen und Beschlüsse stellt die ${esc(name)} technisch bisher nur in ihrem eigenen Ratsinformationssystem bereit – eine vollständige Übernahme in andere Angebote wie Ratsblick ist dort leider noch nicht vorgesehen. Die vollständigen Unterlagen finden Sie direkt im Ratsinformationssystem.</p>
      ${x.D.quelle.ris ? `<a class="btn ghost" href="${esc(x.D.quelle.ris)}" target="_blank" rel="noopener">Ratsinformationssystem öffnen</a>` : ''}</div>`;
  }

  function ohneDaten(t, eb) {
    const ris = INDEX.ris[t.id] || (t.typ === 'gemeinde' && t.vg ? INDEX.ris[t.vg] : null);
    let grund;
    if (ris?.status === 'inaktiv') grund = 'Das Ratsinformationssystem hat eine Standardschnittstelle (OParl), sie ist aber nicht freigeschaltet. Sobald die Verwaltung sie freischaltet, können wir die Daten hier zeigen.';
    else if (ris?.status === 'robots') grund = 'Der Anbieter des Ratsinformationssystems untersagt automatische Abrufe. Wir zeigen die Daten erst, wenn das geklärt ist.';
    else if (ris?.status === 'blockiert') grund = `${anzeigeName(t)} stellt die Ratsinformationen bisher nur zum Lesen im eigenen Ratsinformationssystem bereit – eine Übernahme in andere Angebote wie Ratsblick ist dort leider noch nicht vorgesehen. Sobald die Stadt das ermöglicht, zeigen wir die Sitzungen gern auch hier. Bis dahin finden Sie alle Unterlagen direkt beim Ratsinformationssystem der Stadt.`;
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
  function risLink(seite, startseite, was) {
    const url = seite || startseite;
    if (!url) return '';
    const text = seite ? `${was} im Ratsinformationssystem öffnen` : 'Zum Ratsinformationssystem';
    return `<section class="ris"><a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener">${esc(text)} ↗</a>
      <p class="muted small">Dort finden Sie alle veröffentlichten Unterlagen, auch ältere Sitzungen und Vorlagen.</p></section>`;
  }

  function sitzungRow(m) {
    const n = m.tops.length;
    return `<button class="row" type="button" data-go="${esc(link('s', m.id))}">${dateBox(m.start)}<div class="body"><span class="title">${esc(gremiumKurz(m.gremien[0] || m.name || 'Sitzung'))}</span><span class="meta">${esc(uhr(m.start))} Uhr${m.ort ? ' · ' + esc(ortKurz(m.ort)) : ''}</span><span class="meta">${statusPill(m)}${n ? `<span>${n} TOP${n > 1 ? 's' : ''}</span>` : ''}</span></div>${chev}</button>`;
  }
  function vorlageRow(v) {
    return `<button class="row" type="button" data-go="${esc(link('v', v.id))}"><div class="body"><span class="meta"><span class="mono">${esc(v.nr)}</span><span>${esc(datum(v.datum))}</span>${v.kurz ? '<span class="pill">Kurz erklärt</span>' : ''}</span><span class="title">${esc(v.name)}</span><span class="meta">${esc(v.art || '')}</span></div>${chev}</button>`;
  }
  function docRow(f) {
    const label = f.rolle !== 'auxiliary' && rolleLabel[f.rolle] ? rolleLabel[f.rolle] : f.name;
    return `<a class="doc" href="${esc(f.url)}" target="_blank" rel="noopener"><span class="ico">${f.seite ? 'WEB' : 'PDF'}</span><span class="body"><span>${esc(label)}</span><span class="muted small">${esc(f.rolle === 'auxiliary' ? 'Anlage' : f.name)}</span></span>${chev}</a>`;
  }

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
        <p>${esc(langDatum(m.start))}, ${esc(uhr(m.start))} Uhr${m.ende && m.status === 'durchgeführt' ? ' bis ' + esc(uhr(m.ende)) + ' Uhr' : ''}</p>
        ${m.ort ? `<p class="muted">${esc(m.ort)}</p>` : ''}
      </section>
      ${docs.length ? `<section><h2>Dokumente</h2><div class="list">${docs.map(docRow).join('')}</div></section>` : ''}
      <section><h2>Tagesordnung</h2>
        ${m.tops.length ? `<div class="list">${m.tops.map((t) => {
          const v = t.vorlage && x.v.get(t.vorlage);
          return `<div class="top ${t.oeffentlich === false ? 'np' : ''}"><span class="nr">${esc(t.nr || '')}</span><div class="body">
            <span class="name">${esc(t.name)}</span>
            ${t.oeffentlich === false ? '<span class="meta"><span class="pill plain">nicht öffentlich</span></span>' : ''}
            ${v ? `<button class="linkbtn" type="button" data-go="${esc(link('v', v.id))}">Vorlage <span class="mono">${esc(v.nr)}</span> ansehen${v.kurz ? ' · Kurz erklärt' : ''}</button>` : ''}
            ${t.beschluss ? `<details class="beschluss"><summary>Beschluss</summary><p>${esc(t.beschluss)}</p></details>` : ''}
          </div></div>`;
        }).join('')}</div>` : x.D.quelle.nurTermine ? nurTermineHinweis(x) : '<div class="card empty">Die Tagesordnung ist noch nicht veröffentlicht.</div>'}
      </section>
      ${risLink(m.web, x.D.quelle.ris, 'Sitzung')}`;
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
      ${docs.length ? `<section><h2>Dokumente</h2><div class="list">${docs.map(docRow).join('')}</div></section>` : ''}
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
      <section class="hero"><h3>Was wird zu Ihrem Thema beraten?</h3>
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
  }).catch((err) => {
    $view.innerHTML = `<div class="card empty">Die Daten konnten nicht geladen werden (${esc(err.message)}). Prüfen Sie die Verbindung und laden Sie die Seite neu.</div>`;
  });
})();
