'use strict';
// Bursztynowe Miasto: zasady gry jako czyste funkcje. Bez dostępu do plików i sieci, żeby dało się je testować.

const TAKTYKI = [
  { id: 'natarcie', nazwa: 'Natarcie', stat: 'sila', statNazwa: 'Siła' },
  { id: 'ostrzal', nazwa: 'Ostrzał z daleka', stat: 'zasieg', statNazwa: 'Zasięg' },
  { id: 'zaskoczenie', nazwa: 'Z zaskoczenia', stat: 'zwrot', statNazwa: 'Zwrotność' },
];
const BUD_STAT = { zbrojownia: 'sila', kusznicy: 'zasieg', sternicy: 'zwrot' };
const NIE_DA_SIE = 99;

function minuty(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l').replace(/\s+/g, ' ');
}

function nowyStan(cfg) {
  const s = {};
  cfg.statki.forEach(x => { s[x.id] = 0; });
  s[cfg.statki[0].id] = 1;
  const start = cfg.ustawienia.start_bursztyn;
  // b = bursztyn w skarbcu, z = zdobyty w całej grze, p = zdobyte porty, fail = nieudane ataki na następny port,
  // late = ataki w ostatnich 10 minutach, md/mt = punkty martwe zaliczone / zużyte próby, zn = znajdźki, zy = punkty żywe
  return { b: start, z: start, p: 0, s, bud: {}, fail: 0, late: 0, md: {}, mt: {}, zn: {}, zy: {}, zt: {}, zf: 0 };
}

function staty(cfg, st) {
  const o = { sila: 0, zasieg: 0, zwrot: 0, ile: 0, naprawa: 0 };
  for (const x of cfg.statki) {
    const n = st.s[x.id] || 0;
    o.sila += n * x.sila; o.zasieg += n * x.zasieg; o.zwrot += n * x.zwrot; o.ile += n; o.naprawa += n * x.naprawa;
  }
  for (const b of cfg.budowle) {
    if (st.bud[b.id] && BUD_STAT[b.id]) o[BUD_STAT[b.id]] += (b.bonus || 0);
  }
  return o;
}

function cenaStatku(cfg, st, x) {
  return x.cena;
}

function hhmm(min) { return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }
// Minuta dnia, od której gildia może znowu przyjść na punkt żywy, albo null, gdy może od razu.
function kiedyZnowu(cfg, st, i) {
  const p = cfg.ustawienia.zywy_przerwa_min;
  if (!(p > 0) || !st.zt || st.zt[i] == null || !(st.zy[i] > 0)) return null;
  return st.zt[i] + p;
}

// Czy gildia musi zaliczyć inny punkt, zanim wróci na punkt żywy i (nie może przyjść dwa razy z rzędu).
function musiInny(cfg, st, i) {
  return !!cfg.ustawienia.zywy_inny_punkt && (st.zy[i] || 0) > 0 && st.ost === 'z' + i;
}

function kosztPorazki(naprawa, t) {
  return t === 0 ? naprawa : t === 1 ? Math.ceil(naprawa / 2) : 0;
}

// przed | trwa | ostatnie | koniec
function faza(cfg, min) {
  const u = cfg.ustawienia;
  if (!u.pilnuj_godzin) return 'trwa';
  const a = minuty(u.start_gry), b = minuty(u.ostatnie_10_min), c = minuty(u.koniec_gry);
  if (a != null && min < a) return 'przed';
  if (c != null && min >= c) return 'koniec';
  if (b != null && min >= b) return 'ostatnie';
  return 'trwa';
}

// Szansa, że rzut da co najmniej `brakuje`. Z Latarnią: 3 kości, liczą się 2 najlepsze.
const P2 = Array(14).fill(0), P3 = Array(14).fill(0);
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
  for (let k = 0; k <= a + b; k++) P2[k] += 1 / 36;
  for (let c = 1; c <= 6; c++) { const s = a + b + c - Math.min(a, b, c); for (let k = 0; k <= s; k++) P3[k] += 1 / 216; }
}
function szansa(brakuje, latarnia) {
  if (brakuje <= 2) return 1;
  if (brakuje > 12) return 0;
  return (latarnia ? P3 : P2)[brakuje];
}

function obronaPortu(cfg, st, t) {
  const port = cfg.porty[st.p];
  if (!port) return null;
  const baza = port[TAKTYKI[t].id];
  if (baza >= NIE_DA_SIE) return null;
  return baza + st.fail;
}

/**
 * Wykonuje jedną akcję. Zwraca { ok, msg, delta, st } z nowym stanem (wejściowy stan nie jest zmieniany).
 * a.typ: kup | sprzedaj | atak | martwy | martwy_ok | martwy_nie | znajdzka | znajdzka_foto | zywy | korekta
 * ctx: { min: minuty od północy, kosc: () => 1..6 }
 */
function akcja(cfg, stanWe, a, ctx) {
  const st = JSON.parse(JSON.stringify(stanWe));
  const u = cfg.ustawienia;
  const f = faza(cfg, ctx.min);
  const nie = msg => ({ ok: false, msg, delta: 0, st: stanWe });
  const tak = (msg, delta, extra) => Object.assign({ ok: true, msg, delta, st }, extra || {});

  // korekty i zaliczenia zdjęć przez kadrę działają także po końcu gry (kadra może sprawdzać z opóźnieniem)
  if (!['korekta', 'znajdzka_foto', 'martwy_ok', 'martwy_nie'].includes(a.typ)) {
    if (f === 'przed') return nie('Gra jeszcze się nie zaczęła.');
    if (f === 'koniec') return nie('Gra już się skończyła.');
  }

  if (a.typ === 'kup') {
    const statek = cfg.statki.find(x => x.id === a.co);
    const bud = cfg.budowle.find(x => x.id === a.co);
    if (!statek && !bud) return nie('Nie ma takiej rzeczy w cenniku.');
    if (statek) {
      if (staty(cfg, st).ile >= u.limit_statkow) return nie('Flota ma już ' + u.limit_statkow + ' statków. Najpierw sprzedajcie jeden.');
      const cena = cenaStatku(cfg, st, statek);
      if (st.b < cena) return nie('Za mało bursztynu. ' + statek.nazwa + ' kosztuje ' + cena + ', macie ' + st.b + '.');
      st.b -= cena; st.s[statek.id] = (st.s[statek.id] || 0) + 1;
      return tak('Kupione: ' + statek.nazwa + ' za ' + cena + '.', -cena);
    }
    if (st.bud[bud.id]) return nie('Tę budowlę już macie. Każdą stawia się tylko raz.');
    if (st.b < bud.cena) return nie('Za mało bursztynu. ' + bud.nazwa + ' kosztuje ' + bud.cena + ', macie ' + st.b + '.');
    st.b -= bud.cena; st.bud[bud.id] = 1;
    return tak('Postawione: ' + bud.nazwa + ' za ' + bud.cena + '.', -bud.cena);
  }

  if (a.typ === 'sprzedaj') {
    const statek = cfg.statki.find(x => x.id === a.co);
    if (!statek) return nie('Sprzedać można tylko statek.');
    if (!(st.s[statek.id] > 0)) return nie('Nie macie takiego statku.');
    const zwrot = Math.floor(statek.cena / 2);
    st.s[statek.id] -= 1; st.b += zwrot;
    return tak('Sprzedane: ' + statek.nazwa + ' za ' + zwrot + '.', zwrot);
  }

  if (a.typ === 'atak') {
    const t = TAKTYKI.findIndex(x => x.id === a.taktyka);
    if (t < 0) return nie('Nie wybrano taktyki.');
    if (st.p >= cfg.porty.length) return nie('Wszystkie porty są już zdobyte.');
    const port = cfg.porty[st.p];
    const obrona = obronaPortu(cfg, st, t);
    if (obrona == null) return nie('Tą taktyką nie da się zdobyć portu ' + port.nazwa + '.');
    if (st.b < 0) return nie('Skarbiec jest na minusie. Najpierw odróbcie dług na punktach.');
    if (f === 'ostatnie' && st.late >= 1) return nie('W ostatnich 10 minutach wolno zaatakować tylko raz.');
    const s = staty(cfg, st);
    const stat = s[TAKTYKI[t].stat];
    const kosci = [ctx.kosc(), ctx.kosc()];
    if (st.bud.latarnia) kosci.push(ctx.kosc());
    const rzut = kosci.reduce((x, y) => x + y, 0) - (kosci.length === 3 ? Math.min.apply(null, kosci) : 0);
    const suma = stat + rzut;
    if (f === 'ostatnie') st.late += 1;
    const opis = TAKTYKI[t].statNazwa + ' ' + stat + ' + kości ' + rzut + ' = ' + suma + ', obrona ' + obrona;
    if (suma >= obrona) {
      let lup = 0;
      if (port.lup > 0) lup = Math.round(port.lup * (t === 0 ? u.natarcie_mnoznik : 1)) + (st.bud.sklad ? u.sklad_bonus : 0);
      st.b += lup; st.z += lup; st.p += 1; st.fail = 0;
      return tak(opis + ': port ' + port.nazwa + ' zdobyty' + (lup ? ', łup +' + lup : '') + '.', lup, { kosci, wygrana: true, port: port.nazwa });
    }
    const koszt = kosztPorazki(s.naprawa, t);
    st.b -= koszt; st.fail += 1;
    return tak(opis + ': atak nieudany' + (koszt ? ', naprawa -' + koszt : '') + '. Obrona portu rośnie o 1.', -koszt, { kosci, wygrana: false, port: port.nazwa });
  }

  if (a.typ === 'martwy') {
    const i = Number(a.punkt);
    const pkt = cfg.punkty_martwe[i];
    if (!pkt) return nie('Nie ma takiego punktu.');
    if (st.md[i]) return nie('Ten punkt macie już zaliczony.');
    const zuzyte = st.mt[i] || 0;
    if (zuzyte >= u.proby_martwy) return nie('Wykorzystaliście już wszystkie próby na tym punkcie.');
    if (norm(a.odpowiedz) === '') return nie('Wpiszcie odpowiedź.');
    st.mt[i] = zuzyte + 1; st.ost = 'm' + i;
    if (norm(a.odpowiedz) !== norm(pkt.odpowiedz)) {
      const zostalo = u.proby_martwy - st.mt[i];
      return tak('Błędna odpowiedź na punkcie ' + pkt.nazwa + '. ' + (zostalo > 0 ? 'Zostało prób: ' + zostalo + '.' : 'To była ostatnia próba.'), 0, { bledna: true });
    }
    const nagroda = pkt.nagroda + (st.bud.kram ? u.kram_bonus : 0) + st.p * u.port_bonus;
    st.md[i] = 1; st.b += nagroda; st.z += nagroda;
    return tak(pkt.nazwa + ' zaliczony, +' + nagroda + '.', nagroda);
  }

  if (a.typ === 'znajdzka') {
    const kod = norm(a.kod);
    if (!kod) return nie('Wpiszcie kod znajdźki.');
    const i = cfg.znajdzki.findIndex(k => norm(k) === kod);
    if (i < 0) return nie('Nie ma znajdźki z takim kodem.');
    if (st.zn[i]) return nie('Tę znajdźkę macie już zaliczoną.');
    const nagroda = u.nagroda_znajdzka + (st.bud.kantor ? u.kantor_bonus : 0);
    st.zn[i] = 1; st.b += nagroda; st.z += nagroda;
    return tak('Znajdźka zaliczona, +' + nagroda + '.', nagroda);
  }

  if (a.typ === 'zywy') {
    const i = Number(a.punkt);
    const pkt = cfg.punkty_zywe[i];
    if (!pkt) return nie('Nie ma takiego punktu.');
    const wizyty = st.zy[i] || 0;
    if (u.zywy_wizyty > 0 && wizyty >= u.zywy_wizyty) return nie('Ta gildia była już na punkcie ' + pkt.nazwa + ' ' + wizyty + ' razy. Więcej nie można.');
    st.zt = st.zt || {};
    const od = kiedyZnowu(cfg, st, i);
    if (od != null && ctx.min < od) return nie('Ta gildia była tu niedawno. Kolejna wizyta na punkcie ' + pkt.nazwa + ' możliwa od ' + hhmm(od) + '.');
    if (musiInny(cfg, st, i)) return nie('Ta gildia była tu ostatnio. Zanim wróci na punkt ' + pkt.nazwa + ', musi zaliczyć jakiś inny punkt.');
    const ocena = Number(a.ile);
    if (!Number.isInteger(ocena) || ocena < u.zywy_min || ocena > u.zywy_max) return nie('Ocena musi być liczbą całkowitą od ' + u.zywy_min + ' do ' + u.zywy_max + '.');
    // bonus z Kramu i portów tylko wtedy, gdy gildia w ogóle coś dostała za zadanie
    const nagroda = ocena > 0 ? ocena + (st.bud.kram ? u.kram_bonus : 0) + st.p * u.port_bonus : 0;
    st.zy[i] = wizyty + 1; st.zt[i] = ctx.min; st.ost = 'z' + i; st.b += nagroda; st.z += nagroda;
    return tak('Punkt żywy ' + pkt.nazwa + (wizyty ? ' (wizyta ' + (wizyty + 1) + ')' : '') + ': ocena ' + ocena + (nagroda !== ocena ? ', z bonusami +' + nagroda : ', +' + nagroda) + '.', nagroda);
  }

  // decyzje kadry o zgłoszeniu z punktu martwego (zdjęcie albo odpowiedź, której nie dało się sprawdzić automatycznie)
  if (a.typ === 'martwy_ok' || a.typ === 'martwy_nie') {
    const i = Number(a.punkt), pkt = cfg.punkty_martwe[i];
    if (!pkt) return nie('Nie ma takiego punktu.');
    if (st.md[i]) return nie('Ten punkt jest już zaliczony.');
    st.mt[i] = (st.mt[i] || 0) + 1; st.ost = 'm' + i;
    if (a.typ === 'martwy_nie') {
      const zostalo = Math.max(0, u.proby_martwy - st.mt[i]);
      return tak('Punkt ' + pkt.nazwa + ': odpowiedź odrzucona. ' + (zostalo > 0 ? 'Zostało prób: ' + zostalo + '.' : 'To była ostatnia próba.'), 0, { bledna: true });
    }
    const nagroda = pkt.nagroda + (st.bud.kram ? u.kram_bonus : 0) + st.p * u.port_bonus;
    st.md[i] = 1; st.b += nagroda; st.z += nagroda;
    return tak(pkt.nazwa + ' zaliczony, +' + nagroda + '.', nagroda);
  }

  if (a.typ === 'znajdzka_foto') {
    const limit = u.zdjecia_limit || 0;
    const ile = st.zf || 0;
    if (limit > 0 && ile >= limit) return nie('Ta gildia ma już ' + ile + ' znajdziek ze zdjęć, a limit to ' + limit + '.');
    const nagroda = u.nagroda_znajdzka + (st.bud.kantor ? u.kantor_bonus : 0);
    st.zf = ile + 1; st.b += nagroda; st.z += nagroda;
    return tak('Znajdźka ze zdjęcia zaliczona, +' + nagroda + '.', nagroda);
  }

  if (a.typ === 'korekta') {
    const ile = Math.trunc(Number(a.ile));
    if (!Number.isFinite(ile) || ile === 0) return nie('Podajcie liczbę różną od zera.');
    st.b += ile; st.z = Math.max(0, st.z + ile);
    return tak('Korekta kadry: ' + (ile > 0 ? '+' : '') + ile + (a.powod ? ' (' + String(a.powod).slice(0, 200) + ')' : '') + '.', ile);
  }

  return nie('Nieznane zgłoszenie.');
}

// Ręczna zmiana stanu gildii przez kadrę (awarie, pomyłki). `n` zawiera tylko pola, które mają się zmienić.
function edytujStan(cfg, stanWe, n) {
  const st = JSON.parse(JSON.stringify(stanWe)), zm = [];
  const nie = msg => ({ ok: false, msg, delta: 0, st: stanWe });
  const calk = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  n = n && typeof n === 'object' ? n : {};
  const pola = [['b', 'bursztyn', -100000, 1000000], ['z', 'zdobyty bursztyn', 0, 1000000], ['p', 'porty', 0, cfg.porty.length], ['fail', 'nieudane ataki na następny port', 0, 999], ['late', 'ataki w ostatnich 10 minutach', 0, 999], ['zf', 'znajdźki ze zdjęć', 0, 999]];
  for (const [k, etykieta, min, max] of pola) {
    if (n[k] === undefined || n[k] === null || n[k] === '') continue;
    const v = Number(n[k]);
    if (!calk(v, min, max)) return nie('Pole „' + etykieta + '” musi być liczbą całkowitą od ' + min + ' do ' + max + '.');
    if ((st[k] || 0) !== v) { zm.push(etykieta + ' ' + (st[k] || 0) + ' → ' + v); st[k] = v; }
  }
  if (n.s) for (const x of cfg.statki) {
    if (n.s[x.id] === undefined || n.s[x.id] === '') continue;
    const v = Number(n.s[x.id]);
    if (!calk(v, 0, 99)) return nie('Liczba statków „' + x.nazwa + '” musi być od 0 do 99.');
    if ((st.s[x.id] || 0) !== v) { zm.push(x.nazwa + ' ' + (st.s[x.id] || 0) + ' → ' + v); st.s[x.id] = v; }
  }
  if (n.bud) for (const x of cfg.budowle) {
    if (n.bud[x.id] === undefined) continue;
    const v = !!n.bud[x.id];
    if (!!st.bud[x.id] !== v) { zm.push(x.nazwa + ': ' + (v ? 'jest' : 'zabrana')); if (v) st.bud[x.id] = 1; else delete st.bud[x.id]; }
  }
  cfg.punkty_martwe.forEach((p, i) => {
    if (n.md && n.md[i] !== undefined) { const v = !!n.md[i]; if (!!st.md[i] !== v) { zm.push(p.nazwa + ': ' + (v ? 'zaliczony' : 'niezaliczony')); if (v) st.md[i] = 1; else delete st.md[i]; } }
    if (n.mt && n.mt[i] !== undefined && n.mt[i] !== '') { const v = Number(n.mt[i]); if (calk(v, 0, 99) && (st.mt[i] || 0) !== v) { zm.push(p.nazwa + ', zużyte próby ' + (st.mt[i] || 0) + ' → ' + v); if (v) st.mt[i] = v; else delete st.mt[i]; } }
  });
  cfg.punkty_zywe.forEach((p, i) => {
    if (!n.zy || n.zy[i] === undefined || n.zy[i] === '') return;
    const v = Number(n.zy[i]); if (!calk(v, 0, 99)) return;
    if ((st.zy[i] || 0) !== v) { zm.push(p.nazwa + ', wizyty ' + (st.zy[i] || 0) + ' → ' + v); if (v) st.zy[i] = v; else delete st.zy[i]; }
  });
  cfg.znajdzki.forEach((k, i) => {
    if (!n.zn || n.zn[i] === undefined) return;
    const v = !!n.zn[i];
    if (!!st.zn[i] !== v) { zm.push('znajdźka ' + k + ': ' + (v ? 'zaliczona' : 'niezaliczona')); if (v) st.zn[i] = 1; else delete st.zn[i]; }
  });
  if (!zm.length) return nie('Nic się nie zmieniło.');
  return { ok: true, msg: 'Kadra zmieniła: ' + zm.join(', ') + '.', delta: st.b - stanWe.b, st };
}

function ranking(cfg, stany) {
  const w = stany.map((st, i) => ({ i, nazwa: cfg.gildie[i].nazwa, porty: st.p, zdobyty: st.z, bursztyn: st.b }));
  w.sort((a, b) => b.porty - a.porty || b.zdobyty - a.zdobyty || a.i - b.i);
  let miejsce = 0;
  w.forEach((x, k) => {
    if (k === 0 || x.porty !== w[k - 1].porty || x.zdobyty !== w[k - 1].zdobyty) miejsce = k + 1;
    x.miejsce = miejsce;
  });
  return w;
}

// Wszystko, co strona gildii ma pokazać. Bez haseł, odpowiedzi i kodów.
function widokGildii(cfg, stany, i, min) {
  const st = stany[i], u = cfg.ustawienia, s = staty(cfg, st), f = faza(cfg, min);
  const zamkniete = f === 'przed' ? 'Gra jeszcze się nie zaczęła.' : f === 'koniec' ? 'Gra już się skończyła.' : '';
  const port = cfg.porty[st.p] || null;
  const rank = ranking(cfg, stany);
  // Ranking znika gildiom na ostatnie minuty gry (działa tylko przy włączonym pilnowaniu godzin).
  const koniec = minuty(u.koniec_gry);
  const ukryjOd = u.pilnuj_godzin && u.ukryj_ranking_min > 0 && koniec != null ? koniec - u.ukryj_ranking_min : null;
  const ukryty = ukryjOd != null && min >= ukryjOd;
  return {
    rola: 'gildia', nazwa: cfg.gildie[i].nazwa, faza: f, zamkniete,
    bursztyn: st.b, zdobyty: st.z, porty: st.p, ilePortow: cfg.porty.length,
    miejsce: ukryty ? null : rank.find(x => x.i === i).miejsce, rankingUkryty: ukryty, rankingDo: ukryjOd != null && !ukryty ? hhmm(ukryjOd) : null,
    sila: s.sila, zasieg: s.zasieg, zwrot: s.zwrot, naprawa: s.naprawa, ileStatkow: s.ile, limit: u.limit_statkow,
    portBonus: u.port_bonus,
    statki: cfg.statki.map(x => {
      const cena = cenaStatku(cfg, st, x);
      const powod = zamkniete || (s.ile >= u.limit_statkow ? 'Flota jest pełna' : st.b < cena ? 'Brakuje ' + (cena - st.b) : '');
      return { id: x.id, nazwa: x.nazwa, cena, sila: x.sila, zasieg: x.zasieg, zwrot: x.zwrot, naprawa: x.naprawa, ile: st.s[x.id] || 0, zwrotZaSprzedaz: Math.floor(x.cena / 2), powod };
    }),
    budowle: cfg.budowle.map(x => ({ id: x.id, nazwa: x.nazwa, cena: x.cena, opis: x.opis, ma: !!st.bud[x.id], powod: st.bud[x.id] ? '' : (zamkniete || (st.b < x.cena ? 'Brakuje ' + (x.cena - st.b) : '')) })),
    nastepny: port ? { nr: st.p + 1, nazwa: port.nazwa, broni: port.broni, lup: port.lup, nieudane: st.fail } : null,
    taktyki: TAKTYKI.map((t, k) => {
      const obrona = port ? obronaPortu(cfg, st, k) : null;
      const stat = s[t.stat];
      const brakuje = obrona == null ? null : Math.max(0, obrona - stat);
      let powod = zamkniete;
      if (!powod && !port) powod = 'Wszystkie porty zdobyte';
      if (!powod && obrona == null) powod = 'Tą taktyką nie da się zdobyć tego portu';
      if (!powod && st.b < 0) powod = 'Skarbiec na minusie';
      if (!powod && f === 'ostatnie' && st.late >= 1) powod = 'W ostatnich 10 minutach tylko jeden atak';
      return { id: t.id, nazwa: t.nazwa, statNazwa: t.statNazwa, stat, obrona, brakuje,
        szansa: obrona == null ? 0 : Math.round(100 * szansa(obrona - stat, !!st.bud.latarnia)),
        kosztPorazki: kosztPorazki(s.naprawa, k), lupRazy: k === 0 ? u.natarcie_mnoznik : 1, powod };
    }),
    tabelaPortow: cfg.porty.map((p, k) => ({ nr: k + 1, nazwa: p.nazwa, broni: p.broni, obrona: TAKTYKI.map(t => p[t.id] >= NIE_DA_SIE ? null : p[t.id]), lup: p.lup, zdobyty: k < st.p, nastepny: k === st.p })),
    martwe: cfg.punkty_martwe.map((p, k) => ({ nr: k, nazwa: p.nazwa, pytanie: p.pytanie || '', nagroda: p.nagroda, zaliczony: !!st.md[k], zostaloProb: Math.max(0, u.proby_martwy - (st.mt[k] || 0)) })),
    zywe: cfg.punkty_zywe.map((p, k) => { const od = kiedyZnowu(cfg, st, k); return { nazwa: p.nazwa, wizyty: st.zy[k] || 0, limit: u.zywy_wizyty, znowuOd: od != null && min < od ? hhmm(od) : null, innyNajpierw: musiInny(cfg, st, k) }; }),
    znajdzki: { znalezione: Object.keys(st.zn).length + (st.zf || 0), wszystkie: cfg.znajdzki.length },
    zdjecia: !!u.zdjecia, zdjeciaLimit: u.zdjecia_limit || 0, probyMartwy: u.proby_martwy,
    ranking: ukryty ? [] : rank.map(x => ({ miejsce: x.miejsce, nazwa: x.nazwa, porty: x.porty, ja: x.i === i })),
    godziny: u.pilnuj_godzin ? { ostatnie: u.ostatnie_10_min, koniec: u.koniec_gry } : null,
  };
}

function sprawdzKonfiguracje(cfg) {
  const b = [];
  const lista = (k, min) => { if (!Array.isArray(cfg[k]) || cfg[k].length < min) b.push('Brakuje listy „' + k + '”.'); };
  if (!cfg || typeof cfg !== 'object') return ['Konfiguracja nie jest obiektem.'];
  if (!cfg.ustawienia || typeof cfg.ustawienia !== 'object') b.push('Brakuje sekcji „ustawienia”.');
  lista('gildie', 1); lista('statki', 1); lista('budowle', 0); lista('porty', 1); lista('punkty_martwe', 0); lista('punkty_zywe', 0); lista('znajdzki', 0);
  if (b.length) return b;
  const u = cfg.ustawienia;
  for (const k of ['start_bursztyn', 'port_bonus', 'kram_bonus', 'sklad_bonus', 'kantor_bonus', 'natarcie_mnoznik', 'limit_statkow', 'proby_martwy', 'nagroda_znajdzka', 'zywy_min', 'zywy_max', 'zywy_wizyty', 'zywy_przerwa_min', 'ukryj_ranking_min', 'zdjecia_limit']) {
    if (typeof u[k] !== 'number' || !Number.isFinite(u[k])) b.push('Ustawienie „' + k + '” musi być liczbą.');
  }
  for (const k of ['start_gry', 'ostatnie_10_min', 'koniec_gry']) if (minuty(u[k]) == null) b.push('Ustawienie „' + k + '” musi mieć postać GG:MM.');
  if (!String(u.haslo_punktowych || '').trim()) b.push('Ustawcie hasło punktowych.');
  const hasla = cfg.gildie.map(g => String(g.haslo || '').trim());
  if (hasla.some(h => !h)) b.push('Każda gildia musi mieć hasło.');
  if (new Set(hasla.concat([String(u.haslo_punktowych).trim()])).size !== hasla.length + 1) b.push('Hasła gildii i punktowych muszą być różne.');
  cfg.statki.forEach(x => { for (const k of ['cena', 'sila', 'zasieg', 'zwrot', 'naprawa']) if (typeof x[k] !== 'number') b.push('Statek „' + x.nazwa + '”: pole „' + k + '” musi być liczbą.'); if (!x.id) b.push('Statek bez id.'); });
  cfg.budowle.forEach(x => { if (typeof x.cena !== 'number') b.push('Budowla „' + x.nazwa + '”: cena musi być liczbą.'); });
  if (u.zywy_min > u.zywy_max) b.push('„zywy_min” nie może być większe niż „zywy_max”.');
  cfg.punkty_martwe.forEach(x => { if (typeof x.nagroda !== 'number') b.push('Punkt martwy „' + x.nazwa + '”: nagroda musi być liczbą.'); });
  cfg.porty.forEach(x => { for (const k of ['natarcie', 'ostrzal', 'zaskoczenie', 'lup']) if (typeof x[k] !== 'number') b.push('Port „' + x.nazwa + '”: pole „' + k + '” musi być liczbą.'); });
  return b;
}

module.exports = { TAKTYKI, NIE_DA_SIE, minuty, norm, nowyStan, staty, cenaStatku, kosztPorazki, faza, szansa, obronaPortu, akcja, edytujStan, kiedyZnowu, musiInny, hhmm, ranking, widokGildii, sprawdzKonfiguracje };
