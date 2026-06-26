// ============================================================
// GET /api/lots  — otwarte loty zalogowanego usera (wszystkie tickery)
// ============================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOrCreatePortfolio } from '@/lib/portfolio/service';
import type { PositionLot } from '@/lib/portfolio/types';

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
      .from('position_lots')
      .select('id, ticker, quantity, entry_price, take_profit, stop_loss, status, opened_at, closed_at, close_price, close_reason')
      .eq('portfolio_id', portfolio.id)
      .eq('status', 'open')
      .order('opened_at', { ascending: false });

    if (error) throw error;

    const lots: PositionLot[] = (data ?? []).map((r) => ({
      id: r.id,
      ticker: r.ticker,
      quantity: Number(r.quantity),
      entryPrice: Number(r.entry_price),
      takeProfit: r.take_profit != null ? Number(r.take_profit) : null,
      stopLoss: r.stop_loss != null ? Number(r.stop_loss) : null,
      status: r.status as 'open' | 'closed',
      openedAt: r.opened_at,
      closedAt: r.closed_at ?? null,
      closePrice: r.close_price != null ? Number(r.close_price) : null,
      closeReason: r.close_reason ?? null,
    }));

    return NextResponse.json({ lots });
  } catch (err) {
    console.error('[api/lots]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
