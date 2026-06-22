# Portfel użytkownika — Faza 1 (specyfikacja zamrożona)

> Paper trading na realnych cenach z Finnhub (free tier).
> Status: wizja zatwierdzona — gotowa do implementacji.
> Stack docelowy: Next.js (App Router) + Supabase (Postgres) + Finnhub.

---

## 1. Zasady ogólne

- **Waluta:** USD — balans i ceny w jednej walucie, zero przeliczników FX.
- **Instrumenty:** wyłącznie akcje notowane w USA, **long only** (kup → trzymaj → sprzedaj).
  Bez CFD, shortów i dźwigni. *Keep it simple.*
- **Jednostka:** całe akcje. Częściowa sprzedaż dozwolona (np. 5 z 10 akcji),
  ale minimum **1 akcja** — bez ułamków (0.5 akcji niedozwolone).
- **Balans startowy:** do wyboru przy starcie — 10 000 / 50 000 / 100 000 USD.

> ⚠️ **Uwaga:** instrumenty muszą być realnie notowane. Spółki prywatne
>  nie mają tickera — Finnhub nie zwróci dla nich ceny.
> Dozwolone tylko symbole giełdowe US: AAPL, MSFT, NVDA, TSLA, GOOGL itp.

---

## 2. Cykl życia transakcji

```
Balans startowy (USD) → cash

KUP:
  cash         -= ilość × cena_wykonania
  pozycja      += ilość           (avg entry liczona jako średnia ważona)

TRZYMAJ:
  unrealized P/L = (cena_aktualna − avg_entry) × ilość      [cena z cache]

SPRZEDAJ:
  cash           += ilość_sprzedana × cena_wykonania
  realized P/L    = (cena_sprzedaży − avg_entry) × ilość_sprzedana   → historia
  pozycja        -= ilość_sprzedana
  (przy częściowej sprzedaży reszta pozycji zachowuje tę samą avg entry)
```

### Średnia cena zakupu (avg entry)
Jeśli użytkownik kupi ten sam ticker kilka razy po różnych cenach,
pozycja przechowuje **jedną średnią ważoną** cenę wejścia, nie listę cen.

---

## 3. Integracja z Finnhub (free tier — 60 req/min)

### Cena do WYŚWIETLANIA vs cena do EGZEKUCJI
- **Wyświetlanie** (watchlist, pozycje) → z **cache w bazie**
  (klucz = ticker, TTL ~30–60 s). Może być lekko nieaktualne — bez znaczenia.
- **Egzekucja** zlecenia (klik Kup/Sprzedaj) → **świeży pojedynczy `/quote`**
  w momencie transakcji (1 call), żeby transakcja poszła po realnej cenie.

### Wspólny cache po stronie serwera
Cena danego tickera jest **taka sama dla wszystkich użytkowników** →
cache'owana **raz w bazie** (nie per użytkownik). 10 userów patrzących
na AAPL = 1 call, nie 10. Skaluje się w ramach darmowego limitu.

### Kiedy odświeżać ceny
- przy **logowaniu** → batch cen całej watchlisty (5–20 calls, z zapasem)
- przy **transakcji** → 1 świeży call (cena egzekucji)
- opcjonalnie **łagodny interwał** (np. co 60 s) tylko dla aktualnie
  oglądanego tickera — nie wszystkich naraz
- **deduplikacja**: jeden call na unikalny symbol

---

## 4. Giełda zamknięta (weekend / noc)

Poza sesją Finnhub zwraca ostatnią cenę zamknięcia (cena stoi w miejscu).

- **Faza testowa:** komunikat „aktualna cena rynkowa nie odzwierciedla
  ceny rzeczywistej" — inwestowanie nadal działa (żeby dało się pracować
  nad stroną w weekend).
- **Później:** całkowita blokada składania zleceń przy zamkniętym rynku.
- **Detekcja:** prosty check godzin sesji US (pn–pt, 9:30–16:00 ET)
  wystarczy na start.

---

## 5. Widoki

### Zakładka „Pozycje"
Dla każdej otwartej pozycji:
- ticker
- ilość posiadanych akcji
- avg entry (cena zakupu / średnia ważona)
- cena aktualna (z cache)
- **P/L %** względem ceny zakupu (unrealized)

### Zakładka „Historia transakcji"
Niezmienny ledger. Każdy wpis (kup / sprzedaj):
- typ (buy / sell), ticker, ilość
- cena wykonania (**zapisana na sztywno** — nie przeliczana później)
- data i czas
- **realized P/L** przy zamknięciu (zysk/strata) — widoczne czy user
  wyszedł na plus czy minus

### TopBar — podgląd portfela
- **Total P/L portfela** = (cash + wartość rynkowa pozycji) vs balans startowy
- cash dostępny

---

## 6. Architektura UI (wizja)

### Zasada nadrzędna
Aplikacja tradingowa = użytkownik chce widzieć **naraz** wykres, watchlistę
i stan portfela. Dlatego:

- **Hamburger / drawer → tylko mobile.** Na desktopie chowanie watchlisty
  za menu to antywzorzec (dodaje tarcie tam, gdzie liczy się szybki podgląd).
- **Na desktopie** kluczowe dane zostają widoczne: sidebar z zakładkami +
  portfel na stałe w TopBarze.

### Layout (desktop / tablet)

```
┌──────────────────────────────────────────────────────────────┐
│ TopBar: Sigma Trade | Portfel $98,420 ▲+1.2% | Cash $12k | FI │ ← portfel ZAWSZE widoczny
├──────────┬───────────────────────────────────┬───────────────┤
│ Sidebar  │          Wykres / widok główny     │  Panel agenta │
│ zakładki:│                                     │  (ikony)      │
│ ◉ Watchli│   [wykres AAPL]                     │               │
│ ○ Pozycje│   [panel Kup/Sprzedaj]              │               │
│ ○ Historia                                     │               │
└──────────┴───────────────────────────────────┴───────────────┘
```

- **Lewy sidebar** = przebudowana watchlista jako **uniwersalny panel
  z zakładkami**: Watchlist / Pozycje / Historia.
- **Portfel/balans** → TopBar (stały podgląd) + klik = pełny widok.
- **Kup/Sprzedaj** → panel pod wykresem (kontekst: widzisz wykres
  i od razu składasz zlecenie) lub modal.
- **Panel agenta** (ikony po prawej) — bez zmian, dochodzi Risk Agent.

### Mobile
Te same zakładki sidebara składają się do **hamburgera/drawera**
(tu wzorzec hamburgera jest jak najbardziej OK). Wykres na pełny ekran,
portfel skrócony w TopBarze.

### Sekcje (zakładki) i ich zawartość

| Sekcja | Co pokazuje | Gdzie |
|---|---|---|
| **Watchlist** | ceny obserwowanych instrumentów (istnieje) | sidebar tab |
| **Pozycje** | otwarte akcje: ilość, avg entry, cena aktualna, P/L % | sidebar tab |
| **Historia** | log buy/sell + realized P/L | sidebar tab |
| **Portfel/Balans** | cash, total value, P/L % | TopBar + pełny widok |
| **Kup/Sprzedaj** | wybór instrumentu, ilość, podgląd kosztu | panel pod wykresem |

### Rekomendacja wdrożenia
Jeden komponent zakładek obsługuje oba tryby: jako **sidebar** (desktop)
i jako **drawer** (mobile) — bez chowania kluczowych danych przed traderem.
To naturalna ewolucja obecnej watchlisty, nie przepisywanie od zera.

---

## 7. Walidacja (serwerowa)

- Nie można kupić za więcej niż dostępny **cash**.
- Nie można sprzedać więcej akcji niż się **posiada**.
- Cena egzekucji zawsze ze świeżego `/quote` (nie z UI / nie z cache).

---

## 7. Model danych (logicznie)

```
portfolios   (user_id, cash, initial_balance)
positions    (portfolio_id, ticker, quantity, avg_entry_price)
trades       (portfolio_id, ticker, side, quantity, price, executed_at, realized_pnl)
price_cache  (ticker, price, fetched_at)   -- wspólny dla wszystkich userów
```

Zasada: **cena nigdy nie liczona w UI**. Pozycje wyliczane z transakcji,
historia to niezmienny ledger, cache cen to jedyne źródło prawdy dla
wartości rynkowej.

---

## 8. Poza Fazą 1 (backlog)

- Reset portfela (przywrócenie balansu startowego, czyszczenie pozycji)
- Pełna blokada handlu przy zamkniętej giełdzie
- Stop-loss / take-profit
- Wykres wartości portfela w czasie
