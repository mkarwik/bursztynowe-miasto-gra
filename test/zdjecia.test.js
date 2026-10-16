'use strict';
// Zgłoszenia znajdziek ze zdjęciem: wysyłka przez gildię, sprawdzanie przez kadrę, powiadomienie, limity, reset.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const E = require('../engine');

const PORT = 4000 + Math.floor(Math.random() * 90);
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bmz-'));
const URL0 = 'http://127.0.0.1:' + PORT;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let proc;
const start = () => new Promise((ok, zle) => {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, HASLO_KADRY: 'k' } });
  proc.stdout.on('data', d => { if (String(d).includes('działa na porcie')) ok(); });
  proc.stderr.on('data', d => process.stderr.write(d)); proc.on('error', zle);
});
const stop = () => new Promise(ok => { proc.on('exit', ok); proc.kill(); });
const api = async (haslo, akcja) => (await fetch(URL0 + '/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ haslo, akcja }) })).json();
const zdj = (haslo, id) => fetch(URL0 + '/zdjecie', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ haslo, id }) });

test('silnik: znajdźka ze zdjęcia, Kantor, limit, działa po końcu gry', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.default.json'), 'utf8'));
  cfg.ustawienia.zdjecia_limit = 2; cfg.ustawienia.pilnuj_godzin = true;
  let st = E.nowyStan(cfg), r;
  r = E.akcja(cfg, st, { typ: 'znajdzka_foto' }, { min: 12 * 60 }); assert.ok(r.ok, 'po końcu gry kadra nadal zalicza'); assert.equal(r.delta, 15); st = r.st;
  st.bud.kantor = 1;
  r = E.akcja(cfg, st, { typ: 'znajdzka_foto' }, { min: 600 }); assert.equal(r.delta, 30); st = r.st; assert.equal(st.zf, 2);
  r = E.akcja(cfg, st, { typ: 'znajdzka_foto' }, { min: 600 }); assert.equal(r.ok, false, 'limit');
  assert.equal(E.widokGildii(cfg, [st], 0, 600).znajdzki.znalezione, 2);
});

test('serwer: punkt martwy przez zgłoszenie (tekst, zdjęcie), ocena kadry, znajdźki tylko kodem', async () => {
  await start();
  try {
    let g = await api('gildia1-zmien', { typ: 'zdjecie', rodzaj: 'znajdzka', tekst: 'znalazłem', foto: PNG }); assert.equal(g.komunikat.ok, false, 'znajdźki tylko kodem');
    g = await api('gildia1-zmien', { typ: 'znajdzka', kod: 'bursztyn2' }); assert.ok(g.komunikat.ok); assert.equal(g.widok.znajdzki.znalezione, 1);
    g = await api('gildia1-zmien', { typ: 'martwy', punkt: 0, odpowiedz: 'odp1' }); assert.ok(g.blad, 'bez zgłoszenia nie można');
    g = await api('gildia1-zmien', { typ: 'zdjecie', rodzaj: 'martwy', punkt: 0, tekst: '', foto: '' }); assert.equal(g.komunikat.ok, false, 'puste');
    // nawet poprawny tekst idzie do kadry (ocena ręczna)
    g = await api('gildia1-zmien', { typ: 'zdjecie', rodzaj: 'martwy', punkt: 0, tekst: ' ODP1 ' }); assert.ok(g.komunikat.ok); assert.equal(g.widok.martwe[0].czeka, true); assert.equal(g.widok.martwe[0].zaliczony, false);
    g = await api('gildia1-zmien', { typ: 'zdjecie', rodzaj: 'martwy', punkt: 0, tekst: 'odp1' }); assert.equal(g.komunikat.ok, false, 'już czeka');
    g = await api('gildia1-zmien', { typ: 'zdjecie', rodzaj: 'martwy', punkt: 1, tekst: 'chyba lew', foto: PNG }); assert.ok(g.komunikat.ok);
    g = await api('gildia1-zmien', { typ: 'zdjecie', rodzaj: 'martwy', punkt: 2, foto: 'data:text/html;base64,PHNjcmlwdD4=' }); assert.equal(g.komunikat.ok, false, 'tylko obrazy');
    for (const p of [2, 3, 4]) await api('gildia1-zmien', { typ: 'zdjecie', rodzaj: 'martwy', punkt: p, tekst: 'x' + p });
    g = await api('gildia1-zmien', { typ: 'zdjecie', rodzaj: 'martwy', punkt: 5, tekst: 'szóste' }); assert.equal(g.komunikat.ok, false, 'najwyżej 5 czekających');
    g = await api('gildia1-zmien', { typ: 'zgloszenie', id: 'x', decyzja: 'ok' }); assert.ok(g.blad, 'gildia nie decyduje');

    let k = await api('k'); const czeka = k.widok.zgloszenia.filter(z => z.stan === 'czeka');
    assert.equal(czeka.length, 5);
    const z0 = czeka.find(z => z.pkt === 0), z1 = czeka.find(z => z.pkt === 1);
    assert.equal(z0.odpowiedz, 'odp1', 'kadra widzi poprawną odpowiedź'); assert.equal(z1.gildia, 'Gildia 1');
    // zdjęcie tylko dla kadry
    assert.equal((await zdj('gildia1-zmien', z1.id)).status, 403);
    const rz = await zdj('k', z1.id); assert.equal(rz.status, 200); assert.equal(rz.headers.get('content-type'), 'image/png');
    assert.equal((await zdj('k', z0.id)).status, 404);
    k = await api('k', { typ: 'zgloszenie', id: z0.id, decyzja: 'ok' }); assert.ok(k.komunikat.ok, k.komunikat.tekst);
    k = await api('k', { typ: 'zgloszenie', id: z0.id, decyzja: 'ok' }); assert.equal(k.komunikat.ok, false, 'drugi raz nie');
    k = await api('k', { typ: 'zgloszenie', id: z1.id, decyzja: 'nie', powod: 'to nie lew' }); assert.ok(k.komunikat.ok);
    g = await api('gildia1-zmien');
    assert.equal(g.widok.martwe[0].zaliczony, true); assert.equal(g.widok.martwe[1].zostaloProb, 1); assert.equal(g.widok.martwe[1].czeka, false);
    assert.equal(g.widok.zgloszenia.find(z => z.pkt === 1).powod, 'to nie lew');
    assert.equal(g.widok.bursztyn, 50 + 15 + 25);
    // opcja automatycznego zaliczania zgodnego tekstu
    const c0 = (await api('k')).widok.konfiguracja; c0.ustawienia.martwy_auto = true; await api('k', { typ: 'zapisz_konfiguracje', konfiguracja: c0 });
    g = await api('gildia2-zmien', { typ: 'zdjecie', rodzaj: 'martwy', punkt: 6, tekst: 'odp7' }); assert.equal(g.widok.martwe[6].zaliczony, true);
    // trwałość po restarcie
    await stop(); await start();
    k = await api('k'); assert.equal(k.widok.zgloszenia.length, 5, 'automatyczne zaliczenie nie tworzy zgłoszenia');
    assert.equal((await zdj('k', z1.id)).status, 200);
    k = await api('k', { typ: 'usun_zdjecia' }); assert.ok(k.komunikat.ok);
    assert.equal((await zdj('k', z1.id)).status, 404);
    await api('gildia3-zmien', { typ: 'zdjecie', rodzaj: 'martwy', punkt: 0, foto: PNG });
    k = await api('k', { typ: 'reset', potwierdzenie: 'RESET' }); assert.ok(k.komunikat.ok); assert.equal(k.widok.zgloszenia.length, 0);
    const kopia = fs.readdirSync(DIR).find(f => f.startsWith('kopia-'));
    assert.equal(fs.readdirSync(path.join(DIR, kopia, 'zdjecia')).length, 1, 'zdjęcie trafia do kopii');
  } finally { await stop(); }
});
