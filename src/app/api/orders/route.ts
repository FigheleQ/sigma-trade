// ============================================================
// POST /api/orders   body: { ticker, side, amountUsd? | quantity? }
//
// Egzekucja po ŚWIEŻEJ cenie z Finnhub (nie z cache / nie z UI).
//   • amountUsd → ilość ułamkowa = floor(amount / cena) (zakup nie przekracza budżetu)
//   • quantity  → dokładna ilość (ułamkowa), np. pełne wyjście z pozycji
// Sprzedaż „za X$" jest przycinana do posiadanej ilości (bez pyłu / oversell).
// Walidacja biznesowa (cash / akcje) w executeMarketOrder → OrderError = 400.
// ============================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOrCreatePortfolio, buildPortfolioState } from '@/lib/portfolio/service';
import { getExecutionPrice } from '@/lib/portfolio/prices';
import { executeMarketOrder, OrderError } from '@/lib/portfolio/execute';
import { floorShares, roundShares } from '@/lib/portfolio/shares';
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
  const amountUsd = body.amountUsd != null ? Number(body.amountUsd) : null;
  const quantityIn = body.quantity != null ? Number(body.quantity) : null;

  if (!ticker) {
    return NextResponse.json({ error: 'Missing ticker' }, { status: 400 });
  }
  if (side !== 'buy' && side !== 'sell') {
    return NextResponse.json({ error: 'side must be buy or sell' }, { status: 400 });
  }
  // Dokładnie jedno źródło wielkości zlecenia.
  if ((amountUsd == null) === (quantityIn == null)) {
    return NextResponse.json(
      { error: 'Provide amountUsd or quantity' },
      { status: 400 },
    );
  }
  if (amountUsd != null && (!Number.isFinite(amountUsd) || amountUsd <= 0)) {
    return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
  }
  if (quantityIn != null && (!Number.isFinite(quantityIn) || quantityIn <= 0)) {
    return NextResponse.json({ error: 'Quantity must be positive' }, { status: 400 });
  }

  try {
    const portfolio = await getOrCreatePortfolio(supabase, user.id);

    // Cena egzekucji — świeża z Finnhub.
    const price = await getExecutionPrice(supabase, ticker);

    // Ilość do egzekucji (ułamkowa).
    let quantity =
      amountUsd != null ? floorShares(amountUsd / price) : roundShares(quantityIn as number);

    // Sprzedaż „za X$" przycinamy do posiadanej ilości → czyste pełne wyjście.
    if (side === 'sell' && amountUsd != null) {
      const { data: posRow } = await supabase
        .from('positions')
        .select('quantity')
        .eq('portfolio_id', portfolio.id)
        .eq('ticker', ticker)
        .maybeSingle();
      const owned = posRow ? Number(posRow.quantity) : 0;
      quantity = Math.min(quantity, owned);
    }

    if (quantity <= 0) {
      return NextResponse.json(
        { error: side === 'buy' ? 'Amount too small to buy' : 'No shares to sell' },
        { status: 400 },
      );
    }

    const { realizedPnL } = await executeMarketOrder(supabase, portfolio, {
      ticker,
      side,
      quantity,
      price,
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

// Pomocniczo: czy rynek otwarty (dla UI; egzekucja w Fazie 1 nie jest blokowana).
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ marketOpen: isMarketOpen() });
}
