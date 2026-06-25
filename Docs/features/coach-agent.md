# Coach Agent

Interaktywny chatbot AI wbudowany w dashboard. Przeprowadza nowego użytkownika
przez onboarding (zbiera profil inwestycyjny), a po jego zakończeniu działa jako
asystent edukacyjny do nauki tradingu. Multi-turn czat oparty na Gemini z
persystencją historii w Supabase.

---

## Architektura

```
CoachPanel (UI)
  → coachStore (Zustand)
       GET  /api/coach  → historia + needsOnboarding flag
       POST /api/coach  → nowa tura → chat() → CoachReply
       DELETE /api/coach → reset pamięci
  → agent.ts (server-only)
       Gemini gemini-2.5-flash, multi-turn contents[]
       systemInstruction: persona + katalog tickerów + onboarding flow
  → strategyClient.ts
       POST /api/strategy/recommendations (warstwa C)
       fallback: mockRecommendations() — działa bez backendu C
  → supabase: tabela coach_messages (RLS: user_id = auth.uid())
```

---

## Onboarding flow

Bot zadaje **jedno pytanie na raz** i czeka na odpowiedź przed następnym:

1. Powitanie + krótka zapowiedź
2. Poziom doświadczenia: `beginner / intermediate / advanced`
3. Zainteresowania sektorowe (np. technology, energy, gaming)
4. Tolerancja ryzyka + budżet startowy ($10k / $50k / $100k)

Gdy bot ma komplet — `level + risk + budget + interests` — ustawia
`onboardingComplete: true` i wypełnia pole `strategy` w odpowiedzi JSON.
Store zapisuje profil przez `saveStrategy()` i pobiera rekomendacje.

### Legacy accounts

Konta założone **przed 2026-06-25** (data wdrożenia Coacha) dostają pełny
onboarding przy pierwszym wejściu, nawet jeśli mają już profil od warstwy C.
Cutoff: `ONBOARDING_CUTOFF_MS = Date.parse('2026-06-25T00:00:00Z')` w `route.ts`.

---

## Katalog rekomendacji

`src/lib/coach/recommendationCatalog.ts` — 13 kategorii, ~50 tickerów US:

| Kategoria | Przykłady |
|---|---|
| Broad-market ETFs | VOO, VTI, SCHD, QQQ |
| Technology | AAPL, MSFT, GOOGL, META |
| Semiconductors / AI | NVDA, AMD, AVGO, TSM |
| Automotive / EV | TSLA, RIVN, GM |
| Food / Beverage | MCD, KO, SBUX |
| Healthcare | JNJ, UNH, LLY, ABBV |
| Financials | JPM, BAC, GS, V |
| Energy | XOM, CVX, SLB |
| Nuclear / Clean | CEG, CCJ, NEE, LEU |
| Rare-earth / Materials | MP, ALB, FCX |
| Aerospace / Defense | LMT, RTX, BA |
| Retail / E-commerce | AMZN, WMT, TGT |
| Entertainment / Media | NFLX, DIS, RBLX, EA |

Bot dobiera kategorie na podstawie `interests` usera i filtruje po `risk`.
`mockRecommendations()` w strategyClient odtwarza tę logikę lokalnie gdy
backend C nie odpowiada.

---

## Gemini — ważne szczegóły

- **Model:** `gemini-2.5-flash` (konfigurowany przez `config.yaml → ai_provider.gemini.model`)
- **`thinkingConfig: { thinkingBudget: 0 }`** — WYMAGANE. Flash to model
  „thinking"; bez tego tokeny myślenia zjadają cały budżet wyjścia i zwracają
  pusty tekst → 500.
- **Structured output:** bot zwraca raw JSON `{ reply, onboardingComplete, strategy }`.
  `extractJson()` strippuje ewentualne code fences przed `JSON.parse`.
- **Retry:** przy 429 lub ≥500 jedna ponowna próba na kolejnym kluczu z puli
  (`nextGeminiKey()`).
- **Fallback:** zły JSON → `reply = surowy tekst`, `onboardingComplete = false`.

---

## API routes

| Method | Endpoint | Opis |
|---|---|---|
| `GET` | `/api/coach` | Historia wątku + `needsOnboarding` + `isLegacyAccount` |
| `POST` | `/api/coach` | `{ history: CoachTurn[], strategy? }` → `CoachReply` |
| `DELETE` | `/api/coach` | Kasuje wszystkie `coach_messages` usera |

Każda trasa wymaga zalogowanego użytkownika (Supabase `getUser()`).

---

## Baza danych

Migracja: `supabase/migrations/0003_coach.sql`

```sql
coach_messages (
  id         uuid PRIMARY KEY,
  user_id    uuid REFERENCES auth.users,
  role       text CHECK (role IN ('user','model')),
  content    text,
  created_at timestamptz DEFAULT now()
)
```

RLS policy `"own coach messages"`: wszystkie operacje tylko gdy
`user_id = auth.uid()`. Dodatkowy jawny filtr `.eq('user_id', user.id)` w
`DELETE` jako defense-in-depth.

---

## Kluczowe pliki

| Plik | Rola |
|---|---|
| `src/lib/coach/types.ts` | Wspólny kontrakt A↔C: `UserStrategy`, `Recommendation`, `CoachTurn`, `CoachReply` |
| `src/lib/coach/agent.ts` | Wywołanie Gemini, budowanie system instruction, parsing |
| `src/lib/coach/recommendationCatalog.ts` | 13 kategorii, `catalogForPrompt()` |
| `src/lib/coach/strategyClient.ts` | `getRecommendations()` + `mockRecommendations()` fallback |
| `src/lib/store/coachStore.ts` | Zustand: messages, status, onboarding, strategy, recommendations |
| `src/app/api/coach/route.ts` | GET / POST / DELETE; `buildUserContext()` |
| `src/components/agents/CoachPanel.tsx` | UI czatu: bąbelki, rekomendacje, przycisk Reset |
| `src/components/agents/CoachIntroPopup.tsx` | Jednorazowy popup desktop przy pierwszym wejściu |
| `supabase/migrations/0003_coach.sql` | Tabela + RLS |
| `public/coach-icon.svg` | Ikona agenta (sidebar + header panelu + favicon) |

---

## Zmienne środowiskowe

| Zmienna | Kiedy |
|---|---|
| `GEMINI_API_KEY` | zawsze (Coach wymaga Gemini) |
| `GEMINI_API_KEYS` | opcjonalnie — CSV kilku kluczy do round-robin (`src/lib/apiKeys.ts`) |

---

## Znane pułapki

| Problem | Fix |
|---|---|
| POST 500 po kilku turach | Brak `thinkingBudget: 0` — Flash zjada tokeny na myślenie |
| GET 500 przy pierwszym wejściu | Migracja `0003_coach.sql` nie wgrana — wykonaj w Supabase SQL Editor |
| Bot nie startuje onboardingu | `messages.length === 0` w store → kickoff tura `ONBOARDING_KICKOFF` wysyłana automatycznie w `init()` |
| `onboardingComplete: true` bez strategii | `coerceStrategy()` waliduje kształt — jeśli profil niepełny, traktuje jako `false` |
| Rekomendacje zawsze te same 3 tickery | Stary katalog 3-tickerowy — zastąpiony 13-kategoriowym w `recommendationCatalog.ts` |

---

## Testy

`cypress/e2e/coach.cy.ts` — 5 testów (wszystkie backendy stubowane przez `cy.intercept`):

1. Pierwsze wejście → powitanie i pierwsze pytanie onboardingu
2. Wysłanie wiadomości → odpowiedź bota dopisana do wątku
3. Zakończenie onboardingu → sekcja rekomendacji widoczna
4. Pierwszy launch → popup powitalny; CTA otwiera Coacha
5. Reset → DELETE, czyszczenie stanu, onboarding od nowa
