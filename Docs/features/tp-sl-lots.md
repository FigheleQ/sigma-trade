# Take Profit / Stop Loss — model lotowy

## Cel

Użytkownik może przy każdym zakupie ustawić opcjonalne ceny TP i SL. Każde otwarcie pozycji tworzy oddzielny **lot** z własnym TP/SL. Gdy cena osiągnie poziom, lot jest automatycznie zamykany przez cron.

## Przepływ

1. **Kupno** — panel KUP: użytkownik klika „TP/SL", wpisuje ceny absolutne. Kliknięcie „Kup" tworzy lot w `position_lots`.
2. **Portfolio** — zakładka „Pozycje": ticker jest rozwijany, pokazuje loty z oznaczeniami TP/SL.
3. **Wykres** — kliknięcie lotu w portfelu zmienia aktywny ticker i nakłada 2 linie (zielona TP, czerwona SL) z efektem poświaty.
4. **Auto-zamknięcie** — Vercel Cron (`* * * * *`) wywołuje `/api/cron/check-tp-sl`, który pobiera ceny i zamyka loty gdzie warunek jest spełniony.
5. **Ręczna sprzedaż** — gdy lot wybrany: „Zamknij lot" (tylko ten lot) lub „Wszystko" (wszystkie loty tickera).

## Architektura danych

### Nowa tabela: `position_lots`

| Kolumna | Typ | Opis |
|---|---|---|
| id | uuid | PK |
| portfolio_id | uuid | FK → portfolios |
| ticker | text | |
| quantity | int | |
| entry_price | numeric | cena zakupu |
| take_profit | numeric? | cena TP (null = brak) |
| stop_loss | numeric? | cena SL (null = brak) |
| status | text | `open` / `closed` |
| opened_at | timestamptz | |
| closed_at | timestamptz? | |
| close_price | numeric? | cena zamknięcia |
| close_reason | text? | `manual` / `take_profit` / `stop_loss` |

### Tabela `positions` (agregat)

Pozostaje bez zmian. Przeliczana po każdej zmianie lotów: `quantity` = suma otwartych lotów, `avg_entry_price` = średnia ważona.

## Kluczowe pliki

- `supabase/migrations/0002_position_lots.sql` — schemat DB
- `src/lib/portfolio/types.ts` — `PositionLot`, rozszerzony `OrderRequest`
- `src/app/api/lots/route.ts` — GET otwartych lotów
- `src/app/api/orders/route.ts` — BUY tworzy lot; SELL zamyka lot/wszystko
- `src/app/api/cron/check-tp-sl/route.ts` — auto-zamknięcie TP/SL
- `src/store/portfolioStore.ts` — `lots`, `selectedLotId`, `fetchLots`, `selectLot`
- `src/components/market/PositionsPanel.tsx` — rozwijalne loty
- `src/components/market/OrderPanel.tsx` — inputy TP/SL + sell lot/all
- `src/components/market/StockChart.tsx` — linie TP/SL z poświatą
- `src/components/market/MarketView.tsx` — przekazuje TP/SL do wykresu
- `vercel.json` — cron schedule `* * * * *`

## Zmienne środowiskowe

| Zmienna | Wymagana | Opis |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Tak (prod) | Klucz service_role do crona (bypasses RLS) |
| `CRON_SECRET` | Opcjonalnie | Bearer token zabezpieczający endpoint crona |

## Ograniczenia

- Cron działa wyłącznie na Vercel (lokalnie nie uruchamia się automatycznie).
- Sprawdzanie TP/SL co minutę — przy dużej zmienności cena może przeskoczyć poziom między sprawdzaniami.
- Cena egzekucji = cena Finnhub w momencie sprawdzenia (nie cena TP/SL dokładnie).
