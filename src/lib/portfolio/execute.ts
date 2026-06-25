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

  // Najpierw ruszamy POZYCJĄ, dopiero potem cash — i SPRAWDZAMY błąd każdego
  // zapisu. Bez tego nieudany insert (np. zła kolumna/RLS) przechodził po cichu,
  // a cash i tak był odejmowany → „znikające" pieniądze bez pozycji w portfelu.
  let cashDelta: number;

  if (side === 'buy') {
    const cost = price * quantity;
    if (cost > portfolio.cash) {
      throw new OrderError('Insufficient funds');
    }
    cashDelta = -cost;

    if (posRow) {
      // Średnia ważona cena wejścia.
      const oldQty = Number(posRow.quantity);
      const oldAvg = Number(posRow.avg_entry_price);
      const newQty = oldQty + quantity;
      const newAvg = (oldAvg * oldQty + price * quantity) / newQty;
      const { error } = await supabase
        .from('positions')
        .update({ quantity: newQty, avg_entry_price: newAvg, updated_at: new Date().toISOString() })
        .eq('id', posRow.id);
      if (error) throw new Error(`positions.update: ${error.message}`);
    } else {
      const { error } = await supabase.from('positions').insert({
        portfolio_id: portfolio.id,
        ticker,
        quantity,
        avg_entry_price: price,
      });
      if (error) throw new Error(`positions.insert: ${error.message}`);
    }
  } else {
    // SELL
    if (!posRow || Number(posRow.quantity) < quantity) {
      throw new OrderError('Not enough shares to sell');
    }
    cashDelta = price * quantity;

    const oldQty = Number(posRow.quantity);
    const avg = Number(posRow.avg_entry_price);
    realizedPnL = (price - avg) * quantity;
    const newQty = oldQty - quantity;

    if (newQty <= 0) {
      const { error } = await supabase.from('positions').delete().eq('id', posRow.id);
      if (error) throw new Error(`positions.delete: ${error.message}`);
    } else {
      // Częściowa sprzedaż — reszta zachowuje tę samą avg entry.
      const { error } = await supabase
        .from('positions')
        .update({ quantity: newQty, updated_at: new Date().toISOString() })
        .eq('id', posRow.id);
      if (error) throw new Error(`positions.update: ${error.message}`);
    }
  }

  // Cash dopiero po udanej zmianie pozycji.
  const { error: cashErr } = await supabase
    .from('portfolios')
    .update({ cash: portfolio.cash + cashDelta })
    .eq('id', portfolio.id);
  if (cashErr) throw new Error(`portfolios.update: ${cashErr.message}`);

  // Wpis do historii (niezmienny ledger).
  const { error: tradeErr } = await supabase.from('trades').insert({
    portfolio_id: portfolio.id,
    ticker,
    side,
    quantity,
    price,
    realized_pnl: realizedPnL,
  });
  if (tradeErr) throw new Error(`trades.insert: ${tradeErr.message}`);

  return { realizedPnL };
}
