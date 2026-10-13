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

test('serwer: zgłoszenie ze zdjęciem od wysyłki do decyzji', async () => {
  await start();
  try {
    let g = await api('gildia1-zmien', { typ: 'zdjecie', tekst: 'znajdźka', foto: PNG }); assert.equal(g.komunikat.ok, false, 'domyślnie znajdźki tylko kodem');
    g = await api('gildia1-zmien', { typ: 'znajdzka', kod: 'bursztyn2' }); assert.ok(g.komunikat.ok, 'kod działa');
    const c0 = (await api('k')).widok.konfiguracja; c0.ustawienia.zdjecia = true; await api('k', { typ: 'zapisz_konfiguracje', konfiguracja: c0 });
    g = await api('gildia1-zmien', { typ: 'zdjecie', tekst: '', foto: '' }); assert.equal(g.komunikat.ok, false, 'puste zgłoszenie');
    g = await api('gildia1-zmien', { typ: 'zdjecie', tekst: 'Tabliczka pod Żurawiem', foto: PNG }); assert.ok(g.komunikat.ok);
    g = await api('gildia1-zmien', { typ: 'zdjecie', tekst: 'Sam opis bez zdjęcia' }); assert.ok(g.komunikat.ok);
    g = await api('gildia1-zmien', { typ: 'zdjecie', foto: 'data:text/html;base64,PHNjcmlwdD4=' }); assert.equal(g.komunikat.ok, false, 'tylko obrazy');
    assert.equal(g.widok.zgloszenia.length, 2); assert.ok(g.widok.zgloszenia.every(z => z.stan === 'czeka'));
    await api('gildia1-zmien', { typ: 'zdjecie', tekst: 'trzecie' });
    // punkt martwy: zgodna odpowiedź zalicza się od razu, inna czeka na kadrę, drugi raz na ten sam punkt nie
    g = await api('gildia1-zmien', { typ: 'zdjecie', rodzaj: 'martwy', punkt: 0, tekst: ' ODP1 ' }); assert.ok(g.komunikat.ok); assert.equal(g.widok.martwe[0].zaliczony, true);
    g = await api('gildia1-zmien', { typ: 'zdjecie', rodzaj: 'martwy', punkt: 1, tekst: 'chyba lew' }); assert.ok(g.komunikat.ok); assert.equal(g.widok.martwe[1].czeka, true);
    g = await api('gildia1-zmien', { typ: 'zdjecie', rodzaj: 'martwy', punkt: 1, tekst: 'odp2' }); assert.equal(g.komunikat.ok, false, 'czeka już');
    await api('gildia1-zmien', { typ: 'zdjecie', rodzaj: 'martwy', punkt: 2, foto: PNG });
    g = await api('gildia1-zmien', { typ: 'zdjecie', tekst: 'szóste' }); assert.equal(g.komunikat.ok, false, 'najwyżej 5 czekających');
    let km = (await api('k')).widok.zgloszenia.filter(z => z.rodzaj === 'martwy' && z.stan === 'czeka');
    assert.equal(km.length, 2); assert.equal(km[0].odpowiedz, 'odp2', 'kadra widzi poprawną odpowiedź');
    let r = await api('k', { typ: 'zgloszenie', id: km[0].id, decyzja: 'nie', powod: 'to nie lew' }); assert.ok(r.komunikat.ok);
    r = await api('k', { typ: 'zgloszenie', id: km[1].id, decyzja: 'ok' }); assert.ok(r.komunikat.ok);
    g = await api('gildia1-zmien'); assert.equal(g.widok.martwe[1].zostaloProb, 1); assert.equal(g.widok.martwe[1].czeka, false); assert.equal(g.widok.martwe[2].zaliczony, true);
    assert.equal(g.widok.zgloszenia.find(z => z.rodzaj === 'martwy' && z.pkt === 1).powod, 'to nie lew');
    // gildia nie może sama zaliczać
    g = await api('gildia1-zmien', { typ: 'zgloszenie', id: 'x', decyzja: 'ok' }); assert.ok(g.blad);

    let k = await api('k'); const czeka = k.widok.zgloszenia.filter(z => z.stan === 'czeka' && z.rodzaj === 'znajdzka');
    assert.equal(czeka.length, 3);
    const zFoto = czeka.find(z => z.zdjecie), zTekst = czeka.find(z => z.tekst === 'Sam opis bez zdjęcia');
    assert.equal(zFoto.gildia, 'Gildia 1');
    // zdjęcie tylko dla kadry
    assert.equal((await zdj('gildia1-zmien', zFoto.id)).status, 403);
    const rz = await zdj('k', zFoto.id); assert.equal(rz.status, 200); assert.equal(rz.headers.get('content-type'), 'image/png');
    assert.ok((await rz.arrayBuffer()).byteLength > 50);
    assert.equal((await zdj('k', zTekst.id)).status, 404);
    // nadzór widzi kolejkę (alert dopiero po 4 min, więc tu tylko liczba)
    assert.ok(Array.isArray(k.widok.nadzor.alerty));

    k = await api('k', { typ: 'zgloszenie', id: zFoto.id, decyzja: 'ok' }); assert.ok(k.komunikat.ok, k.komunikat.tekst);
    k = await api('k', { typ: 'zgloszenie', id: zFoto.id, decyzja: 'ok' }); assert.equal(k.komunikat.ok, false, 'drugi raz nie');
    k = await api('k', { typ: 'zgloszenie', id: zTekst.id, decyzja: 'nie', powod: 'Nie widać tabliczki' }); assert.ok(k.komunikat.ok);
    g = await api('gildia1-zmien');
    assert.equal(g.widok.znajdzki.znalezione, 2);
    const ok = g.widok.zgloszenia.find(z => z.id === zFoto.id), nie = g.widok.zgloszenia.find(z => z.id === zTekst.id);
    assert.equal(ok.stan, 'ok'); assert.equal(ok.delta, 15); assert.equal(nie.stan, 'nie'); assert.equal(nie.powod, 'Nie widać tabliczki');
    assert.ok(g.widok.dziennik.some(d => /Znajdźka ze zdjęcia zaliczona/.test(d.wynik)));

    // trwałość po restarcie
    await stop(); await start();
    k = await api('k'); assert.equal(k.widok.zgloszenia.length, 5, 'zgodna odpowiedź nie tworzy zgłoszenia');
    assert.equal((await zdj('k', zFoto.id)).status, 200);
    // usunięcie zdjęć
    k = await api('k', { typ: 'usun_zdjecia' }); assert.ok(k.komunikat.ok);
    assert.equal((await zdj('k', zFoto.id)).status, 404);
    assert.equal(fs.readdirSync(path.join(DIR, 'zdjecia')).length, 0);
    // reset czyści zgłoszenia
    await api('gildia2-zmien', { typ: 'zdjecie', tekst: 'po resecie zniknie', foto: PNG });
    k = await api('k', { typ: 'reset', potwierdzenie: 'RESET' }); assert.ok(k.komunikat.ok);
    assert.equal(k.widok.zgloszenia.length, 0);
    const kopia = fs.readdirSync(DIR).find(f => f.startsWith('kopia-'));
    assert.equal(fs.readdirSync(path.join(DIR, kopia, 'zdjecia')).length, 1, 'zdjęcie trafia do kopii');
  } finally { await stop(); }
});
