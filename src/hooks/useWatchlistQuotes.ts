'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export type QuoteEntry = {
  price: number;
  change: number;
  changePercent: number;
  cachedAt: number;
};

const CACHE_TTL = 60_000;
const REFRESH_INTERVAL = 60_000;
const FAST_REFRESH_INTERVAL = 15_000;
const MAX_SYMBOLS = 20;

export function useWatchlistQuotes(symbols: string[], fastSymbols: string[] = []) {
  const [quotes, setQuotes] = useState<Record<string, QuoteEntry>>({});
  const cacheRef = useRef<Record<string, QuoteEntry>>({});

  const fetchQuotes = useCallback(async (syms: string[], bypassCache = false) => {
    const now = Date.now();
    const toFetch = syms
      .slice(0, MAX_SYMBOLS)
      .filter((s) => {
        if (bypassCache) return true;
        const cached = cacheRef.current[s];
        return !cached || now - cached.cachedAt > CACHE_TTL;
      });

    if (toFetch.length === 0) return;

    try {
      const res = await fetch(`/api/quotes?symbols=${toFetch.join(',')}`);
      if (!res.ok) return;
      const data: Record<string, Record<string, string>> = await res.json();

      const updates: Record<string, QuoteEntry> = {};
      for (const sym of toFetch) {
        const d = data[sym];
        if (!d?.close) continue;
        updates[sym] = {
          price: parseFloat(d.close),
          change: parseFloat(d.change ?? '0'),
          changePercent: parseFloat(d.percent_change ?? '0'),
          cachedAt: Date.now(),
        };
      }

      if (Object.keys(updates).length > 0) {
        cacheRef.current = { ...cacheRef.current, ...updates };
        setQuotes((prev) => ({ ...prev, ...updates }));
      }
    } catch {
      // Silent — stale data is fine
    }
  }, []);

  const symbolsKey = symbols.slice(0, MAX_SYMBOLS).join(',');

  useEffect(() => {
    if (!symbolsKey) return;
    const syms = symbolsKey.split(',');
    void fetchQuotes(syms);
    const id = setInterval(() => void fetchQuotes(syms), REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [symbolsKey, fetchQuotes]);

  const fastKey = fastSymbols.slice(0, MAX_SYMBOLS).join(',');

  useEffect(() => {
    if (!fastKey) return;
    const syms = fastKey.split(',');
    // bypass cache so every tick always fetches fresh data
    const id = setInterval(() => void fetchQuotes(syms, true), FAST_REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [fastKey, fetchQuotes]);

  return quotes;
}
