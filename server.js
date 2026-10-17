'use strict';
// Bursztynowe Miasto: serwer. Bez zewnętrznych bibliotek. Dane w plikach w katalogu DATA_DIR.
const http = require('http');
const fs = require('fs');
const path = require('path');
const E = require('./engine');
const N = require('./nadzor');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const HASLO_KADRY = String(process.env.HASLO_KADRY || 'kadra-zmien-mnie').trim();
const STREFA = process.env.STREFA || 'Europe/Warsaw';
// AI: działa z kluczem Anthropic albo OpenAI (pierwszy znaleziony). Bez klucza nadzór działa na samych regułach.
const KLUCZ_ANTHROPIC = String(process.env.ANTHROPIC_API_KEY || '').trim();
const KLUCZ_OPENAI = String(process.env.OPENAI_API_KEY || '').trim();
const AI_DOSTAWCA = KLUCZ_ANTHROPIC ? 'anthropic' : KLUCZ_OPENAI ? 'openai' : '';
const AI_KLUCZ = KLUCZ_ANTHROPIC || KLUCZ_OPENAI;
const OPENAI_URL = process.env.OPENAI_URL || 'https://api.openai.com/v1/chat/completions';
const AI_MODEL = AI_DOSTAWCA === 'openai' ? (process.env.OPENAI_MODEL || 'gpt-5-mini') : (process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5');
const AI_CO_MIN = Number(process.env.AI_CO_MIN ?? 15);
const PLIK_KONFIG = path.join(DATA_DIR, 'config.json');
const PLIK_STAN = path.join(DATA_DIR, 'state.json');
const PLIK_DZIENNIK = path.join(DATA_DIR, 'dziennik.jsonl');
const PLIK_ZGL = path.join(DATA_DIR, 'zgloszenia.json');
const KAT_ZDJ = path.join(DATA_DIR, 'zdjecia');
const PLIK_TEST = path.join(DATA_DIR, 'test.json');
const PLIK_ANK = path.join(DATA_DIR, 'ankieta.json');
// Ankieta po grze: każdy telefon osobno, oceny 1–5 (0 = nie dotyczy), dwa pola tekstowe.
const PYTANIA = [
  { id: 'ogolnie', tekst: 'Jak ogólnie podobała ci się gra?' },
  { id: 'kupowanie', tekst: 'Kupowanie statków i budowli: czy wybór był ciekawy?' },
  { id: 'ataki', tekst: 'Ataki na porty: dobór taktyki i floty' },
  { id: 'set', tekst: 'Set przed atakiem: czy dobrze się w niego grało?', nieDotyczy: 'Nie graliśmy' },
  { id: 'zywe', tekst: 'Punkty żywe: zadania z kadrą' },
  { id: 'martwe', tekst: 'Punkty martwe i znajdźki' },
  { id: 'zasady', tekst: 'Jasność zasad: czy wiedzieliście, co robić?' },
  { id: 'aplikacja', tekst: 'Aplikacja na telefonie: czy była wygodna?' }
];
const DOMYSLNA = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.default.json'), 'utf8'));
const STRONA = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(KAT_ZDJ, { recursive: true });

function zapiszAtomowo(plik, tekst) {
  const tmp = plik + '.tmp';
  fs.writeFileSync(tmp, tekst);
  fs.renameSync(tmp, plik);
}
function wczytajJson(plik, zapas) {
  try { return JSON.parse(fs.readFileSync(plik, 'utf8')); } catch (e) { return zapas; }
}

let cfg = wczytajJson(PLIK_KONFIG, null) || JSON.parse(JSON.stringify(DOMYSLNA));
// nowe ustawienia z nowszej wersji aplikacji dopisują się do starego, zapisanego cennika
for (const k in DOMYSLNA.ustawienia) if (!(k in cfg.ustawienia)) cfg.ustawienia[k] = DOMYSLNA.ustawienia[k];
// zgłoszenia znajdziek ze zdjęciem: { id, g, t, czas, tekst, zdjecie: bool, stan: 'czeka'|'ok'|'nie', powod, delta, decyzja: czas }
let zgloszenia = wczytajJson(PLIK_ZGL, []);
let ankiety = wczytajJson(PLIK_ANK, []);
function planszaKonca(min) { const od = E.minuty(cfg.ustawienia.plansza_od); return od != null && min >= od ? (String(cfg.ustawienia.plansza_tekst || '').trim() || 'Koniec gry! Udajcie się do punktu startowego.') : null; }
function ankietaOtwarta(min) { const od = E.minuty(cfg.ustawienia.ankieta_od); return od != null && min >= od; }
function ankietaDlaTelefonu(urz, min) { return { otwarta: ankietaOtwarta(min), pytania: PYTANIA, wypelniona: !!urz && ankiety.some(a => a.urz === urz) }; }
function zapiszAnkiete(g, test, urz, a) {
  const oceny = {};
  for (const q of PYTANIA) { const v = Math.trunc(Number((a.oceny || {})[q.id])); if (v >= 0 && v <= 5 && (v > 0 || q.nieDotyczy)) oceny[q.id] = v; }
  const najlepsze = String(a.najlepsze || '').trim().slice(0, 1000), poprawic = String(a.poprawic || '').trim().slice(0, 1000);
  if (!Object.keys(oceny).length && !najlepsze && !poprawic) return { ok: false, tekst: 'Zaznaczcie choć jedną ocenę albo napiszcie uwagę.' };
  const wpisA = { urz: String(urz || '').slice(0, 40) || 'brak-' + Date.now(), g, gildia: test ? 'Konto testowe' : (cfg.gildie[g] || { nazwa: '?' }).nazwa, test: !!test, czas: teraz().czas.slice(0, 5), oceny, najlepsze, poprawic };
  ankiety = ankiety.filter(x => x.urz !== wpisA.urz); ankiety.push(wpisA);
  zapiszAtomowo(PLIK_ANK, JSON.stringify(ankiety));
  return { ok: true, tekst: 'Dziękujemy za ankietę!' };
}
function ankietaDlaKadry() {
  const prawdziwe = ankiety.filter(a => !a.test);
  return { od: cfg.ustawienia.ankieta_od, n: prawdziwe.length, nTest: ankiety.length - prawdziwe.length,
    pytania: PYTANIA.map(q => { const v = prawdziwe.map(a => a.oceny[q.id]).filter(x => x > 0); const nd = prawdziwe.filter(a => a.oceny[q.id] === 0).length;
      const rozklad = [1, 2, 3, 4, 5].map(k => v.filter(x => x === k).length);
      return { tekst: q.tekst, n: v.length, srednia: v.length ? Math.round(10 * v.reduce((s, x) => s + x, 0) / v.length) / 10 : null, rozklad, nieDotyczy: nd }; }),
    uwagi: prawdziwe.filter(a => a.najlepsze || a.poprawic).map(a => ({ gildia: a.gildia, czas: a.czas, najlepsze: a.najlepsze, poprawic: a.poprawic })).reverse() };
}
function zapiszZgl() { zapiszAtomowo(PLIK_ZGL, JSON.stringify(zgloszenia)); }
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

function wpis(g, kto, opis, wynik, a) {
  const t = teraz();
  const w = { t: Date.now(), czas: t.czas, g, kto, opis, wynik: wynik.msg, ok: wynik.ok, delta: wynik.delta || 0, b: g == null ? null : stany[g].b };
  // pola do nadzoru: co to było i z jakim skutkiem
  if (a && a.typ) {
    w.typ = a.typ;
    if (a.punkt != null) w.pkt = Number(a.punkt);
    if (/^martwy/.test(a.typ)) w.odp = String(a.odpowiedz || '').slice(0, 60);
    if (a.typ === 'znajdzka') w.kod = String(a.kod || '').slice(0, 40);
    if (a.typ === 'zywy' && wynik.ok) w.ile = Number(a.ile);
    if (wynik.bledna) w.bledna = true;
    if (a.typ === 'atak' && wynik.ok) w.wygrana = !!wynik.wygrana;
  }
  dziennik.push(w);
  fs.appendFileSync(PLIK_DZIENNIK, JSON.stringify(w) + '\n');
  return w;
}

function rola(haslo) {
  const h = String(haslo || '').trim();
  if (!h) return null;
  if (h === HASLO_KADRY) return { rola: 'kadra' };
  if (h === String(cfg.ustawienia.haslo_punktowych || '').trim()) return { rola: 'punktowy' };
  if (String(cfg.ustawienia.haslo_testowe || '').trim() && h === String(cfg.ustawienia.haslo_testowe).trim()) return { rola: 'test' };
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
  if (a.typ === 'zestaw_start') return 'Set: start';
  if (a.typ === 'zestaw_wybor' || a.typ === 'zestaw_koniec') return 'Set: wynik';
  return 'Zgłoszenie';
}

function wykonaj(g, kto, a) {
  const t = teraz();
  const portPrzed = cfg.porty[stany[g].p];
  const w = E.akcja(cfg, stany[g], a, { min: t.min, kosc, ms: Date.now() });
  if (w.ok) { stany[g] = w.st; zapiszStan(); }
  let opis = opisAkcji(a);
  if (a.typ === 'atak' && portPrzed) opis = 'Atak: ' + portPrzed.nazwa + ', ' + (E.TAKTYKI.find(x => x.id === a.taktyka) || { nazwa: '?' }).nazwa;
  if (w.kosci && a.typ !== 'atak' && portPrzed) opis = 'Atak po Secie: ' + portPrzed.nazwa;
  // pojedyncze kliknięcia w zestawach nie zaśmiecają dziennika; zapisuje się start i wynik
  if (!(a.typ === 'zestaw_wybor' && !w.zestawKoniec) && !(a.typ === 'zestaw_koniec' && !w.ok)) wpis(g, kto, opis, w, a);
  return { ok: w.ok && !w.bledna, tekst: w.msg, kosci: w.kosci || null, wygrana: w.wygrana, atak: !!w.kosci,
    zestaw: a.typ.startsWith('zestaw') ? { dobry: !!w.zestawDobry, zly: !!w.zestawZly, stare: !!w.zestawStare, nowe: w.zestawNowe || null, koniec: w.zestawKoniec || null } : undefined };
}

function dziennikGildii(g, ile) {
  const o = [];
  for (let k = dziennik.length - 1; k >= 0 && o.length < ile; k--) if (dziennik[k].g === g) o.push({ czas: dziennik[k].czas.slice(0, 5), opis: dziennik[k].opis, wynik: dziennik[k].wynik, ok: dziennik[k].ok });
  return o;
}

// ---------- znajdźki ze zdjęciem ----------
const MAX_ZDJ = 1500000;          // bajtów po zdekodowaniu; telefon i tak zmniejsza zdjęcie do ok. 200 KB
// Zgłoszenie gildii: znajdźka albo punkt martwy, zdjęciem i/lub tekstem.
// Punkt martwy z tekstem zgodnym z odpowiedzią zalicza się od razu. Reszta czeka na kadrę.
function noweZgloszenie(g, a) {
  const u = cfg.ustawienia, f = E.faza(cfg, teraz().min), st = stany[g];
  if (f === 'przed') return { ok: false, tekst: 'Gra jeszcze się nie zaczęła.' };
  if (f === 'koniec') return { ok: false, tekst: 'Gra już się skończyła.' };
  const rodzaj = 'martwy';
  if (a.rodzaj !== 'martwy') return { ok: false, tekst: 'Znajdźki zalicza się kodem z kartki.' };
  const tekst = String(a.tekst || '').trim().slice(0, 300);
  const foto = typeof a.foto === 'string' ? a.foto : '';
  if (!tekst && !foto) return { ok: false, tekst: rodzaj === 'martwy' ? 'Wpiszcie odpowiedź albo dodajcie zdjęcie.' : 'Dodajcie zdjęcie albo opis.' };
  const czekaG = zgloszenia.filter(z => z.g === g && z.stan === 'czeka');
  let pkt = null;
  if (rodzaj === 'martwy') {
    pkt = Number(a.punkt); const p = cfg.punkty_martwe[pkt];
    if (!p) return { ok: false, tekst: 'Nie ma takiego punktu.' };
    if (st.md[pkt]) return { ok: false, tekst: 'Ten punkt macie już zaliczony.' };
    if ((st.mt[pkt] || 0) >= u.proby_martwy) return { ok: false, tekst: 'Wykorzystaliście już wszystkie próby na tym punkcie.' };
    if (czekaG.some(z => z.rodzaj === 'martwy' && z.pkt === pkt)) return { ok: false, tekst: 'Odpowiedź na ten punkt czeka już na sprawdzenie.' };
    // zgodny tekst: zalicza się od razu, bez kadry
    if (u.martwy_auto && tekst && !foto && E.norm(tekst) === E.norm(p.odpowiedz)) return wykonaj(g, 'gildia', { typ: 'martwy', punkt: pkt, odpowiedz: tekst });
  }
  if (czekaG.length >= 5) return { ok: false, tekst: 'Macie już 5 zgłoszeń czekających na sprawdzenie. Poczekajcie chwilę na kadrę.' };
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  let zdjecie = false;
  if (foto) {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(foto);
    if (!m) return { ok: false, tekst: 'Nie udało się odczytać zdjęcia. Spróbujcie jeszcze raz.' };
    const bufor = Buffer.from(m[2], 'base64');
    if (bufor.length > MAX_ZDJ) return { ok: false, tekst: 'Zdjęcie jest za duże.' };
    fs.writeFileSync(path.join(KAT_ZDJ, id + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1])), bufor);
    zdjecie = m[1];
  }
  const t = teraz();
  zgloszenia.push({ id, g, t: Date.now(), czas: t.czas, rodzaj, pkt, tekst, zdjecie, stan: 'czeka' });
  zapiszZgl();
  const opis = rodzaj === 'martwy' ? 'Zgłoszenie: ' + cfg.punkty_martwe[pkt].nazwa : 'Zgłoszenie znajdźki';
  wpis(g, 'gildia', opis + (zdjecie ? ' (zdjęcie)' : ''), { ok: true, msg: 'Czeka na sprawdzenie przez kadrę.', delta: 0 }, { typ: 'zdjecie' });
  return { ok: true, tekst: 'Wysłane do sprawdzenia.' };
}
function decyzja(a) {
  const z = zgloszenia.find(x => x.id === a.id);
  if (!z) return { ok: false, tekst: 'Nie ma takiego zgłoszenia.' };
  if (z.stan !== 'czeka') return { ok: false, tekst: 'To zgłoszenie jest już sprawdzone (' + (z.stan === 'ok' ? 'zaliczone' : 'odrzucone') + ').' };
  if (a.decyzja !== 'ok' && a.decyzja !== 'nie') return { ok: false, tekst: 'Wybierzcie: zalicz albo odrzuć.' };
  const kiedy = teraz().czas.slice(0, 5), nazwa = (cfg.gildie[z.g] || {}).nazwa;
  const powod = String(a.powod || '').trim().slice(0, 200);
  if (z.rodzaj === 'martwy') {
    const w = wykonaj(z.g, 'kadra', { typ: a.decyzja === 'ok' ? 'martwy_ok' : 'martwy_nie', punkt: z.pkt, odpowiedz: z.tekst });
    if (!w.ok && a.decyzja === 'ok') return { ok: false, tekst: w.tekst };
    z.stan = a.decyzja; z.delta = a.decyzja === 'ok' ? dziennik[dziennik.length - 1].delta : 0; z.powod = a.decyzja === 'nie' ? powod : ''; z.decyzja = kiedy;
    zapiszZgl();
    return { ok: true, tekst: nazwa + ': ' + (a.decyzja === 'ok' ? 'zaliczone, +' + z.delta : 'odrzucone') + '.' };
  }
  if (a.decyzja === 'ok') {
    const w = wykonaj(z.g, 'kadra', { typ: 'znajdzka_foto' });
    if (!w.ok) return { ok: false, tekst: w.tekst };
    z.stan = 'ok'; z.delta = dziennik[dziennik.length - 1].delta; z.decyzja = kiedy;
    zapiszZgl();
    return { ok: true, tekst: nazwa + ': zaliczone, +' + z.delta + '.' };
  }
  z.stan = 'nie'; z.powod = powod; z.decyzja = kiedy;
  zapiszZgl();
  wpis(z.g, 'kadra', 'Zgłoszenie znajdźki odrzucone', { ok: true, msg: 'Odrzucone' + (z.powod ? ': ' + z.powod : '') + '.', delta: 0 }, { typ: 'zdjecie_nie' });
  return { ok: true, tekst: nazwa + ': odrzucone.' };
}

// ---------- konto testowe: pełna gra dla jednej osoby, bez wpływu na gildie, ranking i dziennik ----------
// Działa zawsze (bez pilnowania godzin), punkt martwy sprawdza się automatycznie, a przyciski testowe dają bursztyn, porty i punkty żywe.
let test = wczytajJson(PLIK_TEST, null);
const testDz = [];
function testNowy() { const st = E.nowyStan(cfg); st.b = st.z = 500; return st; }
function testZapisz() { zapiszAtomowo(PLIK_TEST, JSON.stringify(test)); }
function testCfg() { const c = JSON.parse(JSON.stringify(cfg)); c.ustawienia.pilnuj_godzin = false; c.gildie = c.gildie.concat([{ nazwa: 'Konto testowe', haslo: '' }]); return c; }
function testAkcja(a) {
  if (!test) test = testNowy();
  for (const x of cfg.statki) if (typeof test.s[x.id] !== 'number') test.s[x.id] = 0;
  const c = testCfg(), t = teraz(), u = c.ustawienia;
  let w;
  if (a.typ === 'test_reset') { test = testNowy(); testDz.length = 0; w = { ok: true, msg: 'Konto testowe od nowa: 500 bursztynu, 1 sznika.', st: test }; }
  else if (a.typ === 'test_bursztyn') { const ile = Math.max(-5000, Math.min(5000, Math.trunc(Number(a.ile) || 200))); test.b += ile; test.z = Math.max(0, test.z + ile); w = { ok: true, msg: 'Bursztyn ' + (ile > 0 ? '+' : '') + ile + '.', st: test }; }
  else if (a.typ === 'test_port') { const p = Math.max(0, Math.min(c.porty.length, Math.trunc(Number(a.p) || 0))); test.p = p; test.fail = 0; test.zestaw = null; w = { ok: true, msg: 'Następny port: ' + (c.porty[p] ? (p + 1) + '. ' + c.porty[p].nazwa : 'wszystkie zdobyte') + '.', st: test }; }
  else if (a.typ === 'test_zywy') { const k = Math.trunc(Number(a.punkt) || 0); w = E.akcja(c, test, { typ: 'zywy', punkt: k, ile: Math.trunc(Number(a.ile) || 40) }, { min: t.min, kosc, ms: Date.now() }); }
  else if (a.typ === 'zdjecie') {
    // bez kadry: tekst sprawdza się sam, samo zdjęcie zalicza się od razu
    const pkt = Number(a.punkt), tekst = String(a.tekst || '').trim();
    if (!tekst && a.foto) w = E.akcja(c, test, { typ: 'martwy_ok', punkt: pkt }, { min: t.min, kosc, ms: Date.now() });
    else w = E.akcja(c, test, { typ: 'martwy', punkt: pkt, odpowiedz: tekst }, { min: t.min, kosc, ms: Date.now() });
    if (w.ok) w.msg += ' (konto testowe: sprawdzone automatycznie)';
  }
  else if (['kup', 'sprzedaj', 'atak', 'znajdzka', 'zestaw_start', 'zestaw_wybor', 'zestaw_koniec'].includes(a.typ)) w = E.akcja(c, test, a, { min: t.min, kosc, ms: Date.now() });
  else return { blad: 'Na koncie testowym tego nie ma.' };
  if (w.ok) { test = w.st; testZapisz(); }
  if (!(a.typ === 'zestaw_wybor' && !w.zestawKoniec)) { testDz.push({ czas: t.czas.slice(0, 5), opis: opisAkcji(a), wynik: w.msg, ok: w.ok }); if (testDz.length > 30) testDz.shift(); }
  return { ok: w.ok && !w.bledna, tekst: w.msg, kosci: w.kosci || null, wygrana: w.wygrana, atak: !!w.kosci,
    zestaw: a.typ.startsWith('zestaw') ? { dobry: !!w.zestawDobry, zly: !!w.zestawZly, stare: !!w.zestawStare, nowe: w.zestawNowe || null, koniec: w.zestawKoniec || null } : undefined };
}
function testWidok() {
  if (!test) { test = testNowy(); testZapisz(); }
  const c = testCfg(), t = teraz();
  if (test.zestaw && Date.now() > test.zestaw.start + (c.ustawienia.zestawy_czas_s || 60) * 1000 + 1500) testAkcja({ typ: 'zestaw_koniec' });
  const w = E.widokGildii(c, stany.concat([test]), stany.length, t.min);
  w.rola = 'gildia'; w.test = true; w.teraz = t.czas.slice(0, 5); w.zgloszenia = [];
  w.dziennik = testDz.slice().reverse().slice(0, 15);
  w.martwe.forEach(p => { p.czeka = false; });
  w.zywePunkty = cfg.punkty_zywe.map(p => p.nazwa);
  return w;
}

// Kto i kiedy ostatnio był w aplikacji. Tylko w pamięci: po restarcie serwera liczy się od nowa.
const ob = { gildie: {}, punkty: {}, urz: {}, start: Date.now(), eksport: null };
function obecnosc(r, body) {
  const n = Date.now();
  const id = String(body.urz || '').slice(0, 40);
  if (r.rola === 'gildia') ob.gildie[r.i] = n;
  let punkt = null;
  if (r.rola === 'punktowy') {
    punkt = body.akcja && body.akcja.typ === 'zywy' ? Number(body.akcja.punkt) : (body.punkt == null ? null : Number(body.punkt));
    if (Number.isInteger(punkt) && cfg.punkty_zywe[punkt]) ob.punkty[punkt] = n; else punkt = null;
  }
  if (id) ob.urz[id] = { rola: r.rola, t: n, g: r.i, punkt };
  for (const k in ob.urz) if (n - ob.urz[k].t > 6 * 3600000) delete ob.urz[k];
}
let ai = { tekst: '', czas: '', blad: '', trwa: false, ostatnio: 0 };
function nadzor() { const t = teraz(); ob.zgloszenia = zgloszenia; return N.analiza(cfg, stany, dziennik, ob, t.min, Date.now()); }
const zglDlaGildii = g => zgloszenia.filter(z => z.g === g).slice(-30).reverse().map(z => ({ id: z.id, czas: z.czas.slice(0, 5), rodzaj: z.rodzaj || 'znajdzka', pkt: z.pkt, nazwa: z.rodzaj === 'martwy' ? (cfg.punkty_martwe[z.pkt] || {}).nazwa : 'Znajdźka', tekst: z.tekst, zdjecie: z.zdjecie, stan: z.stan, powod: z.powod || '', delta: z.delta || 0 }));
const zglDlaKadry = () => zgloszenia.slice(-300).map(z => {
  const o = Object.assign({}, z, { gildia: (cfg.gildie[z.g] || { nazwa: '?' }).nazwa, rodzaj: z.rodzaj || 'znajdzka' });
  if (o.rodzaj === 'martwy') { const p = cfg.punkty_martwe[z.pkt] || {}; o.punkt = p.nazwa; o.pytanie = p.pytanie || ''; o.odpowiedz = p.odpowiedz || ''; }
  return o;
});

function widok(r, urz) {
  const t = teraz();
  if (r.rola === 'test') { const w = testWidok(); w.ankieta = ankietaDlaTelefonu(urz, t.min); w.plansza = planszaKonca(t.min); return w; }
  if (r.rola === 'gildia') {
    // gra w zestawy po czasie kończy się sama, nawet gdy telefon był zamknięty
    const z = stany[r.i].zestaw;
    if (z && Date.now() > z.start + (cfg.ustawienia.zestawy_czas_s || 60) * 1000 + 1500) wykonaj(r.i, 'gildia', { typ: 'zestaw_koniec' });
    const w = E.widokGildii(cfg, stany, r.i, t.min);
    w.dziennik = dziennikGildii(r.i, 15); w.teraz = t.czas.slice(0, 5); w.zgloszenia = zglDlaGildii(r.i);
    w.ankieta = ankietaDlaTelefonu(urz, t.min); w.plansza = planszaKonca(t.min);
    w.martwe.forEach(p => { p.czeka = zgloszenia.some(z => z.g === r.i && z.rodzaj === 'martwy' && z.pkt === p.nr && z.stan === 'czeka'); });
    return w;
  }
  if (r.rola === 'punktowy') {
    const f = E.faza(cfg, t.min);
    return { rola: 'punktowy', faza: f, teraz: t.czas.slice(0, 5), punkty: cfg.punkty_zywe.map(p => p.nazwa),
      ocena: { min: cfg.ustawienia.zywy_min, max: cfg.ustawienia.zywy_max },
      limit: cfg.ustawienia.zywy_wizyty,
      przerwa: cfg.ustawienia.zywy_przerwa_min,
      gildie: cfg.gildie.map((g, i) => ({ nazwa: g.nazwa, wizyty: cfg.punkty_zywe.map((p, k) => stany[i].zy[k] || 0),
        znowuOd: cfg.punkty_zywe.map((p, k) => { const od = E.kiedyZnowu(cfg, stany[i], k); return od != null && t.min < od ? E.hhmm(od) : null; }),
        inny: cfg.punkty_zywe.map((p, k) => E.musiInny(cfg, stany[i], k)) })), innyPunkt: !!cfg.ustawienia.zywy_inny_punkt };
  }
  const rank = E.ranking(cfg, stany);
  return { rola: 'kadra', faza: E.faza(cfg, t.min), teraz: t.czas,
    ranking: rank.map(x => {
      const st = stany[x.i], s = E.staty(cfg, st);
      return { i: x.i, miejsce: x.miejsce, nazwa: x.nazwa, porty: x.porty, zdobyty: x.zdobyty, bursztyn: x.bursztyn, sila: s.sila, zasieg: s.zasieg, zwrot: s.zwrot,
        statki: cfg.statki.filter(q => st.s[q.id] > 0).map(q => st.s[q.id] + ' × ' + q.nazwa).join(', ') || 'brak',
        budowle: cfg.budowle.filter(q => st.bud[q.id]).map(q => q.nazwa).join(', ') || 'brak',
        martwe: Object.keys(st.md).length, zywe: Object.values(st.zy).reduce((a, b) => a + b, 0), znajdzki: Object.keys(st.zn).length + (st.zf || 0), nieudane: st.fail };
    }),
    dziennik: dziennik.slice(-300).reverse().map(d => ({ czas: d.czas, gildia: d.g == null ? '' : (cfg.gildie[d.g] || { nazwa: '?' }).nazwa, g: d.g, kto: d.kto, opis: d.opis, wynik: d.wynik, ok: d.ok, delta: d.delta, b: d.b })),
    ileZdarzen: dziennik.length, stany, konfiguracja: cfg, hasloKadryDomyslne: HASLO_KADRY === 'kadra-zmien-mnie',
    zgloszenia: zglDlaKadry(), ankieta: ankietaDlaKadry(), nadzor: nadzor(), ai: { jest: !!AI_KLUCZ, dostawca: AI_DOSTAWCA, model: AI_KLUCZ ? AI_MODEL : '', tekst: ai.tekst, czas: ai.czas, blad: ai.blad, trwa: ai.trwa, co: AI_CO_MIN } };
}

function api(body) {
  const r = rola(body.haslo);
  if (!r) return { blad: 'Złe hasło.', zleHaslo: true };
  if (r.rola !== 'test') obecnosc(r, body);
  const a = body.akcja;
  let komunikat = null;
  if (a && typeof a === 'object' && a.typ === 'ankieta' && (r.rola === 'gildia' || r.rola === 'test')) komunikat = zapiszAnkiete(r.i, r.rola === 'test', body.urz, a);
  else if (a && typeof a === 'object' && (r.rola === 'gildia' || r.rola === 'test') && planszaKonca(teraz().min)) return { blad: 'Gra jest zakończona. Udajcie się do punktu startowego.', widok: widok(r, String(body.urz || '').slice(0, 40)) };
  else if (a && typeof a === 'object' && r.rola === 'test') { const o = testAkcja(a); if (o.blad) return o; komunikat = o; }
  else if (a && typeof a === 'object') {
    if (r.rola === 'gildia') {
      if (a.typ === 'zdjecie') komunikat = noweZgloszenie(r.i, a);
      else if (!['kup', 'sprzedaj', 'atak', 'znajdzka', 'zestaw_start', 'zestaw_wybor', 'zestaw_koniec'].includes(a.typ)) return { blad: 'Gildia nie może tego zgłosić.' };
      else komunikat = wykonaj(r.i, 'gildia', a);
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
        if (w.ok) { stany[g] = w.st; zapiszStan(); wpis(g, 'kadra', 'Edycja kadry', w, { typ: 'edytuj' }); }
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
      } else if (a.typ === 'domyslny_cennik') {
        // statki, budowle, porty i liczby z nowej wersji aplikacji; gildie, hasła, punkty, kody i godziny zostają
        const zost = ['haslo_punktowych', 'haslo_testowe', 'pilnuj_godzin', 'start_gry', 'ostatnie_10_min', 'koniec_gry'];
        const nowy = JSON.parse(JSON.stringify(DOMYSLNA));
        for (const k of zost) if (k in cfg.ustawienia) nowy.ustawienia[k] = cfg.ustawienia[k];
        for (const k of ['gildie', 'punkty_martwe', 'punkty_zywe', 'znajdzki']) nowy[k] = cfg[k];
        cfg = nowy; zapiszAtomowo(PLIK_KONFIG, JSON.stringify(cfg, null, 1)); dopasujStany(); zapiszStan();
        wpis(null, 'kadra', 'Przywrócenie domyślnego cennika', { ok: true, msg: 'Statki, budowle, porty i liczby jak w nowej wersji.', delta: 0 });
        komunikat = { ok: true, tekst: 'Cennik przywrócony. Gildie, hasła, punkty i godziny zostały bez zmian.' };
      } else if (a.typ === 'reset') {
        if (a.potwierdzenie !== 'RESET') komunikat = { ok: false, tekst: 'Wpiszcie słowo RESET, żeby wyzerować grę.' };
        else {
          const kopia = path.join(DATA_DIR, 'kopia-' + new Date().toISOString().replace(/[:.]/g, '-'));
          fs.mkdirSync(kopia, { recursive: true });
          for (const p of [PLIK_STAN, PLIK_DZIENNIK]) if (fs.existsSync(p)) fs.copyFileSync(p, path.join(kopia, path.basename(p)));
          if (fs.existsSync(PLIK_ZGL)) fs.copyFileSync(PLIK_ZGL, path.join(kopia, 'zgloszenia.json'));
          fs.renameSync(KAT_ZDJ, path.join(kopia, 'zdjecia')); fs.mkdirSync(KAT_ZDJ, { recursive: true });
          stany = cfg.gildie.map(() => E.nowyStan(cfg)); dziennik = []; zgloszenia = []; zapiszZgl();
          zapiszStan(); fs.writeFileSync(PLIK_DZIENNIK, '');
          komunikat = { ok: true, tekst: 'Gra wyzerowana. Poprzedni stan zapisany w kopii na serwerze.' };
        }
      } else if (a.typ === 'zgloszenie') {
        komunikat = decyzja(a);
      } else if (a.typ === 'usun_zdjecia') {
        let n = 0; for (const f of fs.readdirSync(KAT_ZDJ)) { fs.unlinkSync(path.join(KAT_ZDJ, f)); n++; }
        zgloszenia.forEach(z => { if (z.zdjecie) { z.zdjecie = false; z.usuniete = true; } }); zapiszZgl();
        wpis(null, 'kadra', 'Usunięcie zdjęć', { ok: true, msg: 'Usunięto zdjęć: ' + n + '.', delta: 0 });
        komunikat = { ok: true, tekst: 'Usunięto zdjęć z serwera: ' + n + '. Opisy i decyzje zostały.' };
      } else if (a.typ === 'ai') {
        if (!AI_KLUCZ) komunikat = { ok: false, tekst: 'Brak klucza AI. Dodajcie w Coolify zmienną OPENAI_API_KEY albo ANTHROPIC_API_KEY.' };
        else if (ai.trwa) komunikat = { ok: true, tekst: 'Analiza już trwa.' };
        else { analizaAI(); komunikat = { ok: true, tekst: 'Analiza ruszyła. Wynik pojawi się tu za kilkanaście sekund.' }; }
      } else return { blad: 'Nieznane polecenie kadry.' };
    }
  }
  return { widok: widok(r, String(body.urz || '').slice(0, 40)), komunikat };
}

// ---------- analiza AI (opcjonalna, gdy jest klucz OpenAI albo Anthropic) ----------
const AI_SYSTEM = 'Jesteś asystentem kadry harcerskiej gry miejskiej „Bursztynowe Miasto” (10 gildii po 4 osoby, Gdańsk, ok. 2,5 h). ' +
  'Gildie zarabiają bursztyn na punktach żywych (ocena punktowego 0–55), martwych (zdjęcie i tekst, sprawdzane ręcznie przez kadrę) i znajdźkach (kod), kupują statki i budowle, atakują po kolei 10 portów; od 3. portu przed atakiem mogą zagrać w Seta (minigra, do +6 do ataku). ' +
  'Ranking: liczba portów, przy remisie bursztyn zdobyty w całej grze. Dostajesz migawkę: reguły nadzoru, dane gildii, punkty i ostatnie wpisy dziennika. ' +
  'Napisz po polsku raport dla kadry w trzech częściach, każda z nagłówkiem wielkimi literami w osobnym wierszu:\n' +
  'STAN GRY: 2–3 zdania, jak idzie całość (tempo względem symulacji, ile zostało do końca, czy walka o czołówkę jest wyrównana).\n' +
  'KTO JAK SOBIE RADZI: po jednym krótkim wierszu na gildię, w kolejności rankingu, zaczynając od myślnika: miejsce, nazwa, porty, krótka ocena (prowadzi / dobrze / środek / słabo / kłopot) i dlaczego, np. dużo punktów ale słaba flota, długo bez punktu, seria porażek, nie wydaje bursztynu.\n' +
  'CO ZROBIĆ TERAZ: 0–4 konkretne działania (kto, co), tylko gdy naprawdę trzeba. Jeśli nic, napisz „Nic pilnego.”\n' +
  'Pisz zwięźle i konkretnie, z nazwami gildii i punktów. Nie wymyślaj danych, których nie ma w migawce. Bez markdownu (bez gwiazdek i krzyżyków).';
function migawka() {
  const n = nadzor();
  return JSON.stringify({ teraz: n.teraz, faza: n.faza, minutaGry: n.minutaGry, koniec: n.koniec, tempo: n.tempo, urzadzenia: n.urzadzenia,
    alerty: n.alerty.map(a => a.poziom + ' | ' + a.kto + ' | ' + a.tekst),
    gildie: n.gildie.map(g => ({ miejsce: (E.ranking(cfg, stany).find(x => x.i === g.i) || {}).miejsce, nazwa: g.nazwa, porty: g.porty, zdobyty: g.zdobyty, flota: (s => 'Siła ' + s.sila + ', Zasięg ' + s.zasieg + ', Zwrotność ' + s.zwrot + ', statków ' + s.ile)(E.staty(cfg, stany[g.i])), budowle: cfg.budowle.filter(q => stany[g.i].bud[q.id]).map(q => q.nazwa), martweZaliczone: Object.keys(stany[g.i].md).length, wizytyZywe: Object.values(stany[g.i].zy).reduce((a, b) => a + b, 0), znajdzki: Object.keys(stany[g.i].zn).length + (stany[g.i].zf || 0), skarbiec: g.bursztyn, nieudaneZRzedu: g.nieudane, minOdOtwarciaAplikacji: g.widziana, minOdPunktu: g.ostatniPunkt, minOdZakupu: g.ostatniZakup, minOdAtaku: g.ostatniAtak, zakupy: g.zakupy, korekty: g.korekty })),
    punktyZywe: n.zywe.map(p => ({ nazwa: p.nazwa, wizyt: p.wizyt, wizyt30min: p.ost30, srednia: p.srednia, minOdWpisu: p.ostatniWpis })),
    punktyMartwe: n.martwe.map(p => ({ nazwa: p.nazwa, zaliczyli: p.zaliczyli, gildieZle: p.gildieZle, najczestszaZla: p.czesta })),
    znajdzki: n.znajdzki.map(z => z.ile), zdjeciaCzekaja: zgloszenia.filter(z => z.stan === 'czeka').length,
    dziennik: dziennik.slice(-40).map(d => [d.czas.slice(0, 5), d.g == null ? '-' : (cfg.gildie[d.g] || {}).nazwa, d.kto, d.opis, d.ok ? d.wynik : 'ODRZUCONE: ' + d.wynik].join(' | ')) });
}
async function zapytajAI(tresc) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 90000);
  try {
    if (AI_DOSTAWCA === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': AI_KLUCZ, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: AI_MODEL, max_tokens: 1500, system: AI_SYSTEM, messages: [{ role: 'user', content: tresc }] }) });
      const o = await r.json();
      if (!r.ok) throw new Error((o.error && o.error.message) || ('HTTP ' + r.status));
      return (o.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    }
    // OpenAI, Chat Completions. Modele GPT-5 chcą max_completion_tokens; starsze (gpt-4o) też je przyjmują.
    const zapytaj = async extra => {
      const r = await fetch(OPENAI_URL, { method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + AI_KLUCZ },
        body: JSON.stringify(Object.assign({ model: AI_MODEL, max_completion_tokens: 4000, messages: [{ role: 'system', content: AI_SYSTEM }, { role: 'user', content: tresc }] }, extra)) });
      return { r, o: await r.json() };
    };
    let { r, o } = await zapytaj({ reasoning_effort: 'low' });
    // model bez rozumowania (np. gpt-4o) odrzuca reasoning_effort: spróbuj jeszcze raz bez niego
    if (!r.ok && o.error && /reasoning/i.test(String(o.error.message) + String(o.error.param))) ({ r, o } = await zapytaj({}));
    if (!r.ok) throw new Error((o.error && o.error.message) || ('HTTP ' + r.status));
    const t = (((o.choices || [])[0] || {}).message || {}).content;
    if (!t) throw new Error('Pusta odpowiedź modelu' + (o.choices && o.choices[0] && o.choices[0].finish_reason === 'length' ? ' (za mało miejsca na odpowiedź)' : ''));
    return String(t).trim();
  } finally { clearTimeout(tm); }
}
async function analizaAI() {
  ai.trwa = true; ai.blad = ''; ai.ostatnio = Date.now();
  try {
    ai.tekst = await zapytajAI('Migawka gry:\n' + migawka());
    ai.czas = teraz().czas.slice(0, 5);
  } catch (e) {
    ai.blad = 'Analiza AI nie wyszła: ' + String(e.name === 'AbortError' ? 'brak odpowiedzi w 90 s' : (e.message || e)).slice(0, 200);
    console.error(ai.blad);
  }
  ai.trwa = false;
}
// automatyczna analiza co AI_CO_MIN minut w trakcie gry
setInterval(() => {
  if (!AI_KLUCZ || !(AI_CO_MIN > 0) || ai.trwa) return;
  const f = E.faza(cfg, teraz().min);
  if ((f === 'trwa' || f === 'ostatnie') && cfg.ustawienia.pilnuj_godzin && Date.now() - ai.ostatnio >= AI_CO_MIN * 60000) analizaAI();
}, 60000).unref();

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
    ob.eksport = Date.now();
    if (url.pathname === '/eksport.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="bursztynowe-miasto-stan.json"' });
      return res.end(JSON.stringify({ kiedy: new Date().toISOString(), konfiguracja: cfg, stany, ranking: E.ranking(cfg, stany), dziennik, zgloszenia }, null, 1));
    }
    const wiersze = [['czas', 'gildia', 'kto', 'zgloszenie', 'wynik', 'przyjete', 'zmiana_bursztynu', 'bursztyn_po']].concat(
      dziennik.map(d => [d.czas, d.g == null ? '' : (cfg.gildie[d.g] || { nazwa: '?' }).nazwa, d.kto, d.opis, d.wynik, d.ok ? 'tak' : 'nie', d.delta, d.b]));
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="bursztynowe-miasto-dziennik.csv"' });
    return res.end('﻿' + wiersze.map(w => w.map(csv).join(';')).join('\n'));
  }
  if (req.method === 'POST' && url.pathname === '/zdjecie') {
    if (zablokowany(ip)) return json(429, { blad: 'Za dużo złych haseł.' });
    let dane = ''; req.on('data', c => { dane += c; if (dane.length > 2000) req.destroy(); });
    req.on('end', () => {
      let b = {}; try { b = JSON.parse(dane || '{}'); } catch (e) {}
      const r = rola(b.haslo);
      if (!r || r.rola !== 'kadra') { zlaProba(ip); return json(403, { blad: 'Tylko dla kadry.' }); }
      const z = zgloszenia.find(x => x.id === b.id);
      if (!z || !z.zdjecie) return json(404, { blad: 'Brak zdjęcia.' });
      const plik = path.join(KAT_ZDJ, z.id + '.' + (z.zdjecie === 'jpeg' || z.zdjecie === true ? 'jpg' : z.zdjecie));
      if (!fs.existsSync(plik)) return json(404, { blad: 'Brak zdjęcia.' });
      res.writeHead(200, { 'content-type': z.zdjecie === 'png' ? 'image/png' : z.zdjecie === 'webp' ? 'image/webp' : 'image/jpeg', 'cache-control': 'private, max-age=3600' });
      fs.createReadStream(plik).pipe(res);
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api') {
    if (zablokowany(ip)) return json(429, { blad: 'Za dużo złych haseł. Spróbujcie za minutę.' });
    let dane = '';
    req.on('data', c => { dane += c; if (dane.length > 3000000) req.destroy(); });
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
