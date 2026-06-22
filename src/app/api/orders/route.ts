// ============================================================
// POST /api/orders   body: { ticker, side: 'buy'|'sell', quantity }
//
// Egzekucja po ŚWIEŻEJ cenie z Finnhub (nie z cache / nie z UI).
// Walidacja serwerowa: dość cash przy kupnie, dość akcji przy sprzedaży.
// Aktualizuje pozycję (avg entry ważona), cash i dopisuje wpis do historii.
//
// Uwaga: operacje nie są opakowane w transakcję SQL (Supabase JS).
// Dla paper-tradingu jednego usera ryzyko wyścigu jest pomijalne;
// docelowo można przenieść do funkcji Postgres (RPC) dla atomowości.
// ============================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOrCreatePortfolio, buildPortfolioState } from '@/lib/portfolio/service';
import { getExecutionPrice } from '@/lib/portfolio/prices';
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

  // ── Walidacja wejścia ──────────────────────────────────────
  let body: Partial<OrderRequest>;
  try {
    body = (await req.json()) as Partial<OrderRequest>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const ticker = body.ticker?.toUpperCase().trim();
  const side = body.side;
  const quantity = Number(body.quantity);

  if (!ticker) {
    return NextResponse.json({ error: 'Brak tickera' }, { status: 400 });
  }
  if (side !== 'buy' && side !== 'sell') {
    return NextResponse.json({ error: 'side musi być buy lub sell' }, { status: 400 });
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return NextResponse.json(
      { error: 'quantity musi być liczbą całkowitą ≥ 1' },
      { status: 400 },
    );
  }

  try {
    const portfolio = await getOrCreatePortfolio(supabase, user.id);

    // Cena egzekucji — świeża z Finnhub.
    const price = await getExecutionPrice(supabase, ticker);

    // Aktualna pozycja (jeśli jest).
    const { data: posRow } = await supabase
      .from('positions')
      .select('id, quantity, avg_entry_price')
      .eq('portfolio_id', portfolio.id)
      .eq('ticker', ticker)
      .maybeSingle();

    let realizedPnL: number | null = null;

    if (side === 'buy') {
      const cost = price * quantity;
      if (cost > portfolio.cash) {
        return NextResponse.json(
          { error: 'Za mało środków na zakup' },
          { status: 400 },
        );
      }

      if (posRow) {
        // Średnia ważona cena wejścia.
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
      // SELL
      if (!posRow || Number(posRow.quantity) < quantity) {
        return NextResponse.json(
          { error: 'Za mało akcji do sprzedaży' },
          { status: 400 },
        );
      }

      const oldQty = Number(posRow.quantity);
      const avg = Number(posRow.avg_entry_price);
      realizedPnL = (price - avg) * quantity;
      const newQty = oldQty - quantity;

      if (newQty === 0) {
        await supabase.from('positions').delete().eq('id', posRow.id);
      } else {
        // Częściowa sprzedaż — reszta zachowuje tę samą avg entry.
        await supabase
          .from('positions')
          .update({ quantity: newQty, updated_at: new Date().toISOString() })
          .eq('id', posRow.id);
      }

      await supabase
        .from('portfolios')
        .update({ cash: portfolio.cash + price * quantity })
        .eq('id', portfolio.id);
    }

    // Wpis do historii (niezmienny ledger).
    await supabase.from('trades').insert({
      portfolio_id: portfolio.id,
      ticker,
      side,
      quantity,
      price,
      realized_pnl: realizedPnL,
    });

    // Świeży stan portfela po transakcji.
    const updated = await getOrCreatePortfolio(supabase, user.id);
    const state = await buildPortfolioState(supabase, updated);

    const result: OrderResult = {
      ok: true,
      side,
      ticker,
      quantity,
      executionPrice: price,
      realizedPnL,
      portfolio: state,
    };
    return NextResponse.json(result);
  } catch (err) {
    console.error('[api/orders]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

// Pomocniczo: czy rynek otwarty (dla UI; egzekucja w Fazie 1 nie jest blokowana).
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ marketOpen: isMarketOpen() });
}
