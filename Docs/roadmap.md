# Roadmap — Sigma Trade

Wizja: paper trading z live data + zespół wyspecjalizowanych agentów AI.
Ten plik zastępuje wcześniejszy obszerny `PHASE_1_PLAN.md` (draft wizji) —
zostawiamy tu tylko aktualny status i kierunek.

---

## ✅ Gotowe

- Scaffold Next.js + Tailwind + design system
- Layout dashboardu (TopBar, Market View, Agent Workspace)
- Wykres (Lightweight Charts) — TwelveData świece + Finnhub quote, auto-resize
- Watchlist z sekcjami, DnD, ulubionymi, search
- **News Agent** — fetch z Finnhub, dedup, analiza AI on-demand (Gemini/Claude)
- **Logowanie** (Supabase Auth) + ochrona tras (middleware) — `features/auth.md`
- **Portfel / paper trading** (Supabase) — kup/sprzedaj, pozycje, historia, P/L,
  cache cen — `features/portfolio.md`
- CI/CD (GitHub Actions + Vercel) + testy e2e (Cypress)

---

## 🔜 Następne

### Portfel — domknięcie
- Ekran wyboru balansu startowego (10k / 50k / 100k) — teraz na sztywno 100k
- Reset portfela
- Pełna blokada handlu przy zamkniętej giełdzie (teraz tylko komunikat)
- Atomowość zleceń (funkcja Postgres/RPC zamiast sekwencji zapytań)

### Agenci (Faza 2)
Każdy ma zdefiniowany kontrakt I/O (TypeScript) — szczegóły w historii projektu.

| Agent | Rola | Źródło danych |
|---|---|---|
| **Technical Analyst** | wskaźniki OHLCV (RSI, MACD, SMA…), sygnały | TwelveData |
| **Sentiment** | sentyment z social media | Reddit API |
| **Orchestrator** | synteza News + Technical + Sentiment → rekomendacja | — |
| **Coach** | monitoring decyzji usera, edukacja, debrief po trade'ach | — |
| **Strategy** | profil inwestycyjny (`UserStrategy`) z konwersacji | — |

### Onboarding
- Knowledge quiz (poziom: beginner/intermediate/advanced)
- Strategy setup → `UserStrategy`
- Guided first trade

### Interaktywny czat (ChatBlock)
Typy `TextBlock / NewsCardBlock / AlertCardBlock / TrendInsightBlock` są w
`src/lib/news/types.ts`, ale brak komponentów renderujących — zaczep pod
Orchestratora.

---

## Otwarte decyzje techniczne

- WebSocket do real-time cen (Finnhub `/ws`) vs obecny polling + cache
- Rate limiting / kolejka żądań przy wielu userach (Twelveable 8/min to wąskie gardło)
- Storage strategii i historii agentów (kolejne tabele Supabase)
