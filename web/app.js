// Ratsblick – Web-App. Liest die statischen Datendateien aus data/ (erzeugt mit `npm run web`).
(() => {
  'use strict';
  const TZ = 'Europe/Berlin';
  const $view = document.getElementById('view');
  const $title = document.getElementById('title');
  const $back = document.getElementById('back');
  const $toast = document.getElementById('toast');
  const $offline = document.getElementById('offline');

  const store = {
    get(k, d) { try { const v = localStorage.getItem('ratsblick:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('ratsblick:' + k, JSON.stringify(v)); } catch {} },
  };

  let INDEX = null;                    // Verzeichnis aller Quellen und Körperschaften
  const bodyIdx = new Map();           // Körperschafts-ID → { k, q }
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
  $back.addEventListener('click', () => { if (depth > 0) { depth--; history.back(); } else location.hash = kommune ? link('k', kommune) : link(); });
  window.addEventListener('hashchange', () => route());
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    depth = 0;
    const tab = b.dataset.tab;
    if (tab === 'wahl' || !kommune) location.hash = link('wahl');
    else if (tab === 'start') location.hash = link('k', kommune);
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
      if (r.v === 'k' && bodyIdx.has(r.a)) {
        kommune = r.a; store.set('kommune', kommune); tab = 'start';
        await vStart(r.a, r.b);
      } else if (r.v === 's' || r.v === 'v') {
        tab = 'start';
        const qid = quelleFuerObjekt(r.a);
        if (!qid) throw new Error('Unbekannte Quelle');
        const x = await quelle(qid);
        if (r.v === 's') vSitzung(x, r.a); else vVorlage(x, r.a);
      } else if (r.v === 'abo' && kommune) {
        tab = 'abo';
        await vAbo();
      } else if (!r.v && kommune && bodyIdx.has(kommune)) {
        location.replace(link('k', kommune));
        return;
      } else {
        vWahl();
      }
    } catch (err) {
      setTitle('<span class="brand">Ratsblick</span>');
      $view.innerHTML = `<div class="card empty">Das konnte nicht geladen werden (${esc(err.message)}). Prüfen Sie die Verbindung und laden Sie die Seite neu.</div>`;
    }
    $back.hidden = !(r.v === 's' || r.v === 'v');
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
    window.scrollTo(0, 0);
  }

  function setTitle(html) { $title.innerHTML = html; }

  // Klicks auf Einträge: Navigation über data-Attribute
  $view.addEventListener('click', (e) => {
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
    if (installEvent) return `<div class="card install"><p>Ratsblick als App auf dem Startbildschirm ablegen.</p><button class="btn" type="button" id="inst">Installieren</button><button class="x" type="button" id="instx" aria-label="Hinweis ausblenden">×</button></div>`;
    if (isIos()) return `<div class="card install"><p>Als App nutzen: in Safari auf <strong>Teilen</strong> tippen, dann <strong>Zum Home-Bildschirm</strong>.</p><button class="x" type="button" id="instx" aria-label="Hinweis ausblenden">×</button></div>`;
    return '';
  }
  function bindInstall() {
    document.getElementById('inst')?.addEventListener('click', async () => { installEvent.prompt(); await installEvent.userChoice; installEvent = null; route(); });
    document.getElementById('instx')?.addEventListener('click', () => { store.set('installHidden', true); route(); });
  }

  // ---------- Ansicht: Kommune wählen ----------
  function vWahl() {
    setTitle('<span class="brand">Ratsblick<small>Rheinland-Pfalz</small></span>');
    const query = q.trim().toLowerCase();
    const match = (k) => !query || k.name.toLowerCase().includes(query) || (k.plz || '').startsWith(query) || (k.ort || '').toLowerCase().includes(query);
    const rang = { Verbandsgemeinde: 0, Stadt: 1, Ortsgemeinde: 2, Ortsbezirk: 3, Zweckverband: 4, Sonstige: 5 };
    const lists = INDEX.quellen.map((qq) => {
      const items = qq.koerperschaften.filter(match)
        .sort((a, b) => (rang[a.art] ?? 9) - (rang[b.art] ?? 9) || a.name.localeCompare(b.name, 'de'));
      if (!items.length) return '';
      return `<section><h2>${esc(qq.name)}${qq.landkreis ? ' · ' + esc(qq.landkreis) : ''}</h2><div class="list">${items.map((k) => `
        <button class="row" type="button" data-go="${esc(link('k', k.id))}"><div class="body"><span class="title">${esc(k.name)}</span><span class="meta">${k.plz ? esc(k.plz + ' ' + (k.ort || '')) : esc(k.art)}${k.kommend ? ` · ${k.kommend} Sitzung${k.kommend > 1 ? 'en' : ''} geplant` : ''}</span></div>${kommune === k.id ? '<span class="pill">gewählt</span>' : ''}${chev}</button>`).join('')}</div></section>`;
    }).join('');
    $view.innerHTML = `
      ${installCard()}
      <section class="hero">
        <h3>Was beschließt Ihr Gemeinderat?</h3>
        <p class="muted">Sitzungen, Tagesordnungen und Vorlagen aus den Ratsinformationssystemen – an einem Ort. Wählen Sie Ihre Kommune.</p>
      </section>
      <input class="search" id="q" type="search" placeholder="Gemeinde oder Postleitzahl" value="${esc(q)}" aria-label="Kommune suchen" autocomplete="off">
      <div id="lists" style="display:grid;gap:20px">${lists || '<div class="empty card">Keine Kommune gefunden. Bisher sind sechs Ratsinformationssysteme aus Rheinland-Pfalz angebunden.</div>'}</div>
      <p class="stand">Datenstand ${esc(stand(INDEX.erstellt))} · ${INDEX.quellen.length} Ratsinformationssysteme · Quelle: OParl</p>`;
    const input = document.getElementById('q');
    input.addEventListener('input', () => {
      q = input.value;
      const pos = input.selectionStart;
      vWahl();
      const n = document.getElementById('q'); n.focus(); try { n.setSelectionRange(pos, pos); } catch {}
    });
    bindInstall();
  }

  // ---------- Ebenen ----------
  function ebenen(x, kid) {
    const k = x.k.get(kid);
    const vg = x.D.vg && x.k.get(x.D.vg);
    const istVg = k.art === 'Verbandsgemeinde';
    return [
      { key: 'gemeinde', label: k.art === 'Zweckverband' ? 'Verband' : 'Gemeinde', sub: istVg ? '–' : kurzName(k.name), id: istVg ? null : k.id, off: istVg },
      { key: 'vg', label: 'VG', sub: vg ? kurzName(vg.name) : 'keine', id: vg?.id ?? (istVg ? k.id : null), off: !vg && !istVg },
      { key: 'kreis', label: 'Landkreis', sub: x.D.quelle.landkreis || 'kreisfrei', id: null, off: true },
    ];
  }

  // ---------- Ansicht: Startseite der Kommune ----------
  async function vStart(kid, ebene) {
    const qid = bodyIdx.get(kid).q;
    const x = await quelle(qid);
    const k = x.k.get(kid);
    const eb = ebenen(x, kid);
    const sel = eb.find((e) => e.key === ebene && !e.off) || eb.find((e) => !e.off);
    setTitle(`<span class="brand">${esc(kurzName(k.name))}</span>`);
    const t = now();
    const sitz = x.sByK.get(sel.id) || [];
    const kommend = sitz.filter((m) => m.start >= t);
    const vergangen = sitz.filter((m) => m.start < t).reverse().slice(0, 6);
    const vorl = (x.vByK.get(sel.id) || []).slice(0, 10);
    const target = x.k.get(sel.id);
    const hint = sel.key === 'vg' && k.art !== 'Verbandsgemeinde'
      ? 'Die Verbandsgemeinde entscheidet u. a. über Grundschulen, Feuerwehr, Wasser, Abwasser und den Flächennutzungsplan.'
      : `${target.art}${x.D.quelle.landkreis ? ' im Landkreis ' + x.D.quelle.landkreis : ''}`;
    $view.innerHTML = `
      <div class="seg" role="group" aria-label="Ebene">${eb.map((e) => `<button type="button" ${e.off ? 'disabled' : `data-go="${esc(link('k', kid, e.key))}"`} aria-pressed="${e.key === sel.key}" title="${e.key === 'kreis' ? 'Der Landkreis ist noch nicht angebunden' : ''}">${e.label}<small>${esc(e.sub)}</small></button>`).join('')}</div>
      <section class="hero"><h3>${esc(target.name)}</h3><p class="muted small">${esc(hint)}</p></section>
      <section><h2>Nächste Sitzungen</h2>
        ${kommend.length ? `<div class="list">${kommend.map(sitzungRow).join('')}</div>` : '<div class="card empty">Zurzeit sind keine Sitzungen angekündigt.</div>'}
      </section>
      <section><h2>Neue Vorlagen</h2>
        ${vorl.length ? `<div class="list">${vorl.map(vorlageRow).join('')}</div>` : '<div class="card empty">Keine aktuellen Vorlagen.</div>'}
      </section>
      ${vergangen.length ? `<section><h2>Zuletzt getagt</h2><div class="list">${vergangen.map(sitzungRow).join('')}</div></section>` : ''}
      <p class="stand">Abgleich mit ${esc(x.D.quelle.name)}: ${esc(stand(x.D.quelle.abgleich))}</p>`;
  }
  // Die Ebenen-Schalter navigieren ohne Verlaufseintrag
  $view.addEventListener('click', (e) => {
    const b = e.target.closest('.seg [data-go]');
    if (b) { e.stopImmediatePropagation(); e.preventDefault(); location.replace(b.dataset.go); }
  }, true);

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
    setTitle('Sitzung');
    const docs = m.dateien.filter((f) => f.url);
    $view.innerHTML = `
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
      </section>`;
  }

  // ---------- Ansicht: Vorlage ----------
  function vVorlage(x, id) {
    const v = x.v.get(id);
    if (!v) throw new Error('Diese Vorlage ist nicht im aktuellen Datenstand');
    setTitle(`<span class="mono">${esc(v.nr)}</span>`);
    const docs = v.dateien.filter((f) => f.url);
    const steps = v.beratung.filter((b) => b.gremium || b.datum);
    const t = now();
    $view.innerHTML = `
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
      ${docs.length ? `<section><h2>Dokumente</h2><div class="list">${docs.map(docRow).join('')}</div></section>` : ''}`;
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
    const x = await quelle(bodyIdx.get(kommune).q);
    const k = x.k.get(kommune);
    setTitle('Themen-Abo');
    const a = abo();
    const terms = [...a.themen.flatMap((t) => THEMEN[t] || []), ...[a.stichwort, a.strasse].filter(Boolean).map((s) => s.toLowerCase())];
    const ids = ebenen(x, kommune).filter((e) => !e.off).map((e) => e.id);
    const treffer = !terms.length ? [] : x.D.vorlagen.filter((v) => ids.includes(v.k)).map((v) => {
      const hay = ((v.name || '') + ' ' + (v.text || '')).toLowerCase();
      const hit = terms.find((t) => hay.includes(t));
      return hit ? { v, hit } : null;
    }).filter(Boolean).slice(0, 15);
    $view.innerHTML = `
      <section class="hero"><h3>Bescheid wissen, wenn es um Ihr Thema geht</h3><p class="muted small">Für ${esc(k.name)}${x.D.vg && x.D.vg !== kommune ? ' und die ' + esc(x.k.get(x.D.vg)?.name) : ''}.</p></section>
      <section><h2>Themen</h2><div class="chips">${Object.keys(THEMEN).map((t) => `<button type="button" class="chip" data-thema="${esc(t)}" aria-pressed="${a.themen.includes(t)}">${esc(t)}</button>`).join('')}</div></section>
      <section class="field"><label for="stw">Stichwort</label><input type="text" id="stw" value="${esc(a.stichwort)}" placeholder="z. B. Dorfgemeinschaftshaus" enterkeyhint="done"></section>
      <section class="field"><label for="str">Ihre Straße</label><input type="text" id="str" value="${esc(a.strasse)}" placeholder="z. B. Hauptstraße" autocomplete="address-line1" enterkeyhint="done"><p class="muted small">Wird nur auf diesem Gerät gespeichert.</p></section>
      <section><h2>Benachrichtigung</h2><div class="list">
        <label class="switch" for="push"><span>Push-Mitteilung</span><input type="checkbox" id="push" ${a.push ? 'checked' : ''}></label>
        <label class="switch" for="mail"><span>E-Mail</span><input type="checkbox" id="mail" ${a.mail ? 'checked' : ''}></label>
      </div><p class="notice">Benachrichtigungen werden noch nicht verschickt. Ihre Auswahl bleibt auf diesem Gerät gespeichert.</p></section>
      <section><h2>Das wäre zuletzt gekommen (${treffer.length})</h2>
        ${treffer.length ? `<div class="list">${treffer.map(({ v, hit }) => `<button class="row" type="button" data-go="${esc(link('v', v.id))}"><div class="body"><span class="meta"><span class="mono">${esc(v.nr)}</span><span>${esc(datum(v.datum))}</span><span>${esc(kurzName(x.k.get(v.k)?.name))}</span></span><span class="title">${esc(v.name)}</span><span class="meta">Treffer: <mark>${esc(hit)}</mark></span></div>${chev}</button>`).join('')}</div>` : '<div class="card empty">Keine passenden Vorlagen im aktuellen Datenstand.</div>'}
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
    INDEX = idx;
    for (const qq of INDEX.quellen) for (const k of qq.koerperschaften) bodyIdx.set(k.id, { k, q: qq.id });
    if (kommune && !bodyIdx.has(kommune)) kommune = null;
    route();
  }).catch((err) => {
    $view.innerHTML = `<div class="card empty">Die Daten konnten nicht geladen werden (${esc(err.message)}). Prüfen Sie die Verbindung und laden Sie die Seite neu.</div>`;
  });
})();
