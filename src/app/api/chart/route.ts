// ============================================================
// GET /api/chart?symbol=AAPL&timeframe=1M
// Server-side: fetches candles (Twelve Data) + quote (Finnhub)
// API keys never leave the server
//
// Two separate in-memory caches:
//   candleCache  — keyed by symbol:timeframe  (5 min TTL)
//   quoteCache   — keyed by symbol only        (60 s  TTL)
//
// This ensures the displayed price is always the same quote
// regardless of which timeframe is currently selected.
// ============================================================
import { NextResponse } from 'next/server';
import { fetchCandles, fetchQuote } from '@/lib/chart/dataSource';
import { generateMockCandles } from '@/lib/chart/mockData';
import type { Timeframe, ChartApiResponse, Candle, QuoteData } from '@/lib/chart/types';

const CANDLE_TTL = 5 * 60 * 1000;  // 5 minutes
const QUOTE_TTL  =      60 * 1000;  // 60 seconds

const candleCache = new Map<string, {
  candles: Candle[];
  usingMockData: boolean;
  expiresAt: number;
}>();

const quoteCache = new Map<string, {
  quote: QuoteData;
  expiresAt: number;
}>();

const VALID_TIMEFRAMES = new Set<Timeframe>(['1D', '1W', '1M', '3M', '1Y']);

export async function GET(req: Request): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') ?? '').toUpperCase().trim();
  const tf = searchParams.get('timeframe') as Timeframe | null;

  if (!symbol) {
    return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
  }
  const timeframe: Timeframe = tf && VALID_TIMEFRAMES.has(tf) ? tf : '1M';

  const now = Date.now();
  const cacheKey = `${symbol}:${timeframe}`;

  // ── Candles ──────────────────────────────────────────────────
  const cachedCandle = candleCache.get(cacheKey);
  let candles: Candle[];
  let usingMockData = false;

  if (cachedCandle && cachedCandle.expiresAt > now) {
    candles = cachedCandle.candles;
    usingMockData = cachedCandle.usingMockData;
  } else {
    try {
      candles = await fetchCandles(symbol, timeframe);
    } catch (err) {
      console.warn(`[chart] candle fetch failed for ${symbol}/${timeframe}:`, err);
      usingMockData = true;
      candles = generateMockCandles(symbol, timeframe);
    }
    candleCache.set(cacheKey, { candles, usingMockData, expiresAt: now + CANDLE_TTL });
  }

  // ── Quote (symbol-level cache, not timeframe-level) ──────────
  const cachedQuote = quoteCache.get(symbol);
  let quote: QuoteData | null = null;

  if (cachedQuote && cachedQuote.expiresAt > now) {
    quote = cachedQuote.quote;
  } else {
    try {
      quote = await fetchQuote(symbol);
      quoteCache.set(symbol, { quote, expiresAt: now + QUOTE_TTL });
    } catch (err) {
      console.warn(`[chart] quote fetch failed for ${symbol}:`, err);
      // Fall back to stale quote rather than returning null
      quote = cachedQuote?.quote ?? null;
    }
  }

  const response: ChartApiResponse = { candles, quote, usingMockData };
  return NextResponse.json(response);
}
