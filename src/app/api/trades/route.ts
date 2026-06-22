// ============================================================
// GET /api/trades
// Historia transakcji zalogowanego usera (najnowsze pierwsze).
// ============================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOrCreatePortfolio } from '@/lib/portfolio/service';
import type { Trade } from '@/lib/portfolio/types';

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const portfolio = await getOrCreatePortfolio(supabase, user.id);

    const { data, error } = await supabase
      .from('trades')
      .select('id, ticker, side, quantity, price, realized_pnl, executed_at')
      .eq('portfolio_id', portfolio.id)
      .order('executed_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    const trades: Trade[] = (data ?? []).map((t) => ({
      id: t.id,
      ticker: t.ticker,
      side: t.side,
      quantity: Number(t.quantity),
      price: Number(t.price),
      realizedPnL: t.realized_pnl != null ? Number(t.realized_pnl) : null,
      executedAt: t.executed_at,
    }));

    return NextResponse.json({ trades });
  } catch (err) {
    console.error('[api/trades]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
