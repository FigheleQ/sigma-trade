# Coach Agent (AI v2)

Interaktywny chatbot AI wbudowany w dashboard. Prowadzi nowego użytkownika przez
onboarding (sloty profilu), a potem działa jako edukacyjny coach inwestycyjny.
Multi-turn czat na Gemini, historia w Supabase.

**AI v2** (2026-11) przebudował Coacha pod darmowy tier Gemini:
twarde guardraile (lokalny gate, 0 wywołań API), onboarding na jawnej maszynie
slotów, deterministyczny silnik portfela (model tylko go opisuje), jeden wspólny
klient Gemini z `responseSchema` i tieringiem modeli, telemetria kosztu.

---

## Flow tury (POST /api/coach)

Kolejność jest kluczowa — najtańsze odcięcia są pierwsze:

```
POST { message, strategy? }                 (legacy { history } nadal działa)
 1. limit per user  RPM (pamięć) / RPD (DB)   → 429 + własny komunikat   · 0 wywołań
 2. budżet nadużyć  (3× off-topic → blokada)  → szablon                  · 0 wywołań
 3. lokalny gate    guard.ts (heurystyki)     → szablon off_topic/inj.   · 0 wywołań
 4. ambiguous?      Flash-Lite, 8 tokenów out → szablon albo dalej      · 1 lekkie
 5. sloty           parser lokalny → (Flash-Lite, gdy nie rozpoznał)    · 0–1 lekkie
 6. plan            allocate.ts (gdy profil właśnie domknięty)          · 0 wywołań AI
 7. czat            Flash, prompt v2 + historia z DB (≤ 8 wiadomości)    · 1 wywołanie
 8. walidacja       offTopic z modelu → szablon; tickery narracji ⊂ plan
 9. after()         streszczenie starszych tur (Flash-Lite), telemetria
```

Odpowiedź ma dzisiejszy kształt `CoachReply` (`reply`, `onboardingComplete`,
`strategy`) plus pola addytywne: `offTopic`, `gate`, `recommendations?`.
Nagłówki diagnostyczne: `x-coach-gate`, `x-gemini-calls`.

---

## Guardrails

### Warstwa 1 — `src/lib/ai/guard.ts` (darmowa)

`classifyIntent(text, ctx)` → `in_scope | off_topic | injection | ambiguous`:

| Sygnał | Przykłady | Wynik |
|---|---|---|
| Injection (pierwszeństwo) | „ignore previous instructions", „you are now", „reveal your system prompt", „answer only in polish", `<system>` | `injection` |
| Typ prośby spoza roli | „write a poem…", „write code…", „translate…" | `off_topic` (nawet z „stocks") |
| Arytmetyka | `2+2`, „ile to 2+2", „what is 7 x 8" | `off_topic` |
| Off-topic bez finansów | pogoda, przepisy, sport, geografia, historia („kto jest królem Polski"), celebryci, zdrowie, polityka | `off_topic` |
| Leksykon finansowy / tickery z katalogu | ETF, buy, stop loss, NVDA, $TSLA | `in_scope` |
| Sprzeczne sygnały | „apple pie recipe" | `ambiguous` |
| Brak sygnałów + czekamy na slot | „50k", „medium" | `in_scope` |

PL i EN obsługiwane jednym zestawem wzorców (normalizacja bez ogonków).
Szablony to **jedno zdanie** bez moralizowania; w trakcie onboardingu od razu
przekierowują na brakujące pytanie.

Pary off-topic są zapisywane z `coach_messages.off_topic = true` (UI je
przygasza), ale **pomijane** przy budowie historii dla modelu.

**Budżet nadużyć:** 3 off-topic pod rząd → blokada na `offtopic_window_minutes`
(stan w `coach_threads` + pamięć procesu). W blokadzie każda wiadomość dostaje
szablon, model nie jest wołany wcale.

### Warstwa 2 — prompt + `responseSchema`

Sekcja SCOPE w prompcie + pole `offTopic: boolean` w schemacie. Gdy model
oznaczy off-topic (przeciek gate'a), serwer **zastępuje** jego tekst szablonem
(jedno zdanie) i liczy przeciek do budżetu nadużyć.

---

## Onboarding na slotach

Sloty wymagane (w tej kolejności pytań): `level → interests → risk → budget`.
Opcjonalne, zbierane gdy user sam je poda: `horizonYears`, `monthlyContribution`,
`drawdownComfort`, `preferredInstruments`, `dividendPreference`, `exclusions`.

- Stan w `coach_threads.slots` (JSONB). Bez migracji 0006 — pamięć procesu.
- Ekstrakcja: **lokalny parser** (`slots.ts`, 0 wywołań) → gdy nie rozpoznał
  odpowiedzi na zadane pytanie → **Flash-Lite** z jednopolowym `responseSchema`.
- Prompt dostaje `MISSING SLOTS: [...]` i pyta o pierwszy brakujący.
- **„Onboarding complete" decyduje kod** (`coerceStrategy` w `strategy/validate.ts`),
  nie model. `slotUpdates` z czatu są walidowane i przyjmowane tylko dla
  brakujących slotów.
- Błąd Gemini w trakcie onboardingu nie blokuje: odpowiedź to deterministyczne
  pytanie o kolejny slot.

---

## Prompt v2 (`src/lib/coach/prompt.ts`)

Najpierw część **stabilna** (identyczna dla każdego usera i tury), potem **zmienna**:

| # | Sekcja | Typ |
|---|---|---|
| 1 | ROLE | stabilna |
| 2 | SCOPE (hard rule) | stabilna |
| 3 | ADVICE (zasady + zakazy) | stabilna |
| 4 | ONBOARDING | stabilna |
| 5 | PLAN (narracja) | stabilna |
| — | USER PROFILE, PORTFOLIO, ALLOWED TICKERS (~14 z katalogu), MISSING SLOTS, SUMMARY, PORTFOLIO PLAN | zmienna |

Format wyjścia wymusza `responseSchema` (`{ reply, offTopic, slotUpdates? }`),
nie opis w prompcie.

**Cache:** implicit caching Gemini 2.5 Flash startuje od **2048 tokenów**
prefiksu (dokumentacja Gemini, 2026-11); explicit `cachedContents` nie jest
dostępny na darmowym tierze. Nasz cały prompt ma ~510–600 tokenów, więc
`cachedContent` **nie jest używany**. Stabilny prefiks zostaje (darmowy,
gotowy na płatny tier).

---

## Tiering modeli (`config.yaml → ai_provider.gemini`)

| Tier | Model | Do czego | max output |
|---|---|---|---|
| `chat` | gemini-2.5-flash | rozmowa, narracja planu | 512 |
| `light` | gemini-2.5-flash-lite | intent gate (8), sloty (32), streszczenia (96) | 32 |
| `analysis` | gemini-2.5-flash | News Analyzer (batch do 15 artykułów) | 4096 |

Limity darmowego tieru liczą się **per projekt i per model** — Flash-Lite ma
osobną (wyższą) pulę, więc lekkie zadania nie zjadają limitu czatu.
Stary kształt `gemini.model / max_tokens` działa jako fallback (`getGeminiSettings()`).

---

## Pomiar tokenów (countTokens, gemini-2.5-flash)

| Scenariusz | Przed (main) | Po (AI v2) | Zmiana |
|---|---:|---:|---:|
| system prompt — onboarding | 816 | 513 | −37% |
| system prompt — profil znany | 831 | 549 | −34% |
| system prompt — tura domknięcia (+plan) | 831 | 600 | −28% |
| tura: onboarding, 4 wiadomości historii | 976 | 673 | −31% |
| tura: 10. wymiana (20 wiadomości) | 1575 | 856 | −46% |
| tura: 25. wymiana (50 wiadomości) | 2673 | 856 | −68% |
| tura: off-topic „ile to 2+2" | 1139 | **0** | −100% |

Wyjście: `maxOutputTokens` 4096 → 512. Telemetria per tura: log `[ai-usage]`
(zawsze) + tabela `ai_usage_log` (flaga `coach_agent.usage_log`).

---

## API routes

| Method | Endpoint | Opis |
|---|---|---|
| `GET` | `/api/coach` | Historia (z `offTopic`) + `needsOnboarding` + `isLegacyAccount` |
| `POST` | `/api/coach` | `{ message, strategy? }` → `CoachReply` + `offTopic`/`gate`/`recommendations?` |
| `DELETE` | `/api/coach` | Kasuje `coach_messages` i `coach_threads` usera |

Kody: `429` (limit per user / Gemini), `503` (cała pula kluczy niedostępna).

---

## Baza danych

- `0003_coach.sql` — `coach_messages` + RLS.
- `0006_coach_v2.sql` — `coach_messages.off_topic`, `coach_threads`
  (summary, summarized_until, slots, offtopic_streak, offtopic_locked_until),
  `ai_usage_log` (insert/select własnych wierszy).

Wszystko działa bez 0006 (degradacja do pamięci procesu / logów).

---

## Flagi (`features.coach_agent`)

| Flaga | Domyślnie | Co robi |
|---|---|---|
| `guardrails` | `true` | warstwa 1 + budżet nadużyć |
| `intent_gate` | `true` | mikro-wywołanie Flash-Lite dla `ambiguous` |
| `history_summary` | `true` | streszczanie starszych tur |
| `usage_log` | `false` | zapis telemetrii do `ai_usage_log` |

---

## Kluczowe pliki

| Plik | Rola |
|---|---|
| `src/lib/ai/gemini.ts` | Jedyny klient Gemini: schema, thinkingBudget 0, pula kluczy, usage |
| `src/lib/ai/errors.ts` | `RateLimitError`, `GeminiError` (re-export w `news/analyzer.ts`) |
| `src/lib/ai/guard.ts` | Lokalny gate, szablony, budżet nadużyć (czysty, testowany `cy.task`) |
| `src/lib/ai/intentGate.ts` | Flash-Lite dla `ambiguous` |
| `src/lib/ai/rateLimit.ts` | RPM / RPD per user |
| `src/lib/ai/telemetry.ts` | `[ai-usage]` + `ai_usage_log` |
| `src/lib/coach/prompt.ts` | Prompt v2 + `COACH_RESPONSE_SCHEMA` |
| `src/lib/coach/slots.ts` | Maszyna slotów + lokalny parser |
| `src/lib/coach/history.ts` | Historia z DB, przycinanie, streszczenia |
| `src/lib/coach/thread.ts` | `coach_threads` (z fallbackiem w pamięci) |
| `src/lib/coach/agent.ts` | `runCoachTurn` — tura po guardrails |
| `src/app/api/coach/route.ts` | Pipeline POST, GET, DELETE |
| `src/components/agents/RecommendationsBlock.tsx` | Karty rekomendacji + CTA |

---

## Znane pułapki

| Problem | Fix |
|---|---|
| POST 500 / pusta odpowiedź | Brak `thinkingBudget: 0` — Flash zjada budżet na myślenie. Klient ustawia 0 domyślnie. |
| HTTP 402 „prepayment credits are depleted" | Projekt Google bez środków. Klient przeskakuje na kolejny klucz z puli; gdy cała pula martwa → 503. Dodaj klucz z innego projektu do `GEMINI_API_KEYS`. |
| Klucze z jednego projektu nie zwiększają limitu | Limit free tier jest per projekt — klucze muszą być z różnych projektów. |
| `cachedContentTokenCount` zawsze 0 | Oczekiwane: prompt < 2048 tokenów (próg implicit cache 2.5 Flash). |
| Krótka odpowiedź („50k") odcięta jako off-topic | Gate dostaje `awaitingSlot` — sprawdź, czy `coach_threads.slots` się zapisuje (migracja 0006). |
| Bot pyta drugi raz o ten sam slot | Lokalny parser + Flash-Lite nie rozpoznały wartości — dopisz wzorzec w `slots.ts`. |
| Narracja z tickerem spoza planu | Odrzucana automatycznie → `deterministicNarration()` (log `narration rejected`). |
| GET 500 przy pierwszym wejściu | Migracja `0003_coach.sql` nie wgrana. |
| „car" dopasowywało „healthcare" | Naprawione — `matchCategories` dopasowuje prefiksy, nie podciągi. |

---

## Testy

- `cypress/e2e/coach.cy.ts` — 5 testów UI sprzed v2 (stuby `cy.intercept`).
- `cypress/e2e/coach-v2.cy.ts` — guardrails, sloty, karty rekomendacji, plany per profil.
- Logika (`guard.ts`, `slots.ts`, `allocate.ts`) testowana deterministycznie przez `cy.task` w Node.
