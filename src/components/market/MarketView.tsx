'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useChartStore } from '@/store/chartStore';
import { useWatchlistStore } from '@/store/watchlistStore';
import type { ChartApiResponse } from '@/lib/chart/types';
import { usePortfolioStore } from '@/store/portfolioStore';
import LeftPanel from './LeftPanel';
import OrderPanel from './OrderPanel';
import ChartHeader from './ChartHeader';
import ChartTypeToggle from './ChartTypeToggle';
import TimeframeSelector from './TimeframeSelector';

const StockChart = dynamic(() => import('./StockChart'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <div className="font-mono text-xs text-zinc-500">Loading chart…</div>
    </div>
  ),
});

export default function MarketView() {
  const {
    activeTicker,
    timeframe,
    chartType,
    isLoading,
    usingMockData,
    candleCache,
    candleIsMock,
    quoteCache,
    setActiveTicker,
    setLoading,
    setUsingMockData,
    setCandleCache,
    setQuoteCache,
  } = useChartStore();

  const { sections, activeTicker: wlActiveTicker } = useWatchlistStore();

  const lots = usePortfolioStore((s) => s.lots);
  const selectedLotId = usePortfolioStore((s) => s.selectedLotId);

  // Init: sync watchlist's persisted activeTicker into chartStore on first mount
  useEffect(() => {
    if (wlActiveTicker && !activeTicker) {
      setActiveTicker(wlActiveTicker);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch when ticker or timeframe changes.
  // AbortController cancels any in-flight request from a previous render
  // so stale responses never overwrite the quote for the current view.
  useEffect(() => {
    if (!activeTicker) return;
    const cacheKey = `${activeTicker}:${timeframe}`;
    // Pomijamy fetch tylko gdy mamy REALNE dane w cache. Jeśli zacacheowany
    // wynik był mockiem (chwilowy rate-limit), ponawiamy próbę realnych danych.
    if (candleCache[cacheKey] && !candleIsMock[cacheKey]) return;

    const controller = new AbortController();
    setLoading(true);
    setUsingMockData(false);

    fetch(`/api/chart?symbol=${activeTicker}&timeframe=${timeframe}`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ChartApiResponse>;
      })
      .then((data) => {
        setCandleCache(cacheKey, data.candles, data.usingMockData);
        if (data.quote) setQuoteCache(activeTicker, data.quote);
        setUsingMockData(data.usingMockData);
      })
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') {
          console.warn('[MarketView] fetch failed:', err);
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTicker, timeframe]);

  const cacheKey = `${activeTicker}:${timeframe}`;
  const candles = candleCache[cacheKey] ?? [];
  const quote = activeTicker ? quoteCache[activeTicker] : undefined;

  // Find active ticker metadata from watchlist sections
  const activeMeta = activeTicker
    ? sections.flatMap((s) => s.items).find((i) => i.symbol === activeTicker)
    : undefined;

  // Linie TP/SL z wybranego lotu (tylko gdy lot należy do aktywnego tickera)
  const selectedLot = selectedLotId
    ? lots.find((l) => l.id === selectedLotId && l.ticker === activeTicker)
    : null;
  const tpPrice = selectedLot?.takeProfit ?? null;
  const slPrice = selectedLot?.stopLoss ?? null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel — tabs: Watchlist / Pozycje / Historia */}
      <div className="hidden md:block shrink-0">
        <LeftPanel />
      </div>

      {/* Chart area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle shrink-0 gap-4">
          <ChartHeader ticker={activeMeta} quote={quote} isLoading={isLoading} />
          <div className="flex items-center gap-2 shrink-0">
            {usingMockData && (
              <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 uppercase tracking-wider">
                Demo data
              </span>
            )}
            <ChartTypeToggle />
          </div>
        </div>

        {/* Chart */}
        <div className="flex-1 relative overflow-hidden">
          <StockChart
            data={candles}
            chartType={chartType}
            isLoading={isLoading && candles.length === 0}
            tpPrice={tpPrice}
            slPrice={slPrice}
          />
        </div>

        {/* Panel Kup/Sprzedaj */}
        <OrderPanel />

        <TimeframeSelector />
      </div>
    </div>
  );
}
