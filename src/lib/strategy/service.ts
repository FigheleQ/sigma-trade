// ============================================================
// Rekomendacje (warstwa C) — server-only orkiestracja silnika:
//   profil + pozycje + żywe ceny (cache prices.ts) → allocate.ts
//   → konsensus analityków (enrich.ts) → uzasadnienia (explain.ts).
// Wspólne dla /api/strategy/recommendations i narracji w /api/coach.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { getOrCreatePortfolio } from '@/lib/portfolio/service';
import { getCachedPrices } from '@/lib/portfolio/prices';
import type { Recommendation, UserStrategy } from '@/lib/coach/types';
import { buildPortfolioPlan, planToRecommendations, type PlanContext, type PortfolioPlan } from './allocate';
import { getAnalystConsensus } from './enrich';
import { explainPlan } from './explain';

export interface RecommendationResult {
  plan: PortfolioPlan;
  recommendations: Recommendation[];
}

// Pozycje + gotówka usera. Brak portfela → pusty kontekst (nie blokujemy).
export async function loadPlanContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<Pick<PlanContext, 'positions' | 'cash'>> {
  try {
    const portfolio = await getOrCreatePortfolio(supabase, userId);
    const { data } = await supabase.from('positions').select('ticker').eq('portfolio_id', portfolio.id);
    return { positions: (data ?? []).map((p: { ticker: string }) => p.ticker), cash: portfolio.cash };
  } catch {
    return { positions: [], cash: null };
  }
}

export async function buildRecommendations(
  supabase: SupabaseClient,
  userId: string,
  strategy: UserStrategy,
  base?: Pick<PlanContext, 'positions' | 'cash'>,
): Promise<RecommendationResult> {
  const ctx = base ?? (await loadPlanContext(supabase, userId));

  // 1. Plan bez cen → wiemy, które tickery wycenić (~7 zamiast 50 z katalogu —
  //    oszczędza darmowy limit Finnhub). Zastępców wyceniamy dopiero w kroku 2.
  const draft = buildPortfolioPlan(strategy, ctx);

  let prices: Record<string, number> = {};
  try {
    prices = await getCachedPrices(supabase, draft.items.map((i) => i.entry.ticker));
  } catch {
    prices = {}; // bez cen — kwoty z wag, bez liczby akcji
  }

  // 2. Plan z cenami. Jeśli wszedł kandydat bez ceny — dociągnij jego cenę raz.
  let plan = buildPortfolioPlan(strategy, { ...ctx, prices });
  const missing = plan.items.map((i) => i.entry.ticker).filter((t) => prices[t] == null);
  if (missing.length > 0 && Object.keys(prices).length > 0) {
    try {
      prices = { ...prices, ...(await getCachedPrices(supabase, missing)) };
      plan = buildPortfolioPlan(strategy, { ...ctx, prices });
    } catch {
      // zostajemy przy planie częściowo wycenionym
    }
  }

  // 3. Konsensus analityków — best-effort, nigdy nie blokuje.
  const consensus = await getAnalystConsensus(plan.items.map((i) => i.entry.ticker)).catch(() => ({}));

  return {
    plan,
    recommendations: explainPlan(plan, strategy, planToRecommendations(plan), consensus),
  };
}
