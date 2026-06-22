// ============================================================
// Serwis cen — Finnhub + wspólny cache w tabeli price_cache.
//
// Dwie ścieżki (zgodnie ze spec):
//   • WYŚWIETLANIE → getCachedPrices(): cache z TTL, odświeża nieaktualne
//   • EGZEKUCJA    → getExecutionPrice(): zawsze świeży /quote (uczciwa cena)
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';

const PRICE_TTL_MS = 60_000; // 60 s — po tym czasie cache uznajemy za nieaktualny

// Surowy pojedynczy quote z Finnhub. Zwraca cenę lub null (brak danych / rate limit).
export async function fetchFinnhubQuote(ticker: string): Promise<number | null> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) throw new Error('FINNHUB_API_KEY not set');

  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;

  // Finnhub: c = current price
  const q = (await res.json()) as { c?: number };
  return typeof q.c === 'number' && q.c > 0 ? q.c : null;
}

async function upsertCache(
  supabase: SupabaseClient,
  ticker: string,
  price: number,
): Promise<void> {
  await supabase
    .from('price_cache')
    .upsert(
      { ticker, price, fetched_at: new Date().toISOString() },
      { onConflict: 'ticker' },
    );
}

// EGZEKUCJA — świeża cena z Finnhub w momencie transakcji + odświeżenie cache.
// Jeśli świeży fetch padnie (limit API / chwilowy błąd), spada na ostatnią
// znaną cenę z cache — lepsze niż blokada całego handlu. Rzuca dopiero gdy
// nie ma ŻADNEJ ceny (np. zły ticker / spółka nienotowana, nigdy nie cache'owana).
export async function getExecutionPrice(
  supabase: SupabaseClient,
  ticker: string,
): Promise<number> {
  const fresh = await fetchFinnhubQuote(ticker);
  if (fresh != null) {
    await upsertCache(supabase, ticker, fresh);
    return fresh;
  }

  // Fallback: ostatnia cena z cache (np. zasilona przez watchlistę), dowolny wiek.
  const { data } = await supabase
    .from('price_cache')
    .select('price')
    .eq('ticker', ticker)
    .maybeSingle();

  if (data?.price != null) {
    return Number(data.price);
  }

  throw new Error(
    `Brak ceny dla ${ticker} — Finnhub przekroczył limit zapytań. Spróbuj za chwilę.`,
  );
}

// WYŚWIETLANIE — ceny z cache; nieaktualne (> TTL) odświeżane z Finnhub.
// Deduplikuje tickery i odpytuje każdy maksymalnie raz.
export async function getCachedPrices(
  supabase: SupabaseClient,
  tickers: string[],
): Promise<Record<string, number>> {
  const unique = [...new Set(tickers.map((t) => t.toUpperCase()))].filter(Boolean);
  if (unique.length === 0) return {};

  const { data } = await supabase
    .from('price_cache')
    .select('ticker, price, fetched_at')
    .in('ticker', unique);

  const now = Date.now();
  const cached = new Map<string, { price: number; fetchedAt: number }>();
  for (const row of data ?? []) {
    cached.set(row.ticker, {
      price: Number(row.price),
      fetchedAt: new Date(row.fetched_at).getTime(),
    });
  }

  const result: Record<string, number> = {};
  const stale: string[] = [];

  for (const ticker of unique) {
    const entry = cached.get(ticker);
    if (entry && now - entry.fetchedAt < PRICE_TTL_MS) {
      result[ticker] = entry.price;
    } else {
      stale.push(ticker);
    }
  }

  // Odśwież nieaktualne równolegle; przy błędzie zostań przy starej cenie.
  await Promise.all(
    stale.map(async (ticker) => {
      try {
        const fresh = await fetchFinnhubQuote(ticker);
        if (fresh != null) {
          result[ticker] = fresh;
          await upsertCache(supabase, ticker, fresh);
          return;
        }
      } catch {
        // ignore — fallback poniżej
      }
      const old = cached.get(ticker);
      if (old) result[ticker] = old.price;
    }),
  );

  return result;
}
