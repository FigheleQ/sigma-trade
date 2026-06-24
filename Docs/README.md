# Dokumentacja — Sigma Trade

Indeks. Każdy plik ma jedną odpowiedzialność.

| Plik | Co zawiera |
|---|---|
| **`architecture.md`** | Przegląd: stack, layout, struktura plików, podział Server/Client, reguły |
| **`CLAUDE.md`** | Zwięzły przewodnik dla AI (skrót architektury + pułapki) |
| **`roadmap.md`** | Co gotowe, co dalej (Faza 2: agenci, onboarding) |
| **`features/auth.md`** | Logowanie — Supabase Auth, middleware, sesje, wylogowanie |
| **`features/portfolio.md`** | Portfel paper-trading — schemat, ceny, zlecenia, UI |
| **`features/dca.md`** | DCA — cykliczny zakup „za X$ co tydzień" (cron w tle) |
| **`features/news-agent.md`** | Agent newsów — pipeline Finnhub + analiza AI |
| **`ci-cd.md`** | Pipeline: Vercel preview, GitHub Actions, deploy po tagu |
| **`testing.md`** | Testy e2e Cypress — uruchamianie, konwencje, CI |

## Gdzie zacząć
- **Nowy w projekcie** → `architecture.md`, potem odpowiedni `features/*`
- **Stawiasz lokalnie** → `architecture.md` (zmienne env) + uruchom migrację SQL
  z `supabase/migrations/` w Supabase
- **Co dalej z projektem** → `roadmap.md`

## Materiały do nauki kodu
Pogłębione materiały edukacyjne (deep-dive React/Next/Zustand, scenariusze
przepływu danych, pytania kontrolne) zostały przeniesione **poza repo**, do
folderu `Sigma Trade Learning` na pulpicie — to materiały do uczenia się, nie
referencja projektu.
