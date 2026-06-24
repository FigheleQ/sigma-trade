# DCA — cykliczny zakup („kup za X$ co tydzień")

Automatyczny, powtarzalny market-buy: użytkownik zakłada plan „kupuj **za X$**
danego tickera **co tydzień**", a egzekucja dzieje się **w tle** — także gdy
user nie ma otwartej aplikacji. Per-portfel, chronione RLS.

> Faza 1 świadomie ogranicza się do interwału **tygodniowego** i akcji
> **long-only / całe sztuki** (jak reszta portfela — patrz `portfolio.md`).

---

## Zasady

- **Budżet, nie liczba akcji.** Plan trzyma kwotę USD na cykl (`amount_usd`),
  nie ilość akcji. Co tydzień kupujemy `floor(budżet / cena)` całych akcji.
- **Reszta się nie marnuje.** Handlujemy całymi sztukami, więc niewykorzystana
  reszta budżetu trafia do `carry_usd` i powiększa budżet następnego cyklu.
  (np. budżet $100, cena $190 → 0 akcji, carry $100; za tydzień budżet $200 → 1 akcja.)
- **Rynek zamknięty → odroczenie.** Gdy skan trafia na zamkniętą giełdę
  (weekend / poza sesją), cron **nic nie kupuje** — plany zostają „due" i złapie
  je najbliższy skan w sesji. Zakup wpada na najbliższą otwartą sesję.
- **Limit cash.** Jeśli portfel nie ma środków na choćby 1 akcję, cykl jest
  pomijany, budżet przechodzi dalej (carry), a harmonogram i tak rusza o tydzień.

---

## Pipeline

```
UŻYTKOWNIK (zakładanie planu):
  DcaPanel → dcaStore.createPlan
    → POST /api/dca { ticker, amountUsd }      (klient usera, RLS)
         walidacja tickera (getExecutionPrice) → insert dca_plans
         next_run_at = now()   ← pierwszy zakup przy najbliższym skanie

CRON (egzekucja w tle, codziennie):
  Vercel Cron  "0 15 * * 1-5"
    → GET /api/dca/run   (Authorization: Bearer CRON_SECRET)
         isMarketOpen() == false → odrocz cały przebieg (nic nie rób)
         service-role client (omija RLS):
           select dca_plans where status='active' and next_run_at <= now
           dla każdego planu:
             cena = getExecutionPrice(ticker)
             { quantity, carry } = planDcaBuy(amount + carry, cena, cash)
             quantity >= 1 → executeMarketOrder(buy)   (positions/cash/trades)
             update plan: carry_usd, last_run_at, next_run_at += 7 dni
```

**Dlaczego dzienny skan, a nie harmonogram tygodniowy:** Vercel Hobby uruchamia
cron **maks. raz dziennie**. Dlatego cron odpala się codziennie i wybiera plany
„due dziś" po `next_run_at` — kadencja tygodniowa wynika z `next_run_at += 7 dni`,
nie z wyrażenia cron.

---

## Model danych

```
dca_plans (
  portfolio_id  → portfolios(id)   -- per-portfel, kaskada przy usunięciu
  ticker        text
  amount_usd    numeric            -- budżet na cykl
  carry_usd     numeric            -- reszta przeniesiona z poprzedniego cyklu
  status        active|paused|cancelled
  next_run_at   timestamptz        -- kiedy plan jest „due"
  last_run_at   timestamptz | null
)
```

RLS: user operuje tylko na planach swojego portfela (`portfolio_id in (select id
from portfolios where user_id = auth.uid())`) — wzorzec z `0001`. Cron pomija RLS
kluczem **service-role**, więc każdy filtr per-portfel w `/api/dca/run` jest jawny.

---

## Kluczowe pliki

| Plik | Rola |
|---|---|
| `supabase/migrations/0002_dca_plans.sql` | tabela `dca_plans` + RLS + indeks pod skan |
| `src/lib/portfolio/types.ts` | `DcaPlan`, `DcaPlanRequest`, `DcaStatus` |
| `src/lib/portfolio/dca.ts` | czysta logika: `planDcaBuy` (qty/carry), `nextWeeklyRun` (+7d) |
| `src/lib/portfolio/execute.ts` | `executeMarketOrder` — wspólna egzekucja buy/sell (cron) |
| `src/lib/supabase/service.ts` | klient service-role (TYLKO serwer, omija RLS) |
| `src/app/api/dca/route.ts` | GET / POST / DELETE planów (sesja usera) |
| `src/app/api/dca/run/route.ts` | endpoint crona — skan i egzekucja due-planów |
| `vercel.json` | harmonogram crona `0 15 * * 1-5` (sesja US) |
| `src/store/dcaStore.ts` | Zustand: lista planów + create/delete |
| `src/components/market/DcaPanel.tsx` | zakładka „DCA" — formularz + lista planów |
| `src/components/market/MarketRail.tsx` | ikona zakładki DCA (Repeat) |

---

## API

| Metoda / trasa | Auth | Działanie |
|---|---|---|
| `GET /api/dca` | sesja usera | lista planów usera |
| `POST /api/dca` | sesja usera | utwórz plan `{ ticker, amountUsd }` (waliduje ticker) |
| `DELETE /api/dca?id=` | sesja usera | usuń plan |
| `GET /api/dca/run` | `CRON_SECRET` | skan + egzekucja (Vercel Cron) |

---

## Zmienne środowiskowe

| Zmienna | Kiedy | Skąd |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | egzekucja w tle (cron) | Supabase → Settings → API |
| `CRON_SECRET` | autoryzacja `/api/dca/run` | dowolny losowy sekret; Vercel sam dokłada go w nagłówku `Authorization` |
| `FINNHUB_API_KEY` | cena egzekucji | — (już używane przez portfel) |

> Klucz service-role **omija RLS** — nigdy w kliencie. Bez `CRON_SECRET`
> endpoint `/api/dca/run` zwraca 401 (chroni przed publicznym wyzwalaniem).

---

## Wdrożenie (kroki ręczne)

1. **Migracja:** Supabase → SQL Editor → wklej `0002_dca_plans.sql` → Run.
2. **Env:** ustaw `SUPABASE_SERVICE_ROLE_KEY` i `CRON_SECRET` na Vercel
   (Production + Preview) oraz lokalnie w `.env`.
3. Cron rejestruje się automatycznie z `vercel.json` przy deployu.

---

## Znane pułapki

| Problem | Fix / wyjaśnienie |
|---|---|
| Cron zwraca 401 | brak / zły `CRON_SECRET` w env Vercel |
| „SUPABASE_SERVICE_ROLE_KEY not set" | brak env; cron nie ma sesji usera, klucz jest wymagany |
| Plan założony w weekend nie kupuje od razu | poprawne — `isMarketOpen()` odracza do najbliższej sesji |
| Budżet < cena 1 akcji → brak zakupu | poprawne — budżet rośnie w `carry_usd` do kolejnego cyklu |
| Cron na Hobby nie odpala częściej niż raz/dzień | limit planu — kadencję tygodniową daje `next_run_at`, nie cron |
| Wiele planów na ten sam portfel w jednym przebiegu | cash pobierany świeżo per plan (sekwencyjnie), brak stale cache |
