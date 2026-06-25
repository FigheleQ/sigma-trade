'use client';

// ============================================================
// Zakładka „Pozycje" — otwarte pozycje usera z P/L (unrealized).
// Klik w pozycję → ustawia aktywny ticker (wykres się przełącza).
// ============================================================
import { useEffect } from 'react';
import { usePortfolioStore } from '@/store/portfolioStore';
import { useWatchlistStore } from '@/store/watchlistStore';
import { cn } from '@/lib/utils';
import { fmtUSD, fmtPct } from '@/lib/portfolio/format';
import { fmtShares } from '@/lib/portfolio/shares';

export default function PositionsPanel() {
  const portfolio = usePortfolioStore((s) => s.portfolio);
  const loading = usePortfolioStore((s) => s.loading);
  const fetchPortfolio = usePortfolioStore((s) => s.fetchPortfolio);
  const setActiveTicker = useWatchlistStore((s) => s.setActiveTicker);

  useEffect(() => {
    void fetchPortfolio();
  }, [fetchPortfolio]);

  const positions = portfolio?.positions ?? [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-border-subtle shrink-0">
        <span className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider">
          Positions
        </span>
      </div>
      <div className="flex flex-col flex-1 overflow-y-auto">
      {positions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="font-mono text-[11px] text-zinc-600 text-center">
            {loading ? 'Loading…' : 'No open positions.\nBuy an instrument to start.'}
          </p>
        </div>
      ) : (
        positions.map((p) => {
          const positive = p.unrealizedPnL >= 0;
          return (
            <button
              key={p.ticker}
              onClick={() => setActiveTicker(p.ticker)}
              className="px-3 py-2.5 border-b border-border-subtle text-left hover:bg-bg-panel transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-gray-100">{p.ticker}</span>
                <span
                  className={cn(
                    'font-mono text-[10px] tabular-nums',
                    positive ? 'text-accent' : 'text-red-400',
                  )}
                >
                  {fmtPct(p.unrealizedPnLPercent)}
                </span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="font-mono text-[10px] text-zinc-500">
                  {fmtShares(p.quantity)} × {fmtUSD(p.avgEntryPrice)}
                </span>
                <span className="font-mono text-[10px] text-zinc-400 tabular-nums">
                  {fmtUSD(p.currentPrice)}
                </span>
              </div>
            </button>
          );
        })
      )}
      </div>
    </div>
  );
}
