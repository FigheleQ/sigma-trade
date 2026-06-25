// ============================================================
// GET /api/dca/run — skan i egzekucja planów DCA (wyzwalany przez Vercel Cron).
//
// • Chroniony nagłówkiem Authorization: Bearer <CRON_SECRET> (Vercel dokłada go
//   automatycznie, gdy ustawiony jest env CRON_SECRET).
// • Działa kluczem service-role (brak sesji usera) — RLS pominięte, dlatego
//   każdy filtr per-portfel jest tu jawny.
// • Rynek zamknięty → zakup idzie po ostatniej cenie zamknięcia (demo mode).
// • Handel CAŁYMI akcjami: kup floor(budżet/cena), resztę przenieś (carry_usd).
//   Po egzekucji next_run_at += 7 dni.
// ============================================================
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { executeMarketOrder } from '@/lib/portfolio/execute';
import { getExecutionPrice } from '@/lib/portfolio/prices';
import { planDcaBuy, nextWeeklyRun } from '@/lib/portfolio/dca';
import type { PortfolioRow } from '@/lib/portfolio/service';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  // ── Autoryzacja crona ──────────────────────────────────────
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();

  const { data: due, error } = await supabase
    .from('dca_plans')
    .select('id, portfolio_id, ticker, amount_usd, carry_usd, next_run_at')
    .eq('status', 'active')
    .lte('next_run_at', now.toISOString());

  if (error) {
    console.error('[api/dca/run] query', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let bought = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const plan of due ?? []) {
    try {
      // Świeży wiersz portfela (cash mógł się zmienić po poprzednim planie).
      const { data: pf } = await supabase
        .from('portfolios')
        .select('id, cash, initial_balance')
        .eq('id', plan.portfolio_id)
        .maybeSingle();
      if (!pf) {
        errors.push(`plan ${plan.id}: brak portfela`);
        continue;
      }
      const portfolio: PortfolioRow = {
        id: pf.id,
        cash: Number(pf.cash),
        initial_balance: Number(pf.initial_balance),
      };

      const price = await getExecutionPrice(supabase, plan.ticker);
      const budget = Number(plan.amount_usd) + Number(plan.carry_usd);
      const { quantity, carry } = planDcaBuy(budget, price, portfolio.cash);

      if (quantity >= 1) {
        await executeMarketOrder(supabase, portfolio, {
          ticker: plan.ticker,
          side: 'buy',
          quantity,
          price,
        });
        bought += 1;
      } else {
        // Nie stać na całą akcję w tym cyklu — budżet przechodzi dalej.
        skipped += 1;
      }

      // Przesuń harmonogram o tydzień i zapisz przeniesioną resztę.
      const next = nextWeeklyRun(new Date(plan.next_run_at), now);
      await supabase
        .from('dca_plans')
        .update({
          carry_usd: carry,
          last_run_at: now.toISOString(),
          next_run_at: next.toISOString(),
        })
        .eq('id', plan.id);
    } catch (e) {
      errors.push(`plan ${plan.id}: ${e instanceof Error ? e.message : 'error'}`);
    }
  }

  return NextResponse.json({ ran: (due ?? []).length, bought, skipped, errors });
}
