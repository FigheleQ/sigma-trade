'use client';

import { cn } from '@/lib/utils';
import type { QuoteData } from '@/lib/chart/types';
import type { WatchlistItem } from '@/store/watchlistStore';

interface ChartHeaderProps {
  ticker: WatchlistItem | undefined;
  quote: QuoteData | null | undefined;
  isLoading: boolean;
}

export default function ChartHeader({ ticker, quote, isLoading }: ChartHeaderProps) {
  const symbol = ticker?.symbol ?? '—';
  const name   = ticker?.name   ?? '';

  const change = quote?.change ?? 0;
  const changePercent = quote?.changePercent ?? 0;
  const positive = changePercent >= 0;
  const changeColor = positive ? 'text-accent' : 'text-red-400';
  const sign = positive ? '+' : '';

  return (
    <div className="flex items-center gap-4 min-w-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-white tracking-wide">{symbol}</span>
          {ticker?.exchange && (
            <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">
              {ticker.exchange}
            </span>
          )}
        </div>
        {name && (
          <p className="font-mono text-[10px] text-zinc-600 truncate">{name}</p>
        )}
      </div>

      {isLoading ? (
        <div className="flex gap-2">
          <div className="w-20 h-4 bg-zinc-800 rounded animate-pulse" />
          <div className="w-14 h-4 bg-zinc-800 rounded animate-pulse" />
        </div>
      ) : quote ? (
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-base font-bold text-white">
            ${quote.price.toFixed(2)}
          </span>
          <span className={cn('font-mono text-xs', changeColor)}>
            {sign}{change.toFixed(2)} ({sign}{changePercent.toFixed(2)}%)
          </span>
        </div>
      ) : null}
    </div>
  );
}
