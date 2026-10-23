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

### Punkty martwe i znajdźki

Znajdźki zalicza się kodem z kartki (od razu). Punkt martwy: gildia wysyła odpowiedź tekstem, zdjęciem albo jednym i drugim, a kadra sprawdza zgłoszenie w zakładce **Zgłoszenia** (widzi pytanie i poprawną odpowiedź). „Zalicz” dolicza nagrodę z bonusami, „Odrzuć” zużywa jedną z prób i wysyła gildii powód. Gildia dostaje powiadomienie w ciągu kilku sekund. Ustawienie `martwy_auto` na „tak” zalicza od razu tekst zgodny z odpowiedzią (mniej pracy dla kadry). Zdjęcia leżą w `/data/zdjecia`, kadra usuwa je jednym przyciskiem w zakładce Gra. Nadzór ostrzega, gdy zgłoszenie czeka dłużej niż 4 minuty.

### Set (premia do ataku)

Minigra na wzór SET, grana przy ataku. Od portu `zestawy_od_portu` (3), gdy gildia wybierze taktykę, okno ataku proponuje „Gramy w Seta, potem atak” albo „Atakujemy od razu”. Plansza ma 8 kart i na start 2–4 sety; znaleziony set znika i wchodzą nowe karty, tak żeby zawsze był co najmniej jeden set (prawie zawsze dwa). Czas `zestawy_czas_s` (60 s), zła trójka to `zestawy_kara_s` (3 s) blokady. Każdy set daje `zestawy_premia` (+2) do tego ataku, liczy się najwyżej `zestawy_max` (3). Po czasie albo „Kończymy” od razu następuje rzut kośćmi z premią; gdy telefon zamknięto w trakcie, serwer kończy grę i wykonuje atak sam. Czas, blokadę i premię liczy serwer. W aplikacji jest objaśnienie z przykładami i trening bez punktów. Obrona portów 3–10 jest wyższa o 4, żeby premia nie rozregulowała balansu.

### Ranking

Domyślnie ranking widzi tylko kadra (`ranking_dla_gildii` na „nie”). Po włączeniu gildie widzą ranking i miejsce, a `ukryj_ranking_min` chowa je na ostatnie minuty gry.

Przycisk **„Przywróć domyślny cennik”** (zakładka Cennik) wczytuje statki, budowle, porty i liczby z nowej wersji aplikacji, zostawiając gildie, hasła, punkty, kody i godziny.

### Konto testowe

Hasło z ustawienia `haslo_testowe` (domyślnie `test-zmien-mnie`) otwiera osobne konto do prób: 500 bursztynu na start, działa o każdej porze, nie trafia do rankingu, dziennika ani kolejki zgłoszeń. Na górze ma przyciski: +200 bursztynu, wybór następnego portu, zaliczenie punktu żywego i „Od nowa”. Punkty martwe sprawdzają się tam same. Puste hasło wyłącza konto.

### Nadzór i analiza AI

Zakładka **Nadzór** w widoku kadry działa bez żadnych ustawień. Reguły sprawdzają na bieżąco: gildie bez kontaktu, gildie w tyle albo podejrzanie szybkie, długi dług, serie porażek, punkty martwe z dużą liczbą złych odpowiedzi (z najczęstszą złą odpowiedzią), błędne kody znajdziek, punkty żywe, które dawno nic nie wpisały, różnice w ocenianiu i tempo całej gry w porównaniu z symulacją. Przed grą pokazuje listę rzeczy do uzupełnienia.

Raport AI jest opcjonalny. W Coolify dodaj zmienną **OPENAI_API_KEY** (klucz z platform.openai.com) albo **ANTHROPIC_API_KEY** (console.anthropic.com); gdy są oba, używany jest Anthropic. W Nadzorze pojawia się „Raport AI”: stan gry, kto jak sobie radzi i co zrobić teraz. Robi się na przycisk i automatycznie co `AI_CO_MIN` minut w trakcie gry (domyślnie 15, 0 wyłącza; automat działa przy `pilnuj_godzin` na „tak”). Model ustawia `OPENAI_MODEL` (domyślnie `gpt-5-mini`) albo `ANTHROPIC_MODEL` (domyślnie `claude-sonnet-5-5`). Do AI trafia stan gry i ostatnie wpisy dziennika, bez haseł.

Informacje, kto był w aplikacji, serwer trzyma tylko w pamięci, więc po restarcie liczą się od nowa.

## Pierwsze uruchomienie

1. Wejdź na stronę i zaloguj się hasłem kadry.
2. Zakładka **Cennik**:
   - **Gildie i hasła**: nazwy gildii i hasło dla każdej. Hasła muszą być różne. Przyciski „Dodaj wiersz” i „Usuń ostatni” zmieniają liczbę gildii.
   - **Ustawienia**: `haslo_punktowych`, godziny gry, zakres oceny punktu żywego (`zywy_min`, `zywy_max`), ile razy gildia może przyjść na ten sam punkt żywy (`zywy_wizyty`, 0 oznacza bez limitu), czy między wizytami musi zaliczyć inny punkt (`zywy_inny_punkt`) i opcjonalna przerwa w minutach (`zywy_przerwa_min`, 0 wyłącza). `ukryj_ranking_min` ustawia, na ile minut przed końcem gildie przestają widzieć ranking (0 wyłącza). Działa tylko przy `pilnuj_godzin` na „tak”; kadra widzi ranking zawsze.
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
