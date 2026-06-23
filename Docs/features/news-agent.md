# News Agent

Skanuje newsy finansowe dla tickerów z watchlisty (Finnhub) i — na żądanie,
przy kliknięciu artykułu — analizuje je AI (Gemini w dev / Claude w prod),
nadając impact score, urgency, interpretację i tagi.

> Konsolidacja wcześniejszych `NEWS_AGENT_ARCHITECTURE.md` (projekt) i
> `ETAP3_DOCS.md` (implementacja).

---

## Pipeline

```
config.yaml → useNewsFetch (interval)
  → POST /api/news/fetch
       Finnhub /company-news (per ticker) + opcjonalnie /news?general
       → normalize → dedup (po id, merge tickerów) → RawArticle[]   (BEZ AI)
  → newsStore.addArticles()
  → NewsFeed render + badge w AgentSidebar

Kliknięcie artykułu:
  → POST /api/news/analyze { article }
       analyzer.ts → Gemini/Claude → AnalyzedArticle
  → newsStore.updateArticle()
  → ArticleCard re-render z realną analizą
```

**Dlaczego analiza on-demand, a nie batch przy fetchu:** 1 artykuł = mały prompt
= mniej tokenów i mniejsze ryzyko rate-limitu; user kontroluje co analizować;
fetch działa natychmiast (bez czekania na AI).

---

## Co daje Finnhub, a co dokłada AI

Finnhub `/company-news` zwraca surowe artykuły (headline, summary, source, url,
datetime, related ticker). **Nie** daje sentymentu, relevance ani kategorii —
to dokłada warstwa AI:
- `impactScore` (−1..+1), `urgency` (low/medium/high/critical)
- `category` (earnings/macro/sector/company/regulatory)
- `interpretation` (2–3 zdania), `tags[]`, `affectsPortfolio`

**Rate-limit math:** ~6 req na cykl (5 tickerów + general) przy fetchu co 5 min
= ~72 req/h. Limit Finnhub 60/min — ogromny zapas. Bottleneck to koszt AI, nie
Finnhub.

---

## Kluczowe pliki

| Plik | Rola |
|---|---|
| `src/lib/news/types.ts` | `RawArticle`, `AnalyzedArticle`, `ChatBlock`, `NewsAgentConfig` |
| `src/lib/news/analyzer.ts` | server-only; wywołanie Gemini/Claude, `extractJson`, fallback |
| `src/lib/store/newsStore.ts` | Zustand: articles, readIds, unread/critical count, fetchStatus |
| `src/app/api/news/fetch/route.ts` | Finnhub → normalize → dedup (bez AI) |
| `src/app/api/news/analyze/route.ts` | analiza jednego artykułu on-demand |
| `src/hooks/useNewsFetch.ts` | interval fetch → store |
| `src/components/agents/NewsFeed.tsx` | lista artykułów, trigger analizy, stany per artykuł |
| `src/components/agents/AgentSidebar.tsx` | live badge (unread/critical) z store |

---

## Sygnał „przeanalizowany przez AI"

```ts
const isAnalyzed = article.tags.length > 0;
```

Fallback (artykuł bez AI) zawsze ma `tags: []`; realna analiza zwraca ≥1 tag.
**Nie** używaj `interpretation !== ''` — stare fallbacki miały niepusty string.

---

## Zmienne środowiskowe

| Zmienna | Kiedy |
|---|---|
| `FINNHUB_API_KEY` | zawsze |
| `GEMINI_API_KEY` | gdy `ai_provider.provider: gemini` |
| `ANTHROPIC_API_KEY` | gdy `ai_provider.provider: claude` |

---

## Znane pułapki

| Problem | Fix |
|---|---|
| Gemini zwraca JSON w ` ```json ``` ` | `extractJson()` strippuje code fences przed `JSON.parse` |
| `isAnalyzed` po `interpretation` | zawsze `tags.length > 0` |
| Artykuł szarzeje podczas analizy, spinner niewidoczny | `isRead && !isAnalyzing ? 'opacity-50' : 'opacity-100'` |
| Rate limit 429 przy każdym requeście (Gemini) | free tier wyczerpany — nowy projekt GCP / billing |
| `RateLimitError` jako czerwony error w konsoli | `console.warn` dla 429, `console.error` dla reszty |
| 0% impact po kolejnym fetchu | `addArticles` robi update in-place po `id` (nowe → góra) |

---

## ChatBlock — szkielet pod przyszłość

`types.ts` definiuje `ChatBlock = TextBlock | NewsCardBlock | AlertCardBlock |
TrendInsightBlock`, ale komponenty renderujące rich-blocki nie są jeszcze
zbudowane. To zaczep pod Orchestrator Agenta (Faza 2) — patrz `roadmap.md`.
