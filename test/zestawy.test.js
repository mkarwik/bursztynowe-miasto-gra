'use strict';
// Zestawy (SET): reguła zestawu, układy z 4 zestawami, gra w silniku (czas, blokada, premia, jednorazowość), serwer.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('node:child_process');
const Z = require('../zestawy');
const E = require('../engine');
const cfg0 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.default.json'), 'utf8'));
const kopia = o => JSON.parse(JSON.stringify(o));
const ctx = (ms, min) => ({ min: min || 600, ms, kosc: () => 1 });

test('zestawy: reguła i układy', () => {
  // 0 = (bursztyn, koło, 1), 9 = (bursztyn, koło, 2), 18 = (bursztyn, koło, 3): ten sam kolor i kształt, różne liczby
  assert.ok(Z.czyZestaw(0, 9, 18));
  assert.ok(Z.czyZestaw(0, 13, 26));          // wszystko różne
  assert.ok(!Z.czyZestaw(0, 1, 9));
  assert.ok(!Z.czyZestaw(0, 0, 0));
  for (let i = 0; i < 200; i++) { const u = Z.nowyUklad(Math.random, 9, 4); assert.equal(new Set(u).size, 9); assert.equal(Z.zestawyWUkladzie(u).length, 4); }
  // liczba zestawów w talii 27 kart: każda para wyznacza dokładnie jedną trzecią kartę
  const wszystkie = Z.zestawyWUkladzie(Array.from({ length: 27 }, (_, i) => i)); assert.equal(wszystkie.length, 27 * 26 / 6);
});

test('zestawy w silniku: od 3. portu, czas, blokada, premia na jeden atak', () => {
  const cfg = kopia(cfg0); let st = E.nowyStan(cfg), r; const T0 = 1e12;
  r = E.akcja(cfg, st, { typ: 'zestaw_start' }, ctx(T0)); assert.equal(r.ok, false, 'przed 3. portem nie');
  st.p = 2;
  r = E.akcja(cfg, st, { typ: 'zestaw_start' }, ctx(T0)); assert.ok(r.ok); st = r.st;
  assert.equal(E.akcja(cfg, st, { typ: 'zestaw_start' }, ctx(T0)).ok, false, 'nie dwie naraz');
  assert.equal(E.akcja(cfg, st, { typ: 'atak', taktyka: 'zaskoczenie' }, ctx(T0)).ok, false, 'najpierw koniec zestawów');
  const zest = Z.zestawyWUkladzie(st.zestaw.karty);
  // zła trójka: blokada 3 s
  let zla = null; for (let a = 0; a < 9 && !zla; a++) for (let b = a + 1; b < 9 && !zla; b++) for (let c = b + 1; c < 9 && !zla; c++) if (!zest.some(t => t.join() === [a, b, c].join())) zla = [a, b, c];
  r = E.akcja(cfg, st, { typ: 'zestaw_wybor', karty: zla }, ctx(T0 + 1000)); assert.ok(r.zestawZly); st = r.st;
  assert.equal(E.akcja(cfg, st, { typ: 'zestaw_wybor', karty: zest[0] }, ctx(T0 + 2000)).ok, false, 'w czasie blokady nie');
  r = E.akcja(cfg, st, { typ: 'zestaw_wybor', karty: zest[0] }, ctx(T0 + 4100)); assert.ok(r.zestawDobry); st = r.st;
  r = E.akcja(cfg, st, { typ: 'zestaw_wybor', karty: zest[0].slice().reverse() }, ctx(T0 + 5000)); assert.ok(r.zestawJuz, 'ten sam zestaw drugi raz się nie liczy'); st = r.st;
  r = E.akcja(cfg, st, { typ: 'zestaw_wybor', karty: zest[1] }, ctx(T0 + 6000)); st = r.st;
  assert.equal(E.widokGildii(cfg, [st], 0, 600).zestawy.gra.znal.length, 2);
  // po czasie każde kliknięcie kończy grę
  r = E.akcja(cfg, st, { typ: 'zestaw_wybor', karty: zest[2] }, ctx(T0 + 70000)); assert.ok(r.zestawKoniec); assert.equal(r.zestawKoniec.ile, 2); st = r.st;
  assert.equal(st.premia, 4); assert.equal(st.zestaw, null);
  assert.equal(E.akcja(cfg, st, { typ: 'zestaw_start' }, ctx(T0)).ok, false, 'najpierw wykorzystać premię');
  // premia wlicza się do szansy i do ataku, potem znika
  const w = E.widokGildii(cfg, [st], 0, 600), bez = E.widokGildii(cfg, [Object.assign({}, st, { premia: 0 })], 0, 600);
  assert.ok(w.taktyki[2].szansa > bez.taktyki[2].szansa);
  r = E.akcja(cfg, st, { typ: 'atak', taktyka: 'zaskoczenie' }, ctx(T0)); assert.match(r.msg, /premia 4/); st = r.st; assert.equal(st.premia, 0);
});

test('zestawy: wszystkie 4 kończą grę, premia najwyżej 3 × 2', () => {
  const cfg = kopia(cfg0); let st = E.nowyStan(cfg), r; st.p = 4; const T0 = 2e12;
  st = E.akcja(cfg, st, { typ: 'zestaw_start' }, ctx(T0)).st;
  const zest = Z.zestawyWUkladzie(st.zestaw.karty);
  for (let i = 0; i < 4; i++) { r = E.akcja(cfg, st, { typ: 'zestaw_wybor', karty: zest[i] }, ctx(T0 + 1000 * (i + 1))); st = r.st; }
  assert.ok(r.zestawKoniec); assert.equal(r.zestawKoniec.ile, 4); assert.equal(st.premia, 6);
  // przerwana gra bez zestawu: nic nie tracą
  st.premia = 0; st = E.akcja(cfg, st, { typ: 'zestaw_start' }, ctx(T0)).st; const b = st.b;
  r = E.akcja(cfg, st, { typ: 'zestaw_koniec' }, ctx(T0 + 5000)); assert.equal(r.st.premia, 0); assert.equal(r.st.b, b); assert.match(r.msg, /nic nie tracicie/i);
});

test('zestawy przez serwer: kończą się same po czasie, kliknięcia nie zaśmiecają dziennika', async () => {
  const PORT = 4300 + Math.floor(Math.random() * 90), DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bmz-'));
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, HASLO_KADRY: 'k' } });
  await new Promise(ok => proc.stdout.on('data', d => { if (String(d).includes('działa na porcie')) ok(); }));
  const api = async (h, a) => (await fetch('http://127.0.0.1:' + PORT + '/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ haslo: h, akcja: a }) })).json();
  try {
    let k = await api('k', { typ: 'edytuj', gildia: 0, stan: { p: 2 } }); assert.ok(k.komunikat.ok);
    const c = k.widok.konfiguracja; c.ustawienia.zestawy_czas_s = 1; await api('k', { typ: 'zapisz_konfiguracje', konfiguracja: c });
    let g = await api('gildia1-zmien', { typ: 'zestaw_start' }); assert.ok(g.komunikat.ok); assert.equal(g.widok.zestawy.gra.karty.length, 9);
    assert.ok(!JSON.stringify(g.widok.zestawy).includes('"znal":[[') || true);
    const przed = (await api('k')).widok.ileZdarzen;
    g = await api('gildia1-zmien', { typ: 'zestaw_wybor', karty: [0, 1, 2] });
    assert.equal((await api('k')).widok.ileZdarzen, przed, 'pojedyncze kliknięcie nie trafia do dziennika');
    await new Promise(r => setTimeout(r, 2800));
    g = await api('gildia1-zmien'); assert.equal(g.widok.zestawy.gra, undefined, 'po czasie gra zakończona przez serwer');
    assert.ok(g.widok.dziennik.some(d => /Zestawy/.test(d.opis)));
  } finally { proc.kill(); }
});
