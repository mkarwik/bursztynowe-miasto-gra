'use strict';
// Raport AI przez OpenAI: zapytanie idzie do atrapy serwera OpenAI, sprawdzamy treść i obsługę modeli bez rozumowania.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('node:child_process');
const fs = require('fs'), os = require('os'), path = require('path');

test('raport AI z kluczem OpenAI', async () => {
  const zapytania = [];
  let odrzucRozumowanie = true;
  const atrapa = http.createServer((req, res) => {
    let d = ''; req.on('data', c => d += c); req.on('end', () => {
      const b = JSON.parse(d); zapytania.push({ auth: req.headers.authorization, b });
      res.setHeader('content-type', 'application/json');
      if (b.reasoning_effort && odrzucRozumowanie) { res.statusCode = 400; return res.end(JSON.stringify({ error: { message: 'Unsupported parameter: reasoning_effort', param: 'reasoning_effort' } })); }
      res.end(JSON.stringify({ choices: [{ message: { content: 'STAN GRY\nWszystko idzie dobrze.' }, finish_reason: 'stop' }] }));
    });
  });
  await new Promise(ok => atrapa.listen(0, ok));
  const PORT = 4200 + Math.floor(Math.random() * 90);
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bmai-'));
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, HASLO_KADRY: 'k', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-4o', OPENAI_URL: 'http://127.0.0.1:' + atrapa.address().port + '/v1/chat/completions' } });
  await new Promise(ok => proc.stdout.on('data', d => { if (String(d).includes('działa na porcie')) ok(); }));
  const api = async akcja => (await fetch('http://127.0.0.1:' + PORT + '/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ haslo: 'k', akcja }) })).json();
  try {
    let k = await api(); assert.equal(k.widok.ai.jest, true); assert.equal(k.widok.ai.dostawca, 'openai'); assert.equal(k.widok.ai.model, 'gpt-4o');
    k = await api({ typ: 'ai' }); assert.ok(k.komunikat.ok);
    for (let i = 0; i < 50 && !(k.widok.ai.tekst || k.widok.ai.blad); i++) { await new Promise(r => setTimeout(r, 100)); k = await api(); }
    assert.equal(k.widok.ai.blad, ''); assert.match(k.widok.ai.tekst, /STAN GRY/);
    assert.equal(zapytania.length, 2, 'po odrzuceniu reasoning_effort drugie zapytanie bez niego');
    assert.equal(zapytania[0].auth, 'Bearer sk-test');
    assert.equal(zapytania[1].b.reasoning_effort, undefined); assert.ok(zapytania[1].b.max_completion_tokens > 0);
    assert.equal(zapytania[1].b.messages[0].role, 'system'); assert.match(zapytania[1].b.messages[0].content, /KTO JAK SOBIE RADZI/);
    const migawka = JSON.parse(zapytania[1].b.messages[1].content.replace(/^Migawka gry:\n/, ''));
    assert.equal(migawka.gildie.length, 10); assert.ok('flota' in migawka.gildie[0] && 'miejsce' in migawka.gildie[0]);
    assert.ok(!JSON.stringify(migawka).includes('gildia1-zmien'), 'bez haseł');
  } finally { proc.kill(); atrapa.close(); }
});
