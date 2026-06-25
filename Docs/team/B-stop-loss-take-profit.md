# B — Stop-loss / Take-profit + domknięcie portfela

> Ten plik jest pisany szczegółowo, krok po kroku — czytaj od góry do dołu.
> **Najważniejsze:** wszystko, co robisz, musi działać **dla każdego użytkownika**,
> nie tylko dla twojego konta testowego. To znaczy: per-portfel, chronione RLS,
> i — przy SL/TP — wyzwalane także gdy user **nie** ma otwartej apki.

---

## 0. Najpierw przeczytaj (w tej kolejności)

| Plik | Po co |
|---|---|
| [Docs/features/portfolio.md](../features/portfolio.md) | pełna specyfikacja portfela (Sekcje 2, 7, 8 — twoje) |
| [Docs/team/README.md](README.md) | zasady wspólne, migracje, workflow, pula kluczy API |
| [src/app/api/orders/route.ts](../../src/app/api/orders/route.ts) | **tu egzekwują się zlecenia** — tu wepniesz SL/TP |
| [src/lib/portfolio/prices.ts](../../src/lib/portfolio/prices.ts) | `getExecutionPrice` (świeży quote) + cache cen |
| [src/lib/portfolio/service.ts](../../src/lib/portfolio/service.ts) | budowanie stanu portfela, `getOrCreatePortfolio` |
| [src/lib/portfolio/types.ts](../../src/lib/portfolio/types.ts) | typy `Position`, `Trade`, `OrderRequest`, `OrderResult` |
| [supabase/migrations/0001_portfolio_schema.sql](../../supabase/migrations/0001_portfolio_schema.sql) | wzorzec tabeli + **RLS** (skopiuj wzorzec!) |
| [cypress/e2e/portfolio.cy.ts](../../cypress/e2e/portfolio.cy.ts) | wzorzec testów (stuby `cy.intercept`) |

Zrozum jedną rzecz z `orders/route.ts`: dziś zlecenie jest **natychmiastowe**
(market order — kup/sprzedaj po świeżej cenie). SL/TP to zlecenia **warunkowe**:
„sprzedaj automatycznie, gdy cena spadnie/wzrośnie do progu". Więc potrzebujesz
(a) miejsca, gdzie je zapiszesz, i (b) mechanizmu, który je **sprawdza w tle**.

---

## 1. Co to jest SL/TP i dlaczego multi-user jest trudny

- **Stop-loss (SL):** automatyczny SELL, gdy cena spadnie ≤ próg (ograniczasz stratę).
- **Take-profit (TP):** automatyczny SELL, gdy cena wzrośnie ≥ próg (realizujesz zysk).
- Zwykle ustawiane **parą** na otwartej pozycji (to tzw. **OCO** — one-cancels-other:
  gdy odpali SL, TP się kasuje i odwrotnie).

**Pułapka multi-user:** jeśli sprawdzasz progi tylko w przeglądarce zalogowanego usera
(polling po stronie klienta), to SL/TP **nie zadziała**, gdy user zamknie kartę.
Prawdziwa giełda pilnuje zleceń po stronie serwera. My zrobimy to samo, w wersji minimalnej:
**serwerowy endpoint-skaner**, który przechodzi po **wszystkich** aktywnych zleceniach
wszystkich userów i wykonuje te, których próg został trafiony.

---

## 2. Model danych — migracja `0002_orders_sl_tp.sql` (twoja)

Nowa tabela `pending_orders`. Skopiuj wzorzec RLS z `0001`.

```sql
create table if not exists public.pending_orders (
  id            uuid primary key default gen_random_uuid(),
  portfolio_id  uuid not null references public.portfolios(id) on delete cascade,
  ticker        text not null,
  kind          text not null check (kind in ('stop_loss','take_profit')),
  trigger_price numeric(18,4) not null,
  quantity      integer not null check (quantity > 0),
  status        text not null default 'active' check (status in ('active','filled','cancelled')),
  oco_group     uuid,                       -- para SL+TP: ten sam UUID → odpalenie jednego kasuje drugie
  created_at    timestamptz not null default now(),
  filled_at     timestamptz
);
create index if not exists idx_pending_active on public.pending_orders(status) where status = 'active';

alter table public.pending_orders enable row level security;
drop policy if exists "own pending orders" on public.pending_orders;
create policy "own pending orders" on public.pending_orders
  for all to authenticated
  using (portfolio_id in (select id from public.portfolios where user_id = auth.uid()))
  with check (portfolio_id in (select id from public.portfolios where user_id = auth.uid()));
```

> **RLS = warunek poprawności dla każdego usera.** Bez polityki user A widziałby/edytował
> zlecenia usera B. Wzorzec masz w `0001` (`own positions`/`own trades`) — kopiuj 1:1.

---

## 3. Backend — endpointy

Trzymaj się stylu istniejących route'ów (`createClient`, `auth.getUser()`, walidacja, `NextResponse`).

1. **`POST /api/orders/conditional`** — utwórz SL/TP (lub parę OCO).
   - Waliduj: user zalogowany, posiada pozycję na `ticker`, `quantity` ≤ ilość w pozycji,
     `trigger_price > 0`. SL poniżej, TP powyżej ceny bieżącej (ostrzeżenie, nie twardy błąd).
   - Para SL+TP → ten sam `oco_group`.
2. **`DELETE /api/orders/conditional/[id]`** — anuluj (status `cancelled`).
3. **`GET /api/orders/conditional`** — lista aktywnych zleceń usera (do panelu UI).
4. **`POST /api/orders/scan`** — **skaner (multi-user, sedno działania dla wszystkich):**
   - pobiera **wszystkie** `pending_orders` ze `status='active'` (serwerowo, z `service_role`
     albo z polityki — patrz uwaga niżej),
   - dla każdego unikalnego tickera bierze cenę (`getCachedPrices`),
   - dla trafionych progów (`SL: cena ≤ trigger`, `TP: cena ≥ trigger`) wywołuje egzekucję SELL
     (ta sama logika co `orders/route.ts`), ustawia `status='filled'`, `filled_at`,
     a parę OCO kasuje (`cancelled`).
   - zwraca liczbę wykonanych.

   > **Uwaga RLS dla skanera:** skaner musi widzieć zlecenia **wszystkich** userów, więc nie może
   > działać na kliencie zalogowanego usera. Użyj klienta serwerowego z kluczem `service_role`
   > (env `SUPABASE_SERVICE_ROLE_KEY`, **tylko** serwer/API route, nigdy w przeglądarce) — on omija RLS.
   > Endpoint zabezpiecz sekretem (`CRON_SECRET` w nagłówku), żeby nie dało się go wywołać z zewnątrz.

5. **Wyzwalanie skanera (żeby działało dla offline userów):**
   - **Teraz (proste):** [Vercel Cron](https://vercel.com/docs/cron-jobs) co 1–5 min uderza w `/api/orders/scan`.
     Dodaj `vercel.json` z `crons`. Działa nawet gdy nikt nie jest zalogowany.
   - **Dodatkowo (UX):** lekki polling z przeglądarki gdy user patrzy na pozycje (szybsze odświeżenie
     jego widoku), ale **prawdą jest skaner serwerowy**, nie klient.

### Refaktor pod DRY (uzgodnij z A jako integration-owner)
Logika SELL w `orders/route.ts` (linie 102–140) i w skanerze jest ta sama. Wyłuskaj ją do
`src/lib/portfolio/execute.ts` (`executeSell(supabase, portfolioId, ticker, qty, price)`),
żeby nie kopiować. To dotyka `orders/route.ts` — zrób w osobnym małym commicie.

---

## 4. Atomowość (z backlogu portfolio.md Sekcja 8 + roadmap) — twoje

Dziś `orders/route.ts` robi sekwencję osobnych zapytań (update pozycji → update cash → insert trade)
**bez transakcji** (komentarz w pliku linie 8–10). Przy jednym userze OK, ale przy SL/TP + skanerze
+ równoległym kliknięciu może dojść do wyścigu. Docelowo: **funkcja Postgres (RPC) `execute_order`**
robiąca wszystko w jednej transakcji. Wstaw szkielet RPC w migracji `0002` i przełącz route na `supabase.rpc(...)`.

---

## 5. Zakres B — co budujesz i w jakiej kolejności (USTALONE)

To jest twój zatwierdzony zakres. Reszta pomysłów („proper trading site") wylądowała
w backlogu [portfolio.md](../features/portfolio.md) Sekcja 8 — stamtąd dobierasz później.
Kolejność = od fundamentu do bajerów, nie przeskakuj:

1.  **Stop-loss / take-profit** — rdzeń (sekcje 2–4 wyżej). Wraz z nim **minimalna lista
   aktywnych zleceń** (podgląd + „anuluj"), bo bez niej user nie zobaczy, co ustawił.
2.  **OCO / bracket** — SL + TP jako para (`oco_group` w tabeli z sekcji 2); jeden się
   wykona → drugi automatycznie `cancelled`. Tabela już to przewiduje.
3.  **Podgląd kosztu przed zakupem** — frontend w [OrderPanel.tsx](../../src/components/market/OrderPanel.tsx):
   „kupujesz 10× AAPL ≈ 1 650$ → zostanie ci 8 350$". Dane już tam są (`quote` z `quoteCache`
   + `cash` z portfela) — to głównie prezentacja, bez backendu.
4.  **Reset portfela** — `POST /api/portfolio/reset`: przywróć `initial_balance`, usuń
   pozycje i aktywne zlecenia. Trades zostaw jako ledger (albo archiwizuj). RLS po userze.
5.  **Wykres wartości portfela w czasie** — nowa tabela `portfolio_snapshots` (cron zapisuje
   `totalValue` per user raz dziennie), wykres na Lightweight Charts (biblioteka już jest).
6.  **Cykliczny zakup (DCA) - trudniejsze!** — „kupuj za X$ co tydzień". Tabela `recurring_orders` + **ten sam
   cron-skaner** co SL/TP (sekcja 3) sprawdza „minął tydzień → kup". Robisz **na końcu**, bo
   stoi na działającym skanerze.

> Atomowość zleceń (RPC z sekcji 4) i blokada handlu poza sesją to techniczne podpory pod SL/TP —
> rób je przy okazji rdzenia, nie jako osobne „funkcje".

### Dodatkowe tabele w migracji `0002` (poza `pending_orders` z sekcji 2)
- `recurring_orders(portfolio_id, ticker, amount_usd, interval, next_run_at, status)` — DCA
- `portfolio_snapshots(portfolio_id, total_value, captured_at)` — punkty do wykresu
Obie z RLS po `auth.uid()` (wzorzec z `0001`).

---

## 6. Poprawki UI — panel Kup/Sprzedaj (czytelność)

[OrderPanel.tsx](../../src/components/market/OrderPanel.tsx) ma teraz **bardzo drobny tekst**
(cena `text-[11px]`, koszt `text-[10px]`, cash `text-[9px]`). Zakup to kluczowy moment — user
musi jasno widzieć liczby, na których wydaje (wirtualne) pieniądze. Propozycje:

- **Powiększ liczby, które się liczą:** cena i koszt do ~`text-sm`/`text-base`, ilość wyraźniejsza.
  `9px` zostaw najwyżej dla etykiet pomocniczych.
- **Wyróżnij „koszt → zostanie":** przed kliknięciem pokaż `Koszt 1 650$ → zostanie 8 350$`,
  na czerwono gdy zabraknie cash (mocniejszy sygnał niż samo wyszarzenie przycisku).
- **Większe przyciski Kup/Sprzedaj** — więcej paddingu, czytelniejszy stan `disabled`
  (teraz wtapia się w tło — `text-zinc-700` na `bg-zinc-900`).
- **Stepper ilości** — większe pola i `+/−` łatwiejsze do trafienia (też pod palec na mobilce).
- **Szybkie ilości** (opcjonalnie): przyciski `×1 / ×5 / ×10 / Max` — mniej klikania.
- **Spójność:** trzymaj akcent `#00ff88` i `font-mono`. Chodzi o **rozmiar i hierarchię**,
  nie o nowy styl — design system zostaje (patrz CLAUDE.md → Design system).

---

## 7. Multi-user — checklista (czytaj zanim powiesz „działa")

- [ ] Wszystkie nowe tabele mają **RLS po `auth.uid()`** (skopiowane z `0001`).
- [ ] Żaden endpoint nie ma zahardkodowanego `user_id`/`portfolio_id` — zawsze z `auth.getUser()`.
- [ ] Skaner SL/TP działa dla usera, który **nie ma otwartej apki** (cron serwerowy, nie polling klienta).
- [ ] Skaner używa `service_role` **tylko** po stronie serwera i jest chroniony sekretem.
- [ ] Test na **dwóch różnych kontach**: user A nie widzi i nie może anulować zleceń usera B.
- [ ] Świeży user (nowe konto) = pusty stan, zero crashy (portfel tworzy się leniwie w `getOrCreatePortfolio`).

---

## 8. Testy lokalne

1. `npm run dev`, zaloguj się, kup jakąś pozycję (np. 10× AAPL).
2. Ustaw SL poniżej i TP powyżej ceny → sprawdź, że pojawiają się w panelu zleceń.
3. Ręcznie wywołaj skaner: `POST /api/orders/scan` (z nagłówkiem `CRON_SECRET`) i sztucznie zmień
   cenę w `price_cache` (SQL Editor), żeby trafić próg → pozycja sprzedana, zlecenie `filled`, para OCO `cancelled`.
4. `npm run typecheck` i `npm run lint` muszą być zielone.

---

## 9. Testy Cypress (`cypress/e2e/orders-sl-tp.cy.ts`)

Wzoruj się na [portfolio.cy.ts](../../cypress/e2e/portfolio.cy.ts): **stubuj backend `cy.intercept`**,
nie dotykaj prawdziwej bazy. Pokryj minimum:

- [ ] tworzenie SL i TP na pozycji → pojawiają się na liście aktywnych zleceń
- [ ] anulowanie zlecenia → znika z listy
- [ ] walidacja: nie da się ustawić SL/TP na ilość większą niż w pozycji
- [ ] (stub skanera) gdy `/api/orders/scan` zwraca „1 wykonane" → UI pokazuje powiadomienie i zaktualizowany portfel

Uruchom: `npm run cy:run:win`.

---

## 10. Push — checklist
- [ ] DoD z [README.md](README.md#definition-of-done-każda-osoba-przed-pushem) spełnione
- [ ] migracja `0002` puszczona na testowym Supabase i działa
- [ ] funkcja za flagą, jeśli niedopięta do końca
- [ ] mały PR do `main`, rebase na świeży `main`, opis co i jak testować
