# Bursztynowe Miasto

Aplikacja do gry ekonomicznej: jedna strona dla gildii, punktowych i kadry. Każdy wchodzi pod ten sam adres i wpisuje swoje hasło.

Bez zewnętrznych bibliotek. Wymaga tylko Node 20 lub nowszego. Dane leżą w plikach w jednym katalogu.

## Wdrożenie w Coolify

1. Wgraj ten katalog do repozytorium na GitHubie.
2. W Coolify dodaj nową aplikację z tego repozytorium. Sposób budowania: **Dockerfile** (jest w głównym katalogu).
3. Port aplikacji: **3000**.
4. Dodaj zmienną środowiskową **HASLO_KADRY** z hasłem dla kadry. Bez niej działa hasło domyślne `kadra-zmien-mnie`, a aplikacja pokazuje ostrzeżenie.
5. Dodaj trwały katalog (persistent storage, volume) zamontowany w kontenerze pod ścieżką **/data**. Bez tego każdy restart kasuje postęp gry.
6. Ustaw domenę i wdróż.
7. Sprawdź adres `/zdrowie`. Powinien zwrócić `{"ok":true,...}`.

Opcjonalne zmienne: `PORT` (domyślnie 3000), `DATA_DIR` (domyślnie /data w kontenerze), `STREFA` (domyślnie Europe/Warsaw).

### Znajdźki ze zdjęciem

Gildia może potwierdzić znajdźkę zdjęciem, opisem albo jednym i drugim (zakładka Punkty). Telefon zmniejsza zdjęcie do ok. 1280 px przed wysłaniem. Kadra sprawdza zgłoszenia w zakładce **Zdjęcia**: „Zalicz” dolicza nagrodę za znajdźkę (z Kantorem większą), „Odrzuć” wysyła gildii powód. Gildia dostaje powiadomienie w ciągu kilku sekund. Kody z kartek działają dalej obok.

Ustawienia: `zdjecia` (włącza zgłoszenia), `zdjecia_limit` (ile znajdziek ze zdjęć może mieć jedna gildia, 0 bez limitu). Jedna gildia może mieć naraz najwyżej 3 zgłoszenia czekające. Zdjęcia leżą w `/data/zdjecia`, kadra usuwa je jednym przyciskiem w zakładce Gra. Nadzór ostrzega, gdy zgłoszenie czeka dłużej niż 4 minuty.

### Nadzór i analiza AI

Zakładka **Nadzór** w widoku kadry działa bez żadnych ustawień. Reguły sprawdzają na bieżąco: gildie bez kontaktu, gildie w tyle albo podejrzanie szybkie, długi dług, serie porażek, punkty martwe z dużą liczbą złych odpowiedzi (z najczęstszą złą odpowiedzią), błędne kody znajdziek, punkty żywe, które dawno nic nie wpisały, różnice w ocenianiu i tempo całej gry w porównaniu z symulacją. Przed grą pokazuje listę rzeczy do uzupełnienia.

Podsumowanie AI jest opcjonalne. W Coolify dodaj zmienną **ANTHROPIC_API_KEY** z kluczem z console.anthropic.com. Wtedy w Nadzorze pojawia się „Ocena AI”: na przycisk i automatycznie co `AI_CO_MIN` minut w trakcie gry (domyślnie 15, 0 wyłącza; działa przy `pilnuj_godzin` na „tak”). Model ustawia `ANTHROPIC_MODEL` (domyślnie `claude-sonnet-5-5`). Do AI trafia stan gry i ostatnie wpisy dziennika, bez haseł.

Informacje, kto był w aplikacji, serwer trzyma tylko w pamięci, więc po restarcie liczą się od nowa.

## Pierwsze uruchomienie

1. Wejdź na stronę i zaloguj się hasłem kadry.
2. Zakładka **Cennik**:
   - **Gildie i hasła**: nazwy gildii i hasło dla każdej. Hasła muszą być różne. Przyciski „Dodaj wiersz” i „Usuń ostatni” zmieniają liczbę gildii.
   - **Ustawienia**: `haslo_punktowych`, godziny gry, zakres oceny punktu żywego (`zywy_min`, `zywy_max`), ile razy gildia może przyjść na ten sam punkt żywy (`zywy_wizyty`, 0 oznacza bez limitu) i po ilu minutach najwcześniej (`zywy_przerwa_min`). `ukryj_ranking_min` ustawia, na ile minut przed końcem gildie przestają widzieć ranking (0 wyłącza). Działa tylko przy `pilnuj_godzin` na „tak”; kadra widzi ranking zawsze.
   - **Punkty martwe**: nazwa, pytanie (pokazuje się gildiom), poprawna odpowiedź i nagroda, osobno dla każdego punktu.
   - **Punkty żywe**: nazwy. Punkty nie mają godzin: punktowy zalicza zadanie wtedy, kiedy gildia przyjdzie.
   - **Kody znajdziek**: jeden kod w wierszu.
3. Zrób próbę: zaloguj się jako gildia i jako punktowy, kup coś, zaatakuj, zalicz punkt.
4. Przed grą: w **Ustawieniach** przestaw `pilnuj_godzin` na „tak”, a w zakładce **Gra** wyzeruj grę (słowo RESET).

Wielkość liter i polskie znaki w odpowiedziach oraz kodach nie mają znaczenia.

## Role

| Hasło | Co widzi |
| --- | --- |
| hasło gildii | swój skarbiec, flotę, zakupy, atak na port, punkty, dziennik, ranking |
| hasło punktowych | lista gildii i pole na ocenę zadania (liczba bursztynów z ustalonego zakresu) dla wybranego punktu żywego |
| hasło kadry | ranking ze szczegółami, pełny dziennik, poprawki (korekta bursztynu i edycja gildii), cennik, eksport, wyzerowanie gry |

## W trakcie gry

- **Pomyłka punktowego albo reklamacja:** zakładka Poprawki. Korekta bursztynu: liczba dodatnia dodaje, ujemna odejmuje.
- **Awaria albo większa pomyłka:** zakładka Poprawki, część „Edycja gildii”. Można ustawić bursztyn, liczbę portów, statki, budowle, zaliczone punkty i znajdźki. Każda zmiana trafia do dziennika.
- **Kopia zapasowa:** zakładka Gra, eksport dziennika (CSV) i pełnego stanu (JSON). Warto pobrać raz w połowie gry i raz na koniec.
- **Zmiana ceny lub odpowiedzi:** zakładka Cennik. Działa od razu po zapisaniu.

## Pliki danych

W katalogu danych: `config.json` (cennik i hasła, powstaje po pierwszym zapisie w Cenniku), `state.json` (stan gildii), `dziennik.jsonl` (wszystkie zdarzenia, jedno w wierszu), `zgloszenia.json` i katalog `zdjecia/` (znajdźki ze zdjęciem). Wyzerowanie gry zapisuje poprzedni stan w podkatalogu `kopia-...`.

## Uruchomienie lokalne i testy

```
HASLO_KADRY=moje-haslo node server.js      # http://localhost:3000
npm test                                    # zasady gry i serwer
```

Testy obejmują zasady (scenariusze, odmowy, godziny, 400 losowych gier) oraz serwer (role, akcje, trwałość po restarcie, eksport, wyzerowanie).

## Zasady w kodzie

Wszystkie zasady są w `engine.js`. Liczby (ceny, obrona portów, nagrody) są w `config.default.json` i w zakładce Cennik.
