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

  // ── Quote (symbol-level cache, not timeframe-level) ──────────
  // Pobierane PRZED świecami, by realna cena mogła zakotwiczyć mock-fallback.
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
      // Kotwiczymy mock do realnej ceny z quote (jeśli mamy), żeby fallback
      // nie pokazywał absurdalnych wartości (np. sprzed splitu).
      candles = generateMockCandles(symbol, timeframe, quote?.price);
    }
    // Mock cache'ujemy krócej (30 s), żeby szybko ponowić próbę realnych danych
    // gdy minie chwilowy rate-limit; realne dane — pełne 5 min.
    const ttl = usingMockData ? 30 * 1000 : CANDLE_TTL;
    candleCache.set(cacheKey, { candles, usingMockData, expiresAt: now + ttl });
  }

  // Fallback ceny: gdy quote z Finnhuba nie dojdzie (np. rate-limit → throw),
  // podeprzyj się ostatnią ceną ze świec. Bez tego panel Kup/Sprzedaj nie ma
  // ceny (koszt $0.00, przyciski disabled), choć wykres pokazuje realną wartość.
  // Egzekucja i tak bierze świeżą cenę serwerowo (getExecutionPrice), więc to
  // tylko cena do wyświetlania/podglądu kosztu — bezpieczne.
  if ((!quote || !quote.price) && candles.length > 0) {
    const lastClose = candles[candles.length - 1].close;
    quote = {
      price: lastClose,
      change: quote?.change ?? 0,
      changePercent: quote?.changePercent ?? 0,
      high: quote?.high ?? lastClose,
      low: quote?.low ?? lastClose,
      open: quote?.open ?? lastClose,
    };
  }

  // Zakotwiczenie ostatniej świecy do ceny z quote (Finnhub), żeby koniec
  // wykresu zgadzał się z ceną w nagłówku i panelu Kup/Sprzedaj. Świece idą
  // z TwelveData (inny vendor → inna ostatnia wartość); nagłówek/egzekucja
  // używają Finnhuba, więc to quote jest wartością wiążącą. Nie mutujemy
  // cache — budujemy nową tablicę tylko na odpowiedź.
  let outCandles = candles;
  if (quote?.price && candles.length > 0) {
    const last = candles[candles.length - 1];
    outCandles = [
      ...candles.slice(0, -1),
      {
        ...last,
        close: quote.price,
        high: Math.max(last.high, quote.price),
        low: Math.min(last.low, quote.price),
      },
    ];
  }

  const response: ChartApiResponse = { candles: outCandles, quote, usingMockData };
  return NextResponse.json(response);
}
