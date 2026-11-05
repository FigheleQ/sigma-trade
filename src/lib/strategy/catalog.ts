// ============================================================
// Katalog rekomendacji (warstwa C) — kuratorowana lista kategorii i spółek
// + metadane dla deterministycznego silnika `allocate.ts`.
//
// Wszystkie tickery są notowane w USA → działają na darmowym Finnhub
// (quote / recommendation). To DANE, nie logika.
//
// Plik CZYSTY (bez I/O, bez aliasu `@/`) — importowany też przez guard.ts
// i testy `cy.task` w Node.
//
// `src/lib/coach/recommendationCatalog.ts` zostaje jako re-export, żeby
// nie wywrócić istniejących importów.
// ============================================================
import type { RiskTolerance } from '../coach/types';

export type AssetClass = 'equity-etf' | 'equity';
export type Band = 'low' | 'medium' | 'high';
export type DividendBand = 'none' | 'low' | 'medium' | 'high';
export type Horizon = 'short' | 'mid' | 'long';

export interface CatalogEntry {
  ticker: string;
  name: string;
  risk: RiskTolerance;
  kind: 'etf' | 'stock';
  reason: string; // krótkie uzasadnienie pod rekomendację
  // ---- Metadane silnika (AI v2) ----
  sector: string; // do limitu „max % na sektor"
  assetClass: AssetClass;
  dividendYieldBand: DividendBand;
  volatilityBand: Band;
  horizon: Horizon; // minimalny sensowny horyzont trzymania
  beginnerFriendly: boolean;
  themes: string[];
}

export interface CatalogCategory {
  key: string;
  label: string;
  keywords: string[]; // do dopasowania zainteresowań usera (free-text)
  entries: CatalogEntry[];
}

// Specjalna kategoria „fundament" — szerokie ETF-y, baza (core) portfela.
export const BROAD_MARKET_KEY = 'broad-market';

type Meta = Omit<CatalogEntry, 'ticker' | 'name' | 'risk' | 'kind' | 'reason'>;

// Skrót do budowy wpisu — czytelniej niż 13 pól w jednej linii.
function e(
  ticker: string,
  name: string,
  risk: RiskTolerance,
  kind: 'etf' | 'stock',
  reason: string,
  meta: Meta,
): CatalogEntry {
  return { ticker, name, risk, kind, reason, ...meta };
}

const etf = (sector: string, div: DividendBand, vol: Band, themes: string[]): Meta => ({
  sector,
  assetClass: 'equity-etf',
  dividendYieldBand: div,
  volatilityBand: vol,
  horizon: 'long',
  beginnerFriendly: true,
  themes,
});

const stock = (
  sector: string,
  div: DividendBand,
  vol: Band,
  horizon: Horizon,
  beginnerFriendly: boolean,
  themes: string[],
): Meta => ({ sector, assetClass: 'equity', dividendYieldBand: div, volatilityBand: vol, horizon, beginnerFriendly, themes });

export const RECOMMENDATION_CATALOG: CatalogCategory[] = [
  {
    key: BROAD_MARKET_KEY,
    label: 'Broad-market ETFs',
    keywords: ['etf', 'index', 'diversified', 'dividend', 'passive'],
    entries: [
      e('VOO', 'Vanguard S&P 500 ETF', 'low', 'etf', 'One-ticket exposure to the 500 largest US companies — the classic beginner core.', etf('Broad market', 'low', 'low', ['index', 'core'])),
      e('VTI', 'Vanguard Total US Market ETF', 'low', 'etf', 'Whole US market in a single fund — maximum diversification, minimal effort.', etf('Broad market', 'low', 'low', ['index', 'core'])),
      e('SCHD', 'Schwab US Dividend Equity ETF', 'low', 'etf', 'Dividend-paying blue chips — steadier ride, income while you learn.', etf('Broad market', 'high', 'low', ['dividend', 'income', 'core'])),
      e('QQQ', 'Invesco Nasdaq-100 ETF', 'medium', 'etf', 'Tech-heavy index for growth tilt while staying diversified.', etf('Broad market', 'none', 'medium', ['growth', 'tech', 'index'])),
    ],
  },
  {
    key: 'technology',
    label: 'Technology',
    keywords: ['tech', 'technology', 'software', 'cloud', 'computers', 'internet'],
    entries: [
      e('AAPL', 'Apple', 'low', 'stock', 'Cash-rich mega-cap with a huge ecosystem — a stable tech anchor.', stock('Technology', 'low', 'medium', 'mid', true, ['consumer-tech', 'mega-cap'])),
      e('MSFT', 'Microsoft', 'low', 'stock', 'Diversified across cloud, software and AI — low-drama compounder.', stock('Technology', 'low', 'medium', 'mid', true, ['cloud', 'ai', 'mega-cap'])),
      e('GOOGL', 'Alphabet', 'medium', 'stock', 'Search + ads cash machine with AI upside.', stock('Technology', 'low', 'medium', 'mid', true, ['ai', 'ads', 'mega-cap'])),
      e('ADBE', 'Adobe', 'medium', 'stock', 'Subscription software with sticky creative-tools moat.', stock('Technology', 'none', 'medium', 'mid', false, ['software', 'subscription'])),
      e('CRM', 'Salesforce', 'medium', 'stock', 'Enterprise software leader, recurring revenue base.', stock('Technology', 'low', 'medium', 'mid', false, ['software', 'cloud'])),
    ],
  },
  {
    key: 'semiconductors',
    label: 'Semiconductors / AI hardware',
    keywords: ['chips', 'semiconductors', 'semiconductor', 'ai', 'hardware', 'gpu'],
    entries: [
      e('NVDA', 'NVIDIA', 'high', 'stock', 'AI-chip leader — high growth, high volatility.', stock('Semiconductors', 'none', 'high', 'long', false, ['ai', 'gpu', 'growth'])),
      e('AMD', 'Advanced Micro Devices', 'high', 'stock', 'NVIDIA challenger in CPUs/GPUs — momentum name.', stock('Semiconductors', 'none', 'high', 'long', false, ['ai', 'gpu', 'growth'])),
      e('AVGO', 'Broadcom', 'medium', 'stock', 'Broad chip + software mix, pays a dividend.', stock('Semiconductors', 'low', 'medium', 'mid', false, ['ai', 'networking', 'dividend'])),
      e('TSM', 'Taiwan Semiconductor', 'medium', 'stock', 'The foundry that builds most advanced chips.', stock('Semiconductors', 'low', 'medium', 'mid', false, ['ai', 'foundry'])),
      e('INTC', 'Intel', 'high', 'stock', 'Turnaround play in US chip manufacturing.', stock('Semiconductors', 'none', 'high', 'long', false, ['turnaround'])),
    ],
  },
  {
    key: 'automotive-ev',
    label: 'Automotive & EV',
    keywords: ['cars', 'car', 'auto', 'automotive', 'ev', 'vehicles', 'mobility'],
    entries: [
      e('TSLA', 'Tesla', 'high', 'stock', 'EV + energy + robotics story — volatile, high-beta.', stock('Automotive', 'none', 'high', 'long', false, ['ev', 'robotics', 'growth'])),
      e('F', 'Ford', 'medium', 'stock', 'Legacy automaker pivoting to EVs, pays a dividend.', stock('Automotive', 'high', 'medium', 'mid', false, ['ev', 'dividend', 'value'])),
      e('GM', 'General Motors', 'medium', 'stock', 'Scaled automaker with EV roadmap, value-priced.', stock('Automotive', 'low', 'medium', 'mid', false, ['ev', 'value'])),
      e('RIVN', 'Rivian', 'high', 'stock', 'Early-stage EV maker — speculative, high risk.', stock('Automotive', 'none', 'high', 'long', false, ['ev', 'speculative'])),
    ],
  },
  {
    key: 'food-beverage',
    label: 'Food, beverage & restaurants',
    keywords: ['food', 'drinks', 'beverage', 'restaurants', 'consumer', 'snacks', 'coffee'],
    entries: [
      e('KO', 'Coca-Cola', 'low', 'stock', 'Defensive dividend stalwart — sells in any economy.', stock('Consumer staples', 'medium', 'low', 'mid', true, ['defensive', 'dividend'])),
      e('PEP', 'PepsiCo', 'low', 'stock', 'Snacks + drinks, reliable dividend grower.', stock('Consumer staples', 'medium', 'low', 'mid', true, ['defensive', 'dividend'])),
      e('MCD', "McDonald's", 'low', 'stock', 'Global franchise model, steady cash flow.', stock('Consumer discretionary', 'medium', 'low', 'mid', true, ['defensive', 'dividend'])),
      e('SBUX', 'Starbucks', 'medium', 'stock', 'Premium coffee brand with global expansion.', stock('Consumer discretionary', 'medium', 'medium', 'mid', false, ['brand'])),
      e('COST', 'Costco', 'low', 'stock', 'Membership retail — loyal customers, durable growth.', stock('Consumer staples', 'low', 'low', 'mid', true, ['defensive', 'retail'])),
    ],
  },
  {
    key: 'healthcare',
    label: 'Healthcare & pharma',
    keywords: ['health', 'healthcare', 'pharma', 'medicine', 'biotech', 'medical'],
    entries: [
      e('LLY', 'Eli Lilly', 'medium', 'stock', 'Weight-loss & diabetes drug leader — strong growth.', stock('Healthcare', 'low', 'medium', 'mid', false, ['pharma', 'growth'])),
      e('JNJ', 'Johnson & Johnson', 'low', 'stock', 'Diversified healthcare, decades of dividend growth.', stock('Healthcare', 'medium', 'low', 'mid', true, ['defensive', 'dividend'])),
      e('UNH', 'UnitedHealth', 'medium', 'stock', 'Largest US health insurer, steady compounder.', stock('Healthcare', 'low', 'medium', 'mid', false, ['insurance'])),
      e('PFE', 'Pfizer', 'medium', 'stock', 'Big-pharma with high dividend yield.', stock('Healthcare', 'high', 'medium', 'mid', false, ['pharma', 'dividend', 'value'])),
    ],
  },
  {
    key: 'financials',
    label: 'Banks & payments',
    keywords: ['finance', 'financial', 'banks', 'banking', 'payments', 'fintech'],
    entries: [
      e('JPM', 'JPMorgan Chase', 'medium', 'stock', 'Best-in-class big bank, pays a solid dividend.', stock('Financials', 'medium', 'medium', 'mid', true, ['bank', 'dividend'])),
      e('V', 'Visa', 'low', 'stock', 'Payments toll-road — high margins, low capital needs.', stock('Financials', 'low', 'low', 'mid', true, ['payments'])),
      e('MA', 'Mastercard', 'low', 'stock', 'Visa peer with the same wide payments moat.', stock('Financials', 'low', 'low', 'mid', true, ['payments'])),
      e('BAC', 'Bank of America', 'medium', 'stock', 'Large retail bank, leveraged to interest rates.', stock('Financials', 'medium', 'medium', 'mid', false, ['bank', 'rates'])),
    ],
  },
  {
    key: 'energy-traditional',
    label: 'Energy (oil & gas)',
    keywords: ['energy', 'oil', 'gas', 'petroleum', 'fuel'],
    entries: [
      e('XOM', 'ExxonMobil', 'medium', 'stock', 'Oil major with a big, durable dividend.', stock('Energy', 'high', 'medium', 'mid', false, ['oil', 'dividend'])),
      e('CVX', 'Chevron', 'medium', 'stock', 'Disciplined oil major, shareholder-friendly.', stock('Energy', 'high', 'medium', 'mid', false, ['oil', 'dividend'])),
      e('COP', 'ConocoPhillips', 'medium', 'stock', 'Pure-play exploration & production.', stock('Energy', 'medium', 'medium', 'mid', false, ['oil', 'commodity'])),
    ],
  },
  {
    key: 'clean-nuclear',
    label: 'Nuclear & clean energy',
    keywords: ['nuclear', 'atom', 'atomic', 'uranium', 'clean', 'renewable', 'solar', 'green'],
    entries: [
      e('CEG', 'Constellation Energy', 'high', 'stock', 'Largest US nuclear operator — direct atomic-energy play.', stock('Utilities', 'low', 'high', 'long', false, ['nuclear', 'ai-power'])),
      e('CCJ', 'Cameco', 'high', 'stock', 'Top uranium miner — leveraged to nuclear fuel demand.', stock('Materials', 'none', 'high', 'long', false, ['nuclear', 'uranium', 'commodity'])),
      e('NEE', 'NextEra Energy', 'medium', 'stock', 'Utility + biggest US renewables developer.', stock('Utilities', 'medium', 'medium', 'mid', true, ['renewables', 'dividend'])),
      e('LEU', 'Centrus Energy', 'high', 'stock', 'Enriched-uranium supplier — small-cap, speculative.', stock('Energy', 'none', 'high', 'long', false, ['nuclear', 'speculative', 'small-cap'])),
    ],
  },
  {
    key: 'materials-rare-earth',
    label: 'Rare-earth & materials',
    keywords: ['rare', 'earth', 'metals', 'materials', 'mining', 'lithium', 'copper', 'minerals'],
    entries: [
      e('MP', 'MP Materials', 'high', 'stock', 'Only scaled US rare-earth miner — strategic, volatile.', stock('Materials', 'none', 'high', 'long', false, ['rare-earth', 'commodity'])),
      e('ALB', 'Albemarle', 'high', 'stock', 'Lithium producer for EV batteries — commodity-cyclical.', stock('Materials', 'low', 'high', 'long', false, ['lithium', 'ev', 'commodity'])),
      e('FCX', 'Freeport-McMoRan', 'high', 'stock', 'Copper & gold miner — leveraged to industrial demand.', stock('Materials', 'low', 'high', 'long', false, ['copper', 'commodity'])),
    ],
  },
  {
    key: 'aerospace-defense',
    label: 'Aerospace & defense',
    keywords: ['defense', 'defence', 'aerospace', 'military', 'space', 'weapons'],
    entries: [
      e('LMT', 'Lockheed Martin', 'low', 'stock', 'Defense prime contractor, steady dividend.', stock('Industrials', 'medium', 'low', 'mid', true, ['defense', 'dividend'])),
      e('RTX', 'RTX (Raytheon)', 'medium', 'stock', 'Defense + commercial aerospace mix.', stock('Industrials', 'medium', 'medium', 'mid', false, ['defense', 'aerospace'])),
      e('BA', 'Boeing', 'high', 'stock', 'Aerospace turnaround — higher risk, recovery play.', stock('Industrials', 'none', 'high', 'long', false, ['aerospace', 'turnaround'])),
    ],
  },
  {
    key: 'retail-ecommerce',
    label: 'Retail & e-commerce',
    keywords: ['retail', 'shopping', 'ecommerce', 'e-commerce', 'stores', 'commerce'],
    entries: [
      e('AMZN', 'Amazon', 'medium', 'stock', 'E-commerce + cloud (AWS) — growth at scale.', stock('Consumer discretionary', 'none', 'medium', 'mid', true, ['ecommerce', 'cloud', 'mega-cap'])),
      e('WMT', 'Walmart', 'low', 'stock', 'Defensive retail giant, reliable dividend.', stock('Consumer staples', 'low', 'low', 'mid', true, ['defensive', 'retail'])),
      e('HD', 'Home Depot', 'low', 'stock', 'Home-improvement leader, strong cash returns.', stock('Consumer discretionary', 'medium', 'low', 'mid', true, ['housing', 'dividend'])),
    ],
  },
  {
    key: 'entertainment-media',
    label: 'Entertainment & media',
    keywords: ['entertainment', 'media', 'streaming', 'movies', 'music', 'games', 'gaming'],
    entries: [
      e('NFLX', 'Netflix', 'medium', 'stock', 'Streaming leader with growing profitability.', stock('Communication services', 'none', 'medium', 'mid', false, ['streaming', 'growth'])),
      e('DIS', 'Disney', 'medium', 'stock', 'IP powerhouse — parks, streaming, studios.', stock('Communication services', 'low', 'medium', 'mid', true, ['streaming', 'parks'])),
      e('SPOT', 'Spotify', 'high', 'stock', 'Audio-streaming growth name — higher volatility.', stock('Communication services', 'none', 'high', 'long', false, ['streaming', 'growth'])),
    ],
  },
];

// Kategorie domyślne, gdy user nie poda dopasowanych zainteresowań —
// zbalansowany przekrój sektorów.
export const DEFAULT_CATEGORY_KEYS = ['technology', 'healthcare', 'financials', 'food-beverage'];

// ---- Wyszukiwanie -------------------------------------------

export const ALL_ENTRIES: CatalogEntry[] = RECOMMENDATION_CATALOG.flatMap((c) => c.entries);

const BY_TICKER = new Map<string, { entry: CatalogEntry; category: CatalogCategory }>(
  RECOMMENDATION_CATALOG.flatMap((c) => c.entries.map((en) => [en.ticker, { entry: en, category: c }] as const)),
);

export const findEntry = (ticker: string) => BY_TICKER.get(ticker.toUpperCase()) ?? null;
export const isCatalogTicker = (ticker: string): boolean => BY_TICKER.has(ticker.toUpperCase());

// Dopasowanie zainteresowań (free-text) do kategorii po słowach kluczowych.
export function matchCategories(interests: string[]): CatalogCategory[] {
  const tokens = interests
    .flatMap((i) => i.toLowerCase().split(/[^a-z]+/))
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];

  // Krótkie słowa („ev", „ai", „car") tylko przy dokładnym trafieniu;
  // dłuższe także jako PREFIKS („semiconductors" ↔ „semiconductor",
  // „tech" ↔ „technology"). Nie `includes` — „car" siedzi w „healthcare".
  const hit = (k: string, t: string) =>
    k.length < 4 || t.length < 4 ? k === t : t.startsWith(k) || k.startsWith(t);
  return RECOMMENDATION_CATALOG.filter((c) => {
    if (c.key === BROAD_MARKET_KEY) return false;
    const labelWords = c.label.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    return (
      c.keywords.some((k) => tokens.some((t) => hit(k, t))) ||
      labelWords.some((w) => tokens.some((t) => hit(w, t)))
    );
  });
}

export function defaultCategories(): CatalogCategory[] {
  return RECOMMENDATION_CATALOG.filter((c) => DEFAULT_CATEGORY_KEYS.includes(c.key));
}

// Które poziomy ryzyka dopuszczamy dla profilu (rozwinięcie dawnego
// `allowedRisks` ze strategyClient). Low → bez high-beta; beginner+medium →
// też bez high; wyżej dopuszczamy spekulacyjne pozycje.
export function allowedRisks(level: string, risk: RiskTolerance): Set<RiskTolerance> {
  if (risk === 'high') return new Set<RiskTolerance>(['low', 'medium', 'high']);
  if (risk === 'medium') {
    return level === 'beginner'
      ? new Set<RiskTolerance>(['low', 'medium'])
      : new Set<RiskTolerance>(['low', 'medium', 'high']);
  }
  return new Set<RiskTolerance>(['low', 'medium']);
}

// ---- Podzbiór katalogu do promptu Coacha --------------------
//
// Model NIE potrzebuje 50 tickerów — dobór portfela robi silnik (allocate.ts).
// Dajemy broad-market + kategorie z zainteresowań (albo domyślne), filtr
// ryzyka, max `limit` tickerów z nazwami. ~14 tickerów ≈ 200 tokenów
// zamiast ~450 za pełną listę (i bez szumu, który kusi model do dygresji).
export function catalogForPrompt(
  interests: string[] = [],
  risk: RiskTolerance = 'medium',
  level = 'intermediate',
  limit = 14,
): string {
  const allowed = allowedRisks(level, risk);
  const broad = RECOMMENDATION_CATALOG.find((c) => c.key === BROAD_MARKET_KEY);
  const matched = matchCategories(interests);
  const cats = [...(broad ? [broad] : []), ...(matched.length ? matched : defaultCategories())];

  // Round-robin po kategoriach — żeby limit nie zjadł jednej kategorii.
  const perCat = cats.map((c) => c.entries.filter((en) => allowed.has(en.risk)));
  const picked = new Map<string, CatalogEntry[]>();
  let count = 0;
  for (let idx = 0; count < limit; idx++) {
    let progressed = false;
    perCat.forEach((list, ci) => {
      if (count >= limit || !list[idx]) return;
      const key = cats[ci].label;
      picked.set(key, [...(picked.get(key) ?? []), list[idx]]);
      count++;
      progressed = true;
    });
    if (!progressed) break;
  }
  // Same tickery (model je zna) + gwiazdka przy high risk — nazwy kosztowały
  // ~2× więcej tokenów, a nie poprawiały odpowiedzi.
  const body = [...picked.entries()]
    .map(([label, list]) => `- ${label}: ${list.map((en) => `${en.ticker}${en.risk === 'high' ? '*' : ''}`).join(', ')}`)
    .join('\n');
  return [...picked.values()].flat().some((en) => en.risk === 'high') ? `${body}\n(* = high risk)` : body;
}

// Pełna, zwięzła lista tickerów (tylko do pomiaru „przed" i debugowania).
export function fullCatalogForPrompt(): string {
  return RECOMMENDATION_CATALOG.map((c) => `- ${c.label}: ${c.entries.map((en) => en.ticker).join(', ')}`).join('\n');
}
