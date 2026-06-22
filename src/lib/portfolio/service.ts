// ============================================================
// Serwis portfela — wspólna logika dla API routes.
//   • getOrCreatePortfolio — pobiera portfel usera, tworzy z 100k jeśli brak
//   • buildPortfolioState  — składa pełny stan (pozycje + ceny + P/L)
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCachedPrices } from './prices';
import type { PortfolioState, Position } from './types';

export const DEFAULT_BALANCE = 100_000;

export interface PortfolioRow {
  id: string;
  cash: number;
  initial_balance: number;
}

// Pobiera portfel zalogowanego usera. Jeśli nie istnieje — tworzy z domyślnym
// balansem (Faza 1: chooser 10k/50k/100k dorobimy później).
export async function getOrCreatePortfolio(
  supabase: SupabaseClient,
  userId: string,
): Promise<PortfolioRow> {
  const { data: existing } = await supabase
    .from('portfolios')
    .select('id, cash, initial_balance')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    return {
      id: existing.id,
      cash: Number(existing.cash),
      initial_balance: Number(existing.initial_balance),
    };
  }

  const { data: created, error } = await supabase
    .from('portfolios')
    .insert({
      user_id: userId,
      cash: DEFAULT_BALANCE,
      initial_balance: DEFAULT_BALANCE,
    })
    .select('id, cash, initial_balance')
    .single();

  if (error || !created) {
    throw new Error(`Nie udało się utworzyć portfela: ${error?.message ?? 'unknown'}`);
  }

  return {
    id: created.id,
    cash: Number(created.cash),
    initial_balance: Number(created.initial_balance),
  };
}

// Składa pełny stan portfela: pozycje + ceny aktualne (z cache) + P/L.
export async function buildPortfolioState(
  supabase: SupabaseClient,
  portfolio: PortfolioRow,
): Promise<PortfolioState> {
  const { data: posRows } = await supabase
    .from('positions')
    .select('ticker, quantity, avg_entry_price')
    .eq('portfolio_id', portfolio.id);

  const rows = posRows ?? [];
  const prices = await getCachedPrices(
    supabase,
    rows.map((r) => r.ticker),
  );

  const positions: Position[] = rows.map((r) => {
    const quantity = Number(r.quantity);
    const avgEntryPrice = Number(r.avg_entry_price);
    // Fallback do avg entry, jeśli ceny chwilowo brak (brak P/L zamiast crasha).
    const currentPrice = prices[r.ticker.toUpperCase()] ?? avgEntryPrice;
    const marketValue = currentPrice * quantity;
    const unrealizedPnL = (currentPrice - avgEntryPrice) * quantity;
    const unrealizedPnLPercent =
      avgEntryPrice > 0 ? ((currentPrice - avgEntryPrice) / avgEntryPrice) * 100 : 0;

    return {
      ticker: r.ticker,
      quantity,
      avgEntryPrice,
      currentPrice,
      marketValue,
      unrealizedPnL,
      unrealizedPnLPercent,
    };
  });

  const positionsValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
  const totalValue = portfolio.cash + positionsValue;
  const totalPnL = totalValue - portfolio.initial_balance;
  const totalPnLPercent =
    portfolio.initial_balance > 0 ? (totalPnL / portfolio.initial_balance) * 100 : 0;

  return {
    cash: portfolio.cash,
    initialBalance: portfolio.initial_balance,
    positionsValue,
    totalValue,
    totalPnL,
    totalPnLPercent,
    positions,
  };
}
