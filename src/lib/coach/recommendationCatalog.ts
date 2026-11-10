// ============================================================
// Re-export katalogu rekomendacji.
//
// Źródło przeniesione do `src/lib/strategy/catalog.ts` (AI v2 — katalog
// dostał metadane dla silnika portfela). Ten plik zostaje, żeby nie
// wywrócić istniejących importów (strategyClient, stare gałęzie).
// ============================================================
export {
  RECOMMENDATION_CATALOG,
  BROAD_MARKET_KEY,
  DEFAULT_CATEGORY_KEYS,
  catalogForPrompt,
  fullCatalogForPrompt,
  matchCategories,
  defaultCategories,
  allowedRisks,
  findEntry,
  isCatalogTicker,
  type CatalogEntry,
  type CatalogCategory,
} from '@/lib/strategy/catalog';
