'use strict';
// Nadzór nad grą: czyste funkcje, które z dziennika, stanów i obecności urządzeń wyciągają kłopoty.
// Nic tu nie zapisuje plików ani nie łączy się z siecią.
const E = require('./engine');

// Oczekiwane tempo z symulacji (minuty gry 0..160). „dol” = słaba gildia grająca na oślep, „gora” = bardzo dobra grająca najlepiej.
const KRZYWA = {
  min: [0, 20, 40, 60, 80, 100, 120, 140, 160],
  porty_dol: [0, 2, 3.1, 4.1, 4.7, 4.9, 5, 5, 5.6],
  porty_gora: [0, 4.2, 5.1, 5.6, 7, 8.2, 8.9, 9.3, 9.5],
  zdobyty_dol: [50, 129, 217, 311, 397, 472, 537, 601, 685],
  zdobyty_sr: [50, 190, 330, 455, 575, 690, 790, 890, 1000],
  zdobyty_gora: [50, 276, 498, 697, 911, 1114, 1259, 1381, 1485],
};
function krzywa(k, m) {
  const X = KRZYWA.min, Y = KRZYWA[k];
  if (m <= 0) return Y[0];
  for (let i = 1; i < X.length; i++) if (m <= X[i]) return Y[i - 1] + (Y[i] - Y[i - 1]) * (m - X[i - 1]) / (X[i] - X[i - 1]);
  return Y[Y.length - 1];
}

const minDnia = czas => { const p = String(czas || '').split(':').map(Number); return p.length >= 2 ? p[0] * 60 + p[1] + (p[2] || 0) / 60 : null; };
const hhmm = m => E.hhmm(Math.floor(m));
const mediana = a => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const ileTemu = (ms, teraz) => ms ? Math.round((teraz - ms) / 60000) : null;

/**
 * cfg, stany, dziennik: jak w serwerze. ob: { gildie: {i: ms}, punkty: {k: ms}, urz: {id: {rola, t, g?, punkt?}}, start: ms, eksport: ms }
 * min: minuta dnia teraz, ms: Date.now()
 * Zwraca { faza, minutaGry, alerty: [{id, poziom: 'zle'|'uwaga'|'info', kto, tekst}], gildie: [...], punkty: [...], tempo }
 */
function analiza(cfg, stany, dziennik, ob, min, ms) {
  const u = cfg.ustawienia;
  const f = E.faza(cfg, min);
  const start = E.minuty(u.start_gry), koniec = E.minuty(u.koniec_gry);
  // minuta gry: od startu według zegara, a bez pilnowania godzin od pierwszego wpisu w dzienniku
  let m = start != null ? min - start : 0;
  if (!u.pilnuj_godzin) { const p = dziennik.find(d => d.g != null); m = p ? (ms - p.t) / 60000 : 0; }
  m = Math.max(0, m);
  const graTrwa = f === 'trwa' || f === 'ostatnie';
  const A = [];
  const dodaj = (id, poziom, kto, tekst) => A.push({ id, poziom, kto, tekst });
  const nazwaG = i => (cfg.gildie[i] || { nazwa: 'Gildia ' + (i + 1) }).nazwa;

  // ---------- przed grą: lista kontrolna ----------
  const kontrola = [];
  if (String(u.haslo_punktowych).trim() === 'punkt-zmien-mnie') kontrola.push('Hasło punktowych jest domyślne (punkt-zmien-mnie).');
  const domyslneG = cfg.gildie.filter(g => /-zmien$/.test(String(g.haslo))).length;
  if (domyslneG) kontrola.push(domyslneG + ' gildii ma domyślne hasło (…-zmien).');
  const odpDomyslne = cfg.punkty_martwe.filter(p => /^odp\d+$/i.test(String(p.odpowiedz).trim())).length;
  if (odpDomyslne) kontrola.push(odpDomyslne + ' punktów martwych ma odpowiedź „odpN”, czyli nieuzupełnioną.');
  const bezPytania = cfg.punkty_martwe.filter(p => !String(p.pytanie || '').trim()).length;
  if (bezPytania) kontrola.push(bezPytania + ' punktów martwych nie ma pytania.');
  if (cfg.znajdzki.some(k => /^BURSZTYN\d+$/i.test(k))) kontrola.push('Kody znajdziek są przykładowe (BURSZTYN1…). Zmieńcie je, bo łatwo je zgadnąć.');
  if (!u.pilnuj_godzin) kontrola.push('Pilnowanie godzin jest wyłączone. Przed grą ustawcie „pilnuj_godzin” na „tak”.');
  if (kontrola.length && (f === 'przed' || f === 'trwa' && m < 15)) dodaj('kontrola', f === 'przed' ? 'uwaga' : 'zle', 'Przygotowanie przed grą', kontrola.map(t => '• ' + t).join('\n'));
  if (f === 'przed') {
    const zalogowane = cfg.gildie.filter((g, i) => ob.gildie[i]).length;
    dodaj('przed-gildie', 'info', 'Gildie', 'Zalogowane do tej pory: ' + zalogowane + ' z ' + cfg.gildie.length + (zalogowane < cfg.gildie.length ? '. Brakuje: ' + cfg.gildie.map((g, i) => ob.gildie[i] ? null : g.nazwa).filter(Boolean).join(', ') + '.' : '.'));
  }

  // ---------- urządzenia ----------
  const urz = Object.values(ob.urz || {});
  const aktywne = (rola, minut) => urz.filter(x => x.rola === rola && ms - x.t < minut * 60000);
  const kadraAkt = aktywne('kadra', 10).length, punktAkt = aktywne('punktowy', 10).length;

  // ---------- gildie ----------
  const pkt = new Set(['martwy', 'zywy', 'znajdzka']);
  const gildie = cfg.gildie.map((g, i) => {
    const st = stany[i] || E.nowyStan(cfg);
    const wpisy = dziennik.filter(d => d.g === i);
    const ost = wpisy[wpisy.length - 1];
    const ostPunkt = [...wpisy].reverse().find(d => d.ok && pkt.has(d.typ) && d.delta > 0);
    const ostZakup = [...wpisy].reverse().find(d => d.ok && d.typ === 'kup');
    const ostAtak = [...wpisy].reverse().find(d => d.ok && d.typ === 'atak');
    const odrzucone10 = wpisy.filter(d => !d.ok && ms - d.t < 10 * 60000);
    let minusOd = null;
    for (let k = wpisy.length - 1; k >= 0; k--) { if (wpisy[k].b != null && wpisy[k].b < 0) minusOd = wpisy[k].t; else if (wpisy[k].b != null) break; }
    const korekty = wpisy.filter(d => d.kto === 'kadra' && d.ok).reduce((a, d) => a + (d.delta || 0), 0);
    return { i, nazwa: g.nazwa, porty: st.p, zdobyty: st.z, bursztyn: st.b, nieudane: st.fail,
      widziana: ileTemu(ob.gildie[i], ms), ostatnieZdarzenie: ost ? ileTemu(ost.t, ms) : null, ostatniPunkt: ostPunkt ? ileTemu(ostPunkt.t, ms) : null,
      ostatniZakup: ostZakup ? ileTemu(ostZakup.t, ms) : null, ostatniAtak: ostAtak ? ileTemu(ostAtak.t, ms) : null,
      minusOd: minusOd ? ileTemu(minusOd, ms) : null, odrzucone10: odrzucone10.length, ostOdrzucone: odrzucone10.length ? odrzucone10[odrzucone10.length - 1].wynik : '',
      korekty, zakupy: wpisy.filter(d => d.ok && d.typ === 'kup').length, zdarzen: wpisy.length };
  });

  const medZ = mediana(gildie.map(g => g.zdobyty)), medP = mediana(gildie.map(g => g.porty));
  if (graTrwa) for (const g of gildie) {
    const kto = g.nazwa, id = 'g' + g.i + '-';
    if (g.widziana == null && g.zdarzen === 0) { if (m >= 10) dodaj(id + 'nigdy', 'zle', kto, 'Od startu ani razu nie otworzyła aplikacji. Sprawdźcie, czy mają hasło i telefon z internetem.'); continue; }
    const cisza = Math.min(g.widziana == null ? 999 : g.widziana, g.ostatnieZdarzenie == null ? 999 : g.ostatnieZdarzenie);
    if (cisza >= 35) dodaj(id + 'cisza', 'zle', kto, 'Brak kontaktu od ' + cisza + ' min: aplikacja zamknięta i żadnych zgłoszeń. Może padł telefon albo się zgubili.');
    else if (cisza >= 20) dodaj(id + 'cisza', 'uwaga', kto, 'Aplikacja nieotwierana od ' + cisza + ' min.');
    if (m >= 25 && g.ostatniPunkt == null) dodaj(id + 'zero', 'uwaga', kto, 'Po ' + Math.round(m) + ' min gry nie zaliczyła jeszcze żadnego punktu.');
    else if (g.ostatniPunkt != null && g.ostatniPunkt >= 30 && m < 150) dodaj(id + 'bezpkt', 'uwaga', kto, 'Od ' + g.ostatniPunkt + ' min żadnego zaliczonego punktu.');
    if (g.minusOd != null && g.minusOd >= 12) dodaj(id + 'minus', 'uwaga', kto, 'Skarbiec na minusie (' + g.bursztyn + ') od ' + g.minusOd + ' min. Nie mogą kupować ani atakować, dopóki nie zarobią na punkcie.');
    if (g.nieudane >= 3) dodaj(id + 'porazki', 'uwaga', kto, g.nieudane + ' nieudane ataki z rzędu na następny port. Może wybierają złą taktykę albo flota jest za słaba. Warto podpowiedzieć zakładkę Atak (szansa w %).');
    if (m >= 30 && g.zakupy === 0) dodaj(id + 'nicnie', 'uwaga', kto, 'Po ' + Math.round(m) + ' min nic nie kupiła. Mogą nie rozumieć, że flotę trzeba rozbudowywać.');
    else if (m >= 30 && g.bursztyn >= 200 && (g.ostatniZakup == null || g.ostatniZakup >= 25)) dodaj(id + 'skarb', 'info', kto, 'Trzyma ' + g.bursztyn + ' bursztynu i od ' + (g.ostatniZakup == null ? 'początku' : g.ostatniZakup + ' min') + ' nic nie kupiła.');
    if (g.odrzucone10 >= 6) dodaj(id + 'odrz', 'uwaga', kto, g.odrzucone10 + ' odrzuconych zgłoszeń w 10 min. Ostatnie: „' + g.ostOdrzucone + '”. Coś im nie wychodzi.');
    if (m >= 20) {
      const dol = krzywa('zdobyty_dol', m), gora = krzywa('zdobyty_gora', m);
      if (g.zdobyty < 0.7 * dol && g.zdobyty < 0.6 * medZ) dodaj(id + 'wolno', 'uwaga', kto, 'Wyraźnie w tyle: zdobyła ' + g.zdobyty + ' bursztynu, mediana gildii ' + Math.round(medZ) + ', najsłabsze w symulacji ok. ' + Math.round(dol) + '.');
      if (g.zdobyty > 1.3 * gora || (g.zdobyty > 2.2 * medZ && medZ > 150)) dodaj(id + 'szybko', 'uwaga', kto, 'Podejrzanie dużo: ' + g.zdobyty + ' bursztynu przy medianie ' + Math.round(medZ) + ' (najlepsze w symulacji ok. ' + Math.round(gora) + '). Sprawdźcie dziennik: hojny punktowy, wyciek kodów albo pomyłka w korekcie.');
    }
    if (Math.abs(g.korekty) >= 100) dodaj(id + 'kor', 'info', kto, 'Korekty kadry razem: ' + (g.korekty > 0 ? '+' : '') + g.korekty + '.');
  }
  if (graTrwa && gildie.length >= 3) {
    const p = gildie.map(g => g.porty).sort((a, b) => b - a);
    if (p[0] - p[1] >= 3 && m >= 40) dodaj('lider', 'info', 'Ranking', 'Lider ma ' + (p[0] - p[1]) + ' porty przewagi. Gra o pierwsze miejsce może być rozstrzygnięta.');
  }

  // ---------- punkty martwe ----------
  const martwe = cfg.punkty_martwe.map((p, k) => {
    const w = dziennik.filter(d => d.typ === 'martwy' && Number(d.pkt) === k && d.ok);
    const dobre = w.filter(d => !d.bledna).length, zle = w.filter(d => d.bledna);
    const gZle = new Set(), gDobre = new Set();
    w.forEach(d => (d.bledna ? gZle : gDobre).add(d.g));
    const odp = {}; zle.forEach(d => { const o = String(d.odp || '').trim().toLowerCase(); if (o) odp[o] = (odp[o] || 0) + 1; });
    const czeste = Object.entries(odp).sort((a, b) => b[1] - a[1])[0];
    return { k, nazwa: p.nazwa, zaliczyli: dobre, proby: w.length, bledne: zle.length, gildieZle: gZle.size, gildieDobre: gDobre.size, czesta: czeste ? czeste[0] : '', czestaIle: czeste ? czeste[1] : 0 };
  });
  for (const p of martwe) {
    const prob = p.gildieZle + p.gildieDobre;
    if (prob >= 3 && p.gildieZle / prob >= 0.6) dodaj('m' + p.k, 'zle', p.nazwa, p.gildieZle + ' z ' + prob + ' gildii odpowiedziało źle. Sprawdźcie odpowiedź w Cenniku' + (p.czestaIle >= 2 ? ': najczęstsza błędna to „' + p.czesta + '” (' + p.czestaIle + '×), poprawna wpisana „' + cfg.punkty_martwe[p.k].odpowiedz + '”.' : '.'));
    else if (p.czestaIle >= 3) dodaj('m' + p.k + 'o', 'uwaga', p.nazwa, 'Ta sama błędna odpowiedź „' + p.czesta + '” padła ' + p.czestaIle + ' razy. Może to też dobra odpowiedź?');
  }
  if (graTrwa && m >= 60) {
    const nikt = martwe.filter(p => p.proby === 0).map(p => p.nazwa);
    if (nikt.length) dodaj('m-nikt', 'info', 'Punkty martwe', 'Po godzinie nikt nie próbował: ' + nikt.join(', ') + '. Może są trudne do znalezienia.');
  }

  // ---------- znajdźki ----------
  const zlyKod = {};
  dziennik.filter(d => d.typ === 'znajdzka' && !d.ok && d.kod && /takim kodem/.test(d.wynik)).forEach(d => { const c = String(d.kod).trim().toUpperCase(); (zlyKod[c] = zlyKod[c] || new Set()).add(d.g); });
  Object.entries(zlyKod).filter(([, s]) => s.size >= 2).forEach(([c, s]) => dodaj('z-' + c, 'uwaga', 'Znajdźki', s.size + ' gildie wpisały kod „' + c + '”, którego nie ma na liście. Literówka na kartce albo w Cenniku?'));
  const znalezione = cfg.znajdzki.map((kod, k) => ({ kod, ile: stany.filter(st => st.zn && st.zn[k]).length }));
  if (graTrwa && m >= 70) {
    const nikt = znalezione.filter(z => z.ile === 0).map(z => z.kod);
    if (nikt.length && nikt.length < cfg.znajdzki.length) dodaj('z-nikt', 'info', 'Znajdźki', 'Nikt jeszcze nie znalazł: ' + nikt.join(', ') + '. Może zniknęły albo są za dobrze schowane.');
  }

  // ---------- zgłoszenia ze zdjęciem ----------
  const czeka = (ob.zgloszenia || []).filter(z => z.stan === 'czeka');
  if (czeka.length) {
    const najst = Math.round((ms - Math.min(...czeka.map(z => z.t))) / 60000);
    if (najst >= 4) dodaj('zdj', najst >= 10 ? 'zle' : 'uwaga', 'Zdjęcia', 'Do sprawdzenia: ' + czeka.length + ', najstarsze czeka ' + najst + ' min. Gildie czekają na punkty (zakładka Zdjęcia).');
  }

  // ---------- punkty żywe ----------
  const wszystkieOceny = dziennik.filter(d => d.typ === 'zywy' && d.ok && typeof d.ile === 'number').map(d => d.ile);
  const sredniaAll = wszystkieOceny.length ? wszystkieOceny.reduce((a, b) => a + b, 0) / wszystkieOceny.length : null;
  // Punkty żywe nie mają godzin: punktowi sami decydują, kiedy działają. Nadzór patrzy tylko na to, co widać w danych.
  const zywe = cfg.punkty_zywe.map((p, k) => {
    const w = dziennik.filter(d => d.typ === 'zywy' && d.ok && Number(d.pkt) === k);
    const oceny = w.map(d => d.ile).filter(x => typeof x === 'number');
    const ost = w[w.length - 1];
    const urzP = urz.filter(x => x.rola === 'punktowy' && x.punkt === k).sort((a, b) => b.t - a.t)[0];
    const telefon = urzP ? ileTemu(urzP.t, ms) : (ob.punkty[k] ? ileTemu(ob.punkty[k], ms) : null);
    return { k, nazwa: p.nazwa, wizyt: w.length, ost30: w.filter(d => ms - d.t < 30 * 60000).length,
      srednia: oceny.length ? Math.round(oceny.reduce((a, b) => a + b, 0) / oceny.length) : null,
      ostatniWpis: ost ? ileTemu(ost.t, ms) : null, telefon, czynny: (ost && ms - ost.t < 30 * 60000) || (telefon != null && telefon < 10), oceny };
  });
  if (graTrwa) for (const p of zywe) {
    const id = 'z' + p.k + '-';
    if (p.ostatniWpis != null && p.ostatniWpis >= 35 && (p.telefon == null || p.telefon >= 15)) dodaj(id + 'cisza', 'info', p.nazwa, 'Ostatni wpis ' + p.ostatniWpis + ' min temu' + (p.telefon != null ? ', telefon punktowego niewidoczny od ' + p.telefon + ' min' : '') + '. Jeśli punkt miał teraz działać, sprawdźcie.');
    if (sredniaAll != null && p.oceny.length >= 4 && Math.abs(p.srednia - sredniaAll) >= 12) dodaj(id + 'ocena', 'uwaga', p.nazwa, 'Średnia ocena ' + p.srednia + ', a na wszystkich punktach ' + Math.round(sredniaAll) + '. Punktowy ocenia ' + (p.srednia > sredniaAll ? 'dużo hojniej' : 'dużo surowiej') + ' niż inni.');
    if (p.oceny.length >= 5 && new Set(p.oceny).size === 1) dodaj(id + 'stala', 'info', p.nazwa, 'Wszystkie oceny takie same (' + p.oceny[0] + '). Ocena przestaje różnicować drużyny.');
  }
  if (graTrwa) {
    const czynne = zywe.filter(p => p.czynny);
    if (czynne.length >= 2) {
      const mx = czynne.reduce((a, b) => b.ost30 > a.ost30 ? b : a), mn = czynne.reduce((a, b) => b.ost30 < a.ost30 ? b : a);
      if (mx.ost30 >= 6 && mx.ost30 >= 3 * Math.max(1, mn.ost30)) dodaj('z-obl', 'info', 'Punkty żywe', mx.nazwa + ' jest oblegany (' + mx.ost30 + ' wizyt w 30 min), a ' + mn.nazwa + ' prawie pusty (' + mn.ost30 + '). Można kierować gildie dalej.');
    }
  }

  // ---------- kadra i punktowi ----------
  if (graTrwa) {
    if (kadraAkt === 0) dodaj('kadra', 'info', 'Kadra', 'Żaden telefon kadry nie był w aplikacji od 10 min (poza tym).');
  }
  if (graTrwa && m >= 50 && (!ob.eksport || ms - ob.eksport > 60 * 60000)) dodaj('kopia', 'info', 'Kopia', 'Pobierzcie kopię zapasową (zakładka Gra, eksport JSON).');

  // ---------- tempo całej gry ----------
  let tempo = null;
  if (graTrwa && m >= 20) {
    const sr = krzywa('zdobyty_sr', m), dol = krzywa('zdobyty_dol', m), gora = krzywa('zdobyty_gora', m);
    tempo = { mediana: Math.round(medZ), oczekiwana: Math.round(sr), zakres: [Math.round(dol), Math.round(gora)], portyMediana: medP };
    if (medZ < 0.75 * sr) dodaj('tempo', 'uwaga', 'Cała gra', 'Gildie zarabiają wolniej niż w symulacji: mediana ' + Math.round(medZ) + ' bursztynu, spodziewane ok. ' + Math.round(sr) + '. Możliwe przyczyny: kolejki na punktach żywych, długie przejścia, za trudne pytania. Można dać wszystkim korektę albo podnieść nagrody w Cenniku.');
    else if (medZ > 1.35 * sr) dodaj('tempo', 'uwaga', 'Cała gra', 'Gildie zarabiają szybciej niż w symulacji: mediana ' + Math.round(medZ) + ', spodziewane ok. ' + Math.round(sr) + '. Porty mogą się skończyć przed czasem. Można obniżyć nagrody w Cenniku.');
  }

  const waga = { zle: 0, uwaga: 1, info: 2 };
  A.sort((a, b) => waga[a.poziom] - waga[b.poziom]);
  return { faza: f, minutaGry: Math.round(m), teraz: hhmm(min), alerty: A, gildie, martwe, zywe: zywe.map(p => { const o = Object.assign({}, p); delete o.oceny; return o; }), znajdzki: znalezione, tempo,
    urzadzenia: { kadra: kadraAkt, punktowi: punktAkt, gildie: aktywne('gildia', 10).length }, koniec: koniec != null ? hhmm(koniec) : null };
}

module.exports = { analiza, krzywa, KRZYWA };
