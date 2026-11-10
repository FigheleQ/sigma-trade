// ============================================================
// POST /api/strategy/recommendations — rekomendacje dla profilu (warstwa C).
//
// Body: { strategy } (albo brak → profil z `user_strategy`).
// Zwraca: { recommendations: Recommendation[], plan: PlanSummary }.
//
// Skład liczy deterministyczny silnik (allocate.ts) — zero wywołań AI.
// Za flagą `features.strategy_agent.enabled`; przy `false` → 404 i klient
// spada na lokalny mock (strategyClient), bez zmiany kontraktu URL.
// ============================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isStrategyAgentEnabled } from '@/lib/config';
import { loadStoredStrategy } from '@/lib/strategy/store';
import { coerceStrategy } from '@/lib/strategy/validate';
import { buildRecommendations } from '@/lib/strategy/service';

export async function POST(req: Request): Promise<NextResponse> {
  if (!isStrategyAgentEnabled()) {
    return NextResponse.json({ error: 'Strategy agent disabled' }, { status: 404 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { strategy?: unknown } = {};
  try {
    body = (await req.json()) as { strategy?: unknown };
  } catch {
    // puste body → profil z bazy
  }

  const strategy = coerceStrategy(body.strategy) ?? (await loadStoredStrategy(supabase, user.id));
  if (!strategy) {
    return NextResponse.json({ error: 'No valid strategy profile' }, { status: 400 });
  }

  try {
    const { plan, recommendations } = await buildRecommendations(supabase, user.id, strategy);
    return NextResponse.json({
      recommendations,
      plan: {
        budget: plan.budget,
        base: plan.base,
        invested: plan.invested,
        cashReserved: plan.cashReserved,
        coreShare: plan.limits.coreShare,
        cashBuffer: plan.limits.cashBuffer,
        maxTickerWeight: plan.limits.maxTickerWeight,
        maxSectorWeight: plan.limits.maxSectorWeight,
        skippedOwned: plan.skippedOwned,
        priced: plan.priced,
      },
    });
  } catch (err) {
    console.error('[api/strategy/recommendations]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
