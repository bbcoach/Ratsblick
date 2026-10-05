import type { Status } from './status.js';
import type { Zugriffe, ZugriffeFehler } from './zugriffe.js';

/**
 * Verschlüsselte Admin-Seite für GitHub Pages: Das Dashboard (HTML mit eingebetteten Daten) wird mit einem Passwort
 * verschlüsselt (PBKDF2-SHA256 → AES-256-GCM); im Browser fragt eine kleine Hülle das Passwort ab und entschlüsselt lokal.
 * Auf dem Server liegen nur unlesbare Daten. Schutz hängt an der Länge des Passworts (Offline-Raten ist möglich).
 */
export const PBKDF2_RUNDEN = 600_000;

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const ausB64 = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(s, "base64"));

export interface Chiffre {
  salt: string;
  iv: string;
  ct: string;
  iter: number;
}

async function schluessel(passwort: string, salt: Uint8Array<ArrayBuffer>, runden: number): Promise<CryptoKey> {
  const roh = await crypto.subtle.importKey('raw', new TextEncoder().encode(passwort), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: runden, hash: 'SHA-256' }, roh, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function verschluessele(klartext: string, passwort: string, runden = PBKDF2_RUNDEN): Promise<Chiffre> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await schluessel(passwort, salt, runden);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(klartext)));
  return { salt: b64(salt), iv: b64(iv), ct: b64(ct), iter: runden };
}

/** Gegenstück zur Entschlüsselung in der Hülle (für Tests). Wirft bei falschem Passwort. */
export async function entschluessele(c: Chiffre, passwort: string): Promise<string> {
  const key = await schluessel(passwort, ausB64(c.salt), c.iter);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ausB64(c.iv) }, key, ausB64(c.ct));
  return new TextDecoder().decode(pt);
}

/** Die öffentliche Hülle: nur Passwortfeld und verschlüsselte Daten. */
export function huelle(c: Chiffre): string {
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Wahlheimat – Admin</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f4f4;color:#1f1a1c}
@media(prefers-color-scheme:dark){body{background:#141113;color:#ece5e8}}
form{width:min(92vw,360px);display:grid;gap:12px;padding:24px;border-radius:12px;background:rgba(127,127,127,.12)}
h1{margin:0;font-size:18px}input,button{font:inherit;padding:12px;border-radius:8px;border:1px solid #8a7f83}
button{background:#7b2736;color:#fff;border:0;font-weight:600;cursor:pointer}p{margin:0;font-size:13px;min-height:1.2em;color:#b3261e}
</style></head><body>
<form id="f"><h1>Wahlheimat – Admin</h1>
<input id="p" type="password" autocomplete="current-password" placeholder="Passwort" aria-label="Passwort" required autofocus>
<button type="submit">Öffnen</button><p id="m" role="alert"></p></form>
<script>
const D=${JSON.stringify(c)};
const b=(s)=>Uint8Array.from(atob(s),(c)=>c.charCodeAt(0));
document.getElementById('f').addEventListener('submit',async(e)=>{
  e.preventDefault();const m=document.getElementById('m');m.textContent='';
  const btn=e.target.querySelector('button');btn.disabled=true;btn.textContent='Prüfe …';
  try{
    const km=await crypto.subtle.importKey('raw',new TextEncoder().encode(document.getElementById('p').value),'PBKDF2',false,['deriveKey']);
    const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b(D.salt),iterations:D.iter,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['decrypt']);
    const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:b(D.iv)},key,b(D.ct));
    document.open();document.write(new TextDecoder().decode(pt));document.close();
  }catch(_){m.textContent='Falsches Passwort.';btn.disabled=false;btn.textContent='Öffnen';}
});
</script></body></html>`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Das eigentliche Dashboard (wird verschlüsselt ausgeliefert). */
export function dashboardHtml(status: Status, zugriffe: Zugriffe | ZugriffeFehler | null = null): string {
  const daten = JSON.stringify(status).replace(/</g, '\\u003c');
  const zdaten = JSON.stringify(zugriffe).replace(/</g, '\\u003c');
  const z = status.zusammenfassung;
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Wahlheimat – Admin</title>
<style>
:root{color-scheme:light dark;--bg:#f6f4f4;--s:#fff;--fg:#1f1a1c;--m:#655a5e;--l:#e4dcdf;--ok:#2f6b45;--w:#8a5a0b;--f:#9b2c2c;--a:#7b2736;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media(prefers-color-scheme:dark){:root{--bg:#141113;--s:#1e1a1c;--fg:#ece5e8;--m:#a8999f;--l:#392f33;--ok:#86c79c;--w:#e2b866;--f:#ec9a9a;--a:#e6a0ad}}
body{margin:0;background:var(--bg);color:var(--fg);padding:16px;line-height:1.45}
main{max-width:1100px;margin:0 auto}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px}h2.erst{margin-top:12px}
details.mehr{margin-top:12px}details.mehr summary{cursor:pointer;font-size:14px;font-weight:600;padding:8px 0}details.mehr h3{font-size:13px;margin:12px 0 6px;color:var(--m);font-weight:600}
.m{color:var(--m);font-size:13px}.k{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:14px 0}
.k div{background:var(--s);border:1px solid var(--l);border-radius:10px;padding:10px 12px}.k b{display:block;font-size:22px}
.ok{color:var(--ok)}.warnung{color:var(--w)}.fehler{color:var(--f)}
.w{background:var(--s);border:1px solid var(--l);border-left:4px solid var(--w);border-radius:8px;padding:8px 12px;margin:6px 0}
.w.fehler{border-left-color:var(--f)}
.t{width:100%;border-collapse:collapse;background:var(--s);border:1px solid var(--l);border-radius:10px;overflow:hidden;font-size:13px}
.t th,.t td{padding:7px 9px;text-align:left;border-bottom:1px solid var(--l);white-space:nowrap}.t th{font-size:12px;color:var(--m);cursor:pointer}
.t td.n,.t th.n{text-align:right}.sc{overflow-x:auto}
.c{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}input[type=search]{font:inherit;padding:8px 10px;border-radius:8px;border:1px solid var(--l);background:var(--s);color:var(--fg);min-width:180px}
label{font-size:13px;display:flex;align-items:center;gap:6px}
.z{background:var(--s);border:1px dashed var(--l);border-radius:10px;padding:12px;color:var(--m);font-size:13px}
</style></head><body><main>
<h1>Wahlheimat – Admin</h1>
<h2 class="erst">Zugriffe</h2><div id="z" class="z">Der Zähler ist noch nicht eingerichtet.</div>
<h2>Quellenstatus</h2>
<div class="m">Stand ${esc(status.erstellt.slice(0, 16).replace('T', ' '))} UTC · aktualisiert sich mit jedem Abgleich (alle 6 Stunden)</div>
<div class="k"><div><b>${z.quellen}</b>Quellen</div><div><b class="ok">${z.ok}</b>in Ordnung</div><div><b class="warnung">${z.warnung}</b>Warnung</div><div><b class="fehler">${z.fehler}</b>Fehler</div><div><b>${z.sitzungen.toLocaleString('de-DE')}</b>Sitzungen</div><div><b>${z.kuenftig.toLocaleString('de-DE')}</b>kommende</div><div><b>${z.vorlagen.toLocaleString('de-DE')}</b>Vorlagen</div></div>
<h2>Auffälligkeiten</h2><div id="w"></div>
<h2>Veränderungen seit dem vorigen Abgleich</h2><div id="v" class="m"></div>
<h2>Alle Quellen</h2>
<div class="c"><input type="search" id="q" placeholder="Quelle suchen …" aria-label="Quelle suchen"><label><input type="checkbox" id="nur"> nur Auffällige</label></div>
<div class="sc"><table class="t"><thead><tr id="h"></tr></thead><tbody id="b"></tbody></table></div>
</main>
<script type="application/json" id="d">${daten}</script>
<script type="application/json" id="zd">${zdaten}</script>
<script>
const S=JSON.parse(document.getElementById('d').textContent);
const e=(s)=>String(s??'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const dt=(n)=>n===null||n===undefined?'–':(n>0?'+'+n:String(n));
const alter=(h)=>h===null?'nie':h<1?'<1 h':h<48?h+' h':Math.round(h/24)+' Tage';
document.getElementById('w').innerHTML=S.warnungen.length?S.warnungen.map((w)=>'<div class="w '+(w.art==='fehler'||w.art==='leer'?'fehler':'')+'"><b>'+e(w.name)+'</b> <span class="m">('+e(w.id)+')</span><br>'+e(w.text)+'</div>').join(''):'<div class="m">Keine Auffälligkeiten.</div>';
const ver=S.quellen.filter((q)=>q.delta&&(q.delta.sitzungen||q.delta.vorlagen));
document.getElementById('v').innerHTML=ver.length?ver.sort((a,b)=>Math.abs(b.delta.sitzungen)+Math.abs(b.delta.vorlagen)-Math.abs(a.delta.sitzungen)-Math.abs(a.delta.vorlagen)).slice(0,25).map((q)=>e(q.name)+': Sitzungen '+dt(q.delta.sitzungen)+', Vorlagen '+dt(q.delta.vorlagen)).join('<br>'):'Keine Veränderungen erfasst (nach dem nächsten Abgleich sichtbar).';
const sp=[['Quelle','name'],['System','typ'],['Status','ampel'],['Abgleich','alterStunden',1],['Sitzungen','sitzungen',1],['Δ','dS',1],['kommend','kuenftig',1],['Vorlagen','vorlagen',1],['TOP %','anteilTops',1],['letzte Sitzung','letzteSitzung']];
let sort='ampel',asc=false;
const rang={fehler:0,warnung:1,unbekannt:2,ok:3};
function zeichne(){
  const q=document.getElementById('q').value.toLowerCase(),nur=document.getElementById('nur').checked;
  let l=S.quellen.map((x)=>({...x,dS:x.delta?x.delta.sitzungen:0})).filter((x)=>(!q||(x.name+x.id).toLowerCase().includes(q))&&(!nur||x.ampel!=='ok'));
  l.sort((a,b)=>{let r=sort==='ampel'?rang[a.ampel]-rang[b.ampel]:(a[sort]??-1)<(b[sort]??-1)?-1:(a[sort]??-1)>(b[sort]??-1)?1:0;return asc?r:-r;});
  if(sort==='ampel')l.reverse();
  document.getElementById('h').innerHTML=sp.map((c,i)=>'<th class="'+(c[2]?'n':'')+'" data-i="'+i+'">'+c[0]+'</th>').join('');
  document.getElementById('b').innerHTML=l.map((x)=>'<tr><td title="'+e(x.id)+'">'+e(x.name)+'</td><td title="'+e(x.umleitung?'leitet um auf '+x.umleitung:'')+'">'+e(x.typ)+(x.version?' <span class="m">'+e(x.version.replace(/^(SessionNet|ALLRIS net) /,''))+'</span>':'')+'</td><td class="'+x.ampel+'">'+(x.fehler?e(x.fehler.slice(0,60)):x.ampel)+'</td><td class="n">'+alter(x.alterStunden)+'</td><td class="n">'+x.sitzungen+'</td><td class="n">'+dt(x.delta?x.delta.sitzungen:null)+'</td><td class="n">'+x.kuenftig+'</td><td class="n">'+x.vorlagen+'</td><td class="n" title="Anteil der Sitzungen der letzten 120 Tage mit Tagesordnung (Dokumente: '+(x.anteilDok===null?'–':Math.round(x.anteilDok*100)+' %')+')">'+(x.anteilTops===null?'–':Math.round(x.anteilTops*100))+'</td><td>'+e((x.letzteSitzung||'').slice(0,10))+'</td></tr>').join('');
}
document.getElementById('h').addEventListener('click',(ev)=>{const i=ev.target.dataset.i;if(i===undefined)return;const k=sp[i][1];if(k===sort)asc=!asc;else{sort=k;asc=false;}zeichne();});
document.getElementById('q').addEventListener('input',zeichne);document.getElementById('nur').addEventListener('change',zeichne);
zeichne();
const Z=JSON.parse(document.getElementById('zd').textContent);
if(Z&&Z.fehler){document.getElementById('z').textContent='Zugriffszahlen konnten nicht abgerufen werden: '+Z.fehler;}
else if(Z){
  const mx=Math.max(1,...Z.tage.map((t)=>t.aufrufe)),bw=100/Z.tage.length;
  const balken=Z.tage.map((t,i)=>'<rect x="'+(i*bw+0.4).toFixed(2)+'" y="'+(40-t.aufrufe/mx*40).toFixed(1)+'" width="'+(bw-0.8).toFixed(2)+'" height="'+(t.aufrufe/mx*40).toFixed(1)+'" fill="currentColor"><title>'+t.tag+': '+t.aufrufe+'</title></rect>').join('');
  const liste=(a)=>a.length?'<table class="t"><tbody>'+a.map((x)=>'<tr><td>'+e(x.name)+'</td><td class="n">'+x.aufrufe+'</td></tr>').join('')+'</tbody></table>':'<div class="m">noch keine Daten</div>';
  document.getElementById('z').className='';
  document.getElementById('z').innerHTML='<div class="k"><div><b>'+Z.heute+'</b>heute</div><div><b>'+Z.sieben+'</b>7 Tage</div><div><b>'+Z.dreissig+'</b>30 Tage</div></div><div class="m">Seitenaufrufe je Tag (30 Tage)</div><svg viewBox="0 0 100 40" preserveAspectRatio="none" style="width:100%;height:80px;color:var(--a)">'+balken+'</svg><div class="m">Seitenaufrufe, keine Personen: der Zähler speichert nur Summen je Tag und Seitenart.</div><details class="mehr"><summary>Meistgenutzte Seiten anzeigen</summary><h3>Nach Seitenart</h3>'+liste(Z.arten||[])+'<h3>Meistbesuchte Kommunen (alle Ebenen zusammen)</h3>'+liste(Z.kommunen||[])+'</details>';
}
</script></body></html>`;
}
