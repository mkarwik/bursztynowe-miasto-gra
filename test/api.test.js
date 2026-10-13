'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const PORT = 3900 + Math.floor(Math.random() * 90);
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-'));
let proc;
function start() {
  return new Promise((ok, zle) => {
    proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, HASLO_KADRY: 'tajne-kadry' } });
    proc.stdout.on('data', d => { if (String(d).includes('działa na porcie')) ok(); });
    proc.stderr.on('data', d => process.stderr.write(d));
    proc.on('error', zle);
  });
}
const stop = () => new Promise(ok => { proc.on('exit', ok); proc.kill(); });
const api = async (haslo, akcja) => (await fetch('http://127.0.0.1:' + PORT + '/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ haslo, akcja }) })).json();

test('serwer: role, akcje, dziennik, trwałość po restarcie', async () => {
  await start();
  try {
    assert.ok((await api('zle haslo')).zleHaslo);
    let g = await api('gildia1-zmien'); assert.equal(g.widok.rola, 'gildia'); assert.equal(g.widok.bursztyn, 50); assert.equal(g.widok.nazwa, 'Gildia 1');
    g = await api('gildia1-zmien', { typ: 'kup', co: 'sznika' }); assert.ok(g.komunikat.ok); assert.equal(g.widok.bursztyn, 20); assert.equal(g.widok.zwrot, 4);
    g = await api('gildia1-zmien', { typ: 'kup', co: 'holk' }); assert.equal(g.komunikat.ok, false); assert.equal(g.widok.bursztyn, 20);
    g = await api('gildia1-zmien', { typ: 'zywy', gildia: 0, punkt: 0 }); assert.ok(g.blad, 'gildia nie może zaliczać punktów żywych');
    g = await api('gildia1-zmien', { typ: 'korekta', gildia: 0, ile: 999 }); assert.ok(g.blad, 'gildia nie może robić korekt');
    g = await api('gildia1-zmien', { typ: 'atak', taktyka: 'zaskoczenie' }); assert.ok(g.komunikat.atak); assert.equal(g.komunikat.kosci.length, 2);
    const poAtaku = g.widok.porty;                                    // Zwrotność 4 + rzut >= 7: wygrana przy 3+
    assert.ok(poAtaku === 0 || poAtaku === 1);
    let p = await api('punkt-zmien-mnie'); assert.equal(p.widok.rola, 'punktowy'); assert.equal(p.widok.gildie.length, 10);
    p = await api('punkt-zmien-mnie', { typ: 'zywy', gildia: 1, punkt: 2, ile: 99 }); assert.equal(p.komunikat.ok, false);
    p = await api('punkt-zmien-mnie', { typ: 'zywy', gildia: 1, punkt: 2, ile: 55 }); assert.ok(p.komunikat.ok); assert.equal(p.widok.gildie[1].wizyty[2], 1);
    assert.ok(p.widok.gildie[1].znowuOd[2], 'po wizycie widać godzinę kolejnej');
    p = await api('punkt-zmien-mnie', { typ: 'zywy', gildia: 1, punkt: 2, ile: 55 }); assert.equal(p.komunikat.ok, false, 'druga wizyta od razu jest odrzucona');
    p = await api('punkt-zmien-mnie', { typ: 'zywy', gildia: 1, punkt: 3, ile: 0 }); assert.ok(p.komunikat.ok);
    p = await api('punkt-zmien-mnie', { typ: 'kup', co: 'sznika' }); assert.ok(p.blad);
    let g2 = await api('gildia2-zmien'); assert.equal(g2.widok.bursztyn, 105); assert.equal(g2.widok.zywe[2].wizyty, 1);
    assert.ok(!JSON.stringify(g2.widok).includes('gildia1-zmien'));
    let k = await api('tajne-kadry'); assert.equal(k.widok.rola, 'kadra'); assert.equal(k.widok.ranking.length, 10); assert.ok(k.widok.dziennik.length >= 5);
    k = await api('tajne-kadry', { typ: 'korekta', gildia: 2, ile: -20, powod: 'test' }); assert.ok(k.komunikat.ok);
    assert.equal(k.widok.ranking.find(r => r.i === 2).bursztyn, 30);
    k = await api('tajne-kadry', { typ: 'edytuj', gildia: 5, stan: { s: { koga: 2 }, bud: { latarnia: true }, p: 4 } }); assert.ok(k.komunikat.ok);
    assert.equal(k.widok.stany[5].s.koga, 2); assert.equal(k.widok.ranking[0].i, 5);
    let g6 = await api('gildia6-zmien'); assert.equal(g6.widok.porty, 4); assert.equal(g6.widok.zasieg, 16); assert.equal(g6.widok.budowle.find(b => b.id === 'latarnia').ma, true);
    assert.ok((await api('gildia6-zmien', { typ: 'edytuj', gildia: 5, stan: { b: 9999 } })).blad);
    const c = k.widok.konfiguracja; c.statki[0].cena = 33; c.gildie[4].nazwa = 'Bursztynnicy';
    k = await api('tajne-kadry', { typ: 'zapisz_konfiguracje', konfiguracja: c }); assert.ok(k.komunikat.ok);
    g = await api('gildia1-zmien'); assert.equal(g.widok.statki[0].cena, 33);
    c.gildie[0].haslo = 'tajne-kadry'; k = await api('tajne-kadry', { typ: 'zapisz_konfiguracje', konfiguracja: c }); assert.equal(k.komunikat.ok, false);
    k = await api('tajne-kadry', { typ: 'reset', potwierdzenie: 'nie' }); assert.equal(k.komunikat.ok, false);
    const csv = await (await fetch('http://127.0.0.1:' + PORT + '/eksport.csv?haslo=tajne-kadry')).text(); assert.ok(csv.includes('Zakup: Sznika'));
    assert.equal((await fetch('http://127.0.0.1:' + PORT + '/eksport.json?haslo=gildia1-zmien')).status, 403);
    assert.equal((await fetch('http://127.0.0.1:' + PORT + '/')).status, 200);
    assert.equal((await (await fetch('http://127.0.0.1:' + PORT + '/zdrowie')).json()).ok, true);
    const przed = (await api('tajne-kadry')).widok;
    await stop(); await start();                                         // restart: wszystko ma zostać
    const po = (await api('tajne-kadry')).widok;
    assert.deepEqual(po.ranking, przed.ranking); assert.equal(po.ileZdarzen, przed.ileZdarzen); assert.equal(po.konfiguracja.gildie[4].nazwa, 'Bursztynnicy');
    g = await api('gildia1-zmien'); assert.equal(g.widok.porty, poAtaku); assert.equal(g.widok.dziennik.length, 3);
    k = await api('tajne-kadry', { typ: 'reset', potwierdzenie: 'RESET' }); assert.ok(k.komunikat.ok);
    g = await api('gildia1-zmien'); assert.equal(g.widok.bursztyn, 50); assert.equal(g.widok.dziennik.length, 0);
    assert.ok(fs.readdirSync(DIR).some(f => f.startsWith('kopia-')));
    for (let i = 0; i < 12; i++) await api('zgaduje' + i);               // hamowanie zgadywania
    assert.equal((await fetch('http://127.0.0.1:' + PORT + '/api', { method: 'POST', body: '{}' })).status, 429);
  } finally { await stop(); fs.rmSync(DIR, { recursive: true, force: true }); }
});
