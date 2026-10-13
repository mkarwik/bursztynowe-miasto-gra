'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const E = require('../engine');
const N = require('../nadzor');
const cfg0 = JSON.parse(fs.readFileSync(__dirname + '/../config.default.json', 'utf8'));
const kopia = o => JSON.parse(JSON.stringify(o));
const T0 = Date.UTC(2026, 9, 17, 6, 40);          // 8:40 w Polsce
const minut = m => T0 + m * 60000;
const pusteOb = () => ({ gildie: {}, punkty: {}, urz: {}, start: T0, eksport: null });

test('nadzór: przed grą lista kontrolna', () => {
  const cfg = kopia(cfg0); cfg.ustawienia.pilnuj_godzin = true;
  const n = N.analiza(cfg, cfg.gildie.map(() => E.nowyStan(cfg)), [], pusteOb(), 8 * 60 + 20, T0 - 20 * 60000);
  assert.equal(n.faza, 'przed');
  const k = n.alerty.find(a => a.id === 'kontrola'); assert.match(k.tekst, /Hasło punktowych/); assert.match(k.tekst, /odpN/);
  assert.ok(n.alerty.some(a => a.id === 'przed-gildie'));
});

test('nadzór: cisza gildii, zły punkt martwy, punkt żywy bez wpisów, za szybka gildia', () => {
  const cfg = kopia(cfg0); cfg.ustawienia.pilnuj_godzin = true;
  const stany = cfg.gildie.map(() => E.nowyStan(cfg));
  const dz = [];
  const ob = pusteOb();
  // gildie 0..8 aktywne, gildia 9 nigdy
  for (let g = 0; g < 9; g++) ob.gildie[g] = minut(58);
  ob.gildie[3] = minut(10);                        // gildia 4 zamilkła
  ob.urz.k = { rola: 'kadra', t: minut(59) };
  // punkt martwy 0: 4 gildie źle, ta sama odpowiedź
  for (let g = 0; g < 4; g++) dz.push({ t: minut(20 + g), czas: '09:0' + g + ':00', g, kto: 'gildia', typ: 'martwy', pkt: 0, odp: '1343', ok: true, bledna: true, delta: 0, b: 50, wynik: 'Błędna' });
  dz.push({ t: minut(25), czas: '09:05:00', g: 5, kto: 'gildia', typ: 'martwy', pkt: 0, odp: 'odp1', ok: true, delta: 25, b: 75, wynik: 'ok' });
  // gildia 1 ma podejrzanie dużo
  stany[1].z = 2500;
  for (let g = 0; g < 9; g++) if (g !== 1) stany[g].z = 300;
  // Karczmarz (08:40–10:00) dostał jeden wpis na początku
  dz.push({ t: minut(5), czas: '08:45:00', g: 2, kto: 'punktowy', typ: 'zywy', pkt: 0, ile: 40, ok: true, delta: 40, b: 90, wynik: 'ok' });
  const n = N.analiza(cfg, stany, dz, ob, 9 * 60 + 40, minut(60));
  const id = x => n.alerty.find(a => a.id === x);
  assert.ok(id('g9-nigdy'), 'gildia, która się nie zalogowała');
  assert.ok(id('g3-cisza'), 'gildia bez kontaktu');
  assert.equal(id('m0').poziom, 'zle'); assert.match(id('m0').tekst, /1343/);
  assert.ok(id('z0-cisza'), 'punkt żywy bez wpisów');
  assert.ok(!id('z3-cisza'), 'punkt zamknięty o tej porze nie jest alarmem');
  assert.ok(id('g1-szybko'));
  assert.equal(n.alerty[0].poziom, 'zle', 'pilne na górze');
});

test('nadzór: przedziały godzin i krzywa', () => {
  assert.deepEqual(N.przedzial('08:40–10:00'), [520, 600]);
  assert.deepEqual(N.przedzial('10:05-11:20'), [605, 680]);
  assert.equal(N.przedzial(''), null);
  assert.equal(N.krzywa('zdobyty_sr', 0), 50);
  assert.ok(N.krzywa('zdobyty_sr', 30) > 190 && N.krzywa('zdobyty_sr', 30) < 330);
});
