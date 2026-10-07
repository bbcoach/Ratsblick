// Wahlheimat (vormals Ratsblick) – Web-App. Liest die statischen Datendateien aus data/ (erzeugt mit `npm run web`).
(() => {
  'use strict';
  const TZ = 'Europe/Berlin';
  const $view = document.getElementById('view');
  const $title = document.getElementById('title');
  const $toast = document.getElementById('toast');
  const $offline = document.getElementById('offline');

  // Eigener Seitenaufruf-Zähler (Cloudflare Worker, siehe zaehler/README.md). Leer = aus (keine Anfrage, Datenschutz-Absatz erscheint nicht).
  // Einschalten erst nach rechtlicher Prüfung: Adresse des Workers eintragen, z. B. 'https://wahlheimat-zaehler.<konto>.workers.dev/z'.
  const ZAEHLER = 'https://wahlheimat-zaehler.ralph-arnold.workers.dev/z';

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
  // Nur http(s)-Adressen als Link zulassen (Daten stammen aus fremden Systemen; „javascript:“ & Co. werden verworfen)
  const sicherUrl = (u) => (/^https?:\/\//i.test(String(u ?? '')) ? String(u) : '#');
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
    // „Do Not Track“ und Global Privacy Control respektieren
    if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl) return;
    const pfad = () => {
      const r = parse();
      if (r.v === 'g' && r.a) return '/g/' + r.a + (r.b ? '/' + r.b : '');
      return '/' + (r.v || '');
    };
    // Eigener Merker im Gerät („#/ohne-zaehlung“): dieses Gerät wird nicht mitgezählt (Betreiber, Tests, Widerspruch)
    const zaehle = () => { if (store.get('zaehlung-aus', false)) return; try { navigator.sendBeacon(ZAEHLER, pfad()); } catch {} };
    zaehle();
    window.addEventListener('hashchange', zaehle);
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

  // ---------- Spendenhinweis: einmal nach 10 geöffneten Ansichten ----------
  // Zähler und Merkzeichen liegen nur im Gerät (localStorage), nichts wird übertragen. Wer den Hinweis gesehen hat, bekommt ihn nie wieder.
  const SPENDENHINWEIS_NACH = 10;
  let letzteAnsicht = null;
  function zaehleAnsicht(r) {
    if (!BETREIBER.paypal || store.get('spendenhinweis', null)) return;
    if (location.hash !== letzteAnsicht) {
      letzteAnsicht = location.hash;
      store.set('ansichten', (Number(store.get('ansichten', 0)) || 0) + 1);
    }
    // nicht auf Info-, Rechts- und Unterstützen-Seiten und nicht, bevor 10 Ansichten erreicht sind
    if (r.v === 'info' || TEXTSEITEN[r.v] || (Number(store.get('ansichten', 0)) || 0) < SPENDENHINWEIS_NACH) return;
    const hash = location.hash;
    setTimeout(() => { if (location.hash === hash) zeigeSpendenhinweis(); }, 1500);
  }
  function zeigeSpendenhinweis() {
    if (store.get('spendenhinweis', null) || document.getElementById('spendenhinweis')) return;
    store.set('spendenhinweis', new Date().toISOString().slice(0, 10)); // vor dem Anzeigen merken: es kommt nie ein zweites Mal
    const vorher = document.activeElement;
    const box = document.createElement('div');
    box.id = 'spendenhinweis';
    box.className = 'popup';
    box.innerHTML = `<div class="popup-karte" role="dialog" aria-modal="true" aria-labelledby="sh-t">
        <h2 id="sh-t">Guter Rat ist nicht teuer – für dich.</h2>
        <p>Für mich allerdings schon: Wahlheimat wird in meiner Freizeit gepflegt und weiterentwickelt. Wenn dir die App hilft, freue ich mich über eine kleine Unterstützung. 5 € sind für dich nicht viel, machen unser Land aber zu einem besseren Ort.</p>
        <a class="btn spendenknopf" href="${esc(BETREIBER.paypal)}" target="_blank" rel="noopener">Mit PayPal unterstützen</a>
        <button class="linkbtn" type="button" data-zu>Schließen</button>
        <p class="muted small">Freiwillig, keine Spendenbescheinigung. Diesen Hinweis siehst du nur dieses eine Mal.</p>
      </div>`;
    const zu = () => {
      box.remove();
      document.removeEventListener('keydown', taste);
      window.removeEventListener('hashchange', zu);
      try { vorher && vorher.focus && vorher.focus(); } catch {}
    };
    const taste = (e) => {
      if (e.key === 'Escape') { zu(); return; }
      if (e.key === 'Tab') { // Fokus im Fenster halten
        const f = [...box.querySelectorAll('a, button')];
        const i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    };
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-zu]') || e.target.closest('a')) zu(); });
    document.addEventListener('keydown', taste);
    window.addEventListener('hashchange', zu);
    document.body.appendChild(box);
    box.querySelector('[data-zu]').focus();
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
      } else if (r.v === 'ohne-zaehlung' || r.v === 'mit-zaehlung') {
        tab = 'info';
        vZaehlung(r.v === 'ohne-zaehlung');
      } else if (TEXTSEITEN[r.v]) {
        tab = 'info';
        vText(r.v);
      } else if (r.v === 'themen' || r.v === 'abo') {
        tab = 'themen';
        await vThemen();
      } else {
        vWahl();
      }
      zaehleAnsicht(r);
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
    const tl = e.target.closest('[data-share]');
    if (tl) { e.preventDefault(); teilen(tl.dataset.share); return; }
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

  // ---------- Banner-Slider (Startseite) ----------
  // Neue Bilder einfach hier anhängen (Datei nach web/img/, Ort als `t`, Gebiets-ID `id` für den Link auf die Kommunenseite); je Start werden höchstens `BANNER_MAX` (10) zufällig ausgewählt und gemischt.
  const BANNER_BILDER = [
    { t: 'Kaiserslautern', id: '07312', img: 'img/kaiserslautern.jpg', pos: '50% 62%' },
    { t: 'Mainz', id: '07315', img: 'img/mainz.jpg', pos: '50% 50%' },
    { t: 'Cochem', id: '07135020', img: 'img/cochem.jpg', pos: '50% 36%' },
    { t: 'Pirmasens', id: '07317', img: 'img/pirmasens.jpg', pos: '50% 45%' },
    { t: 'Saarburg', id: '07235118', img: 'img/saarburg.jpg', pos: '40% 50%' },
    { t: 'Bernkastel-Kues', id: '07231008', img: 'img/bernkastel-kues.jpg', pos: '35% 50%' },
    { t: 'Annweiler am Trifels', id: '07337501', img: 'img/annweiler.jpg', pos: '50% 38%' },
    { t: 'Donnersbergkreis', id: '07333', img: 'img/donnersbergkreis.jpg', pos: '50% 50%' },
    { t: 'Bad Dürkheim', id: '07332002', img: 'img/bad-duerkheim.jpg', pos: '50% 75%' },
    { t: 'Enkenbach-Alsenborn', id: '07335004', img: 'img/enkenbach-alsenborn.jpg', pos: '45% 50%' },
    { t: 'Idar-Oberstein', id: '07134045', img: 'img/idar-oberstein.jpg', pos: '70% 50%' },
    { t: 'Gerolstein', id: '07233026', img: 'img/gerolstein.jpg', pos: '25% 50%' },
    { t: 'Bad Münster am Stein', id: '07133006', img: 'img/bad-muenster-am-stein.jpg', pos: '50% 50%' }, // Stadtteil von Bad Kreuznach: Link auf die Stadt
    { t: 'Worms', id: '07319', img: 'img/worms.jpg', pos: '50% 40%' },
    { t: 'Mutterstadt', id: '07338019', img: 'img/mutterstadt.jpg', pos: '50% 45%' },
    { t: 'Trier', id: '07211', img: 'img/trier.jpg', pos: '50% 50%' },
    { t: 'Koblenz', id: '07111', img: 'img/koblenz.jpg', pos: '50% 42%' },
    { t: 'Neustadt an der Weinstraße', id: '07316', img: 'img/neustadt.jpg', pos: '50% 40%' },
    { t: 'Montabaur', id: '07143048', img: 'img/montabaur.jpg', pos: '50% 30%' },
    { t: 'Kusel', id: '07336055', img: 'img/kusel.jpg', pos: '50% 42%' },
  ];
  const BANNER_MAX = 10; // höchstens so viele Bilder je Start, zufällig aus dem ganzen Bestand
  const BANNER = (() => { const l = [...BANNER_BILDER]; for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return l.slice(0, BANNER_MAX); })();
  function banner() {
    return `<section class="banner" aria-roledescription="Bildergalerie" aria-label="Bilder aus Rheinland-Pfalz">
      <div class="bn-track" id="bnt">${BANNER.map((b, i) => `<a class="bn-slide" href="${esc(link('g', b.id))}" aria-label="${esc(b.t)}: Sitzungen und Vorlagen ansehen" data-i="${i}"><img src="${b.img}" alt="" draggable="false" style="object-position:${b.pos}" ${i ? 'loading="lazy"' : ''}><span class="bn-cap">${esc(b.t)}<span aria-hidden="true"> ›</span></span></a>`).join('')}</div>
      <div class="bn-dots" id="bnd">${BANNER.map((b, i) => `<button type="button" aria-label="Bild ${i + 1}" data-i="${i}" ${i === 0 ? 'aria-current="true"' : ''}></button>`).join('')}</div>
    </section>`;
  }
  let bannerTimer;
  function starteBanner() {
    clearInterval(bannerTimer);
    const t = document.getElementById('bnt'); if (!t) return;
    const dots = [...document.querySelectorAll('#bnd button')];
    const zeige = (i) => t.scrollTo({ left: t.clientWidth * i, behavior: 'smooth' });
    let aktiv = 0, pause = false;
    const markiere = () => { aktiv = Math.round(t.scrollLeft / t.clientWidth); dots.forEach((d, i) => d.toggleAttribute('aria-current', i === aktiv)); };
    t.addEventListener('scroll', () => { clearTimeout(t._m); t._m = setTimeout(markiere, 60); }, { passive: true });
    dots.forEach((d) => d.addEventListener('click', () => zeige(+d.dataset.i)));
    ['pointerdown', 'focusin', 'mouseenter'].forEach((e) => t.addEventListener(e, () => (pause = true)));
    ['mouseleave', 'focusout'].forEach((e) => t.addEventListener(e, () => (pause = false)));
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) bannerTimer = setInterval(() => { if (!t.isConnected) clearInterval(bannerTimer); else if (!pause && !document.hidden) zeige((aktiv + 1) % BANNER.length); }, 5500);
  }

  // ---------- Ansicht: Startseite (nur Suche) ----------
  const rang = { gemeinde: 0, kreisfrei: 0, vg: 1, kreis: 2, body: 8 }; // Zweckverbände und sonstige Körperschaften deutlich nachrangig
  /**
   * Suchschlüssel in zwei Schreibweisen: [0] Umlaute als ae/oe/ue/ss („Müllheim“ → „muellheim“), [1] ohne Akzente („mullheim“).
   * „St.“ und „Sankt“ gelten gleich, Bindestriche zählen wie Leerzeichen.
   */
  function suchSchluessel(roh) {
    const grund = String(roh).toLowerCase().replace(/[-–]/g, ' ').replace(/\bst\.?(?=\s|$)/g, 'sankt').replace(/\s+/g, ' ').trim();
    const ae = grund.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
    const ohne = grund.replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return [ae.normalize('NFD').replace(/[\u0300-\u036f]/g, ''), ohne];
  }
  function suche(text) {
    const t = text.trim().toLowerCase();
    if (!t) return [];
    const plz = /^\d+$/.test(t);
    const tk = suchSchluessel(t);
    const hits = [];
    for (const g of G.values()) {
      if (g.typ === 'kreisfrei') continue; // die Stadt selbst steht bei den Gemeinden
      let score = -1;
      if (plz) { if (g.typ === 'gemeinde' && (g.plz || '').startsWith(t)) score = 10; }
      else {
        const nk = g._sk || (g._sk = { name: suchSchluessel(g.name), kurz: suchSchluessel(kurzName(kreisKurz(g.name))) });
        // beide Schreibweisen prüfen: „Müllheim“ wird mit „Muellheim“ und mit „Mullheim“ gefunden
        const treffer = (f) => tk.some((q, i) => f(nk.kurz[i], q));
        if (treffer((k, q) => k === q)) score = 40;
        else if (treffer((k, q) => k.startsWith(q))) score = 30;
        else if (tk.some((q, i) => nk.name[i].includes(q))) score = 20;
      }
      if (score < 0) continue;
      hits.push({ g, score: score - rang[g.typ] * 2 + (hatDaten(g) ? 1 : 0) + Math.min((g.ew || 0) / 1e6, 0.5) });
    }
    return hits.sort((a, b) => b.score - a.score || a.g.name.localeCompare(b.g.name, 'de')).slice(0, 8).map((h) => h.g);
  }
  function gebietRow(g) {
    return `<button class="row" type="button" data-go="${esc(link('g', g.id))}"><div class="body"><span class="title">${esc(anzeigeName(g))}</span><span class="meta">${esc(untertitel(g))}</span></div>${g.q ? '' : hatDaten(g) ? '<span class="pill plain">über VG/Kreis</span>' : '<span class="pill plain">ohne Daten</span>'}${chev}</button>`;
  }
  function vWahl() {
    setTitle('');
    const gemeinden = INDEX.gemeinden.length;
    const eigen = INDEX.gemeinden.filter(([id]) => G.get(id)?.q).length;
    const mitDaten = INDEX.gemeinden.filter(([id]) => hatDaten(G.get(id))).length;
    $view.innerHTML = `
      <div class="home">
        ${banner()}
        ${installCard()}
        <section class="hero">
          <p class="slogan">Guter Rat ist nicht teuer.</p>
          <h1>Was beschließt mein Gemeinderat?</h1>
          <p class="lead">Sitzungen, Tagesordnungen und Vorlagen meiner Kommune – verständlich an einem Ort.</p>
        </section>
        <form class="searchbox" id="sf" role="search" autocomplete="off">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
          <input id="q" type="search" inputmode="search" enterkeyhint="search" placeholder="Kommune oder Postleitzahl" value="${esc(q)}" aria-label="Kommune oder Postleitzahl">
        </form>
        <div id="hits"></div>
        <p class="coverage">${fmtZahl(gemeinden)} Gemeinden in Rheinland-Pfalz · eigene Sitzungsdaten für ${fmtZahl(eigen)}${mitDaten > eigen ? `, bei weiteren ${fmtZahl(mitDaten - eigen)} nur über die Verbandsgemeinde oder den Kreis` : ''}<br>Datenstand ${esc(stand(INDEX.erstellt))}</p>
      </div>`;
    starteBanner();
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
      $view.innerHTML = `<section class="hero"><h1>Favoriten</h1></section>
        <div class="card empty">Noch keine Favoriten. Tippen Sie auf den Stern – neben dem Namen einer Gemeinde, Stadt, Verbandsgemeinde oder eines Kreises, bei einem Gremium in einer Sitzung oder auf der Seite Ihrer Kommune unter „Gremien“. Hier finden Sie dann jeweils die nächste und letzte Sitzung.</div>`;
      return;
    }
    const jetzt = now();
    // „Neu seit Ihrem letzten Besuch“: je Favorit merkt sich das Gerät Kurzkennungen der bekannten Sitzungen (nur im Gerät).
    // Beim ersten Öffnen gibt es nichts Neues (Ausgangsstand); Sitzungen, die weiter als 45 Tage zurückliegen, zählen nie als neu.
    const kurz = (id) => { let h = 5381; for (const c of String(id)) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
    const gesehenAlt = store.get('gesehen', {});
    const gesehenNeu = {};
    const grenze = new Date(Date.now() - 45 * 86_400_000).toISOString();
    let neuGesamt = 0;
    const sitzungen = (sitz, key) => {
      const naechste = sitz.find((m) => m.start >= jetzt);
      const letzte = sitz.filter((m) => m.start < jetzt).at(-1);
      const bekannt = gesehenAlt[key] ? new Set(gesehenAlt[key]) : null;
      gesehenNeu[key] = sitz.slice(-400).map((m) => kurz(m.id));
      const neu = bekannt ? sitz.filter((m) => m.start >= grenze && !bekannt.has(kurz(m.id))) : [];
      neuGesamt += neu.length;
      const ids = new Set(neu.map((m) => m.id));
      const zeigen = [...new Set([naechste, letzte, ...neu].filter(Boolean))].sort((a, b) => (a.start < b.start ? -1 : 1));
      return { liste: zeigen, ids };
    };
    const neuPille = (n) => (n ? `<span class="pill neu">${n} neu</span>` : '');
    const kommunen = [];
    const gremien = [];
    for (const f of favs) {
      if (f.typ === 'gebiet') {
        const g = G.get(f.id);
        let r = { liste: [], ids: new Set() };
        if (g.q) {
          try { const x = await quelle(g.q); r = sitzungen(x.sByK.get(g.b) || [], favKey(f)); } catch { /* Quelle nicht erreichbar */ }
        }
        kommunen.push(`<section class="fav">
          <div class="favkopf"><button class="linkbtn favtitel" type="button" data-go="${esc(link('g', f.id))}"><h2>${esc(anzeigeName(g))}</h2><span class="muted small">${esc(untertitel(g))}</span></button>${neuPille(r.ids.size)}${sternKnopf(f)}</div>
          ${r.liste.length ? `<div class="list">${r.liste.map((m) => sitzungRow(m, '', r.ids.has(m.id))).join('')}</div>` : `<div class="card empty">${g.q ? 'Im aktuellen Datenstand keine Sitzung.' : 'Für diese Kommune gibt es noch keine Sitzungsdaten.'}</div>`}
        </section>`);
      } else {
        let x = null;
        try { x = await quelle(f.q); } catch { /* Quelle nicht erreichbar */ }
        const r = x ? sitzungen((x.sByK.get(f.k) || []).filter((m) => m.gremien.includes(f.g)), favKey(f)) : { liste: [], ids: new Set() };
        gremien.push(`<section class="fav">
          <div class="favkopf"><div><h2>${esc(gremiumKurz(f.g))}</h2><span class="muted small">${esc(x?.k.get(f.k)?.name || f.kn || '')}</span></div>${neuPille(r.ids.size)}${sternKnopf(f)}</div>
          ${r.liste.length ? `<div class="list">${r.liste.map((m) => sitzungRow(m, '', r.ids.has(m.id))).join('')}</div>` : '<div class="card empty">Im aktuellen Datenstand keine Sitzung dieses Gremiums.</div>'}
        </section>`);
      }
    }
    const letzterBesuch = store.get('gesehenAm', null);
    const neuText = !letzterBesuch ? ''
      : neuGesamt ? `<p class="neuhinweis"><strong>${neuGesamt} neue Sitzung${neuGesamt > 1 ? 'en' : ''}</strong> seit Ihrem letzten Besuch am ${esc(datum(letzterBesuch))}.</p>`
      : `<p class="muted small">Nichts Neues seit Ihrem letzten Besuch am ${esc(datum(letzterBesuch))}.</p>`;
    $view.innerHTML = `<section class="hero"><h1>Favoriten</h1><p class="muted small">Nur auf diesem Gerät gespeichert.</p></section>
      ${neuText}
      ${kommunen.length ? `<p class="favgruppe">Kommunen</p>${kommunen.join('')}` : ''}
      ${gremien.length ? `<p class="favgruppe">Gremien</p>${gremien.join('')}` : ''}`;
    // Stand merken (nur für Favoriten, deren Quelle geladen wurde; andere behalten ihren alten Stand)
    const merk = {};
    for (const f of favs) { const k = favKey(f); const w = gesehenNeu[k] || gesehenAlt[k]; if (w) merk[k] = w; }
    store.set('gesehen', merk);
    store.set('gesehenAm', new Date().toISOString());
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
  const extern = (url, text) => `<a href="${esc(sicherUrl(url))}" target="_blank" rel="noopener">${esc(text || url)}</a>`;

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
        <h4>Bildnachweis</h4>
        <p>Die Fotos im Bildband der Startseite stammen von Adobe Stock und werden im Rahmen einer Standardlizenz verwendet.</p>
        <h4>Hinweis</h4>
        <p>Wahlheimat ist ein unabhängiges, nicht kommerzielles Angebot und kein Angebot des Landes Rheinland-Pfalz oder der Kommunen. Für die Inhalte verlinkter Seiten, insbesondere der Ratsinformationssysteme, sind deren Betreiber verantwortlich.</p>`,
    }),
    datenschutz: () => ({
      titel: 'Datenschutz',
      html: `<p class="lead">${ZAEHLER
          ? 'Kurz gesagt: Wahlheimat braucht keine Anmeldung, setzt keine Cookies, legt keine Profile an und zeigt keine Werbung. Gezählt wird nur anonym, wie oft App-Seiten aufgerufen werden, ohne Drittanbieter (Abschnitt 3a). Was Sie sich merken, bleibt auf Ihrem Gerät.'
          : 'Kurz gesagt: Wahlheimat braucht keine Anmeldung, setzt keine Cookies, verwendet kein Tracking und keine Analyse- oder Werbedienste. Was Sie sich merken, bleibt auf Ihrem Gerät.'}</p>
        <h4>1. Verantwortlich</h4>
        <p>${ang(BETREIBER.name)}, ${ang(BETREIBER.anschrift)}, E-Mail: ${mail()}</p>
        <h4>2. Bereitstellung der Website (Hosting)</h4>
        <p>Die Website liegt bei GitHub Pages (GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, USA). Beim Aufruf verarbeitet GitHub technisch notwendige Daten wie IP-Adresse, Zeitpunkt, abgerufene Datei und Browser-Kennung, um die Seite auszuliefern und vor Missbrauch zu schützen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einer sicheren, funktionierenden Website). GitHub ist nach dem EU-US Data Privacy Framework zertifiziert. Einzelheiten: ${extern('https://docs.github.com/de/site-policy/privacy-policies/github-general-privacy-statement', 'Datenschutzerklärung von GitHub')}.</p>
        <p>Schriften und alle übrigen Bestandteile der App werden von dieser Website selbst geladen, nicht von Dritten${ZAEHLER ? ' (einzige Ausnahme: der Zähler, siehe 3a)' : ''}.</p>
        <h4>3. Speicher auf Ihrem Gerät</h4>
        <p>Die App speichert im Speicher Ihres Browsers (<em>localStorage</em>) Ihre Favoriten, die zuletzt gewählte Kommune und die Einstellungen der Themensuche, außerdem eine Zahl, wie oft Sie Ansichten der App geöffnet haben, und ein Merkzeichen, ob Ihnen der einmalige Unterstützungshinweis schon angezeigt wurde, außerdem App-Dateien und den zuletzt geladenen Datenstand für die Nutzung ohne Verbindung. Diese Angaben verlassen Ihr Gerät nicht und werden nicht an uns übertragen. Sie dienen ausschließlich Funktionen der App, die Sie selbst nutzen, und dem einmaligen Hinweis; sie werden nicht ausgewertet (§ 25 Abs. 2 TDDDG). Sie können sie jederzeit löschen, indem Sie die Websitedaten in Ihrem Browser entfernen.</p>
        ${ZAEHLER ? `<h4>3a. Reichweitenmessung (eigener Zähler)</h4>
        <p>Um zu verstehen, wie Wahlheimat genutzt wird, zählen wir Seitenaufrufe mit einem eigenen kleinen Zähler. Er läuft als Cloudflare Worker (Cloudflare, Inc., USA; Datenbank bei Cloudflare, Einsatz ohne Drittanbieter-Skript). Bei jedem Seitenwechsel meldet Ihr Browser nur die Art der aufgerufenen App-Seite (zum Beispiel „Kommune 07134005, Ebene VG“, nie Ihre Suchbegriffe oder Sitzungs-/Vorlagen-IDs). Der Zähler erhöht daraufhin eine Tageszahl für diese Seitenart. Es werden keine IP-Adresse, keine Kennung, kein Browser- oder Geräteprofil und kein Verweis gespeichert, und es wird nichts auf Ihrem Gerät abgelegt; Zählungen werden nach 400 Tagen gelöscht. Beim technischen Empfang der Meldung sieht Cloudflare wie jeder Server kurzzeitig die IP-Adresse, speichert sie für diesen Zähler aber nicht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einer bedarfsgerechten Weiterentwicklung). Wenn Ihr Browser „Do Not Track“ oder „Global Privacy Control“ sendet, zählen wir nicht. Sie können der Messung außerdem widersprechen (Art. 21 DSGVO), etwa indem Sie uns schreiben.</p>` : ''}
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
    $view.innerHTML = `<section class="hero"><h1>Info</h1><p class="muted small">Wahlheimat ist ein unabhängiges Angebot – kein Angebot des Landes oder der Kommunen.</p></section>
      <div class="list">
        ${zeile('ueber', 'Was Wahlheimat ist, woher die Daten kommen, Kontakt')}
        ${zeile('impressum', 'Anbieterkennzeichnung')}
        ${zeile('datenschutz', ZAEHLER ? 'Keine Cookies, keine Profile, kein Drittanbieter – die Einzelheiten' : 'Keine Cookies, kein Tracking – die Einzelheiten')}
      </div>
      ${spende}
      <p class="stand">Datenstand ${esc(stand(INDEX.erstellt))}</p>`;
  }

  // Zählung auf diesem Gerät ein-/ausschalten (Link „#/ohne-zaehlung“ bzw. „#/mit-zaehlung“; speichert nur einen Merker im Gerät)
  function vZaehlung(aus) {
    store.set('zaehlung-aus', aus);
    setTitle('Zählung');
    $view.innerHTML = `${backLink}<section class="hero"><h1>${aus ? 'Zählung ausgeschaltet' : 'Zählung eingeschaltet'}</h1></section>
      <div class="card textseite"><p>${aus
        ? 'Dieses Gerät wird ab sofort nicht mehr in der anonymen Reichweitenstatistik mitgezählt. Gespeichert wird dafür nur ein Merker in diesem Browser.'
        : 'Dieses Gerät wird wieder in der anonymen Reichweitenstatistik mitgezählt (nur die Art der aufgerufenen Seite, ohne Kennung).'}</p>
      <p><a class="btn ghost" href="${aus ? '#/mit-zaehlung' : '#/ohne-zaehlung'}">${aus ? 'Wieder mitzählen' : 'Nicht mehr mitzählen'}</a></p></div>`;
  }

  function vText(art) {
    const t = TEXTSEITEN[art]();
    setTitle(t.titel);
    $view.innerHTML = `${backLink}<section class="hero"><h1>${esc(t.titel)}</h1></section><div class="card textseite">${t.html}</div>`;
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
    const kopf = `<section class="hero"><div class="favkopf"><h1>${esc(anzeigeName(t))}</h1>${sternKnopf({ typ: 'gebiet', id: t.id })}</div><p class="muted small">${esc([t.ew ? fmtZahl(t.ew) + ' Einwohner' : '', sel.key !== 'gemeinde' ? ERKLAERUNG[sel.key] : untertitel(t)].filter(Boolean).join(' · '))}</p></section>`;

    if (!t.q) {
      $view.innerHTML = seg + kopf + SITZE_PLATZ + ohneDaten(t, eb);
      sitzverteilung(t);
      return;
    }
    const x = await quelle(t.q);
    const sitz = x.sByK.get(t.b) || [];
    const jetzt = now();
    const kommend = sitz.filter((m) => m.start >= jetzt);
    const alleVergangen = sitz.filter((m) => m.start < jetzt).reverse();
    const vergangen = alleVergangen.slice(0, 6);
    const fruehere = alleVergangen.slice(6);
    const alleVorl = x.vByK.get(t.b) || [];
    const vorl = alleVorl.slice(0, 10);
    const aeltereVorl = alleVorl.slice(10);
    const gremien = gremienVon(sitz);
    // VG-Ebene: auch die Sitzungen der Ortsgemeinden und der Stadt aus demselben System (das RIS zählt sie zur VG)
    const andere = sel.key === 'vg' ? x.D.sitzungen.filter((m) => m.start >= jetzt && m.k !== t.b).sort((a, b) => a.start.localeCompare(b.start)) : [];
    const knName = (m) => kurzName(x.k.get(m.k)?.name || '');
    // „Zuletzt behandelt“: öffentliche Sach-TOPs der letzten 120 Tage mit Beschluss-/Protokolltext, neueste zuerst, höchstens 3 je Sitzung
    const behandelt = [];
    const vor120 = new Date(Date.now() - 120 * 86_400_000).toISOString();
    const FLOSKEL = /^(\d+[.)]?\s*)?(begr(ü|ue)ßung|er(ö|oe)ffnung|feststellung der (beschluss|tages)|genehmigung der (tages|nieder)|niederschrift|einwohner|jugendfrage|mitteilung|bekanntgabe|anfragen|verschiedenes|informationen?\b|anregungen|wünsche|schlusswort|verpflichtung)/i;
    for (const m of alleVergangen) {
      if (m.start < vor120) break;
      let je = 0;
      for (const tp of m.tops) {
        if (je >= 3) break;
        if (tp.oeffentlich === false || !tp.beschluss || !tp.name || FLOSKEL.test(tp.name.trim())) continue;
        behandelt.push({ m, tp }); je++;
      }
      if (behandelt.length >= 8) break;
    }
    const behandeltRow = ({ m, tp }) => {
      const kurzErg = tp.beschluss.length <= 80 && /einstimmig|mehrheitlich|abgelehnt|angenommen|beschlossen|zugestimmt|enthaltung|vertagt|\bja\b|\bnein\b/i.test(tp.beschluss) ? tp.beschluss : '';
      return `<button class="row" type="button" data-go="${esc(link('s', m.id))}">${dateBox(m.start)}<div class="body"><span class="title">${esc(tp.name)}</span><span class="meta">${esc(gremiumKurz(m.gremien[0] || m.name || 'Sitzung'))}${kurzErg ? `<span class="pill ok">${esc(kurzErg)}</span>` : ''}</span></div>${chev}</button>`;
    };
    // Gemeinde/Stadt ohne eigene Termine, VG mit Terminen: darauf hinweisen
    const vgEbene = eb.find((e) => e.key === 'vg' && !e.off && e.g.q === t.q);
    const vgHinweis = !kommend.length && vgEbene && sel.key !== 'vg' && sel.key !== 'kreis'
      ? x.D.sitzungen.filter((m) => m.start >= jetzt && m.k !== t.b).length : 0;
    $view.innerHTML = `${seg}${kopf}${SITZE_PLATZ}${nurTermineHinweis(x)}
      <section class="spalte"><h2>Nächste Sitzungen</h2>
        ${kommend.length ? `<div class="list">${kommend.map(sitzungRow).join('')}</div>` : `<div class="card empty">Zurzeit sind keine künftigen Sitzungen eingetragen.${vergangen.length ? ` Die letzte war am ${fmt(vergangen[0].start, { day: 'numeric', month: 'long', year: 'numeric' })}.` : ''} Neue Termine erscheinen hier, sobald die Verwaltung sie im ${x.D.quelle.ohneRis ? 'Internetauftritt' : 'Ratsinformationssystem'} veröffentlicht.${vgHinweis ? `<br><br>In der Verbandsgemeinde gibt es ${vgHinweis} künftige Sitzung${vgHinweis > 1 ? 'en' : ''} anderer Gemeinden. <button class="linkbtn" type="button" data-go="${esc(link('g', id, 'vg'))}">Zur Verbandsgemeinde</button>` : ''}</div>`}
      </section>
      ${x.D.quelle.nurTermine ? '' : `<section class="spalte"><h2>Neue Vorlagen</h2>
        ${vorl.length ? `<div class="list">${vorl.map(vorlageRow).join('')}</div>` : '<div class="card empty">Keine aktuellen Vorlagen.</div>'}
        ${aeltereVorl.length ? `<details class="gremien archiv" id="avorl"><summary>${fmtZahl(aeltereVorl.length)} ältere Vorlagen</summary><div class="list"></div><div class="mehrwrap"></div></details>` : ''}
      </section>`}
      ${andere.length ? `<section><h2>In den Gemeinden der Verbandsgemeinde</h2>
        <p class="muted small">Sitzungen der Ortsgemeinden und der Stadt, die im selben Ratsinformationssystem geführt werden.</p>
        <div class="list">${andere.slice(0, 8).map((m) => sitzungRow(m, knName(m))).join('')}</div>
        ${andere.length > 8 ? `<details class="gremien"><summary>${andere.length - 8} weitere zeigen</summary><div class="list">${andere.slice(8, 80).map((m) => sitzungRow(m, knName(m))).join('')}</div></details>` : ''}
      </section>` : ''}
      ${behandelt.length ? `<section><h2>Zuletzt behandelt</h2>
        <p class="muted small">Tagesordnungspunkte aus den letzten Sitzungen, zu denen ein Beschluss- oder Protokolltext vorliegt.</p>
        <div class="list">${behandelt.map(behandeltRow).join('')}</div></section>` : ''}
      ${vergangen.length ? `<section><h2>Zuletzt getagt</h2><div class="list">${vergangen.map(sitzungRow).join('')}</div>
        ${fruehere.length ? `<details class="gremien archiv" id="afrueh"><summary>${fmtZahl(fruehere.length)} frühere Sitzungen (bis ${esc(String(new Date(fruehere[fruehere.length - 1].start).getFullYear()))} zurück)</summary><div class="list"></div></details>` : ''}
      </section>` : ''}
      ${gremien.length ? `<section><details class="gremien"><summary>Gremien (${gremien.length}) – mit dem Stern als Favorit merken</summary>
        <div class="list">${gremien.map((g) => `<div class="row static"><div class="body"><span class="title">${esc(gremiumKurz(g))}</span></div>${sternKnopf({ q: t.q, k: t.b, g, kn: x.k.get(t.b)?.name || '', ort: id })}</div>`).join('')}</div>
      </details></section>` : ''}
      ${risLink(null, x.D.quelle.ris, '', x.D.quelle.ohneRis)}
      <p class="stand">Abgleich mit ${esc(x.D.quelle.name)}: ${esc(stand(x.D.quelle.abgleich))}</p>`;
    sitzverteilung(t);
    // Ältere Einträge erst beim Aufklappen zeichnen, je Jahr gruppiert, in Schritten von 40
    const archiv = (id, eintraege, zeile, jahr) => {
      const d = document.getElementById(id);
      if (!d) return;
      let n = 0;
      const $l = d.querySelector('.list');
      const $m = d.querySelector('.mehrwrap');
      const mehr = () => {
        const teil = eintraege.slice(n, n + 40);
        let html = '';
        let j = n ? jahr(eintraege[n - 1]) : null;
        for (const e of teil) {
          if (jahr(e) !== j) { j = jahr(e); html += `<p class="favgruppe">${esc(String(j))}</p>`; }
          html += zeile(e);
        }
        n += teil.length;
        $l.insertAdjacentHTML('beforeend', html);
        $m.innerHTML = n < eintraege.length ? `<button type="button" class="btn ghost mehr">Weitere ${fmtZahl(Math.min(40, eintraege.length - n))} zeigen</button>` : '';
      };
      d.addEventListener('toggle', () => { if (d.open && !n) mehr(); });
      d.addEventListener('click', (e) => { if (e.target.closest('.mehr')) mehr(); });
    };
    archiv('afrueh', fruehere, (m) => sitzungRow(m), (m) => new Date(m.start).getFullYear());
    archiv('avorl', aeltereVorl, vorlageRow, (v) => (v.datum || '').slice(0, 4) || 'ohne Datum');
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
      ${x.D.quelle.ris ? `<a class="btn ghost" href="${esc(sicherUrl(x.D.quelle.ris))}" target="_blank" rel="noopener">Ratsinformationssystem öffnen</a>` : ''}</div>`;
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
        ${ris ? `<a class="btn ghost" href="${esc(sicherUrl(ris.url))}" target="_blank" rel="noopener">Ratsinformationssystem öffnen</a>` : ''}
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
    const url = [seite, startseite].map((u) => sicherUrl(u)).find((u) => u !== '#') || '';
    seite = sicherUrl(seite) === '#' ? null : seite;
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

  function sitzungRow(m, kn, neu) {
    const n = m.tops.length;
    return `<button class="row" type="button" data-go="${esc(link('s', m.id))}">${dateBox(m.start)}<div class="body"><span class="title">${esc(gremiumKurz(m.gremien[0] || m.name || 'Sitzung'))}</span><span class="meta">${kn ? esc(kn) + ' · ' : ''}${esc(uhrText(m.start))}${m.ort ? ' · ' + esc(ortKurz(m.ort)) : ''}</span><span class="meta">${neu ? '<span class="pill neu">neu</span>' : ''}${statusPill(m)}${n ? `<span>${n} TOP${n > 1 ? 's' : ''}</span>` : ''}</span></div>${chev}</button>`;
  }
  function vorlageRow(v) {
    return `<button class="row" type="button" data-go="${esc(link('v', v.id))}"><div class="body"><span class="meta"><span class="mono">${esc(v.nr)}</span><span>${esc(datum(v.datum))}</span>${v.kurz ? '<span class="pill">Kurz erklärt</span>' : ''}</span><span class="title">${esc(v.name)}</span><span class="meta">${esc(v.art || '')}</span></div>${chev}</button>`;
  }
  function docRow(f) {
    const label = f.rolle !== 'auxiliary' && rolleLabel[f.rolle] ? rolleLabel[f.rolle] : f.name;
    return `<a class="doc" href="${esc(sicherUrl(f.url))}" target="_blank" rel="noopener"><span class="ico">${f.seite ? 'WEB' : 'PDF'}</span><span class="body"><span>${esc(label)}</span><span class="muted small">${esc(f.rolle === 'auxiliary' ? 'Anlage' : f.name)}${f.dl ? ' · wird heruntergeladen' : ''}</span></span>${chev}</a>`;
  }
  /** Hinweis unter der Dokumentenliste, wenn das System die Dateien nur als Download liefert */
  const dlHinweis = (docs) => (docs.some((f) => f.dl)
    ? '<p class="muted small dlhinweis">Dieses Ratsinformationssystem liefert Dokumente nur als Download. Auf dem Handy öffnet sich danach Ihre PDF-App, oder Sie finden die Datei im Download-Ordner.</p>'
    : '');

  // ---------- Teilen ----------
  const teilenIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/></svg>';
  const teilenKnopf = (titel) => `<button class="teilen" type="button" data-share="${esc(titel)}">${teilenIcon}Teilen</button>`;
  async function teilen(titel) {
    const url = location.origin + location.pathname + location.hash;
    try {
      if (navigator.share) { await navigator.share({ title: titel, text: titel, url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(`${titel}\n${url}`); toast('Link in die Zwischenablage kopiert'); }
    catch { toast(`<span>Adresse zum Kopieren: ${esc(url)}</span>`); }
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
        <div class="favkopf"><h1>${esc(String(m.gremien[0] || m.name).replace(/\s+/g, ' '))}</h1>${m.gremien[0] ? sternKnopf({ q: x.D.quelle.id, k: m.k, g: m.gremien[0], kn: x.k.get(m.k)?.name || '', ort: kommune || '' }) : ''}</div>
        <p>${esc(langDatum(m.start))}, ${esc(uhrText(m.start))}${m.ende && m.status === 'durchgeführt' ? ' bis ' + esc(uhr(m.ende)) + ' Uhr' : ''}</p>
        ${m.ort ? `<p class="muted">${esc(m.ort)}</p>` : ''}
        ${teilenKnopf(`${(() => { const t = String(m.gremien[0] || m.name || 'Sitzung').replace(/\s+/g, ' '); const kn = x.k.get(m.k)?.name || ''; return kn && !t.includes(kn.replace(/^(Stadt|Gemeinde|Ortsgemeinde|Verbandsgemeinde) /, '')) ? `${t} – ${kn}` : t; })()}, ${langDatum(m.start)}, ${uhrText(m.start)} – Wahlheimat RLP`)}
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
    // Ohne eigene Vorlagenseite (more!rubin u. a.): die Seite der Sitzung verlinken, auf deren Tagesordnung die Vorlage steht
    const ersatz = v.web ? null : steps.map((b) => b.sitzung && x.s.get(b.sitzung)).find((m) => m && m.web && !m.webKalender);
    const t = now();
    $view.innerHTML = `
      ${backLink}
      <section class="hero">
        <span class="meta"><span class="mono">${esc(v.nr)}</span><span>${esc(v.art || '')}</span><span>${esc(datum(v.datum))}</span></span>
        <h1>${esc(v.name)}</h1>
        <p class="muted small">${esc(x.k.get(v.k)?.name)}</p>
        ${teilenKnopf(`${v.nr ? 'Vorlage ' + v.nr + ': ' : ''}${v.name} – ${x.k.get(v.k)?.name || ''} – Wahlheimat RLP`)}
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
      ${risLink(v.web || ersatz?.web, x.D.quelle.ris, ersatz && !v.web ? 'Sitzung mit dieser Vorlage' : 'Vorlage')}`;
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
  function gebietsfilter(gewaehlt) {
    const opt = [{ key: 'alle', label: 'Ganz Rheinland-Pfalz' }];
    const g = kommune && G.get(kommune);
    if (g) for (const e of ebenen(g)) if (!e.off && e.g && e.g.typ !== 'body') opt.push({ key: 'g:' + e.g.id, label: anzeigeName(e.g), id: e.g.id });
    const favs = favoriten().filter((f) => f.typ === 'gebiet' && G.has(f.id));
    if (favs.length) opt.push({ key: 'fav', label: 'Meine Favoriten', ids: favs.map((f) => f.id) });
    // frei gesuchter Ort (noch nicht in der Liste)
    const gw = gewaehlt && G.get(gewaehlt);
    if (gw && !opt.some((o) => o.key === 'g:' + gw.id)) opt.push({ key: 'g:' + gw.id, label: anzeigeName(gw), id: gw.id });
    opt.push({ key: 'suche', label: 'Anderen Ort suchen …' });
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
    const filter = gebietsfilter(zustand.gewaehlt);
    if (!filter.some((f) => f.key === zustand.ort) || zustand.ort === 'suche') zustand.ort = 'alle';
    $view.innerHTML = `
      <section class="hero"><h1>Was wird zu meinem Thema beraten?</h1>
        <p class="muted small">Vorlagen und Tagesordnungspunkte aller angebundenen Räte – in Ihrer Kommune, im Kreis oder in ganz Rheinland-Pfalz.</p></section>
      <form class="searchbox" id="tf" role="search" autocomplete="off">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
        <input id="tq" type="search" enterkeyhint="search" placeholder="Stichwort, z. B. Windkraft oder Freibad" value="${esc(zustand.text)}" aria-label="Stichwort">
      </form>
      <div class="chips" role="group" aria-label="Themen">${Object.keys(THEMEN).map((t) => `<button type="button" class="chip" data-thema="${esc(t)}" aria-pressed="${zustand.thema === t}">${esc(t)}</button>`).join('')}</div>
      <section class="field"><label for="tort">Wo</label><select id="tort">${filter.map((f) => `<option value="${esc(f.key)}" ${f.key === zustand.ort ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select></section>
      <section class="field" id="ortsuche" hidden><label for="tos">Ort, Verbandsgemeinde oder Kreis</label>
        <div class="searchbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
        <input id="tos" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" placeholder="z. B. Enkenbach oder Kusel" aria-label="Ort suchen"></div>
        <div id="oh" class="list suggest"></div></section>
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
        : `<div class="card empty">Keine Treffer im aktuellen Datenstand.${hinweisOhneEigeneDaten(f)}</div>`;
    };
    // Ort ohne eigene Sitzungsdaten: auf VG bzw. Kreis verweisen, wo die Sitzungen liegen können
    const hinweisOhneEigeneDaten = (f) => {
      const g = f && f.id && G.get(f.id);
      if (!g || g.q || g.typ === 'vg' || g.typ === 'kreis') return '';
      const eltern = G.get(g.vg) || G.get(g.kreis);
      if (!hatDaten(g) || !eltern) return `<br><br>Für ${esc(anzeigeName(g))} liegen noch keine Sitzungsdaten vor.`;
      return `<br><br>Für ${esc(anzeigeName(g))} gibt es keine eigenen Sitzungsdaten – die Sitzungen stehen bei ${esc(anzeigeName(eltern))}. <button type="button" class="btn ghost" data-ort="${esc(eltern.id)}">Dort suchen</button>`;
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
    const $sel = document.getElementById('tort');
    const $os = document.getElementById('ortsuche');
    const $tos = document.getElementById('tos');
    const $oh = document.getElementById('oh');
    $sel.addEventListener('change', (e) => {
      if (e.target.value === 'suche') { $os.hidden = false; $tos.focus(); return; }
      $os.hidden = true; zustand.ort = e.target.value; zeigen();
    });
    $tos.addEventListener('input', () => {
      const hits = suche($tos.value);
      $oh.innerHTML = !$tos.value.trim() ? '' : hits.length
        ? hits.map((g) => `<button class="row" type="button" data-ort="${esc(g.id)}"><div class="body"><span class="title">${esc(anzeigeName(g))}</span><span class="meta">${esc(untertitel(g))}</span></div></button>`).join('')
        : '<div class="card empty">Kein Ort gefunden.</div>';
    });
    const ortWahl = (e) => {
      const b = e.target.closest('[data-ort]');
      if (!b) return;
      zustand.gewaehlt = b.dataset.ort; zustand.ort = 'g:' + b.dataset.ort;
      store.set('themensuche', zustand);
      vThemen();
    };
    $oh.addEventListener('click', ortWahl);
    document.getElementById('treffer').addEventListener('click', ortWahl);
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
