'use client';

// ============================================================
// Positions tab — expandable ticker rows with per-lot TP/SL.
// Click ticker → set active ticker + toggle lot list.
// Click lot → set active ticker + select lot (shows TP/SL lines on chart).
// ============================================================
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Target, ShieldAlert } from 'lucide-react';
import { usePortfolioStore } from '@/store/portfolioStore';
import { useWatchlistStore } from '@/store/watchlistStore';
import { cn } from '@/lib/utils';
import { fmtUSD, fmtPct } from '@/lib/portfolio/format';
import { fmtShares } from '@/lib/portfolio/shares';

export default function PositionsPanel() {
  const portfolio = usePortfolioStore((s) => s.portfolio);
  const loading = usePortfolioStore((s) => s.loading);
  const fetchPortfolio = usePortfolioStore((s) => s.fetchPortfolio);
  const lots = usePortfolioStore((s) => s.lots);
  const fetchLots = usePortfolioStore((s) => s.fetchLots);
  const selectedLotId = usePortfolioStore((s) => s.selectedLotId);
  const selectLot = usePortfolioStore((s) => s.selectLot);
  const setActiveTicker = useWatchlistStore((s) => s.setActiveTicker);

  const [expandedTickers, setExpandedTickers] = useState<Set<string>>(new Set());

  useEffect(() => {
    void fetchPortfolio();
    void fetchLots();
  }, [fetchPortfolio, fetchLots]);

  const positions = portfolio?.positions ?? [];

  const toggleTicker = (ticker: string) => {
    setExpandedTickers((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) {
        next.delete(ticker);
      } else {
        next.add(ticker);
      }
      return next;
    });
  };

  const handleTickerClick = (ticker: string) => {
    setActiveTicker(ticker);
    selectLot(null);
    toggleTicker(ticker);
  };

  const handleLotClick = (e: React.MouseEvent, lotId: string, ticker: string) => {
    e.stopPropagation();
    setActiveTicker(ticker);
    selectLot(selectedLotId === lotId ? null : lotId);
  };

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
            const isExpanded = expandedTickers.has(p.ticker);
            const tickerLots = lots.filter((l) => l.ticker === p.ticker);

            return (
              <div key={p.ticker} className="border-b border-border-subtle">
                {/* Ticker aggregate row */}
                <button
                  onClick={() => handleTickerClick(p.ticker)}
                  className="w-full px-3 py-2.5 text-left hover:bg-bg-panel transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {tickerLots.length > 0 ? (
                        isExpanded ? (
                          <ChevronDown size={11} className="text-zinc-600 shrink-0" />
                        ) : (
                          <ChevronRight size={11} className="text-zinc-600 shrink-0" />
                        )
                      ) : (
                        <span className="w-[11px]" />
                      )}
                      <span className="font-mono text-xs font-bold text-gray-100">{p.ticker}</span>
                      {tickerLots.length > 0 && (
                        <span className="font-mono text-[9px] text-zinc-600 bg-zinc-800 px-1 rounded">
                          {tickerLots.length}
                        </span>
                      )}
                    </div>
                    <span
                      className={cn(
                        'font-mono text-[10px] tabular-nums',
                        positive ? 'text-accent' : 'text-red-400',
                      )}
                    >
                      {fmtPct(p.unrealizedPnLPercent)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5 pl-[17px]">
                    <span className="font-mono text-[10px] text-zinc-500">
                      {fmtShares(p.quantity)} × {fmtUSD(p.avgEntryPrice)}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-400 tabular-nums">
                      {fmtUSD(p.currentPrice)}
                    </span>
                  </div>
                </button>

                {/* Expanded lots */}
                {isExpanded && tickerLots.length > 0 && (
                  <div className="bg-zinc-950/50">
                    {tickerLots.map((lot, i) => {
                      const isSelected = selectedLotId === lot.id;
                      const lotPnLPct =
                        lot.entryPrice > 0
                          ? ((p.currentPrice - lot.entryPrice) / lot.entryPrice) * 100
                          : 0;
                      const lotPositive = lotPnLPct >= 0;

                      return (
                        <button
                          key={lot.id}
                          onClick={(e) => handleLotClick(e, lot.id, lot.ticker)}
                          className={cn(
                            'w-full px-3 py-2 text-left transition-colors border-t border-border-subtle/50',
                            isSelected
                              ? 'bg-accent/5 border-l-2 border-l-accent'
                              : 'hover:bg-bg-panel',
                          )}
                        >
                          <div className="flex items-center justify-between pl-4">
                            <span className="font-mono text-[10px] text-zinc-400">
                              Lot {i + 1} · {fmtShares(lot.quantity)} shr
                            </span>
                            <span
                              className={cn(
                                'font-mono text-[10px] tabular-nums',
                                lotPositive ? 'text-accent' : 'text-red-400',
                              )}
                            >
                              {fmtPct(lotPnLPct)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-0.5 pl-4">
                            <span className="font-mono text-[9px] text-zinc-600">
                              @ {fmtUSD(lot.entryPrice)}
                            </span>
                            <div className="flex items-center gap-2">
                              {lot.takeProfit != null && (
                                <span className="flex items-center gap-0.5 font-mono text-[9px] text-emerald-500/80">
                                  <Target size={9} />
                                  {fmtUSD(lot.takeProfit)}
                                </span>
                              )}
                              {lot.stopLoss != null && (
                                <span className="flex items-center gap-0.5 font-mono text-[9px] text-red-500/80">
                                  <ShieldAlert size={9} />
                                  {fmtUSD(lot.stopLoss)}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
