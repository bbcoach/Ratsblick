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
    try {
      const host = new URL(id).hostname;
      return INDEX.quellen.find((qq) => qq.host === host)?.id ?? null;
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
    if (tab === 'wahl' || !kommune) location.hash = '#/';
    else if (tab === 'start') location.hash = link('g', kommune);
    else location.hash = link('abo');
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
        kommune = r.a; store.set('kommune', kommune); tab = 'start';
        await vGebiet(r.a, r.b);
      } else if (r.v === 's' || r.v === 'v') {
        tab = 'start';
        const qid = quelleFuerObjekt(r.a);
        if (!qid) throw new Error('Unbekannte Quelle');
        const x = await quelle(qid);
        if (r.v === 's') vSitzung(x, r.a); else vVorlage(x, r.a);
      } else if (r.v === 'abo' && kommune && G.has(kommune)) {
        tab = 'abo';
        await vAbo();
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
    store.set('zuletzt', store.get('zuletzt', []).map(migr).filter(Boolean));
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
    const zuletzt = store.get('zuletzt', []).filter((id) => G.has(id)).map((id) => G.get(id));
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
        ${zuletzt.length ? `<section id="recent"><h2>Zuletzt angesehen</h2><div class="list">${zuletzt.map(gebietRow).join('')}</div></section>` : ''}
        <p class="coverage">Alle ${fmtZahl(gemeinden)} Gemeinden in Rheinland-Pfalz · Sitzungsdaten für ${fmtZahl(mitDaten)} davon<br>Datenstand ${esc(stand(INDEX.erstellt))}</p>
      </div>`;
    const input = document.getElementById('q');
    const $hits = document.getElementById('hits');
    const $recent = document.getElementById('recent');
    const show = () => {
      q = input.value;
      const hits = suche(q);
      if ($recent) $recent.hidden = !!q.trim();
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
    store.set('zuletzt', [id, ...store.get('zuletzt', []).filter((x) => x !== id)].slice(0, 4));
    const seg = `<div class="seg" role="group" aria-label="Ebene">${eb.map((e) => `<button type="button" ${e.off ? 'disabled' : `data-go="${esc(link('g', id, e.key))}"`} aria-pressed="${e.key === sel.key}" class="${!e.off && !e.g.q ? 'nodata' : ''}">${e.label}<small>${esc(e.sub)}</small></button>`).join('')}</div>`;
    const t = sel.g;
    const kopf = `<section class="hero"><h3>${esc(anzeigeName(t))}</h3><p class="muted small">${esc([t.ew ? fmtZahl(t.ew) + ' Einwohner' : '', sel.key !== 'gemeinde' ? ERKLAERUNG[sel.key] : untertitel(t)].filter(Boolean).join(' · '))}</p></section>`;

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
    $view.innerHTML = `${seg}${kopf}
      <section><h2>Nächste Sitzungen</h2>
        ${kommend.length ? `<div class="list">${kommend.map(sitzungRow).join('')}</div>` : '<div class="card empty">Zurzeit sind keine Sitzungen angekündigt.</div>'}
      </section>
      <section><h2>Neue Vorlagen</h2>
        ${vorl.length ? `<div class="list">${vorl.map(vorlageRow).join('')}</div>` : '<div class="card empty">Keine aktuellen Vorlagen.</div>'}
      </section>
      ${vergangen.length ? `<section><h2>Zuletzt getagt</h2><div class="list">${vergangen.map(sitzungRow).join('')}</div></section>` : ''}
      ${risLink(null, x.D.quelle.ris)}
      <p class="stand">Abgleich mit ${esc(x.D.quelle.name)}: ${esc(stand(x.D.quelle.abgleich))}</p>`;
  }

  function ohneDaten(t, eb) {
    const ris = INDEX.ris[t.id] || (t.typ === 'gemeinde' && t.vg ? INDEX.ris[t.vg] : null);
    let grund;
    if (ris?.status === 'inaktiv') grund = 'Das Ratsinformationssystem hat eine Standardschnittstelle (OParl), sie ist aber nicht freigeschaltet. Sobald die Verwaltung sie freischaltet, können wir die Daten hier zeigen.';
    else if (ris?.status === 'robots') grund = 'Der Anbieter des Ratsinformationssystems untersagt automatische Abrufe. Wir zeigen die Daten erst, wenn das geklärt ist.';
    else if (ris?.status === 'blockiert') grund = 'Das Ratsinformationssystem weist automatische Abrufe mit einem Bot-Schutz ab.';
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
    return `<a class="doc" href="${esc(f.url)}" target="_blank" rel="noopener"><span class="ico">PDF</span><span class="body"><span>${esc(label)}</span><span class="muted small">${esc(f.rolle === 'auxiliary' ? 'Anlage' : f.name)}</span></span>${chev}</a>`;
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
        <h3>${esc(String(m.gremien[0] || m.name).replace(/\s+/g, ' '))}</h3>
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
        }).join('')}</div>` : '<div class="card empty">Die Tagesordnung ist noch nicht veröffentlicht.</div>'}
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

  // ---------- Ansicht: Themen-Abo ----------
  const THEMEN = {
    'Bauen & Planen': ['bebauungsplan', 'bauantrag', 'bauvoranfrage', 'baugebiet', 'flächennutzungsplan', 'einvernehmen'],
    'Kita & Schule': ['kita', 'kindertagesstätte', 'kindergarten', 'schule'],
    'Straßen & Verkehr': ['straße', 'straßen', 'verkehr', 'gehweg', 'parken', 'radweg'],
    'Haushalt & Finanzen': ['haushalt', 'jahresabschluss', 'auftragsvergabe', 'zuschuss', 'förderung'],
    'Klima & Energie': ['wärmeplanung', 'photovoltaik', 'solarpark', 'windenergie', 'klimaschutz', 'klimaanpassung'],
    'Feuerwehr': ['feuerwehr', 'brandschutz'],
    'Friedhof': ['friedhof'],
    'Wald': ['forst', 'wald'],
  };
  const abo = () => store.get('abo', { themen: ['Bauen & Planen', 'Kita & Schule'], stichwort: '', strasse: '', push: true, mail: false });
  const saveAbo = (patch) => store.set('abo', { ...abo(), ...patch });

  async function vAbo() {
    const g = G.get(kommune);
    setTitle(kurzName(kreisKurz(g.name)));
    const a = abo();
    const terms = [...a.themen.flatMap((t) => THEMEN[t] || []), ...[a.stichwort, a.strasse].filter(Boolean).map((s) => s.toLowerCase())];
    const mitDaten = ebenen(g).filter((e) => !e.off && e.g.q).map((e) => e.g);
    const vorlagen = [];
    for (const e of mitDaten) {
      const x = await quelle(e.q);
      for (const v of x.vByK.get(e.b) || []) vorlagen.push({ v, x });
    }
    vorlagen.sort((p, r) => String(r.v.datum).localeCompare(String(p.v.datum)));
    const treffer = !terms.length ? [] : vorlagen.map(({ v, x }) => {
      const hay = ((v.name || '') + ' ' + (v.text || '')).toLowerCase();
      const hit = terms.find((t) => hay.includes(t));
      return hit ? { v, x, hit } : null;
    }).filter(Boolean).slice(0, 15);
    const fuer = mitDaten.map((e) => anzeigeName(e)).join(', ');
    $view.innerHTML = `
      <section class="hero"><h3>Bescheid wissen, wenn es um Ihr Thema geht</h3><p class="muted small">${mitDaten.length ? `Für ${esc(fuer)}.` : `Für ${esc(anzeigeName(g))} liegen noch keine Sitzungsdaten vor. Sie können Ihre Themen trotzdem schon festlegen.`}</p></section>
      <section><h2>Themen</h2><div class="chips">${Object.keys(THEMEN).map((t) => `<button type="button" class="chip" data-thema="${esc(t)}" aria-pressed="${a.themen.includes(t)}">${esc(t)}</button>`).join('')}</div></section>
      <section class="field"><label for="stw">Stichwort</label><input type="text" id="stw" value="${esc(a.stichwort)}" placeholder="z. B. Dorfgemeinschaftshaus" enterkeyhint="done"></section>
      <section class="field"><label for="str">Ihre Straße</label><input type="text" id="str" value="${esc(a.strasse)}" placeholder="z. B. Hauptstraße" autocomplete="address-line1" enterkeyhint="done"><p class="muted small">Wird nur auf diesem Gerät gespeichert.</p></section>
      <section><h2>Benachrichtigung</h2><div class="list">
        <label class="switch" for="push"><span>Push-Mitteilung</span><input type="checkbox" id="push" ${a.push ? 'checked' : ''}></label>
        <label class="switch" for="mail"><span>E-Mail</span><input type="checkbox" id="mail" ${a.mail ? 'checked' : ''}></label>
      </div><p class="notice">Benachrichtigungen werden noch nicht verschickt. Ihre Auswahl bleibt auf diesem Gerät gespeichert.</p></section>
      <section><h2>Das wäre zuletzt gekommen (${treffer.length})</h2>
        ${treffer.length ? `<div class="list">${treffer.map(({ v, x, hit }) => `<button class="row" type="button" data-go="${esc(link('v', v.id))}"><div class="body"><span class="meta"><span class="mono">${esc(v.nr)}</span><span>${esc(datum(v.datum))}</span><span>${esc(kurzName(x.k.get(v.k)?.name))}</span></span><span class="title">${esc(v.name)}</span><span class="meta">Treffer: <mark>${esc(hit)}</mark></span></div>${chev}</button>`).join('')}</div>` : '<div class="card empty">Keine passenden Vorlagen im aktuellen Datenstand.</div>'}
      </section>`;
    $view.querySelectorAll('[data-thema]').forEach((el) => el.addEventListener('click', () => {
      const t = el.dataset.thema; const cur = abo().themen;
      saveAbo({ themen: cur.includes(t) ? cur.filter((y) => y !== t) : [...cur, t] }); vAbo();
    }));
    for (const [id, key] of [['stw', 'stichwort'], ['str', 'strasse']]) {
      const el = document.getElementById(id);
      el.addEventListener('change', () => { saveAbo({ [key]: el.value.trim() }); vAbo(); });
    }
    for (const id of ['push', 'mail']) document.getElementById(id).addEventListener('change', (e) => saveAbo({ [id]: e.target.checked }));
  }

  // ---------- Service Worker: offline nutzbar, Hinweis bei neuer Version ----------
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) toast('Neue Daten oder Funktionen verfügbar.', { label: 'Neu laden', run: () => location.reload() });
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
