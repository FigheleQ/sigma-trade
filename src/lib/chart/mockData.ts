// ============================================================
// Mock data — deterministic seeded random walk
// Used as fallback when API is unavailable
// ============================================================
import type { Candle, Timeframe } from './types';

function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// Awaryjna baza, gdy nie znamy realnej ceny (brak quote). Tylko orientacyjne —
// NIE są aktualizowane i nie powinny być traktowane jak realne dane.
const BASE_PRICES: Record<string, number> = {
  AAPL: 185, MSFT: 420, GOOGL: 175, TSLA: 190, NVDA: 200,
};

const TIMEFRAME_CANDLES: Record<Timeframe, number> = {
  '1D': 78,   // 5-min candles
  '1W': 35,
  '1M': 30,
  '3M': 90,
  '1Y': 52,
};

/**
 * Deterministyczny mock świec. Jeśli podano `anchorPrice` (realna cena z quote),
 * cała seria jest skalowana tak, by OSTATNIA świeca zamykała się dokładnie na tej
 * cenie — dzięki temu wykres-fallback trzyma się realnej wartości zamiast
 * sztywnej, nieaktualnej bazy.
 */
export function generateMockCandles(
  symbol: string,
  timeframe: Timeframe,
  anchorPrice?: number,
): Candle[] {
  const count = TIMEFRAME_CANDLES[timeframe];
  const seed = hashString(`${symbol}:${timeframe}`);
  const rng = makeRng(seed);
  const basePrice = anchorPrice && anchorPrice > 0
    ? anchorPrice
    : (BASE_PRICES[symbol] ?? 100);

  // Determine time step in seconds
  const stepSeconds: Record<Timeframe, number> = {
    '1D': 5 * 60,
    '1W': 60 * 60,
    '1M': 24 * 60 * 60,
    '3M': 24 * 60 * 60,
    '1Y': 7 * 24 * 60 * 60,
  };
  const step = stepSeconds[timeframe];
  const now = Math.floor(Date.now() / 1000);
  const startTime = now - count * step;

  const candles: Candle[] = [];
  let price = basePrice;
  let momentum = 0;

  for (let i = 0; i < count; i++) {
    const time = startTime + i * step;
    const noise = (rng() - 0.5) * 0.015;
    momentum = momentum * 0.85 + noise;
    const changePercent = momentum + (rng() - 0.5) * 0.008;

    const open = price;
    const close = Math.max(1, open * (1 + changePercent));
    const swing = Math.abs(close - open) * (1 + rng() * 1.5);
    const high = Math.max(open, close) + swing * rng();
    const low = Math.min(open, close) - swing * rng();
    const volume = Math.floor(1_000_000 + rng() * 9_000_000);

    candles.push({
      time,
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
      volume,
    });

    price = close;
  }

  // Jeśli mamy kotwicę — przeskaluj całą serię tak, by ostatnia świeca
  // zamknęła się dokładnie na realnej cenie. Mnożymy (nie dodajemy), żeby
  // zachować relacje OHLC i dodatnie wartości.
  if (anchorPrice && anchorPrice > 0 && candles.length > 0) {
    const lastClose = candles[candles.length - 1].close;
    if (lastClose > 0) {
      const factor = anchorPrice / lastClose;
      for (const c of candles) {
        c.open = +(c.open * factor).toFixed(2);
        c.high = +(c.high * factor).toFixed(2);
        c.low = +(c.low * factor).toFixed(2);
        c.close = +(c.close * factor).toFixed(2);
      }
    }
  }

  return candles;
}
