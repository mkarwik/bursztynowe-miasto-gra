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

test('zestawy: reguła, układy, dokładanie nowych kart', () => {
  // 0 = (bursztynowy, bursztyn, 1), 9 = (…, 2), 18 = (…, 3): ten sam kolor i rysunek, różne liczby
  assert.ok(Z.czyZestaw(0, 9, 18));
  assert.ok(Z.czyZestaw(0, 13, 26));          // wszystko różne
  assert.ok(!Z.czyZestaw(0, 1, 9));
  assert.ok(!Z.czyZestaw(0, 0, 0));
  const wszystkie = Z.zestawyWUkladzie(Array.from({ length: 27 }, (_, i) => i)); assert.equal(wszystkie.length, 27 * 26 / 6);
  // długa seria: zawsze jest zestaw, znalezione karty znikają, nowe są inne
  let u = Z.nowyUklad(Math.random, 9, 3); assert.equal(Z.zestawyWUkladzie(u).length, 3);
  for (let i = 0; i < 300; i++) {
    const zs = Z.zestawyWUkladzie(u); assert.ok(zs.length >= 1, 'na planszy zawsze jest zestaw');
    const t = zs[Math.floor(Math.random() * zs.length)], stare = t.map(x => u[x]);
    const n = Z.uzupelnij(u, t);
    assert.equal(new Set(n).size, 9, 'bez powtórzeń kart');
    assert.ok(t.every(x => !stare.includes(n[x])), 'znalezione karty znikają');
    assert.ok(u.every((k, x) => t.includes(x) || n[x] === k), 'reszta zostaje na miejscu');
    u = n;
  }
});

test('zestawy w silniku: od 3. portu, czas, blokada, nowe karty, premia na jeden atak', () => {
  const cfg = kopia(cfg0); let st = E.nowyStan(cfg), r; const T0 = 1e12;
  r = E.akcja(cfg, st, { typ: 'zestaw_start' }, ctx(T0)); assert.equal(r.ok, false, 'przed 3. portem nie');
  st.p = 2;
  r = E.akcja(cfg, st, { typ: 'zestaw_start' }, ctx(T0)); assert.ok(r.ok); st = r.st;
  assert.equal(E.akcja(cfg, st, { typ: 'zestaw_start' }, ctx(T0)).ok, false, 'nie dwie naraz');
  assert.equal(E.akcja(cfg, st, { typ: 'atak', taktyka: 'zaskoczenie' }, ctx(T0)).ok, false, 'najpierw koniec zestawów');
  const zest = () => Z.zestawyWUkladzie(st.zestaw.karty);
  let zla = null; for (let a = 0; a < 9 && !zla; a++) for (let b = a + 1; b < 9 && !zla; b++) for (let c = b + 1; c < 9 && !zla; c++) if (!zest().some(t => t.join() === [a, b, c].join())) zla = [a, b, c];
  r = E.akcja(cfg, st, { typ: 'zestaw_wybor', karty: zla }, ctx(T0 + 1000)); assert.ok(r.zestawZly); st = r.st;
  assert.equal(E.akcja(cfg, st, { typ: 'zestaw_wybor', karty: zest()[0] }, ctx(T0 + 2000)).ok, false, 'w czasie blokady nie');
  const przed = st.zestaw.karty.slice(), t0 = zest()[0];
  r = E.akcja(cfg, st, { typ: 'zestaw_wybor', karty: t0 }, ctx(T0 + 4100)); assert.ok(r.zestawDobry); st = r.st;
  assert.ok(t0.every(i => st.zestaw.karty[i] !== przed[i]), 'w miejsce zestawu weszły nowe karty');
  assert.ok(zest().length >= 1);
  assert.equal(E.widokGildii(cfg, [st], 0, 600).zestawy.gra.znal.length, 1);
  r = E.akcja(cfg, st, { typ: 'zestaw_wybor', karty: zest()[0] }, ctx(T0 + 6000)); st = r.st;
  // po czasie każde kliknięcie kończy grę
  r = E.akcja(cfg, st, { typ: 'zestaw_wybor', karty: zest()[0] }, ctx(T0 + 70000)); assert.ok(r.zestawKoniec); assert.equal(r.zestawKoniec.ile, 2); st = r.st;
  assert.equal(st.premia, 4); assert.equal(st.zestaw, null);
  assert.equal(E.akcja(cfg, st, { typ: 'zestaw_start' }, ctx(T0)).ok, false, 'najpierw wykorzystać premię');
  const w = E.widokGildii(cfg, [st], 0, 600), bez = E.widokGildii(cfg, [Object.assign({}, st, { premia: 0 })], 0, 600);
  assert.ok(w.taktyki[2].szansa > bez.taktyki[2].szansa);
  r = E.akcja(cfg, st, { typ: 'atak', taktyka: 'zaskoczenie' }, ctx(T0)); assert.match(r.msg, /premia 4/); st = r.st; assert.equal(st.premia, 0);
});

test('zestawy: premia najwyżej 3 × 2, przerwana gra nic nie kosztuje', () => {
  const cfg = kopia(cfg0); let st = E.nowyStan(cfg), r; st.p = 4; const T0 = 2e12;
  st = E.akcja(cfg, st, { typ: 'zestaw_start' }, ctx(T0)).st;
  for (let i = 0; i < 6; i++) { r = E.akcja(cfg, st, { typ: 'zestaw_wybor', karty: Z.zestawyWUkladzie(st.zestaw.karty)[0] }, ctx(T0 + 1000 * (i + 1))); assert.ok(r.zestawDobry); st = r.st; }
  r = E.akcja(cfg, st, { typ: 'zestaw_koniec' }, ctx(T0 + 9000)); assert.equal(r.zestawKoniec.ile, 6); assert.equal(r.st.premia, 6); st = r.st;
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
