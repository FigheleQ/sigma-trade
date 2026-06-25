'use client';

// ============================================================
// Zakładka „Historia" — log transakcji (buy/sell) + realized P/L.
// ============================================================
import { useEffect } from 'react';
import { usePortfolioStore } from '@/store/portfolioStore';
import { cn } from '@/lib/utils';
import { fmtUSD, fmtSignedUSD } from '@/lib/portfolio/format';
import { fmtShares } from '@/lib/portfolio/shares';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function HistoryPanel() {
  const trades = usePortfolioStore((s) => s.trades);
  const fetchTrades = usePortfolioStore((s) => s.fetchTrades);

  useEffect(() => {
    void fetchTrades();
  }, [fetchTrades]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-border-subtle shrink-0">
        <span className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider">
          History
        </span>
      </div>
      <div className="flex flex-col flex-1 overflow-y-auto">
      {trades.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="font-mono text-[11px] text-zinc-600 text-center">
            No transactions.
          </p>
        </div>
      ) : (
        trades.map((t) => {
          const isBuy = t.side === 'buy';
          const pnlPositive = (t.realizedPnL ?? 0) >= 0;
          return (
            <div key={t.id} className="px-3 py-2 border-b border-border-subtle">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'font-mono text-[9px] font-bold uppercase px-1 py-0.5 rounded',
                      isBuy ? 'bg-accent/15 text-accent' : 'bg-red-500/15 text-red-400',
                    )}
                  >
                    {isBuy ? 'Buy' : 'Sell'}
                  </span>
                  <span className="font-mono text-xs font-bold text-gray-100">{t.ticker}</span>
                </div>
                <span className="font-mono text-[9px] text-zinc-600">{timeAgo(t.executedAt)}</span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="font-mono text-[10px] text-zinc-500">
                  {fmtShares(t.quantity)} × {fmtUSD(t.price)}
                </span>
                {t.realizedPnL != null && (
                  <span
                    className={cn(
                      'font-mono text-[10px] tabular-nums',
                      pnlPositive ? 'text-accent' : 'text-red-400',
                    )}
                  >
                    {fmtSignedUSD(t.realizedPnL)}
                  </span>
                )}
              </div>
            </div>
          );
        })
      )}
      </div>
    </div>
  );
}
