# A — Coach / witający chatbot (Paweł)

Witający mentor AI. Przy pierwszym logowaniu oprowadza po UI, bada poziom umiejętności,
zainteresowania i budżet, na tej podstawie proponuje rekomendacje, a potem działa jako
zwykły czat. Backend: **Gemini** (free tier). Jesteś też **integration-ownerem** (patrz README).

---

## 0. Najpierw przeczytaj

| Plik | Po co |
|---|---|
| [Docs/team/README.md](README.md) | zasady wspólne; **ty robisz PR contract-first i pulę kluczy API** |
| [Docs/features/news-agent.md](../features/news-agent.md) | wzorzec agenta + integracji AI |
| [src/lib/news/analyzer.ts](../../src/lib/news/analyzer.ts) | `callGemini`, `extractJson`, `RateLimitError` — bazuj na tym |
| [src/components/agents/AgentSidebar.tsx](../../src/components/agents/AgentSidebar.tsx) | slot `coach` (ikona `GraduationCap`) już istnieje |
| [src/app/dashboard/DashboardClient.tsx](../../src/app/dashboard/DashboardClient.tsx) | gdzie montuje się panel agenta + overlay mobilny |
| [src/lib/store/newsStore.ts](../../src/lib/store/newsStore.ts) | wzorzec store Zustand |

---

## 1. Kluczowa różnica vs News Agent: czat jest multi-turn

`analyzer.ts` robi **jeden strzał** (prompt → JSON). Czat wymaga **historii rozmowy**.
Gemini `contents` przyjmuje wiele tur z rolami `user` / `model`:

```ts
contents: [
  { role: 'user',  parts: [{ text: 'Cześć' }] },
  { role: 'model', parts: [{ text: 'Hej! Oprowadzę cię...' }] },
  { role: 'user',  parts: [{ text: '...' }] },
]
```

Persona + flow onboardingu → **system prompt** (`systemInstruction` w body Gemini).
Personalizacja → **kontekst w promicie** (poziom, budżet, watchlista, pozycje usera),
**nie** fine-tuning. Żadnego trenowania modelu — to tylko prompt + kontekst.

---

## 2. Zakres (twoje pliki — pion bez kolizji)

- `src/lib/coach/types.ts` — **wspólny kontrakt** (`UserStrategy`, `CoachMessage`, `Recommendation`).
  > To czytają A i C. Ustal z C w PR contract-first, potem zamrożone.
- `src/lib/coach/agent.ts` — server-only: `chat(history, userContext)` → wywołanie Gemini (multi-turn).
- `src/app/api/coach/route.ts` — `POST` z historią → odpowiedź; zapis do `coach_messages`.
- `src/lib/store/coachStore.ts` — Zustand: wiadomości, status, `isOnboarded`.
- `src/components/agents/CoachPanel.tsx` — UI czatu (lista wiadomości + input).
- migracja `0003_coach.sql` — `coach_messages` (RLS po `auth.uid()`).

**Onboarding flow:** wykryj „pierwsze logowanie" (brak `UserStrategy` u C / brak wiadomości) →
bot prowadzi skryptowaną rozmowę (powitanie → quiz poziomu → zainteresowania → budżet) →
woła endpoint C (`generateRecommendations`) → pokazuje rekomendacje → przechodzi w wolny czat.

---

## 3. Integracja z C (kontrakt, nie kod)

Ty **rozmawiasz**, C **liczy profil i rekomendacje**. Łączycie się przez:
- `UserStrategy` (zapisuje C, czytasz ty jako kontekst do promptu),
- `GET /api/strategy` (czytasz profil) i `POST /api/strategy/recommendations` (C zwraca listę tickerów).

Dopóki C nie skończy → **mockuj** te endpointy lokalnie (zwróć przykładowy `UserStrategy`),
żebyś nie był zablokowany.

---

## 4. Twoje zadania integration-ownera (PR contract-first, dzień 1)

1. `coach` i `strategy` flagi już są w [config.yaml](../../config.yaml) — zostaw, włączysz później.
2. `AgentId`/ikony — `coach` już jest; nic nie dodajesz, chyba że dojdzie `strategy` jako osobny agent (uzgodnij z C).
3. Zamontuj **stuby** `CoachPanel` w `DashboardClient` (desktop panel + mobilny overlay — wzorzec NewsFeed).
4. Załóż `src/lib/coach/types.ts` z uzgodnionymi typami.
5. Wprowadź **pulę kluczy API** (`src/lib/apiKeys.ts`) i wepnij w `analyzer.ts` + `prices.ts` — patrz [README](README.md#optymalizacja-api--pula-kluczy-gemini--finnhub).

---

## 5. Multi-user / RLS
- `coach_messages` z RLS po `auth.uid()` (wzorzec z `0001`).
- Historia rozmowy zawsze filtrowana po zalogowanym userze; zero zahardkodowanego id.
- Świeży user = pusty wątek → bot startuje onboarding, nie crashuje.

---

## 6. Testy lokalne → Cypress → push
1. `npm run dev`: nowe konto → bot wita i prowadzi onboarding; istniejące → wolny czat.
2. `npm run typecheck` + `npm run lint` zielone.
3. Cypress `cypress/e2e/coach.cy.ts` (stub `POST /api/coach` przez `cy.intercept`):
   - [ ] pierwsze logowanie → widać powitanie i pierwsze pytanie onboardingu
   - [ ] wysłanie wiadomości → odpowiedź bota dopisana do wątku
   - [ ] po onboardingu → widać sekcję rekomendacji (stub z `/api/strategy/recommendations`)
   - `npm run cy:run:win`
4. Push: mały PR, za flagą `coach_agent.enabled` dopóki niegotowe.
