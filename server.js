'use strict';
// Bursztynowe Miasto: serwer. Bez zewnętrznych bibliotek. Dane w plikach w katalogu DATA_DIR.
const http = require('http');
const fs = require('fs');
const path = require('path');
const E = require('./engine');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const HASLO_KADRY = String(process.env.HASLO_KADRY || 'kadra-zmien-mnie').trim();
const STREFA = process.env.STREFA || 'Europe/Warsaw';
const PLIK_KONFIG = path.join(DATA_DIR, 'config.json');
const PLIK_STAN = path.join(DATA_DIR, 'state.json');
const PLIK_DZIENNIK = path.join(DATA_DIR, 'dziennik.jsonl');
const DOMYSLNA = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.default.json'), 'utf8'));
const STRONA = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

fs.mkdirSync(DATA_DIR, { recursive: true });

function zapiszAtomowo(plik, tekst) {
  const tmp = plik + '.tmp';
  fs.writeFileSync(tmp, tekst);
  fs.renameSync(tmp, plik);
}
function wczytajJson(plik, zapas) {
  try { return JSON.parse(fs.readFileSync(plik, 'utf8')); } catch (e) { return zapas; }
}

let cfg = wczytajJson(PLIK_KONFIG, null) || JSON.parse(JSON.stringify(DOMYSLNA));
let stany = (wczytajJson(PLIK_STAN, null) || {}).stany || [];
let dziennik = [];
try {
  dziennik = fs.readFileSync(PLIK_DZIENNIK, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
} catch (e) { dziennik = []; }

function dopasujStany() {
  while (stany.length < cfg.gildie.length) stany.push(E.nowyStan(cfg));
  if (stany.length > cfg.gildie.length) stany.length = cfg.gildie.length;
  for (const st of stany) for (const x of cfg.statki) if (typeof st.s[x.id] !== 'number') st.s[x.id] = 0;
}
dopasujStany();
function zapiszStan() { zapiszAtomowo(PLIK_STAN, JSON.stringify({ stany })); }
zapiszStan();

function teraz() {
  const d = new Date();
  const cz = new Intl.DateTimeFormat('pl-PL', { timeZone: STREFA, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
  const [h, m] = cz.split(':').map(Number);
  return { min: h * 60 + m, czas: cz };
}
const kosc = () => 1 + Math.floor(Math.random() * 6);

function wpis(g, kto, opis, wynik) {
  const t = teraz();
  const w = { t: Date.now(), czas: t.czas, g, kto, opis, wynik: wynik.msg, ok: wynik.ok, delta: wynik.delta || 0, b: g == null ? null : stany[g].b };
  dziennik.push(w);
  fs.appendFileSync(PLIK_DZIENNIK, JSON.stringify(w) + '\n');
  return w;
}

function rola(haslo) {
  const h = String(haslo || '').trim();
  if (!h) return null;
  if (h === HASLO_KADRY) return { rola: 'kadra' };
  if (h === String(cfg.ustawienia.haslo_punktowych || '').trim()) return { rola: 'punktowy' };
  const i = cfg.gildie.findIndex(g => String(g.haslo || '').trim() === h);
  return i >= 0 ? { rola: 'gildia', i } : null;
}

function opisAkcji(a) {
  const nazwa = id => (cfg.statki.find(x => x.id === id) || cfg.budowle.find(x => x.id === id) || { nazwa: String(id) }).nazwa;
  if (a.typ === 'kup') return 'Zakup: ' + nazwa(a.co);
  if (a.typ === 'sprzedaj') return 'Sprzedaż: ' + nazwa(a.co);
  if (a.typ === 'atak') { const t = E.TAKTYKI.find(x => x.id === a.taktyka); return 'Atak' + (t ? ': ' + t.nazwa : ''); }
  if (a.typ === 'martwy') { const p = cfg.punkty_martwe[Number(a.punkt)]; return p ? p.nazwa : 'Punkt martwy'; }
  if (a.typ === 'znajdzka') return 'Znajdźka';
  if (a.typ === 'zywy') { const p = cfg.punkty_zywe[Number(a.punkt)]; return 'Punkt żywy' + (p ? ': ' + p.nazwa : ''); }
  if (a.typ === 'korekta') return 'Korekta kadry';
  return 'Zgłoszenie';
}

function wykonaj(g, kto, a) {
  const t = teraz();
  const portPrzed = cfg.porty[stany[g].p];
  const w = E.akcja(cfg, stany[g], a, { min: t.min, kosc });
  if (w.ok) { stany[g] = w.st; zapiszStan(); }
  let opis = opisAkcji(a);
  if (a.typ === 'atak' && portPrzed) opis = 'Atak: ' + portPrzed.nazwa + ', ' + (E.TAKTYKI.find(x => x.id === a.taktyka) || { nazwa: '?' }).nazwa;
  wpis(g, kto, opis, w);
  return { ok: w.ok && !w.bledna, tekst: w.msg, kosci: w.kosci || null, wygrana: w.wygrana, atak: a.typ === 'atak' && !!w.kosci };
}

function dziennikGildii(g, ile) {
  const o = [];
  for (let k = dziennik.length - 1; k >= 0 && o.length < ile; k--) if (dziennik[k].g === g) o.push({ czas: dziennik[k].czas.slice(0, 5), opis: dziennik[k].opis, wynik: dziennik[k].wynik, ok: dziennik[k].ok });
  return o;
}

function widok(r) {
  const t = teraz();
  if (r.rola === 'gildia') {
    const w = E.widokGildii(cfg, stany, r.i, t.min);
    w.dziennik = dziennikGildii(r.i, 15); w.teraz = t.czas.slice(0, 5);
    return w;
  }
  if (r.rola === 'punktowy') {
    const f = E.faza(cfg, t.min);
    return { rola: 'punktowy', faza: f, teraz: t.czas.slice(0, 5), punkty: cfg.punkty_zywe.map(p => p.nazwa),
      ocena: { min: cfg.ustawienia.zywy_min, max: cfg.ustawienia.zywy_max },
      limit: cfg.ustawienia.zywy_wizyty,
      przerwa: cfg.ustawienia.zywy_przerwa_min,
      gildie: cfg.gildie.map((g, i) => ({ nazwa: g.nazwa, wizyty: cfg.punkty_zywe.map((p, k) => stany[i].zy[k] || 0),
        znowuOd: cfg.punkty_zywe.map((p, k) => { const od = E.kiedyZnowu(cfg, stany[i], k); return od != null && t.min < od ? E.hhmm(od) : null; }) })) };
  }
  const rank = E.ranking(cfg, stany);
  return { rola: 'kadra', faza: E.faza(cfg, t.min), teraz: t.czas,
    ranking: rank.map(x => {
      const st = stany[x.i], s = E.staty(cfg, st);
      return { i: x.i, miejsce: x.miejsce, nazwa: x.nazwa, porty: x.porty, zdobyty: x.zdobyty, bursztyn: x.bursztyn, sila: s.sila, zasieg: s.zasieg, zwrot: s.zwrot,
        statki: cfg.statki.filter(q => st.s[q.id] > 0).map(q => st.s[q.id] + ' × ' + q.nazwa).join(', ') || 'brak',
        budowle: cfg.budowle.filter(q => st.bud[q.id]).map(q => q.nazwa).join(', ') || 'brak',
        martwe: Object.keys(st.md).length, zywe: Object.values(st.zy).reduce((a, b) => a + b, 0), znajdzki: Object.keys(st.zn).length, nieudane: st.fail };
    }),
    dziennik: dziennik.slice(-300).reverse().map(d => ({ czas: d.czas, gildia: d.g == null ? '' : (cfg.gildie[d.g] || { nazwa: '?' }).nazwa, g: d.g, kto: d.kto, opis: d.opis, wynik: d.wynik, ok: d.ok, delta: d.delta, b: d.b })),
    ileZdarzen: dziennik.length, stany, konfiguracja: cfg, hasloKadryDomyslne: HASLO_KADRY === 'kadra-zmien-mnie' };
}

function api(body) {
  const r = rola(body.haslo);
  if (!r) return { blad: 'Złe hasło.', zleHaslo: true };
  const a = body.akcja;
  let komunikat = null;
  if (a && typeof a === 'object') {
    if (r.rola === 'gildia') {
      if (!['kup', 'sprzedaj', 'atak', 'martwy', 'znajdzka'].includes(a.typ)) return { blad: 'Gildia nie może tego zgłosić.' };
      komunikat = wykonaj(r.i, 'gildia', a);
    } else if (r.rola === 'punktowy') {
      if (a.typ !== 'zywy') return { blad: 'Punktowy może tylko zaliczać punkty żywe.' };
      const g = Number(a.gildia);
      if (!stany[g]) return { blad: 'Nie ma takiej gildii.' };
      komunikat = wykonaj(g, 'punktowy', { typ: 'zywy', punkt: a.punkt, ile: a.ile });
    } else {
      if (a.typ === 'korekta') {
        const g = Number(a.gildia);
        if (!stany[g]) return { blad: 'Nie ma takiej gildii.' };
        komunikat = wykonaj(g, 'kadra', { typ: 'korekta', ile: a.ile, powod: a.powod });
      } else if (a.typ === 'edytuj') {
        const g = Number(a.gildia);
        if (!stany[g]) return { blad: 'Nie ma takiej gildii.' };
        const w = E.edytujStan(cfg, stany[g], a.stan);
        if (w.ok) { stany[g] = w.st; zapiszStan(); wpis(g, 'kadra', 'Edycja kadry', w); }
        komunikat = { ok: w.ok, tekst: w.msg };
      } else if (a.typ === 'zapisz_konfiguracje') {
        const bledy = E.sprawdzKonfiguracje(a.konfiguracja);
        if (!bledy.length && a.konfiguracja.gildie.some(g => String(g.haslo).trim() === HASLO_KADRY)) bledy.push('Hasło gildii nie może być takie samo jak hasło kadry.');
        if (!bledy.length && String(a.konfiguracja.ustawienia.haslo_punktowych).trim() === HASLO_KADRY) bledy.push('Hasło punktowych nie może być takie samo jak hasło kadry.');
        if (bledy.length) komunikat = { ok: false, tekst: 'Nie zapisano. ' + bledy.join(' ') };
        else {
          cfg = JSON.parse(JSON.stringify(a.konfiguracja));
          zapiszAtomowo(PLIK_KONFIG, JSON.stringify(cfg, null, 1));
          dopasujStany(); zapiszStan();
          wpis(null, 'kadra', 'Zmiana cennika lub ustawień', { ok: true, msg: 'Zapisano.', delta: 0 });
          komunikat = { ok: true, tekst: 'Zapisano. Zmiany działają od razu.' };
        }
      } else if (a.typ === 'reset') {
        if (a.potwierdzenie !== 'RESET') komunikat = { ok: false, tekst: 'Wpiszcie słowo RESET, żeby wyzerować grę.' };
        else {
          const kopia = path.join(DATA_DIR, 'kopia-' + new Date().toISOString().replace(/[:.]/g, '-'));
          fs.mkdirSync(kopia, { recursive: true });
          for (const p of [PLIK_STAN, PLIK_DZIENNIK]) if (fs.existsSync(p)) fs.copyFileSync(p, path.join(kopia, path.basename(p)));
          stany = cfg.gildie.map(() => E.nowyStan(cfg)); dziennik = [];
          zapiszStan(); fs.writeFileSync(PLIK_DZIENNIK, '');
          komunikat = { ok: true, tekst: 'Gra wyzerowana. Poprzedni stan zapisany w kopii na serwerze.' };
        }
      } else return { blad: 'Nieznane polecenie kadry.' };
    }
  }
  return { widok: widok(r), komunikat };
}

// Proste hamowanie zgadywania haseł: 12 złych prób z jednego adresu w 5 minut blokuje go na minutę.
const proby = new Map();
function zablokowany(ip) {
  const p = proby.get(ip); if (!p) return false;
  if (p.blokadaDo && Date.now() < p.blokadaDo) return true;
  return false;
}
function zlaProba(ip) {
  const n = Date.now(); const p = proby.get(ip) || { czasy: [] };
  p.czasy = p.czasy.filter(t => n - t < 300000); p.czasy.push(n);
  if (p.czasy.length >= 12) { p.blokadaDo = n + 60000; p.czasy = []; }
  proby.set(ip, p);
}

function csv(v) { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

const serwer = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const json = (kod, o) => { res.writeHead(kod, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }); return res.end(STRONA);
  }
  if (req.method === 'GET' && url.pathname === '/zdrowie') return json(200, { ok: true, zdarzen: dziennik.length });
  if (req.method === 'GET' && (url.pathname === '/eksport.json' || url.pathname === '/eksport.csv')) {
    const r = rola(url.searchParams.get('haslo'));
    if (!r || r.rola !== 'kadra') { zlaProba(ip); return json(403, { blad: 'Tylko dla kadry.' }); }
    if (url.pathname === '/eksport.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="bursztynowe-miasto-stan.json"' });
      return res.end(JSON.stringify({ kiedy: new Date().toISOString(), konfiguracja: cfg, stany, ranking: E.ranking(cfg, stany), dziennik }, null, 1));
    }
    const wiersze = [['czas', 'gildia', 'kto', 'zgloszenie', 'wynik', 'przyjete', 'zmiana_bursztynu', 'bursztyn_po']].concat(
      dziennik.map(d => [d.czas, d.g == null ? '' : (cfg.gildie[d.g] || { nazwa: '?' }).nazwa, d.kto, d.opis, d.wynik, d.ok ? 'tak' : 'nie', d.delta, d.b]));
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="bursztynowe-miasto-dziennik.csv"' });
    return res.end('﻿' + wiersze.map(w => w.map(csv).join(';')).join('\n'));
  }
  if (req.method === 'POST' && url.pathname === '/api') {
    if (zablokowany(ip)) return json(429, { blad: 'Za dużo złych haseł. Spróbujcie za minutę.' });
    let dane = '';
    req.on('data', c => { dane += c; if (dane.length > 400000) req.destroy(); });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(dane || '{}'); } catch (e) { return json(400, { blad: 'Niepoprawne zapytanie.' }); }
      try {
        const o = api(body);
        if (o.zleHaslo) zlaProba(ip);
        json(200, o);
      } catch (e) {
        console.error('Błąd serwera:', e);
        json(500, { blad: 'Błąd serwera. Zgłoście to kadrze.' });
      }
    });
    return;
  }
  json(404, { blad: 'Nie ma takiej strony.' });
});

if (require.main === module) {
  serwer.listen(PORT, () => {
    console.log('Bursztynowe Miasto działa na porcie ' + PORT + ', dane w ' + DATA_DIR + ', gildii: ' + cfg.gildie.length + ', zdarzeń w dzienniku: ' + dziennik.length);
    if (HASLO_KADRY === 'kadra-zmien-mnie') console.warn('UWAGA: ustawcie zmienną HASLO_KADRY. Teraz działa hasło domyślne.');
  });
}
module.exports = { serwer };
