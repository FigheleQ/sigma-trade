// ============================================================
// Katalog rekomendacji — kuratorowana lista kategorii i spółek.
//
// Wszystkie tickery są notowane w USA, więc działają na darmowym Finnhub
// (quote/recommendation). To DANE, nie logika — gdy C zbuduje prawdziwy
// `generateRecommendations`, może je zaimportować zamiast dublować.
//
// Używane w dwóch miejscach:
//   • mock rekomendacji (strategyClient) — gdy endpoint C jeszcze nie istnieje,
//   • prompt Coacha (agent) — żeby porady w czacie były konkretne, nie ogólne.
// ============================================================
import type { RiskTolerance } from './types';

export interface CatalogEntry {
  ticker: string;
  name: string;
  risk: RiskTolerance;
  kind: 'etf' | 'stock';
  reason: string; // krótkie uzasadnienie pod rekomendację
}

export interface CatalogCategory {
  key: string;
  label: string;
  keywords: string[]; // do dopasowania zainteresowań usera (free-text)
  entries: CatalogEntry[];
}

// Specjalna kategoria „fundament" — szerokie ETF-y, baza dla początkujących.
export const BROAD_MARKET_KEY = 'broad-market';

export const RECOMMENDATION_CATALOG: CatalogCategory[] = [
  {
    key: BROAD_MARKET_KEY,
    label: 'Broad-market ETFs',
    keywords: ['etf', 'index', 'diversified', 'dividend', 'passive'],
    entries: [
      { ticker: 'VOO', name: 'Vanguard S&P 500 ETF', risk: 'low', kind: 'etf', reason: 'One-ticket exposure to the 500 largest US companies — the classic beginner core.' },
      { ticker: 'VTI', name: 'Vanguard Total US Market ETF', risk: 'low', kind: 'etf', reason: 'Whole US market in a single fund — maximum diversification, minimal effort.' },
      { ticker: 'QQQ', name: 'Invesco Nasdaq-100 ETF', risk: 'medium', kind: 'etf', reason: 'Tech-heavy index for growth tilt while staying diversified.' },
      { ticker: 'SCHD', name: 'Schwab US Dividend Equity ETF', risk: 'low', kind: 'etf', reason: 'Dividend-paying blue chips — steadier ride, income while you learn.' },
    ],
  },
  {
    key: 'technology',
    label: 'Technology',
    keywords: ['tech', 'technology', 'software', 'cloud', 'computers', 'internet'],
    entries: [
      { ticker: 'AAPL', name: 'Apple', risk: 'low', kind: 'stock', reason: 'Cash-rich mega-cap with a huge ecosystem — a stable tech anchor.' },
      { ticker: 'MSFT', name: 'Microsoft', risk: 'low', kind: 'stock', reason: 'Diversified across cloud, software and AI — low-drama compounder.' },
      { ticker: 'GOOGL', name: 'Alphabet', risk: 'medium', kind: 'stock', reason: 'Search + ads cash machine with AI upside.' },
      { ticker: 'ADBE', name: 'Adobe', risk: 'medium', kind: 'stock', reason: 'Subscription software with sticky creative-tools moat.' },
      { ticker: 'CRM', name: 'Salesforce', risk: 'medium', kind: 'stock', reason: 'Enterprise software leader, recurring revenue base.' },
    ],
  },
  {
    key: 'semiconductors',
    label: 'Semiconductors / AI hardware',
    keywords: ['chips', 'semiconductors', 'semiconductor', 'ai', 'hardware', 'gpu'],
    entries: [
      { ticker: 'NVDA', name: 'NVIDIA', risk: 'high', kind: 'stock', reason: 'AI-chip leader — high growth, high volatility.' },
      { ticker: 'AMD', name: 'Advanced Micro Devices', risk: 'high', kind: 'stock', reason: 'NVIDIA challenger in CPUs/GPUs — momentum name.' },
      { ticker: 'AVGO', name: 'Broadcom', risk: 'medium', kind: 'stock', reason: 'Broad chip + software mix, pays a dividend.' },
      { ticker: 'TSM', name: 'Taiwan Semiconductor', risk: 'medium', kind: 'stock', reason: 'The foundry that builds most advanced chips.' },
      { ticker: 'INTC', name: 'Intel', risk: 'high', kind: 'stock', reason: 'Turnaround play in US chip manufacturing.' },
    ],
  },
  {
    key: 'automotive-ev',
    label: 'Automotive & EV',
    keywords: ['cars', 'car', 'auto', 'automotive', 'ev', 'vehicles', 'mobility'],
    entries: [
      { ticker: 'TSLA', name: 'Tesla', risk: 'high', kind: 'stock', reason: 'EV + energy + robotics story — volatile, high-beta.' },
      { ticker: 'F', name: 'Ford', risk: 'medium', kind: 'stock', reason: 'Legacy automaker pivoting to EVs, pays a dividend.' },
      { ticker: 'GM', name: 'General Motors', risk: 'medium', kind: 'stock', reason: 'Scaled automaker with EV roadmap, value-priced.' },
      { ticker: 'RIVN', name: 'Rivian', risk: 'high', kind: 'stock', reason: 'Early-stage EV maker — speculative, high risk.' },
    ],
  },
  {
    key: 'food-beverage',
    label: 'Food, beverage & restaurants',
    keywords: ['food', 'drinks', 'beverage', 'restaurants', 'consumer', 'snacks', 'coffee'],
    entries: [
      { ticker: 'KO', name: 'Coca-Cola', risk: 'low', kind: 'stock', reason: 'Defensive dividend stalwart — sells in any economy.' },
      { ticker: 'PEP', name: 'PepsiCo', risk: 'low', kind: 'stock', reason: 'Snacks + drinks, reliable dividend grower.' },
      { ticker: 'MCD', name: "McDonald's", risk: 'low', kind: 'stock', reason: 'Global franchise model, steady cash flow.' },
      { ticker: 'SBUX', name: 'Starbucks', risk: 'medium', kind: 'stock', reason: 'Premium coffee brand with global expansion.' },
      { ticker: 'COST', name: 'Costco', risk: 'low', kind: 'stock', reason: 'Membership retail — loyal customers, durable growth.' },
    ],
  },
  {
    key: 'healthcare',
    label: 'Healthcare & pharma',
    keywords: ['health', 'healthcare', 'pharma', 'medicine', 'biotech', 'medical'],
    entries: [
      { ticker: 'LLY', name: 'Eli Lilly', risk: 'medium', kind: 'stock', reason: 'Weight-loss & diabetes drug leader — strong growth.' },
      { ticker: 'JNJ', name: 'Johnson & Johnson', risk: 'low', kind: 'stock', reason: 'Diversified healthcare, decades of dividend growth.' },
      { ticker: 'UNH', name: 'UnitedHealth', risk: 'medium', kind: 'stock', reason: 'Largest US health insurer, steady compounder.' },
      { ticker: 'PFE', name: 'Pfizer', risk: 'medium', kind: 'stock', reason: 'Big-pharma with high dividend yield.' },
    ],
  },
  {
    key: 'financials',
    label: 'Banks & payments',
    keywords: ['finance', 'financial', 'banks', 'banking', 'payments', 'fintech'],
    entries: [
      { ticker: 'JPM', name: 'JPMorgan Chase', risk: 'medium', kind: 'stock', reason: 'Best-in-class big bank, pays a solid dividend.' },
      { ticker: 'V', name: 'Visa', risk: 'low', kind: 'stock', reason: 'Payments toll-road — high margins, low capital needs.' },
      { ticker: 'MA', name: 'Mastercard', risk: 'low', kind: 'stock', reason: 'Visa peer with the same wide payments moat.' },
      { ticker: 'BAC', name: 'Bank of America', risk: 'medium', kind: 'stock', reason: 'Large retail bank, leveraged to interest rates.' },
    ],
  },
  {
    key: 'energy-traditional',
    label: 'Energy (oil & gas)',
    keywords: ['energy', 'oil', 'gas', 'petroleum', 'fuel'],
    entries: [
      { ticker: 'XOM', name: 'ExxonMobil', risk: 'medium', kind: 'stock', reason: 'Oil major with a big, durable dividend.' },
      { ticker: 'CVX', name: 'Chevron', risk: 'medium', kind: 'stock', reason: 'Disciplined oil major, shareholder-friendly.' },
      { ticker: 'COP', name: 'ConocoPhillips', risk: 'medium', kind: 'stock', reason: 'Pure-play exploration & production.' },
    ],
  },
  {
    key: 'clean-nuclear',
    label: 'Nuclear & clean energy',
    keywords: ['nuclear', 'atom', 'atomic', 'uranium', 'clean', 'renewable', 'solar', 'green'],
    entries: [
      { ticker: 'CEG', name: 'Constellation Energy', risk: 'high', kind: 'stock', reason: 'Largest US nuclear operator — direct atomic-energy play.' },
      { ticker: 'CCJ', name: 'Cameco', risk: 'high', kind: 'stock', reason: 'Top uranium miner — leveraged to nuclear fuel demand.' },
      { ticker: 'NEE', name: 'NextEra Energy', risk: 'medium', kind: 'stock', reason: 'Utility + biggest US renewables developer.' },
      { ticker: 'LEU', name: 'Centrus Energy', risk: 'high', kind: 'stock', reason: 'Enriched-uranium supplier — small-cap, speculative.' },
    ],
  },
  {
    key: 'materials-rare-earth',
    label: 'Rare-earth & materials',
    keywords: ['rare', 'earth', 'metals', 'materials', 'mining', 'lithium', 'copper', 'minerals'],
    entries: [
      { ticker: 'MP', name: 'MP Materials', risk: 'high', kind: 'stock', reason: 'Only scaled US rare-earth miner — strategic, volatile.' },
      { ticker: 'ALB', name: 'Albemarle', risk: 'high', kind: 'stock', reason: 'Lithium producer for EV batteries — commodity-cyclical.' },
      { ticker: 'FCX', name: 'Freeport-McMoRan', risk: 'high', kind: 'stock', reason: 'Copper & gold miner — leveraged to industrial demand.' },
    ],
  },
  {
    key: 'aerospace-defense',
    label: 'Aerospace & defense',
    keywords: ['defense', 'defence', 'aerospace', 'military', 'space', 'weapons'],
    entries: [
      { ticker: 'LMT', name: 'Lockheed Martin', risk: 'low', kind: 'stock', reason: 'Defense prime contractor, steady dividend.' },
      { ticker: 'RTX', name: 'RTX (Raytheon)', risk: 'medium', kind: 'stock', reason: 'Defense + commercial aerospace mix.' },
      { ticker: 'BA', name: 'Boeing', risk: 'high', kind: 'stock', reason: 'Aerospace turnaround — higher risk, recovery play.' },
    ],
  },
  {
    key: 'retail-ecommerce',
    label: 'Retail & e-commerce',
    keywords: ['retail', 'shopping', 'ecommerce', 'e-commerce', 'stores', 'commerce'],
    entries: [
      { ticker: 'AMZN', name: 'Amazon', risk: 'medium', kind: 'stock', reason: 'E-commerce + cloud (AWS) — growth at scale.' },
      { ticker: 'WMT', name: 'Walmart', risk: 'low', kind: 'stock', reason: 'Defensive retail giant, reliable dividend.' },
      { ticker: 'HD', name: 'Home Depot', risk: 'low', kind: 'stock', reason: 'Home-improvement leader, strong cash returns.' },
    ],
  },
  {
    key: 'entertainment-media',
    label: 'Entertainment & media',
    keywords: ['entertainment', 'media', 'streaming', 'movies', 'music', 'games', 'gaming'],
    entries: [
      { ticker: 'NFLX', name: 'Netflix', risk: 'medium', kind: 'stock', reason: 'Streaming leader with growing profitability.' },
      { ticker: 'DIS', name: 'Disney', risk: 'medium', kind: 'stock', reason: 'IP powerhouse — parks, streaming, studios.' },
      { ticker: 'SPOT', name: 'Spotify', risk: 'high', kind: 'stock', reason: 'Audio-streaming growth name — higher volatility.' },
    ],
  },
];

// Kategorie domyślne, gdy user nie poda dopasowanych zainteresowań —
// zbalansowany przekrój sektorów.
export const DEFAULT_CATEGORY_KEYS = ['technology', 'healthcare', 'financials', 'food-beverage'];

// Zwięzła mapa do promptu Coacha: „Kategoria: TICKER, TICKER…".
export function catalogForPrompt(): string {
  return RECOMMENDATION_CATALOG.map(
    (c) => `- ${c.label}: ${c.entries.map((e) => e.ticker).join(', ')}`,
  ).join('\n');
}
