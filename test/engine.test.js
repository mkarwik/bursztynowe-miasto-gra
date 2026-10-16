'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../engine');
const cfg0 = require('../config.default.json');
const kopia = o => JSON.parse(JSON.stringify(o));
const kosci = (...v) => { let i = 0; return () => v[i++ % v.length]; };
const ctx = (k, min) => ({ min: min == null ? 600 : min, kosc: k || kosci(3, 4) });

test('scenariusz: zakup, atak, punkty, kram, sprzedaż', () => {
  const cfg = kopia(cfg0); cfg.ustawienia.zywy_wizyty = 1; let st = E.nowyStan(cfg), r;
  const cena = n => cfg.statki.find(x => x.id === n).cena, bud = n => cfg.budowle.find(x => x.id === n).cena;
  assert.equal(st.b, 50); assert.equal(st.s.sznika, 1);
  r = E.akcja(cfg, st, { typ: 'kup', co: 'sznika' }, ctx()); assert.ok(r.ok); st = r.st; assert.equal(st.b, 50 - cena('sznika')); assert.equal(st.s.sznika, 2);
  r = E.akcja(cfg, st, { typ: 'atak', taktyka: 'zaskoczenie' }, ctx(kosci(3, 4))); st = r.st;       // Zwrotność 4 + 7 = 11 >= 7
  assert.ok(r.wygrana); assert.equal(st.p, 1); assert.equal(r.delta, 10); assert.equal(st.z, 60);
  r = E.akcja(cfg, st, { typ: 'martwy', punkt: 0, odpowiedz: ' ODP1 ' }, ctx()); st = r.st; assert.equal(r.delta, 30);   // 25 + 5 za port
  r = E.akcja(cfg, st, { typ: 'martwy', punkt: 0, odpowiedz: 'odp1' }, ctx()); assert.equal(r.ok, false);
  r = E.akcja(cfg, st, { typ: 'zywy', punkt: 0, ile: 56 }, ctx()); assert.equal(r.ok, false);
  r = E.akcja(cfg, st, { typ: 'zywy', punkt: 0, ile: 12.5 }, ctx()); assert.equal(r.ok, false);
  r = E.akcja(cfg, st, { typ: 'zywy', punkt: 1, ile: 0 }, ctx()); assert.ok(r.ok); assert.equal(r.delta, 0); assert.equal(r.st.zy[1], 1);
  r = E.akcja(cfg, st, { typ: 'zywy', punkt: 0, ile: 55 }, ctx()); st = r.st; assert.equal(r.delta, 60);
  r = E.akcja(cfg, st, { typ: 'zywy', punkt: 0, ile: 55 }, ctx()); assert.equal(r.ok, false);
  r = E.akcja(cfg, st, { typ: 'znajdzka_foto' }, ctx()); st = r.st; assert.equal(r.delta, 15);
  const b0 = st.b; r = E.akcja(cfg, st, { typ: 'kup', co: 'kram' }, ctx()); st = r.st; assert.equal(st.b, b0 - bud('kram'));
  r = E.akcja(cfg, st, { typ: 'kup', co: 'kram' }, ctx()); assert.equal(r.ok, false);
  r = E.akcja(cfg, st, { typ: 'atak', taktyka: 'natarcie' }, ctx(kosci(2, 3))); assert.equal(r.wygrana, false); assert.equal(r.delta, -10); st = r.st;  // naprawa 2 × 5
  assert.equal(st.fail, 1); assert.equal(E.obronaPortu(cfg, st, 0), 12);
  r = E.akcja(cfg, st, { typ: 'sprzedaj', co: 'sznika' }, ctx()); assert.equal(r.delta, Math.floor(cena('sznika') / 2)); st = r.st;
  r = E.akcja(cfg, st, { typ: 'martwy', punkt: 1, odpowiedz: 'odp2' }, ctx()); assert.equal(r.delta, 25 + 5 + 5);   // kram + 1 port
  assert.equal(st.z, 50 + 10 + 30 + 60 + 15);
});

test('punkt martwy: decyzje kadry o zgłoszeniu', () => {
  const cfg = kopia(cfg0); let st = E.nowyStan(cfg), r;
  r = E.akcja(cfg, st, { typ: 'martwy_nie', punkt: 2 }, ctx(null, 12 * 60)); assert.ok(r.ok); st = r.st; assert.equal(st.mt[2], 1); assert.equal(r.delta, 0);
  r = E.akcja(cfg, st, { typ: 'martwy_ok', punkt: 2 }, ctx()); assert.equal(r.delta, 25); st = r.st; assert.equal(st.md[2], 1);
  assert.equal(E.akcja(cfg, st, { typ: 'martwy_ok', punkt: 2 }, ctx()).ok, false, 'drugi raz nie');
});

test('punkt żywy: między wizytami trzeba zaliczyć inny punkt', () => {
  const cfg = kopia(cfg0); let st = E.nowyStan(cfg), r;
  assert.equal(cfg.ustawienia.zywy_wizyty, 2); assert.equal(cfg.ustawienia.zywy_przerwa_min, 0); assert.equal(cfg.ustawienia.zywy_inny_punkt, true);
  r = E.akcja(cfg, st, { typ: 'zywy', punkt: 0, ile: 40 }, ctx(null, 600)); assert.ok(r.ok); st = r.st;
  r = E.akcja(cfg, st, { typ: 'zywy', punkt: 0, ile: 40 }, ctx(null, 640)); assert.equal(r.ok, false, 'dwa razy z rzędu nie'); assert.match(r.msg, /inny punkt/);
  assert.equal(E.widokGildii(cfg, [st], 0, 640).zywe[0].innyNajpierw, true);
  r = E.akcja(cfg, st, { typ: 'martwy', punkt: 3, odpowiedz: 'zle' }, ctx(null, 645)); st = r.st;      // nawet błędna próba na martwym się liczy
  assert.equal(E.widokGildii(cfg, [st], 0, 646).zywe[0].innyNajpierw, false);
  r = E.akcja(cfg, st, { typ: 'zywy', punkt: 0, ile: 40 }, ctx(null, 646)); assert.ok(r.ok, 'po innym punkcie od razu można'); st = r.st;
  r = E.akcja(cfg, st, { typ: 'zywy', punkt: 1, ile: 40 }, ctx(null, 650)); st = r.st;
  r = E.akcja(cfg, st, { typ: 'zywy', punkt: 0, ile: 40 }, ctx(null, 700)); assert.equal(r.ok, false, 'trzecia wizyta ponad limit');
  // znajdźka nie jest punktem
  st = E.nowyStan(cfg); st = E.akcja(cfg, st, { typ: 'zywy', punkt: 2, ile: 30 }, ctx()).st; st = E.akcja(cfg, st, { typ: 'znajdzka', kod: 'BURSZTYN1' }, ctx()).st;
  assert.equal(E.akcja(cfg, st, { typ: 'zywy', punkt: 2, ile: 30 }, ctx()).ok, false);
  // przerwa w minutach nadal działa, jeśli ktoś ją ustawi
  const c2 = kopia(cfg0); c2.ustawienia.zywy_przerwa_min = 30; c2.ustawienia.zywy_inny_punkt = false; st = E.nowyStan(c2);
  st = E.akcja(c2, st, { typ: 'zywy', punkt: 0, ile: 40 }, ctx(null, 600)).st;
  r = E.akcja(c2, st, { typ: 'zywy', punkt: 0, ile: 40 }, ctx(null, 620)); assert.equal(r.ok, false); assert.match(r.msg, /10:30/);
  assert.ok(E.akcja(c2, st, { typ: 'zywy', punkt: 0, ile: 40 }, ctx(null, 631)).ok);
});

test('punkt żywy: kilka wizyt do limitu, bez limitu przy zerze', () => {
  const cfg = kopia(cfg0); cfg.ustawienia.zywy_wizyty = 3; cfg.ustawienia.zywy_przerwa_min = 0; cfg.ustawienia.zywy_inny_punkt = false; let st = E.nowyStan(cfg), r;
  for (let k = 0; k < 3; k++) { r = E.akcja(cfg, st, { typ: 'zywy', punkt: 2, ile: 40 }, ctx()); assert.ok(r.ok); st = r.st; }
  assert.equal(st.zy[2], 3); assert.equal(st.b, 50 + 120);
  assert.equal(E.akcja(cfg, st, { typ: 'zywy', punkt: 2, ile: 40 }, ctx()).ok, false);
  assert.ok(E.akcja(cfg, st, { typ: 'zywy', punkt: 1, ile: 40 }, ctx()).ok);
  cfg.ustawienia.zywy_wizyty = 0; for (let k = 0; k < 6; k++) st = E.akcja(cfg, st, { typ: 'zywy', punkt: 2, ile: 10 }, ctx()).st; assert.equal(st.zy[2], 9);
  assert.equal(E.widokGildii(cfg, [st], 0, 600).zywe[2].wizyty, 9);
});

test('edycja kadry: dawanie i zabieranie rzeczy', () => {
  const cfg = kopia(cfg0); let st = E.nowyStan(cfg), r;
  r = E.edytujStan(cfg, st, {}); assert.equal(r.ok, false);
  r = E.edytujStan(cfg, st, { b: 200, p: 3, s: { holk: 2, sznika: 0 }, bud: { kram: true, latarnia: true }, md: { 4: true }, mt: { 5: 2 }, zy: { 1: 2 }, zf: 3 });
  assert.ok(r.ok); st = r.st; assert.equal(r.delta, 150);
  assert.equal(st.b, 200); assert.equal(st.p, 3); assert.equal(st.s.holk, 2); assert.equal(st.s.sznika, 0); assert.ok(st.bud.kram && st.bud.latarnia);
  assert.equal(st.md[4], 1); assert.equal(st.mt[5], 2); assert.equal(st.zy[1], 2); assert.equal(st.zf, 3);
  assert.match(r.msg, /Holk 0 → 2/); assert.match(r.msg, /porty 0 → 3/);
  assert.equal(E.akcja(cfg, st, { typ: 'martwy', punkt: 4, odpowiedz: 'odp5' }, ctx()).ok, false);
  r = E.edytujStan(cfg, st, { bud: { kram: false }, md: { 4: false }, zf: 0, s: { holk: 1 }, p: 2 }); st = r.st;
  assert.ok(!st.bud.kram && st.bud.latarnia); assert.ok(!st.md[4]); assert.equal(st.zf, 0); assert.equal(st.s.holk, 1); assert.equal(st.p, 2);
  assert.equal(E.edytujStan(cfg, st, { p: 11 }).ok, false); assert.equal(E.edytujStan(cfg, st, { s: { holk: -1 } }).ok, false); assert.equal(E.edytujStan(cfg, st, { b: 'abc' }).ok, false);
  assert.equal(E.staty(cfg, st).sila, 13);
});

test('punkt martwy: dwie próby', () => {
  const cfg = kopia(cfg0); let st = E.nowyStan(cfg), r;
  r = E.akcja(cfg, st, { typ: 'martwy', punkt: 2, odpowiedz: 'zle' }, ctx()); st = r.st; assert.ok(r.bledna); assert.equal(r.delta, 0);
  r = E.akcja(cfg, st, { typ: 'martwy', punkt: 2, odpowiedz: 'znowu zle' }, ctx()); st = r.st; assert.ok(r.bledna);
  r = E.akcja(cfg, st, { typ: 'martwy', punkt: 2, odpowiedz: 'odp3' }, ctx()); assert.equal(r.ok, false);
});

test('odmowy: brak bursztynu, pełna flota, niemożliwa taktyka, minus', () => {
  const cfg = kopia(cfg0); let st = E.nowyStan(cfg), r;
  r = E.akcja(cfg, st, { typ: 'kup', co: 'holk' }, ctx()); assert.equal(r.ok, false); assert.deepEqual(r.st, st);
  st.b = 1000; for (let i = 0; i < 5; i++) st = E.akcja(cfg, st, { typ: 'kup', co: 'sznika' }, ctx()).st;
  assert.equal(E.staty(cfg, st).ile, 6);
  r = E.akcja(cfg, st, { typ: 'kup', co: 'sznika' }, ctx()); assert.equal(r.ok, false);
  st.p = 2;                                                              // Kłajpeda: tylko zaskoczenie
  r = E.akcja(cfg, st, { typ: 'atak', taktyka: 'natarcie' }, ctx()); assert.equal(r.ok, false);
  r = E.akcja(cfg, st, { typ: 'atak', taktyka: 'zaskoczenie' }, ctx(kosci(1, 1))); assert.ok(r.ok);   // 12 + 2 >= 11
  st.b = -5; r = E.akcja(cfg, st, { typ: 'atak', taktyka: 'zaskoczenie' }, ctx()); assert.equal(r.ok, false);
  r = E.akcja(cfg, st, { typ: 'kup', co: 'kram' }, ctx()); assert.equal(r.ok, false);
  st.p = 10; st.b = 50; r = E.akcja(cfg, st, { typ: 'atak', taktyka: 'natarcie' }, ctx()); assert.equal(r.ok, false);
});

test('nieudany atak: koszty według taktyki, minus w skarbcu', () => {
  const cfg = kopia(cfg0); let st = E.nowyStan(cfg); st.s = { sznika: 0, krajer: 0, koga: 2, holk: 1 }; st.b = 30; st.p = 5;  // Visby 40/28/26
  assert.equal(E.staty(cfg, st).naprawa, 54);
  let r = E.akcja(cfg, st, { typ: 'atak', taktyka: 'natarcie' }, ctx(kosci(1, 1))); assert.equal(r.delta, -54); assert.equal(r.st.b, -24);
  r = E.akcja(cfg, st, { typ: 'atak', taktyka: 'ostrzal' }, ctx(kosci(1, 1))); assert.equal(r.delta, -27);
  r = E.akcja(cfg, st, { typ: 'atak', taktyka: 'zaskoczenie' }, ctx(kosci(1, 1))); assert.equal(r.delta, 0); assert.equal(r.st.fail, 1);
});

test('łup: natarcie o połowę większy, skład, latarnia', () => {
  const cfg = kopia(cfg0); let st = E.nowyStan(cfg); st.s.holk = 3; st.bud.sklad = 1; st.p = 3;   // Ryga, łup 15, Siła 40 vs 21
  let r = E.akcja(cfg, st, { typ: 'atak', taktyka: 'natarcie' }, ctx(kosci(1, 1))); assert.equal(r.delta, Math.round(15 * 1.5) + 10);
  st.bud.latarnia = 1; st.s.holk = 0; st.s.koga = 1; st.p = 0;                                     // Zasięg 8 vs 8
  r = E.akcja(cfg, st, { typ: 'atak', taktyka: 'ostrzal' }, ctx(kosci(1, 6, 5))); assert.equal(r.kosci.length, 3); assert.match(r.msg, /kości 11/);
});

test('bonusy budowli, kantor, sprzedaż', () => {
  const cfg = kopia(cfg0); let st = E.nowyStan(cfg); st.b = 1000;
  for (const b of ['zbrojownia', 'kusznicy', 'sternicy', 'kantor']) st = E.akcja(cfg, st, { typ: 'kup', co: b }, ctx()).st;
  assert.equal(E.akcja(cfg, st, { typ: 'kup', co: 'stocznia' }, ctx()).ok, false, 'Stoczni już nie ma');
  const holk = cfg.statki.find(x => x.id === 'holk');
  const przed = st.b; st = E.akcja(cfg, st, { typ: 'kup', co: 'holk' }, ctx()).st; assert.equal(przed - st.b, holk.cena);
  const s = E.staty(cfg, st); assert.equal(s.sila, 1 + holk.sila + 4); assert.equal(s.zasieg, holk.zasieg + 4); assert.equal(s.zwrot, 2 + holk.zwrot + 4);
  assert.equal(E.akcja(cfg, st, { typ: 'znajdzka_foto' }, ctx()).delta, 30);
  assert.equal(E.akcja(cfg, st, { typ: 'sprzedaj', co: 'holk' }, ctx()).delta, Math.floor(holk.cena / 2));
});

test('godziny: przed, ostatnie 10 minut, koniec', () => {
  const cfg = kopia(cfg0); cfg.ustawienia.pilnuj_godzin = true; let st = E.nowyStan(cfg);
  assert.equal(E.akcja(cfg, st, { typ: 'kup', co: 'sznika' }, ctx(null, 8 * 60 + 30)).ok, false);
  assert.equal(E.akcja(cfg, st, { typ: 'kup', co: 'sznika' }, ctx(null, 8 * 60 + 40)).ok, true);
  assert.equal(E.akcja(cfg, st, { typ: 'kup', co: 'sznika' }, ctx(null, 11 * 60 + 20)).ok, false);
  assert.equal(E.faza(cfg, 11 * 60 + 10), 'ostatnie'); assert.equal(E.faza(cfg, 11 * 60 + 9), 'trwa');
  let r = E.akcja(cfg, st, { typ: 'atak', taktyka: 'zaskoczenie' }, ctx(kosci(1, 1), 11 * 60 + 12)); assert.ok(r.ok); st = r.st;
  r = E.akcja(cfg, st, { typ: 'atak', taktyka: 'zaskoczenie' }, ctx(kosci(6, 6), 11 * 60 + 13)); assert.equal(r.ok, false);
  assert.ok(E.akcja(cfg, st, { typ: 'kup', co: 'sznika' }, ctx(null, 11 * 60 + 15)).ok);
  assert.ok(E.akcja(cfg, st, { typ: 'korekta', ile: 10 }, ctx(null, 12 * 60)).ok);
});

test('ranking: porty, potem zdobyty bursztyn, remis', () => {
  const cfg = kopia(cfg0); const stany = cfg.gildie.map(() => E.nowyStan(cfg));
  stany[3].p = 2; stany[5].p = 2; stany[5].z = 300; stany[7].z = 80;
  const r = E.ranking(cfg, stany);
  assert.equal(r[0].i, 5); assert.equal(r[1].i, 3); assert.equal(r[2].i, 7); assert.equal(r[3].miejsce, 4); assert.equal(r[9].miejsce, 4);
});

test('ranking: domyślnie tylko dla kadry', () => {
  const cfg = kopia(cfg0); const stany = cfg.gildie.map(() => E.nowyStan(cfg));
  const w = E.widokGildii(cfg, stany, 0, 600); assert.equal(w.rankingUkryty, true); assert.equal(w.rankingWylaczony, true); assert.equal(w.ranking.length, 0); assert.equal(w.miejsce, null);
});

test('ranking dla gildii (gdy włączony) ukryty przez ostatnie 30 minut', () => {
  const cfg = kopia(cfg0); cfg.ustawienia.pilnuj_godzin = true; cfg.ustawienia.ranking_dla_gildii = true; const stany = cfg.gildie.map(() => E.nowyStan(cfg)); stany[2].p = 3;
  let w = E.widokGildii(cfg, stany, 0, 10 * 60 + 49); assert.equal(w.rankingUkryty, false); assert.equal(w.ranking.length, 10); assert.equal(w.miejsce, 2); assert.equal(w.rankingDo, '10:50');
  w = E.widokGildii(cfg, stany, 0, 10 * 60 + 50); assert.equal(w.rankingUkryty, true); assert.equal(w.ranking.length, 0); assert.equal(w.miejsce, null);
  w = E.widokGildii(cfg, stany, 0, 12 * 60); assert.equal(w.rankingUkryty, true, 'po końcu gry nadal ukryty');
  cfg.ustawienia.ukryj_ranking_min = 0; assert.equal(E.widokGildii(cfg, stany, 0, 11 * 60).rankingUkryty, false);
  cfg.ustawienia.ukryj_ranking_min = 30; cfg.ustawienia.pilnuj_godzin = false; assert.equal(E.widokGildii(cfg, stany, 0, 11 * 60).rankingUkryty, false);
});

test('widok gildii nie zawiera haseł, odpowiedzi ani kodów', () => {
  const cfg = kopia(cfg0); const stany = cfg.gildie.map(() => E.nowyStan(cfg));
  const txt = JSON.stringify(E.widokGildii(cfg, stany, 0, 600));
  for (const g of cfg.gildie) assert.ok(!txt.includes(g.haslo));
  assert.ok(!txt.includes('odp1')); assert.ok(!txt.includes('BURSZTYN1')); assert.ok(!txt.includes(cfg.ustawienia.haslo_punktowych));
});

test('szansa zgadza się z rozkładem kości', () => {
  assert.equal(E.szansa(2, false), 1); assert.equal(E.szansa(13, false), 0);
  assert.ok(Math.abs(E.szansa(7, false) - 21 / 36) < 1e-9); assert.ok(Math.abs(E.szansa(12, false) - 1 / 36) < 1e-9);
  assert.ok(E.szansa(9, true) > E.szansa(9, false));
});

test('konfiguracja domyślna jest poprawna, zepsuta nie', () => {
  assert.deepEqual(E.sprawdzKonfiguracje(kopia(cfg0)), []);
  const zla = kopia(cfg0); zla.gildie[1].haslo = zla.gildie[0].haslo; zla.statki[0].cena = 'x';
  assert.ok(E.sprawdzKonfiguracje(zla).length >= 2);
});

test('losowe gry: stan zawsze spójny', () => {
  const cfg = kopia(cfg0); const rnd = (n) => Math.floor(Math.random() * n);
  const przedmioty = cfg.statki.map(x => x.id).concat(cfg.budowle.map(x => x.id)).concat(['nic']);
  for (let gra = 0; gra < 400; gra++) {
    let st = E.nowyStan(cfg), suma = st.b;
    for (let k = 0; k < 120; k++) {
      const los = rnd(7); let a;
      if (los === 0) a = { typ: 'kup', co: przedmioty[rnd(przedmioty.length)] };
      else if (los === 1) a = { typ: 'sprzedaj', co: przedmioty[rnd(przedmioty.length)] };
      else if (los === 2) a = { typ: 'atak', taktyka: ['natarcie', 'ostrzal', 'zaskoczenie', 'x'][rnd(4)] };
      else if (los === 3) a = { typ: 'martwy', punkt: rnd(14), odpowiedz: rnd(2) ? 'odp' + (rnd(13) + 1) : 'zle' };
      else if (los === 4) a = { typ: 'znajdzka', kod: 'BURSZTYN' + (rnd(12) + 1) };
      else if (los === 5) a = { typ: 'zywy', punkt: rnd(7), ile: rnd(70) - 5 };
      else a = { typ: 'nieznane' };
      const przed = JSON.stringify(st);
      const r = E.akcja(cfg, st, a, { min: 600, kosc: () => 1 + rnd(6) });
      assert.equal(JSON.stringify(st), przed, 'stan wejściowy nie może się zmienić');
      if (!r.ok) { assert.equal(r.st, st); continue; }
      assert.equal(r.st.b, st.b + r.delta, 'zmiana bursztynu zgodna z delta: ' + JSON.stringify(a));
      st = r.st; suma += r.delta;
      const s = E.staty(cfg, st);
      assert.ok(s.ile <= cfg.ustawienia.limit_statkow && s.ile >= 0);
      for (const x of cfg.statki) assert.ok(st.s[x.id] >= 0);
      assert.ok(st.p >= 0 && st.p <= cfg.porty.length); assert.ok(st.z >= cfg.ustawienia.start_bursztyn);
      assert.ok(Object.keys(st.md).length <= cfg.punkty_martwe.length && Object.keys(st.zn).length <= cfg.znajdzki.length && Object.keys(st.zy).length <= cfg.punkty_zywe.length);
      if (a.typ === 'kup') assert.ok(st.b >= 0, 'zakup nie może zadłużyć');
      assert.ok(st.b >= -200);
      E.widokGildii(cfg, [st], 0, 600);
    }
    assert.equal(st.b, suma);
  }
});
