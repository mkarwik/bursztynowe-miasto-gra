'use strict';
// Zestawy (na wzór gry SET). 27 kart: 3 cechy po 3 wartości (kolor, kształt, liczba).
// Karta to liczba 0..26, cechy to jej cyfry w systemie trójkowym.
// Zestaw: trzy karty, w których każda cecha jest na wszystkich taka sama albo na każdej inna.

const cechy = k => [k % 3, Math.floor(k / 3) % 3, Math.floor(k / 9) % 3];   // [kolor, kształt, liczba-1]

function czyZestaw(a, b, c) {
  if (a === b || b === c || a === c) return false;
  const A = cechy(a), B = cechy(b), C = cechy(c);
  for (let i = 0; i < 3; i++) if ((A[i] + B[i] + C[i]) % 3 !== 0) return false;
  return true;
}

// Wszystkie zestawy w układzie, jako trójki indeksów (rosnąco).
function zestawyWUkladzie(karty) {
  const o = [];
  for (let i = 0; i < karty.length; i++) for (let j = i + 1; j < karty.length; j++) for (let k = j + 1; k < karty.length; k++)
    if (czyZestaw(karty[i], karty[j], karty[k])) o.push([i, j, k]);
  return o;
}

// Losowy układ `ile` kart z liczbą zestawów od `od` do `do_` (domyślnie 3–5: zestaw łatwo wypatrzyć, a nie jest za prosto).
function nowyUklad(los, ile, od, do_) {
  los = los || Math.random; ile = ile || 9; od = od || 3; do_ = do_ || (arguments.length >= 3 ? od : 5);
  for (let proba = 0; proba < 5000; proba++) {
    const talia = Array.from({ length: 27 }, (_, i) => i);
    for (let i = talia.length - 1; i > 0; i--) { const j = Math.floor(los() * (i + 1)); [talia[i], talia[j]] = [talia[j], talia[i]]; }
    const karty = talia.slice(0, ile);
    const n = zestawyWUkladzie(karty).length; if (n >= od && n <= do_) return karty;
  }
  throw new Error('Nie udało się ułożyć kart.');
}

const klucz = t => t.slice().sort((x, y) => x - y).join(',');

// Po znalezieniu zestawu: karty z miejsc `idx` znikają, wchodzą nowe tak, żeby na planszy był co najmniej jeden zestaw
// (najchętniej 3–5, potem co najmniej 2, w ostateczności 1). Zwraca nową planszę.
function uzupelnij(karty, idx, los) {
  los = los || Math.random;
  const usuwane = new Set(idx.map(i => karty[i]));
  const pula = []; for (let k = 0; k < 27; k++) if (!karty.includes(k) && !usuwane.has(k)) pula.push(k);
  const trojki = [];
  for (let a = 0; a < pula.length; a++) for (let b = a + 1; b < pula.length; b++) for (let c = b + 1; c < pula.length; c++) trojki.push([pula[a], pula[b], pula[c]]);
  for (let i = trojki.length - 1; i > 0; i--) { const j = Math.floor(los() * (i + 1)); [trojki[i], trojki[j]] = [trojki[j], trojki[i]]; }
  let zapas2 = null, zapas1 = null;
  for (const t of trojki) {
    const nowa = karty.slice(); idx.forEach((i, n) => { nowa[i] = t[n]; });
    const ile = zestawyWUkladzie(nowa).length;
    if (ile >= 3 && ile <= 5) return nowa;
    if (ile >= 2 && !zapas2) zapas2 = nowa;
    if (ile >= 1 && !zapas1) zapas1 = nowa;
  }
  return zapas2 || zapas1 || nowyUklad(los, karty.length, 3, 5);
}

module.exports = { cechy, czyZestaw, zestawyWUkladzie, nowyUklad, uzupelnij, klucz };
