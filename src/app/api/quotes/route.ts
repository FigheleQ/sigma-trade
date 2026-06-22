import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/quotes?symbols=AAPL,MSFT,TSLA
//
// Serwuje ceny watchlisty z WSPÓLNEGO cache (price_cache) i odpytuje Finnhub
// TYLKO dla symboli starszych niż TTL. Dzięki temu wiele kart / szybki polling
// nie wyczerpują darmowego limitu Finnhub (60/min), a egzekucja zleceń ma
// zawsze świeży fallback ceny w cache.
//
// Kształt odpowiedzi zachowany: { [SYMBOL]: { close, change, percent_change } }
const CACHE_TTL_MS = 30_000;

async function fetchFinnhub(
  sym: string,
  apiKey: string,
): Promise<{ price: number; change: number; changePercent: number } | null> {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${apiKey}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    // Finnhub: c=current, d=change, dp=change% ; przy limicie zwraca {error:...}
    const q = (await res.json()) as { c?: number; d?: number; dp?: number };
    if (typeof q.c !== 'number' || q.c <= 0) return null;
    return { price: q.c, change: q.d ?? 0, changePercent: q.dp ?? 0 };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const symbols = req.nextUrl.searchParams.get('symbols');
  if (!symbols?.trim()) {
    return NextResponse.json({ error: 'Missing symbols' }, { status: 400 });
  }

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'FINNHUB_API_KEY not set' }, { status: 500 });
  }

  const list = [
    ...new Set(
      symbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
    ),
  ];

  const supabase = await createClient();
  const now = Date.now();

  // 1. Czytamy cache dla wszystkich żądanych symboli.
  const { data: cacheRows } = await supabase
    .from('price_cache')
    .select('ticker, price, change, change_percent, fetched_at')
    .in('ticker', list);

  const cache = new Map<string, { price: number; change: number; change_percent: number; fetched_at: string }>();
  for (const r of cacheRows ?? []) {
    cache.set(r.ticker, {
      price: Number(r.price),
      change: Number(r.change ?? 0),
      change_percent: Number(r.change_percent ?? 0),
      fetched_at: r.fetched_at,
    });
  }

  const result: Record<string, { close: string; change: string; percent_change: string }> = {};
  const stale: string[] = [];

  for (const sym of list) {
    const c = cache.get(sym);
    if (c && now - new Date(c.fetched_at).getTime() < CACHE_TTL_MS) {
      result[sym] = {
        close: String(c.price),
        change: String(c.change),
        percent_change: String(c.change_percent),
      };
    } else {
      stale.push(sym);
    }
  }

  // 2. Tylko nieaktualne symbole odpytujemy w Finnhub (równolegle).
  const fetched = await Promise.all(
    stale.map(async (sym) => [sym, await fetchFinnhub(sym, apiKey)] as const),
  );

  const upserts: Array<{
    ticker: string;
    price: number;
    change: number;
    change_percent: number;
    fetched_at: string;
  }> = [];

  for (const [sym, q] of fetched) {
    if (q) {
      result[sym] = {
        close: String(q.price),
        change: String(q.change),
        percent_change: String(q.changePercent),
      };
      upserts.push({
        ticker: sym,
        price: q.price,
        change: q.change,
        change_percent: q.changePercent,
        fetched_at: new Date().toISOString(),
      });
    } else {
      // Finnhub padł (limit) — serwuj starą cenę z cache, jeśli jest.
      const c = cache.get(sym);
      if (c) {
        result[sym] = {
          close: String(c.price),
          change: String(c.change),
          percent_change: String(c.change_percent),
        };
      }
    }
  }

  if (upserts.length > 0) {
    try {
      await supabase.from('price_cache').upsert(upserts, { onConflict: 'ticker' });
    } catch {
      // cache to optymalizacja — błąd zapisu nie wywala odpowiedzi
    }
  }

  return NextResponse.json(result);
}
