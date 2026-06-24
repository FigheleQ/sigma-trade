# Architektura — Sigma Trade

Paper-trading dashboard: realne ceny giełdowe, wirtualny portfel per user,
news z analizą AI. Logowanie + dane w Supabase (Postgres).

---

## Stack

| Warstwa | Technologia |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript strict |
| Style | Tailwind CSS, helper `cn()` z `@/lib/utils` (clsx + tailwind-merge) |
| Stan klienta | Zustand (`chartStore`, `newsStore`, `portfolioStore`, `watchlistStore`) |
| Auth + DB | Supabase (Auth + Postgres + RLS) |
| Wykres | Lightweight Charts v5 (TradingView) |
| Dane | Finnhub (quote, news), TwelveData (świece) |
| AI | Gemini (dev) / Claude (prod) — analiza newsów |
| Hosting / CI | Vercel + GitHub Actions; testy e2e: Cypress |

---

## Design system

| Token | Wartość | Klasa |
|---|---|---|
| Accent | `#00ff88` | `text-accent`, `bg-accent`, `ring-accent` |
| Tło | `#0a0a0a` | `bg-base` |
| Panel | `#111111` | `bg-panel` |
| Border | `#1f1f1f` | `border-subtle` |
| Font | JetBrains Mono | `font-mono` |

Dark mode wymuszony przez `class="dark"` na `<html>`.

---

## Layout dashboardu

```
TopBar (h-12): Sigma Trade · PortfolioSummary (value/P&L/cash) · ProfileButton
├── [MarketRail] [LeftPanel]  —  WYKRES + OrderPanel  —  [NewsFeed] [AgentSidebar]
     ikony lewe   Lista/Pozycje/Historia                news      ikony agentów
```

- **Lewy pasek ikon** (`MarketRail`) + treść (`LeftPanel`): Lista / Pozycje /
  Historia. Lustrzane odbicie panelu agentów po prawej.
- **Środek**: wykres (`StockChart`) + panel Kup/Sprzedaj (`OrderPanel`).
- **Prawy pasek** (`AgentSidebar`) + treść (`NewsFeed`): agenci AI.

---

## Podział Server / Client (App Router)

- **Server Components** — `dashboard/page.tsx` (czyta config, pobiera usera),
  `login/page.tsx`. Tu też API routes (`route.ts`) — **tylko** tu żyją klucze API.
- **Client Components** (`'use client'`) — wszystko z `useState`/`useEffect`/
  event handlerami/Zustand: `MarketView`, `NewsFeed`, `OrderPanel`, panele.

---

## Struktura plików (skrót)

```
src/
  middleware.ts                — strażnik tras (auth)
  app/
    dashboard/page.tsx         — Server Component, config + user
    login/                     — LoginForm + page
    api/
      auth/signout/route.ts
      chart/route.ts           — świece (TwelveData) + quote (Finnhub)
      quotes/route.ts          — watchlist, cache-backed (price_cache)
      news/{fetch,analyze}/route.ts
      orders/route.ts          — kup/sprzedaj (portfel)
      portfolio/route.ts       — stan portfela
      trades/route.ts          — historia
      symbol_search/route.ts
  components/
    market/                    — MarketView, StockChart, LeftPanel, MarketRail,
                                 OrderPanel, PositionsPanel, HistoryPanel,
                                 PortfolioSummary, TickerSidebar, ...
    agents/                    — AgentSidebar, NewsFeed
    ui/                        — ProfileButton, Tooltip
  lib/
    supabase/{client,server}.ts
    portfolio/{types,prices,service,format}.ts
    market/hours.ts
    news/{types,analyzer}.ts
    chart/{types,dataSource,mockData}.ts
    config.ts, utils.ts
  store/                       — chartStore, watchlistStore, portfolioStore
  lib/store/newsStore.ts
config.yaml                    — watchlist, feature flags, interwały
supabase/migrations/           — schemat SQL (portfel + RLS)
```

---

## Reguły architektoniczne

- `loadConfig()` (używa `fs`) — **tylko** w Server Components / API routes.
- `'use client'` — tylko gdy potrzebny stan lub event handler.
- `cn()` — zawsze przy warunkowym łączeniu klas.
- Bez zewnętrznych UI libraries (shadcn, MUI) — czysty Tailwind.
- TypeScript strict — żadnych `any`.
- Klucze API **nigdy** w kliencie. Dostęp do danych usera chroni **RLS**.

---

## Dokumenty powiązane

- `features/auth.md` — logowanie (Supabase)
- `features/portfolio.md` — portfel (paper trading)
- `features/dca.md` — cykliczny zakup (DCA, cron w tle)
- `features/news-agent.md` — agent newsów
- `roadmap.md` — co dalej (Faza 2)
- `ci-cd.md`, `testing.md` — operacje
