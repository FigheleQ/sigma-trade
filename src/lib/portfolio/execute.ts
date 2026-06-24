// ============================================================
// Egzekucja market order — współdzielona przez:
//   • POST /api/orders        (klient usera, ręczny Kup/Sprzedaj)
//   • cron DCA /api/dca/run    (service-role, zakup w tle)
//
// Działa na JUŻ ustalonej cenie i wierszu portfela. Mutuje positions /
// portfolios / trades dokładnie tak jak dawniej robił to inline orders/route.
// Walidacja biznesowa (za mało cash / akcji) → OrderError (mapowane na 400).
//
// Uwaga: bez transakcji SQL (Supabase JS) — jak dotychczas. Dla paper-tradingu
// jednego usera ryzyko wyścigu pomijalne; docelowo RPC dla atomowości.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PortfolioRow } from './service';

// Błąd walidacji biznesowej (odróżnia 400 od 500 w warstwie API).
export class OrderError extends Error {}

export interface ExecuteParams {
  ticker: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
}

export async function executeMarketOrder(
  supabase: SupabaseClient,
  portfolio: PortfolioRow,
  { ticker, side, quantity, price }: ExecuteParams,
): Promise<{ realizedPnL: number | null }> {
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
      throw new OrderError('Za mało środków na zakup');
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
      throw new OrderError('Za mało akcji do sprzedaży');
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

  return { realizedPnL };
}
