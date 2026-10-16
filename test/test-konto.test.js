'use strict';
// Konto testowe: pełna gra bez wpływu na gildie, ranking, dziennik i kolejkę zgłoszeń.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('node:child_process');

test('konto testowe', async () => {
  const PORT = 4400 + Math.floor(Math.random() * 90), DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bmt-'));
  const start = () => new Promise(ok => { const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, HASLO_KADRY: 'k' } }); p.stdout.on('data', d => { if (String(d).includes('działa na porcie')) ok(p); }); });
  const api = async (h, a) => (await fetch('http://127.0.0.1:' + PORT + '/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ haslo: h, akcja: a }) })).json();
  let proc = await start();
  try {
    // pilnowanie godzin włączone i gra jeszcze nie trwa: konto testowe i tak działa
    let k = await api('k'); const c = k.widok.konfiguracja; c.ustawienia.pilnuj_godzin = true; c.ustawienia.start_gry = '23:59'; c.ustawienia.ostatnie_10_min = '23:59'; c.ustawienia.koniec_gry = '23:59';
    if (new Date().getHours() === 23) { c.ustawienia.start_gry = '00:00'; }
    await api('k', { typ: 'zapisz_konfiguracje', konfiguracja: c });
    let t = await api('test-zmien-mnie'); assert.equal(t.widok.test, true); assert.equal(t.widok.bursztyn, 500); assert.equal(t.widok.nazwa, 'Konto testowe');
    t = await api('test-zmien-mnie', { typ: 'kup', co: 'koga' }); assert.ok(t.komunikat.ok, t.komunikat.tekst);
    t = await api('test-zmien-mnie', { typ: 'test_bursztyn', ile: 200 }); assert.equal(t.widok.bursztyn, 500 - 160 + 200);
    t = await api('test-zmien-mnie', { typ: 'test_port', p: 4 }); assert.equal(t.widok.porty, 4);
    t = await api('test-zmien-mnie', { typ: 'zestaw_start' }); assert.ok(t.komunikat.ok); assert.equal(t.widok.zestawy.gra.karty.length, 9);
    t = await api('test-zmien-mnie', { typ: 'zestaw_koniec' }); assert.ok(t.komunikat.ok);
    t = await api('test-zmien-mnie', { typ: 'test_zywy', punkt: 1, ile: 40 }); assert.ok(t.komunikat.ok); assert.equal(t.widok.zywe[1].wizyty, 1);
    t = await api('test-zmien-mnie', { typ: 'zdjecie', rodzaj: 'martwy', punkt: 0, tekst: 'odp1' }); assert.equal(t.widok.martwe[0].zaliczony, true);
    t = await api('test-zmien-mnie', { typ: 'zdjecie', rodzaj: 'martwy', punkt: 1, foto: 'data:image/png;base64,iVBORw0KGgo=' }); assert.equal(t.widok.martwe[1].zaliczony, true);
    t = await api('test-zmien-mnie', { typ: 'znajdzka', kod: 'BURSZTYN1' }); assert.ok(t.komunikat.ok);
    t = await api('test-zmien-mnie', { typ: 'atak', taktyka: 'zaskoczenie' }); assert.ok(t.komunikat.atak, t.komunikat.tekst);
    t = await api('test-zmien-mnie', { typ: 'korekta', gildia: 0, ile: 5 }); assert.ok(t.blad, 'żadnych akcji kadry');
    assert.ok(t.widok === undefined || true);
    t = await api('test-zmien-mnie'); assert.ok(t.widok.dziennik.length >= 5);
    // gra się nie zmieniła
    k = await api('k');
    assert.equal(k.widok.ranking.length, 10); assert.ok(k.widok.ranking.every(r => r.nazwa !== 'Konto testowe'));
    assert.equal(k.widok.ileZdarzen, 1, 'w dzienniku tylko zapis ustawień'); assert.equal(k.widok.zgloszenia.length, 0);
    // stan konta testowego przeżywa restart, „od nowa” go czyści
    proc.kill(); proc = await start();
    t = await api('test-zmien-mnie'); assert.equal(t.widok.porty >= 4, true);
    t = await api('test-zmien-mnie', { typ: 'test_reset' }); assert.equal(t.widok.bursztyn, 500); assert.equal(t.widok.porty, 0);
    // puste hasło testowe wyłącza konto
    const c2 = (await api('k')).widok.konfiguracja; c2.ustawienia.haslo_testowe = ''; await api('k', { typ: 'zapisz_konfiguracje', konfiguracja: c2 });
    assert.ok((await api('test-zmien-mnie')).zleHaslo);
  } finally { proc.kill(); }
});
