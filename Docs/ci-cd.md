# CI/CD — Instrukcja dla developera

## Architektura pipeline'u

Pipeline składa się z trzech warstw:

| Warstwa | Trigger | Narzędzie | Co robi |
|---|---|---|---|
| Preview builds | Każdy commit w otwartym PR | Vercel GitHub Integration | Automatyczny URL podglądu widoczny w zakładce "Checks" PR |
| Quality checks | Każdy PR do `main` | GitHub Actions (`ci.yml`) | Lint, typecheck, build — wymagane przed mergem |
| Production deploy | Push tagu `v*` | GitHub Actions (`deploy-production.yml`) | Checks → deploy na Vercel Production |

Wszystko działa na **darmowych tierach** (Vercel Hobby + GitHub Actions free).

---

## Etap 0 — Jednorazowe przygotowanie (kroki ręczne)

### 1. Utwórz projekt na Vercel

1. Wejdź na [vercel.com](https://vercel.com) i zaloguj się kontem GitHub.
2. Kliknij **Add New Project** → wybierz repozytorium `sigma-trade`.
3. Framework powinien zostać wykryty automatycznie jako **Next.js**. Root Directory: zostaw domyślne (`.`).
4. W sekcji **Environment Variables** dodaj:
   - `FINNHUB_API_KEY`
   - `GEMINI_API_KEY`
   - `TWELVEDATA_API_KEY`
   Ustaw je dla środowisk **Production** i **Preview**.
5. Kliknij **Deploy** — Vercel wykona pierwszy deploy i połączy się z repozytorium.

> Po tym kroku Vercel automatycznie tworzy preview URL dla każdego PR — bez dodatkowej konfiguracji.

### 2. Wyłącz automatyczny deploy produkcyjny z Vercela

Chcemy, żeby deploy produkcyjny był wyzwalany wyłącznie przez tagi, nie przez push do `main`.

1. W panelu Vercel → **Settings** → **Git**.
2. W sekcji **Production Branch** zmień wartość z `main` na nieistniejący branch, np. `release` (albo skorzystaj z opcji wyłączenia produkcyjnych deployów jeśli jest dostępna w Twoim UI).

> Alternatywnie: możesz zostawić automatyczny deploy i traktować tag-based deploy jako wymóg procesu zespołowego, a nie techniczne ograniczenie.

### 3. Pobierz dane projektu Vercel

Te wartości są potrzebne jako sekrety GitHub:

```bash
# Zainstaluj Vercel CLI globalnie
npm i -g vercel

# Połącz lokalny projekt z Vercelem (uruchom z katalogu sigmatrade/)
cd sigmatrade
vercel link

# Po linkowaniu znajdziesz dane w pliku .vercel/project.json
cat .vercel/project.json
# → { "orgId": "...", "projectId": "..." }
```

### 4. Dodaj sekrety do repozytorium GitHub

Wejdź na GitHub → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

Dodaj następujące sekrety:

| Nazwa sekretu | Skąd wziąć |
|---|---|
| `VERCEL_TOKEN` | vercel.com → Settings → Tokens → Create |
| `VERCEL_ORG_ID` | `.vercel/project.json` → pole `orgId` |
| `VERCEL_PROJECT_ID` | `.vercel/project.json` → pole `projectId` |
| `FINNHUB_API_KEY` | Twój klucz API Finnhub |
| `GEMINI_API_KEY` | Twój klucz API Google Gemini |
| `TWELVEDATA_API_KEY` | Twój klucz API Twelve Data |

> **Ważne:** nie commituj `.vercel/project.json` do repozytorium (jest już w `.gitignore`).

### 5. Skonfiguruj Branch Protection Rules

To sprawia, że CI staje się wymaganym warunkiem przed mergem PR.

1. GitHub → **Settings** → **Branches** → **Add branch ruleset**.
2. Ustaw **Target branches** → `main`.
3. W sekcji **Require status checks to pass**:
   - Zaznacz **Require branches to be up to date before merging**.
   - Dodaj wymagane checki (wyszukaj po nazwie, pojawią się po pierwszym uruchomieniu CI):
     - `Lint (ESLint)`
     - `Type Check`
     - `Build`
4. Kliknij **Save changes**.

> Tip: checki pojawią się na liście dopiero po pierwszym uruchomieniu workflow — utwórz testowy PR, poczekaj aż CI się wykona, a potem wróć do tych ustawień.

---

## Etap 1 — Preview builds dla Pull Requestów

Po wykonaniu Etapu 0 preview builds działają automatycznie.

**Przepływ:**
1. Developer otwiera PR do `main`.
2. Vercel wykrywa nowy commit w PR i uruchamia build.
3. Po zakończeniu buildu w zakładce **Checks** PR pojawia się:
   - `Vercel — Preview Deployment` z linkiem do unikalnego URL.
4. Każdy kolejny commit w PR odświeża preview URL.

Nie ma tu żadnego pliku GitHub Actions — to natywna integracja Vercela.

---

## Etap 2 — Deploy produkcyjny po tagach

**Przepływ:**
```bash
# Utwórz tag i wypchnij go do repozytorium
git tag v1.2.0
git push origin v1.2.0
```

1. GitHub Actions wykrywa push tagu pasującego do wzorca `v*`.
2. Uruchamia workflow `deploy-production.yml`:
   - Job `quality`: lint + typecheck + build — jeśli cokolwiek failuje, deploy nie startuje.
   - Job `deploy`: `vercel pull → vercel build --prod → vercel deploy --prebuilt --prod`.
3. URL produkcyjny pojawia się w podsumowaniu workflow i w sekcji **Deployments** na GitHubie.

**Konwencja tagów:** używaj [Semantic Versioning](https://semver.org/) — `vMAJOR.MINOR.PATCH`, np. `v1.0.0`, `v1.2.3`.

---

## Etap 3 — Wymagane checks przed mergem

Workflow `ci.yml` uruchamia trzy równoległe joby dla każdego PR:

| Job | Polecenie | Co sprawdza |
|---|---|---|
| `Lint (ESLint)` | `npm run lint` | ESLint + reguły Next.js (import order, React hooks, itp.) |
| `Type Check` | `npm run typecheck` | TypeScript bez emitowania plików (`tsc --noEmit`) |
| `Build` | `npm run build` | Pełny build Next.js — wykrywa błędy kompilacji i SSG |

Merge do `main` jest **zablokowany** dopóki wszystkie trzy checki nie przejdą (wymaga skonfigurowania Branch Protection Rules z Etapu 0, krok 5).

---

## Planowane rozszerzenia (do zrobienia)

### Testy jednostkowe / integracyjne

Projekt aktualnie nie ma testów. Warto zaplanować osobny task na pokrycie kluczowych komponentów. Rekomendowany stack:

- **Vitest** — szybki test runner kompatybilny z Next.js, drop-in replacement dla Jest
- **React Testing Library** — testy komponentów z perspektywy użytkownika
- **@testing-library/user-event** — symulacja interakcji

Gdy testy zostaną dodane, dopisz job `test` do `ci.yml`:

```yaml
  test:
    name: Tests
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: sigmatrade
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: sigmatrade/package-lock.json
      - run: npm ci
      - run: npm test -- --run
```

I dodaj `Tests` do wymaganych checków w Branch Protection Rules.

---

## Pytania i odpowiedzi

**Q: Czy to wszystko działa na darmowych planach?**

Tak. Vercel Hobby (darmowy) obsługuje nieograniczone preview i production deploye, integrację z GitHub i środowiska zmiennych. GitHub Actions jest darmowe dla publicznych repozytoriów; dla prywatnych repozytoriów limit to 2000 min/miesiąc, co wystarczy na setki buildów.

**Q: Jak zmienić środowiskowe zmienne bez rebuild?**

W panelu Vercel → **Settings** → **Environment Variables**. Zmiana wymaga nowego deployu żeby weszła w życie.

**Q: Jak sprawdzić logi nieudanego deployu?**

GitHub: zakładka **Actions** → kliknij nieudany workflow. Vercel: panel projektu → zakładka **Deployments** → kliknij deploy.

**Q: Co jeśli chcę zdeployować hotfix poza tagiem?**

Wypchnij tag z przyrostkiem patch, np. `v1.2.1`. Alternatywnie możesz ręcznie uruchomić `vercel deploy --prod` z lokalnego terminala.
