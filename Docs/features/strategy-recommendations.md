# Strategy & Recommendations (warstwa C, AI v2)

Po onboardingu użytkownik dostaje **plan pierwszego portfela**: kilka pozycji
z rolą core/satellite, kwotą i liczbą akcji pod jego budżet, uzasadnieniem
„dlaczego pod TWÓJ profil" i listą „co może pójść nie tak".

**Zasada:** skład portfela liczy **kod deterministycznie**, model tylko go
opisuje (2–4 zdania). Dzięki temu nie ma halucynowanych tickerów (wyłącznie
katalog), dobór nie kosztuje tokenów, a wynik jest stabilny i testowalny.

---

## Przepływ

```
profil (UserStrategy) ─┐
pozycje + gotówka ─────┼─► allocate.ts ──► plan (bez cen) ──► prices.ts (cache 60 s)
                       │                                         │
                       └──────────────► allocate.ts (z cenami) ◄─┘
                                              │
                         enrich.ts (Finnhub /recommendation, cache 6 h)
                                              │
                         explain.ts (rationale / risks / confidence — 0 tokenów)
                                              ▼
                                     Recommendation[]  ──► UI (RecommendationsBlock)
                                              └──────────► narracja Coacha (Flash, walidowana)
```

Wyceniamy tylko tickery z planu (~7), nie cały katalog — oszczędza darmowy
limit Finnhub.

---

## Silnik — `src/lib/strategy/allocate.ts`

`buildPortfolioPlan(strategy, { positions, prices?, cash? })`:

| Reguła | Wartości |
|---|---|
| Udział core (broad ETF) | risk low 65% / medium 50% / high 35%; beginner +10 pp, advanced −10 pp; drawdownComfort ±5 pp; **zakres 25–80%** (nigdy 0); tylko-ETF → 85% |
| Liczba core | 2 dla beginner lub low risk, inaczej 1; druga pozycja dywersyfikuje czynnik (VOO + SCHD, nie VOO + VTI) |
| Liczba satelitów | beginner 4 / intermediate 5 / advanced 6 |
| Bufor gotówki | low 10% / medium 7% / high 5%; −2 pp przy dopłatach miesięcznych; zakres 3–15% |
| Max na ticker (satelita) | low 10% / medium 12% / high 15% |
| Max na sektor (satelity) | low 20% / medium 25% / high 30%; max 2 tickery na sektor |
| Filtr ryzyka | `allowedRisks(level, risk)`: low → bez high; beginner+medium → bez high |
| Beginner + low | tylko pozycje `beginnerFriendly` |
| Horyzont < 3 lata | bez pozycji z `horizon: 'long'` |
| Zainteresowania | ~2/3 slotów satelitów z kategorii usera, reszta dywersyfikuje; waga ×1,3 |
| Posiadane pozycje | pomijane (`skippedOwned`) — nie proponujemy drugi raz |
| Wykluczenia | `exclusions` dopasowane do tickera / nazwy / sektora / motywu |
| Akcje | **całe akcje** (`api/orders` kupuje całe); 1 akcja dopuszczalna do 1,5× celu; droższe → ticker wypada, wchodzi następny |
| Reszta z zaokrągleń | dokupuje akcje core, bez naruszenia bufora gotówki |
| Tie-break | score malejąco → kuratorowana kolejność katalogu (bez `Math.random`) |

Nadwyżka ponad limity tickera/sektora wraca do core (bezpieczny „zlew").
`checkPlan(plan, ctx)` weryfikuje inwarianty (katalog, posiadane, limity, bufor,
obecność core) — używany w testach.

### Przykład (ceny przykładowe)

| Profil | Plan |
|---|---|
| beginner / low / $10k / tech | VOO 45% · SCHD 32% · AAPL · MSFT · KO · JNJ · gotówka ~10% |
| advanced / high / $10k / semis + nuclear | VOO 28% · NVDA · CEG · AMD · CCJ · AAPL · KO · gotówka ~7% |
| intermediate / medium / $50k / healthcare + energy + dywidendy | SCHD 51% · PFE · XOM · NEE · LLY · GOOGL · gotówka ~7% |

---

## Katalog — `src/lib/strategy/catalog.ts`

13 kategorii, ~50 tickerów US (działają na darmowym Finnhub). Każdy wpis ma
metadane silnika: `sector`, `assetClass`, `dividendYieldBand`, `volatilityBand`,
`horizon`, `beginnerFriendly`, `themes`.
`src/lib/coach/recommendationCatalog.ts` to re-export (stare importy działają).

`catalogForPrompt(interests, risk, level)` — podzbiór do promptu Coacha
(broad-market + kategorie usera, max 14 tickerów, `*` = high risk).

---

## Uzasadnienia — `src/lib/strategy/explain.ts`

Generowane z metadanych, nie przez model:

- **rationale** (2–3 punkty): rola core/udział, dopasowanie do zainteresowań,
  zmienność vs profil ryzyka, dywidenda / konsensus / „beginner-friendly".
- **risks** (2 punkty): zmienność, surowce, spekulacja/small-cap, turnaround,
  wycena wzrostowa, wrażliwość na stopy, ryzyko pojedynczej spółki.
- **confidence**: core = high; satelita z dopasowaniem, ryzykiem i pozytywnym
  konsensusem = high; poza zainteresowaniami = low.
- `deterministicNarration()` — fallback, gdy narracja modelu nie przejdzie walidacji.

---

## Konsensus analityków — `src/lib/strategy/enrich.ts`

Finnhub `/recommendation` (endpoint z `config.yaml`), pula kluczy + retry jak
w `prices.ts`, cache w pamięci 6 h (dane zmieniają się raz w miesiącu),
timeout 4 s. Brak danych (ETF, limit, timeout) = `null`, **nigdy** błąd.

---

## Kontrakt (rozszerzony addytywnie)

`src/lib/coach/types.ts` — nowe pola wyłącznie opcjonalne (uzgodnienie A + C
w nagłówku pliku):

- `Recommendation`: `name`, `category`, `kind`, `risk`, `role`,
  `suggestedAmount`, `suggestedShares`, `price`, `horizon`, `rationale[]`,
  `risks[]`, `analystConsensus`, `confidence`.
- `UserStrategy`: `horizonYears`, `monthlyContribution`, `drawdownComfort`,
  `preferredInstruments`, `dividendPreference`, `exclusions`.

Mock (`strategyClient.mockRecommendations`) zwraca stary kształt — UI go obsługuje.

---

## API (za flagą `features.strategy_agent.enabled`)

| Method | Endpoint | Opis |
|---|---|---|
| `GET` | `/api/strategy` | `{ strategy }` z `user_strategy` |
| `POST` | `/api/strategy` | `{ strategy }` → walidacja → upsert |
| `POST` | `/api/strategy/recommendations` | `{ strategy? }` → `{ recommendations, plan }` |

Flaga `false` → 404 → klient spada na lokalny mock (zachowanie sprzed v2).
Gdy flaga `true`, `/api/coach` sam liczy plan w turze domknięcia profilu,
zapisuje profil i zwraca `recommendations` w odpowiedzi — store nie robi
wtedy drugiego zapytania.

Migracja: `supabase/migrations/0005_user_strategy.sql` (RLS `auth.uid()`).

---

## UI — `RecommendationsBlock`

Karta: ticker + nazwa, badge `core`/`satellite`, badge ryzyka, waga · kwota ·
akcje @ cena, `reason`, rozwijane „Why it fits & risks" (przycisk
`aria-expanded`, klawiatura), pasek konsensusu analityków, CTA
**Place this order** — przełącza wykres na ticker i otwiera `BuyModal`
z sugerowaną liczbą akcji (na mobile zamyka overlay agenta).

`data-testid`: `coach-recommendations`, `coach-rec-card`, `coach-rec-role`,
`coach-rec-risk`, `coach-rec-amount`, `coach-rec-shares`, `coach-rec-toggle`,
`coach-rec-details`, `coach-rec-risks`, `coach-rec-consensus`,
`coach-rec-order`, `coach-rec-summary`.
