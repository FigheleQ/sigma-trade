# A ↔ C — współpraca, konflikty i workflow

Jak **A (Coach / czat)** i **C (Strategy / rekomendacje + onboarding)** pracują
**równolegle na osobnych branchach**, nie wchodząc sobie w pliki. Dokument
spina kontrakt z [A-coach-chatbot.md](A-coach-chatbot.md) i
[C-strategy-recommendations.md](C-strategy-recommendations.md) oraz zasady z
[README.md](README.md).

> TL;DR: **A rozmawia, C liczy.** Łączą się przez `types.ts` (zamrożony kontrakt)
> i HTTP (`/api/strategy*`). Poza tym każdy siedzi w swoim katalogu. A jako
> integration-owner mockuje endpointy C, więc nie czeka na C i odwrotnie.

---

## 1. Podział odpowiedzialności

| | **A — Coach** | **C — Strategy** |
|---|---|---|
| Rola | prowadzi rozmowę, onboarding, wolny czat | buduje profil `UserStrategy`, liczy `Recommendation[]` |
| Backend AI | Gemini multi-turn (`contents` + `systemInstruction`) | reguły + Finnhub `recommendation` (opcjonalnie Gemini ranking) |
| UI | `CoachPanel` (czat) | `BalanceChooser` (ekran budżetu) |
| Baza | `coach_messages` (`0003`) | `user_strategy` (`0004`) |
| Branch | `new-AI-agent-coach` | `new-AI-agent-strategy` (proponowana nazwa) |

---

## 2. Granica integracji (jedyne punkty styku)

1. **Wspólny typ** — [`src/lib/coach/types.ts`](../../src/lib/coach/types.ts):
   `UserStrategy`, `Recommendation`, `CoachUserContext` + typy czatu. **Współwłasność.**
2. **HTTP** — A woła endpointy C:
   - `GET /api/strategy` → profil usera (kontekst do promptu),
   - `POST /api/strategy` → zapis profilu po onboardingu,
   - `POST /api/strategy/recommendations` → lista tickerów do pokazania w czacie.

A nie importuje kodu C i odwrotnie — **tylko `types.ts` i fetch**. Dzięki temu
oba piony kompilują się niezależnie.

### Mock-fallback (czemu nikt nie jest zablokowany)
A trzyma cały styk z C w jednym pliku:
[`src/lib/coach/strategyClient.ts`](../../src/lib/coach/strategyClient.ts).
Dopóki route'y C nie istnieją, `getRecommendations` / `saveStrategy` dostają 404
i **spadają na lokalny mock** (deterministyczny: inny zestaw dla
`beginner/low` niż `advanced/high`). Gdy C wejdzie na `main`, ten sam kod
**bez zmian** zaczyna używać prawdziwych danych. A buduje i testuje pełny flow
zanim C skończy.

---

## 3. Gdzie mogą wybuchnąć konflikty (i jak ich uniknąć)

| Plik / obszar | Ryzyko | Zasada |
|---|---|---|
| `src/lib/coach/types.ts` | **wysokie** — edytują oboje | Zmiana = **wspólny mini-PR**, oboje review. Między zmianami traktować jak zamrożony. Dodajesz pole? Najpierw uzgodnij kształt, potem jeden commit. |
| `config.yaml` (flagi) | średnie | A rusza tylko `coach_agent`, C tylko `strategy_agent`. **Różne klucze = brak konfliktu treści**, ale ten sam plik → kto drugi, robi `git rebase` (zmiana to 1 linia). |
| `supabase/migrations/` | niskie | Numery przydzielone z góry: A=`0003`, C=`0004`. Append-only, **nigdy nie edytuj cudzej migracji**. |
| `DashboardClient.tsx` / `AgentSidebar.tsx` | średnie | **A jest integration-ownerem.** Coach jest już zamontowany. Jeśli C chce osobny agent `strategy` (ikona + slot), **zgłasza A**, nie edytuje sam. Dziś onboarding C wisi pod Coachem → C nie musi tu nic ruszać. |
| `src/lib/portfolio/service.ts` (`DEFAULT_BALANCE`) | **C↔B, nie A** | `BalanceChooser` C zmienia sygnaturę `getOrCreatePortfolio` (parametr zamiast stałej). To uzgodnienie **C z B**. A tego nie dotyka. |
| `src/lib/apiKeys.ts` | niskie | Owner = A (PR contract-first). Jeśli C użyje Gemini do rankingu — **reuse** `nextGeminiKey()`, nie duplikuj integracji. |

### Subtelny konflikt logiczny: kto decyduje o onboardingu?
Źródłem prawdy „czy oprowadzać usera" jest **historia Coacha** (`GET /api/coach
→ needsOnboarding`), **nie** obecność profilu u C. Powód: konto może mieć
`user_strategy` z wcześniejszych testów C, a i tak nie przeszło rozmowy z botem.
Dodatkowo konta **sprzed 25.06.2026** (w tym deweloperskie) są legacy →
**zawsze** dostają pierwsze oprowadzanie. C nie nadpisuje tej decyzji —
po prostu dostarcza profil i rekomendacje, gdy A go o nie poprosi.

---

## 4. Workflow równoległy (oba branche naraz)

1. **Dzień 1 — contract-first (zrobione przez A).** `types.ts`, `apiKeys.ts`,
   flagi, montaż `CoachPanel`, migracja `0003`. To baza, na której C buduje.
2. **C odbija się od tego stanu**: `git checkout -b new-AI-agent-strategy` z
   commita zawierającego `types.ts`. Importuje typy, pisze `0004` + route'y +
   `BalanceChooser`. Zero wspólnych plików poza `types.ts`.
3. **Krótkie gałęzie, `rebase` codziennie** na `main`. Każdy merguje za swoją
   flagą (`coach_agent` / `strategy_agent`) — niedokończone, ale nie psuje `main`.
4. **Kolejność integracji bezbolesna dzięki mockowi:**
   - A merguje pierwszy (Coach + mock C) → działa na mocku.
   - C merguje route'y → A automatycznie przeskakuje z mocka na realne dane.
5. **Definition of done** (z README): `typecheck` + `lint` zielone, RLS sprawdzone
   na 2 kontach, Cypress (`coach.cy.ts` / `strategy.cy.ts`) przechodzi.

### Checklista „handshake" A↔C (zanim zdejmiecie flagi)
- [ ] `types.ts` zgodne po obu stronach (oboje na tej samej wersji `main`).
- [ ] `POST /api/strategy/recommendations` zwraca `{ recommendations: Recommendation[] }`
      — dokładnie kształt, którego oczekuje `strategyClient.ts`.
- [ ] `GET /api/strategy` zwraca `UserStrategy | null` (null = brak profilu, nie 500).
- [ ] A przełącza `strategyClient` z mocka na realny endpoint = **bez zmian w kodzie**,
      tylko C musi istnieć. Zweryfikować na świeżym koncie.
- [ ] Świeży user: onboarding A → zapis profilu C → rekomendacje C → wolny czat.

---

## 5. Mapa plików (kto czego dotyka)

**A (ten branch):** `src/lib/coach/{types,agent,strategyClient}.ts`,
`src/lib/store/coachStore.ts`, `src/components/agents/CoachPanel.tsx`,
`src/app/api/coach/route.ts`, `supabase/migrations/0003_coach.sql`,
`src/lib/apiKeys.ts` (+ wpięcie w `analyzer.ts`/`prices.ts`),
montaż w `DashboardClient.tsx`, flaga `coach_agent`.

**C (osobny branch):** `src/lib/strategy/recommend.ts`,
`src/app/api/strategy/route.ts`, `src/app/api/strategy/recommendations/route.ts`,
`src/components/onboarding/BalanceChooser.tsx`,
`supabase/migrations/0004_user_strategy.sql`, flaga `strategy_agent`,
zmiana `DEFAULT_BALANCE`/sygnatury `getOrCreatePortfolio` (uzgodniona z B).

**Wspólne (zmiana tylko wspólnym PR):** `src/lib/coach/types.ts`.
