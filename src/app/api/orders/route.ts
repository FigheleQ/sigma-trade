// ============================================================
// POST /api/orders
//
// BUY:  { ticker, side:'buy', amountUsd? | quantity?, takeProfit?, stopLoss? }
//   • amountUsd → ilość całkowita = floor(amount / cena)
//   • quantity  → dokładna ilość całkowita (dla lotów)
//   • tworzy lot w position_lots z opcjonalnym TP/SL
//   • aktualizuje agregat w positions (avg entry ważona)
//
// SELL: { ticker, side:'sell', lotId? }
//   • lotId podany → zamknij ten konkretny lot
//   • lotId brak   → zamknij wszystkie otwarte loty tickera
//   • przelicza agregat positions z pozostałych lotów
// ============================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOrCreatePortfolio, buildPortfolioState } from '@/lib/portfolio/service';
import { getExecutionPrice } from '@/lib/portfolio/prices';
import { OrderError } from '@/lib/portfolio/execute';
import { floorShares } from '@/lib/portfolio/shares';
import { isMarketOpen } from '@/lib/market/hours';
import type { OrderRequest, OrderResult } from '@/lib/portfolio/types';

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Partial<OrderRequest>;
  try {
    body = (await req.json()) as Partial<OrderRequest>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const ticker = body.ticker?.toUpperCase().trim();
  const side = body.side;
  const amountUsd = body.amountUsd != null ? Number(body.amountUsd) : null;
  const quantityIn = body.quantity != null ? Number(body.quantity) : null;
  const takeProfit = typeof body.takeProfit === 'number' && body.takeProfit > 0 ? body.takeProfit : null;
  const stopLoss = typeof body.stopLoss === 'number' && body.stopLoss > 0 ? body.stopLoss : null;
  const lotId = typeof body.lotId === 'string' && body.lotId.trim() ? body.lotId.trim() : null;

  if (!ticker) {
    return NextResponse.json({ error: 'Missing ticker' }, { status: 400 });
  }
  if (side !== 'buy' && side !== 'sell') {
    return NextResponse.json({ error: 'side must be buy or sell' }, { status: 400 });
  }
  if (side === 'buy' && amountUsd == null && quantityIn == null) {
    return NextResponse.json({ error: 'Provide amountUsd or quantity' }, { status: 400 });
  }
  if (amountUsd != null && (!Number.isFinite(amountUsd) || amountUsd <= 0)) {
    return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
  }
  if (quantityIn != null && (!Number.isFinite(quantityIn) || quantityIn <= 0)) {
    return NextResponse.json({ error: 'Quantity must be positive' }, { status: 400 });
  }

  try {
    const portfolio = await getOrCreatePortfolio(supabase, user.id);
    const price = await getExecutionPrice(supabase, ticker);

    let realizedPnL: number | null = null;
    let executedQty: number;

    if (side === 'buy') {
      // Convert amountUsd to whole shares; quantity is used directly as integer.
      const quantity = amountUsd != null
        ? Math.floor(floorShares(amountUsd / price))
        : Math.floor(quantityIn as number);

      if (quantity < 1) {
        return NextResponse.json({ error: 'Amount too small to buy' }, { status: 400 });
      }

      const cost = price * quantity;
      if (cost > portfolio.cash) {
        return NextResponse.json({ error: 'Insufficient funds' }, { status: 400 });
      }

      executedQty = quantity;

      // Create new lot.
      await supabase.from('position_lots').insert({
        portfolio_id: portfolio.id,
        ticker,
        quantity,
        entry_price: price,
        take_profit: takeProfit,
        stop_loss: stopLoss,
      });

      // Update aggregate positions (weighted average entry).
      const { data: posRow } = await supabase
        .from('positions')
        .select('id, quantity, avg_entry_price')
        .eq('portfolio_id', portfolio.id)
        .eq('ticker', ticker)
        .maybeSingle();

      if (posRow) {
        const oldQty = Number(posRow.quantity);
        const oldAvg = Number(posRow.avg_entry_price);
        const newQty = oldQty + quantity;
        const newAvg = (oldAvg * oldQty + price * quantity) / newQty;
        await supabase
          .from('positions')
          .update({ quantity: newQty, avg_entry_price: newAvg, updated_at: new Date().toISOString() })
          .eq('id', posRow.id);
      } else {
        await supabase.from('positions').insert({
          portfolio_id: portfolio.id,
          ticker,
          quantity,
          avg_entry_price: price,
        });
      }

      await supabase
        .from('portfolios')
        .update({ cash: portfolio.cash - cost })
        .eq('id', portfolio.id);

    } else {
      // SELL — lotId provided → close specific lot, absent → close all lots.
      if (lotId) {
        const { data: lot } = await supabase
          .from('position_lots')
          .select('id, quantity, entry_price')
          .eq('id', lotId)
          .eq('portfolio_id', portfolio.id)
          .eq('status', 'open')
          .maybeSingle();

        if (!lot) {
          return NextResponse.json({ error: 'Lot not found or already closed' }, { status: 400 });
        }

        executedQty = Number(lot.quantity);
        realizedPnL = (price - Number(lot.entry_price)) * executedQty;

        await supabase
          .from('position_lots')
          .update({
            status: 'closed',
            closed_at: new Date().toISOString(),
            close_price: price,
            close_reason: 'manual',
          })
          .eq('id', lotId);

      } else {
        // Close all open lots for this ticker.
        const { data: openLots } = await supabase
          .from('position_lots')
          .select('id, quantity, entry_price')
          .eq('portfolio_id', portfolio.id)
          .eq('ticker', ticker)
          .eq('status', 'open');

        if (!openLots || openLots.length === 0) {
          return NextResponse.json({ error: 'No open lots to close' }, { status: 400 });
        }

        executedQty = openLots.reduce((sum, l) => sum + Number(l.quantity), 0);
        realizedPnL = openLots.reduce((sum, l) => {
          return sum + (price - Number(l.entry_price)) * Number(l.quantity);
        }, 0);

        const lotIds = openLots.map((l) => l.id);
        await supabase
          .from('position_lots')
          .update({
            status: 'closed',
            closed_at: new Date().toISOString(),
            close_price: price,
            close_reason: 'manual',
          })
          .in('id', lotIds);
      }

      // Recalculate positions aggregate from remaining open lots.
      await recalcAggregatePosition(supabase, portfolio.id, ticker);

      await supabase
        .from('portfolios')
        .update({ cash: portfolio.cash + price * executedQty })
        .eq('id', portfolio.id);
    }

    // Write trade history entry.
    await supabase.from('trades').insert({
      portfolio_id: portfolio.id,
      ticker,
      side,
      quantity: executedQty,
      price,
    });

    const updated = await getOrCreatePortfolio(supabase, user.id);
    const state = await buildPortfolioState(supabase, updated);

    const result: OrderResult = {
      ok: true,
      side,
      ticker,
      quantity: executedQty,
      executionPrice: price,
      realizedPnL,
      portfolio: state,
    };
    return NextResponse.json(result);

  } catch (err) {
    if (err instanceof OrderError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[api/orders]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

// Recalculates the positions aggregate from remaining open lots.
// Deletes the positions row if no open lots remain.
async function recalcAggregatePosition(
  supabase: Parameters<typeof getOrCreatePortfolio>[0],
  portfolioId: string,
  ticker: string,
): Promise<void> {
  const { data: remainingLots } = await supabase
    .from('position_lots')
    .select('quantity, entry_price')
    .eq('portfolio_id', portfolioId)
    .eq('ticker', ticker)
    .eq('status', 'open');

  const lots = remainingLots ?? [];

  if (lots.length === 0) {
    await supabase
      .from('positions')
      .delete()
      .eq('portfolio_id', portfolioId)
      .eq('ticker', ticker);
    return;
  }

  const totalQty = lots.reduce((sum, l) => sum + Number(l.quantity), 0);
  const weightedAvg =
    lots.reduce((sum, l) => sum + Number(l.entry_price) * Number(l.quantity), 0) / totalQty;

  const { data: posRow } = await supabase
    .from('positions')
    .select('id')
    .eq('portfolio_id', portfolioId)
    .eq('ticker', ticker)
    .maybeSingle();

  if (posRow) {
    await supabase
      .from('positions')
      .update({ quantity: totalQty, avg_entry_price: weightedAvg, updated_at: new Date().toISOString() })
      .eq('id', posRow.id);
  } else {
    await supabase.from('positions').insert({
      portfolio_id: portfolioId,
      ticker,
      quantity: totalQty,
      avg_entry_price: weightedAvg,
    });
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ marketOpen: isMarketOpen() });
}
