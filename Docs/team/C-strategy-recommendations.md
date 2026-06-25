# C — Strategy / rekomendacje + onboarding

Warstwa „pod botem A". Bot **rozmawia**, ty **liczysz**: budujesz profil inwestycyjny
użytkownika (`UserStrategy`) z odpowiedzi i zamieniasz go na **rekomendacje inwestycyjne**.
Plus ekran startowy onboardingu (wybór budżetu/balansu).

---

## 0. Najpierw przeczytaj

| Plik | Po co |
|---|---|
| [Docs/team/README.md](README.md) | zasady wspólne, migracje, workflow |
| [Docs/team/A-coach-chatbot.md](A-coach-chatbot.md) | **kontrakt z A** — `UserStrategy`, jak bot cię woła |
| [Docs/features/portfolio.md](../features/portfolio.md) | balans startowy, watchlista, sektory |
| [src/lib/portfolio/service.ts](../../src/lib/portfolio/service.ts) | `DEFAULT_BALANCE` (dziś hardcode 100k) — twój chooser to zmienia |
| [config.yaml](../../config.yaml) | `data_provider.endpoints.recommendation` (Finnhub) + watchlista z sektorami |
| [src/lib/portfolio/prices.ts](../../src/lib/portfolio/prices.ts) | wzorzec wołania Finnhub + cache |

---

## 1. Zakres (twój pion)

- `src/lib/coach/types.ts` — **współwłasność z A**: `UserStrategy` (poziom, ryzyko, budżet,
  zainteresowania/sektory), `Recommendation` (ticker, powód, sugerowana waga). Ustal w PR contract-first.
- `src/lib/strategy/recommend.ts` — server-only: `generateRecommendations(strategy)` → `Recommendation[]`.
- `src/app/api/strategy/route.ts` — `GET`/`POST` profilu (`user_strategy`).
- `src/app/api/strategy/recommendations/route.ts` — zwraca rekomendacje dla profilu.
- `src/components/onboarding/BalanceChooser.tsx` — ekran wyboru 10k / 50k / 100k.
- migracja `0004_user_strategy.sql` — tabela `user_strategy` (RLS po `auth.uid()`).

---

## 2. Skąd biorą się rekomendacje (integracja)

Masz dwa źródła, łącz je:
1. **Profil usera** (`UserStrategy`): budżet → ile akcji; tolerancja ryzyka → dobór tickerów;
   zainteresowania → filtr sektorów (watchlista w `config.yaml` ma `sector`).
2. **Dane rynkowe Finnhub:** endpoint `recommendation` (`/recommendation`, już w configu) daje
   konsensus analityków (buy/hold/sell) per ticker. Cache jak w `prices.ts`, żeby nie palić limitu.

> Opcjonalnie: zamiast reguł — poproś **Gemini** o ranking pod profil (structured output, jak A).
> Wtedy uzgodnij z A wspólny `callGemini`/pulę kluczy (README), żeby nie dublować integracji.

---

## 3. Kontrakt z A (najważniejsze, żeby pracować równolegle)

- A woła `GET /api/strategy` (czyta profil do kontekstu promptu) i
  `POST /api/strategy/recommendations` (dostaje listę tickerów do pokazania w czacie).
- **Zamroźcie typy w PR contract-first dnia 1.** Potem A mockuje twoje endpointy, ty budujesz je
  niezależnie — zero wspólnych plików poza `types.ts`.

---

## 4. Balans startowy (z backlogu portfolio.md)

Dziś `getOrCreatePortfolio` tworzy portfel ze sztywnym `DEFAULT_BALANCE = 100_000`
([service.ts:10](../../src/lib/portfolio/service.ts)). Twój `BalanceChooser` (część onboardingu):
- pozwala wybrać 10k / 50k / 100k **przed** utworzeniem portfela,
- przekazuje wybór do `getOrCreatePortfolio` (parametr zamiast stałej).
> Uzgodnij z **B** — to dotyka `service.ts`/portfela. Jeden z was robi zmianę sygnatury, drugi konsumuje.

---

## 5. Multi-user / RLS
- `user_strategy` z RLS po `auth.uid()` (wzorzec `0001`).
- Profil zawsze per zalogowany user; rekomendacje liczone z **jego** budżetu/pozycji.
- Świeży user bez profilu → endpoint zwraca „brak profilu" (nie crash), bot startuje onboarding.

---

## 6. Testy lokalne → Cypress → push
1. `npm run dev`: przejdź onboarding (wybór budżetu → profil) → sprawdź, że `/api/strategy/recommendations` zwraca sensowną listę.
2. `npm run typecheck` + `npm run lint` zielone.
3. Cypress `cypress/e2e/strategy.cy.ts` (stub Finnhub/`/api/strategy` przez `cy.intercept`):
   - [ ] wybór balansu 10k/50k/100k → portfel startuje z wybraną kwotą
   - [ ] zapis profilu → `GET /api/strategy` zwraca te dane
   - [ ] rekomendacje dla profilu „beginner, niski budżet" wyglądają inaczej niż „advanced, wysoki budżet"
   - `npm run cy:run:win`
4. Push: mały PR, za flagą `strategy_agent.enabled` dopóki niegotowe.
