// ============================================================
// GET /api/cron/check-tp-sl
//
// Wywoływany przez Vercel Cron co minutę.
// Dla każdego otwartego lotu z ustawionym TP lub SL sprawdza,
// czy aktualna cena osiągnęła poziom. Jeśli tak — zamyka lot,
// aktualizuje agregat positions, cash i dopisuje trade do historii.
//
// Uwierzytelnienie: Bearer CRON_SECRET z nagłówka Authorization.
// Używa service_role — działa poza kontekstem sesji użytkownika.
// ============================================================
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fetchFinnhubQuote } from '@/lib/portfolio/prices';

export const runtime = 'nodejs';

type ServiceClient = SupabaseClient;

async function recalcAggregate(
  supabase: ServiceClient,
  portfolioId: string,
  ticker: string,
): Promise<void> {
  const { data: remaining } = await supabase
    .from('position_lots')
    .select('quantity, entry_price')
    .eq('portfolio_id', portfolioId)
    .eq('ticker', ticker)
    .eq('status', 'open');

  const lots = (remaining ?? []) as Array<{ quantity: string | number; entry_price: string | number }>;

  if (lots.length === 0) {
    await supabase
      .from('positions')
      .delete()
      .eq('portfolio_id', portfolioId)
      .eq('ticker', ticker);
    return;
  }

  const totalQty = lots.reduce((s, l) => s + Number(l.quantity), 0);
  const weightedAvg =
    lots.reduce((s, l) => s + Number(l.entry_price) * Number(l.quantity), 0) / totalQty;

  const { data: posRow } = await supabase
    .from('positions')
    .select('id')
    .eq('portfolio_id', portfolioId)
    .eq('ticker', ticker)
    .maybeSingle();

  const pos = posRow as { id: string } | null;

  if (pos) {
    await supabase
      .from('positions')
      .update({ quantity: totalQty, avg_entry_price: weightedAvg, updated_at: new Date().toISOString() })
      .eq('id', pos.id);
  } else {
    await supabase.from('positions').insert({
      portfolio_id: portfolioId,
      ticker,
      quantity: totalQty,
      avg_entry_price: weightedAvg,
    });
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase: ServiceClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    const { data: rawLots, error } = await supabase
      .from('position_lots')
      .select('id, portfolio_id, ticker, quantity, entry_price, take_profit, stop_loss')
      .eq('status', 'open')
      .or('take_profit.not.is.null,stop_loss.not.is.null');

    if (error) throw error;

    type LotRow = {
      id: string;
      portfolio_id: string;
      ticker: string;
      quantity: number | string;
      entry_price: number | string;
      take_profit: number | string | null;
      stop_loss: number | string | null;
    };

    const lots = (rawLots ?? []) as LotRow[];

    if (lots.length === 0) {
      return NextResponse.json({ checked: 0, triggered: 0 });
    }

    const uniqueTickers = [...new Set(lots.map((l) => l.ticker))];

    const priceMap: Record<string, number> = {};
    await Promise.all(
      uniqueTickers.map(async (ticker) => {
        try {
          const price = await fetchFinnhubQuote(ticker);
          if (price != null) priceMap[ticker] = price;
        } catch {
          // Brak ceny — pomijamy
        }
      }),
    );

    let triggered = 0;
    const now = new Date().toISOString();

    for (const lot of lots) {
      const currentPrice = priceMap[lot.ticker];
      if (currentPrice == null) continue;

      const tp = lot.take_profit != null ? Number(lot.take_profit) : null;
      const sl = lot.stop_loss != null ? Number(lot.stop_loss) : null;

      let closeReason: 'take_profit' | 'stop_loss' | null = null;
      if (tp != null && currentPrice >= tp) closeReason = 'take_profit';
      else if (sl != null && currentPrice <= sl) closeReason = 'stop_loss';

      if (!closeReason) continue;

      const qty = Number(lot.quantity);
      const entryPrice = Number(lot.entry_price);
      const realizedPnL = (currentPrice - entryPrice) * qty;

      await supabase
        .from('position_lots')
        .update({ status: 'closed', closed_at: now, close_price: currentPrice, close_reason: closeReason })
        .eq('id', lot.id);

      await recalcAggregate(supabase, lot.portfolio_id, lot.ticker);

      const { data: portfolioRow } = await supabase
        .from('portfolios')
        .select('cash')
        .eq('id', lot.portfolio_id)
        .maybeSingle();

      const portfolio = portfolioRow as { cash: number | string } | null;
      if (portfolio) {
        await supabase
          .from('portfolios')
          .update({ cash: Number(portfolio.cash) + currentPrice * qty })
          .eq('id', lot.portfolio_id);
      }

      await supabase.from('trades').insert({
        portfolio_id: lot.portfolio_id,
        ticker: lot.ticker,
        side: 'sell',
        quantity: qty,
        price: currentPrice,
        realized_pnl: realizedPnL,
      });

      triggered++;
    }

    return NextResponse.json({ checked: lots.length, triggered });
  } catch (err) {
    console.error('[cron/check-tp-sl]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
