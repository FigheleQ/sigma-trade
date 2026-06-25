# Plan pracy zespołu — Faza „bot + portfel" (dokument lokalny, w .gitignore)

Trzy osoby pracują **równolegle, w jednym ciągu**. Ten plik to umowa, jak to zgrać,
żeby git się nie palił. Każdy ma swój szczegółowy plik:

- **A — [Coach / witający chatbot](A-coach-chatbot.md)** *(Paweł)*
- **B — [Stop-loss / take-profit + domknięcie portfela](B-stop-loss-take-profit.md)**
- **C — [Strategy / rekomendacje + onboarding](C-strategy-recommendations.md)**

> Cała trójka: najpierw przeczytaj swój plik **i** sekcję „Pliki-zapalniki" niżej,
> dopiero potem koduj.

---

## Złota zasada: contract-first

90% konfliktów w tym setupie bierze się z trzech osób edytujących te same pliki.
Dlatego **dzień 1 = jeden wspólny mały PR do `main`** (robi go integration-owner, patrz niżej),
który z góry dodaje wszystkie „sloty", nawet jako stuby:

1. **Wspólne typy** (TS) — interfejsy, po których się łączycie:
   - `src/lib/coach/types.ts` → `UserStrategy`, `CoachMessage`, `Recommendation`
   - rozszerzenie `src/lib/portfolio/types.ts` → typy zleceń SL/TP
2. **Pliki-zapalniki** wypełnione od razu (patrz lista) — flagi, `AgentId`, ikony, wpisy w tablicy `agents`.
3. **Szkielety migracji** z przydzielonymi numerami (patrz niżej).
4. **Stuby paneli** (puste komponenty), żeby `DashboardClient` był kompletny.

Po tym PR każdy pracuje w swoim katalogu i tylko **przełącza `enabled: true`** oraz
**podmienia swój stub** na prawdziwy kod. Nikt nie wraca do plików-zapalników.

---

## Pliki-zapalniki (dotykać tylko w PR contract-first, potem prawie nigdy)

| Plik | Co tam jest wspólnego | Jak unikać kolizji |
|---|---|---|
| [config.yaml](../../config.yaml) | flagi `features.*` | dodać **wszystkie** flagi naraz w PR 1 |
| [src/app/dashboard/page.tsx](../../src/app/dashboard/page.tsx) | tablica `agents[]` | wpisać wszystkie agenty w PR 1 |
| [src/components/agents/AgentSidebar.tsx](../../src/components/agents/AgentSidebar.tsx) | typ `AgentId`, `AGENT_ICONS` | komplet ikon w PR 1 |
| [src/app/dashboard/DashboardClient.tsx](../../src/app/dashboard/DashboardClient.tsx) | montaż paneli agentów | stuby w PR 1, potem podmiana 1:1 |
| `supabase/migrations/` | DDL | jedna migracja na osobę, numery z góry |
| `src/store/*` | Zustand stores | każdy ma **własny** store (`coachStore`, nie wspólny) |

---

## Migracje — numery przydzielone z góry (append-only, nigdy nie edytuj cudzej)

| Numer | Właściciel | Zawartość |
|---|---|---|
| `0001_portfolio_schema.sql` | (jest) | portfele, pozycje, trades, price_cache + RLS |
| `0002_orders_sl_tp.sql` | **B** | tabela `pending_orders` (SL/TP) + RLS + RPC `execute_order` |
| `0003_coach.sql` | **A** | `coach_messages` + RLS |
| `0004_user_strategy.sql` | **C** | `user_strategy` (profil, budżet, rekomendacje) + RLS |

Każda migracja: idempotentna (`if not exists` / `drop policy if exists`), RLS oparte
o `auth.uid()` — wzorzec masz w `0001`. **Bez RLS dane wyciekają między userami.**

---

## Wspólny workflow (każda funkcja, każda osoba)

Dokładnie ta kolejność — to jest „roadmapa" z polecenia:

1. **Przeczytaj** pliki wymienione w swoim dokumencie (sekcja „Najpierw przeczytaj").
2. **Wprowadź funkcjonalność** w swoim pionie (katalog + migracja + API route + UI).
3. **Przetestuj lokalnie**: `npm run dev`, klik przez UI; `npm run typecheck` i `npm run lint` muszą przejść.
4. **Dodaj testy Cypress** (`cypress/e2e/<twoja-funkcja>.cy.ts`) — wzorzec: stubuj backend przez
   `cy.intercept`, nie dotykaj prawdziwej bazy (patrz [portfolio.cy.ts](../../cypress/e2e/portfolio.cy.ts)).
   Uruchom: `npm run cy:run:win`.
5. **Jak wszystko działa → push** (mały PR do `main`, za flagą `enabled: false` dopóki niegotowe).

### Reguły gita
- Krótkie gałęzie, **rebase codziennie** na `main`. Zero tygodniowych branchy.
- Merguj często „na ciemno" za feature-flagą — niedokończone, ale nie psuje `main`.
- **Integration-owner = A (Paweł).** Tylko on rusza `DashboardClient`/`AgentSidebar` po PR 1,
  gdyby jednak trzeba; reszta zgłasza mu zmianę zamiast edytować sama.

---

## Optymalizacja API — pula kluczy (Gemini + Finnhub)

Darmowe limity (Gemini free, Finnhub 60/min, TwelveData 8/min) to wąskie gardło przy wielu userach.
Rozwiązanie: **kilka kluczy + rotacja/failover na 429**. To **wspólne zadanie — robi je integration-owner
w PR 1** (dotyka `analyzer.ts` i `prices.ts`, więc nie chcemy trzech osób w tych plikach).

Wzorzec — nowy plik `src/lib/apiKeys.ts`:

```ts
// Czyta np. GEMINI_API_KEYS="k1,k2,k3" (albo pojedynczy GEMINI_API_KEY jako fallback).
// Round-robin + przeskok na kolejny klucz gdy 429.
function pool(envList: string, envSingle: string): string[] {
  const multi = (process.env[envList] ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (multi.length) return multi;
  const one = process.env[envSingle];
  return one ? [one] : [];
}
export const geminiKeys  = () => pool('GEMINI_API_KEYS',  'GEMINI_API_KEY');
export const finnhubKeys = () => pool('FINNHUB_API_KEYS', 'FINNHUB_API_KEY');

let gi = 0, fi = 0;
export const nextGeminiKey  = () => { const k = geminiKeys();  return k[gi++ % k.length]; };
export const nextFinnhubKey = () => { const k = finnhubKeys(); return k[fi++ % k.length]; };
```

Wpięcie:
- [analyzer.ts](../../src/lib/news/analyzer.ts) `callGemini` → klucz z `nextGeminiKey()`, a na `RateLimitError`
  retry raz na kolejnym kluczu, dopiero potem fallback.
- [prices.ts](../../src/lib/portfolio/prices.ts) `fetchFinnhubQuote` → klucz z `nextFinnhubKey()`,
  na `429`/`!res.ok` retry na kolejnym kluczu.

`.env.local` (nie commitować — `.gitignore` już je trzyma):
```
GEMINI_API_KEYS=klucz_konta_1,klucz_konta_2
FINNHUB_API_KEYS=klucz_konta_1,klucz_konta_2
```

> Stare pojedyncze `GEMINI_API_KEY` / `FINNHUB_API_KEY` dalej działają (fallback w `pool()`),
> więc to zmiana niełamiąca.

---

## Definition of done (każda osoba przed pushem)
- [ ] `npm run typecheck` zielony (TS strict — zero `any`)
- [ ] `npm run lint` zielony
- [ ] działa lokalnie po kliknięciu w UI **na świeżym userze** (nowe konto = pusty stan)
- [ ] RLS: sprawdzone na 2 różnych kontach, że user nie widzi cudzych danych
- [ ] testy Cypress dla nowej ścieżki przechodzą (`cy:run:win`)
- [ ] funkcja domyślnie za flagą, jeśli jeszcze niedopięta
