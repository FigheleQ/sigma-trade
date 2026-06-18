// ============================================================
// Chart store — Zustand
// Tracks active ticker, timeframe, chartType, candle/quote cache
// ============================================================
import { create } from 'zustand';
import type { Timeframe, ChartType, Candle, QuoteData } from '@/lib/chart/types';

interface ChartState {
  activeTicker: string;
  timeframe: Timeframe;
  chartType: ChartType;
  isLoading: boolean;
  usingMockData: boolean;

  // Keyed by `symbol:timeframe`
  candleCache: Record<string, Candle[]>;
  // Które klucze pochodzą z mocka (fallback) — pozwala ponowić pobranie.
  candleIsMock: Record<string, boolean>;
  // Keyed by symbol
  quoteCache: Record<string, QuoteData>;

  setActiveTicker: (ticker: string) => void;
  setTimeframe: (tf: Timeframe) => void;
  setChartType: (type: ChartType) => void;
  setLoading: (v: boolean) => void;
  setUsingMockData: (v: boolean) => void;
  setCandleCache: (key: string, candles: Candle[], isMock: boolean) => void;
  setQuoteCache: (symbol: string, quote: QuoteData) => void;
}

export const useChartStore = create<ChartState>((set) => ({
  activeTicker: '',
  timeframe: '1M',
  chartType: 'line',
  isLoading: false,
  usingMockData: false,
  candleCache: {},
  candleIsMock: {},
  quoteCache: {},

  setActiveTicker: (ticker) => set({ activeTicker: ticker }),
  setTimeframe:    (tf)     => set({ timeframe: tf }),
  setChartType:    (type)   => set({ chartType: type }),
  setLoading:      (v)      => set({ isLoading: v }),
  setUsingMockData:(v)      => set({ usingMockData: v }),

  setCandleCache: (key, candles, isMock) =>
    set((s) => ({
      candleCache: { ...s.candleCache, [key]: candles },
      candleIsMock: { ...s.candleIsMock, [key]: isMock },
    })),

  setQuoteCache: (symbol, quote) =>
    set((s) => ({ quoteCache: { ...s.quoteCache, [symbol]: quote } })),
}));
