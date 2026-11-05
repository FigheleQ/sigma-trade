// ============================================================
// Konsensus analityków — Finnhub `/recommendation` (server-only).
//
// Endpoint był w config.yaml od początku, ale nieużywany. Wzorem prices.ts:
// pula kluczy round-robin + jeden retry na kolejnym kluczu, plus cache.
// Rekomendacje analityków zmieniają się raz w miesiącu → cache w pamięci
// procesu z TTL 6h wystarcza i chroni darmowy limit (60 req/min).
//
// Brak danych (ETF, limit, timeout) = `null`. NIGDY nie blokuje rekomendacji.
// ============================================================
import { nextFinnhubKey } from '@/lib/apiKeys';
import { loadConfig } from '@/lib/config';
import type { AnalystConsensus } from '@/lib/coach/types';

const TTL_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 4000;
const cache = new Map<string, { value: AnalystConsensus | null; fetchedAt: number }>();

interface FinnhubRecommendation {
  buy?: number;
  hold?: number;
  sell?: number;
  strongBuy?: number;
  strongSell?: number;
  period?: string;
}

async function fetchConsensus(ticker: string): Promise<AnalystConsensus | null> {
  const { base_url, endpoints } = loadConfig().data_provider;
  const path = endpoints.recommendation ?? '/recommendation';
  const call = (key: string) =>
    fetch(`${base_url}${path}?symbol=${encodeURIComponent(ticker)}&token=${key}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  const firstKey = nextFinnhubKey();
  if (!firstKey) return null;
  let res = await call(firstKey);
  if (res.status === 429 || !res.ok) {
    const retryKey = nextFinnhubKey();
    if (retryKey && retryKey !== firstKey) res = await call(retryKey);
  }
  if (!res.ok) return null;

  const rows = (await res.json()) as FinnhubRecommendation[];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  // Finnhub zwraca okresy od najnowszego — bierzemy najświeższy.
  const latest = [...rows].sort((a, b) => (b.period ?? '').localeCompare(a.period ?? ''))[0];
  const value: AnalystConsensus = {
    buy: (latest.buy ?? 0) + (latest.strongBuy ?? 0),
    hold: latest.hold ?? 0,
    sell: (latest.sell ?? 0) + (latest.strongSell ?? 0),
  };
  return value.buy + value.hold + value.sell > 0 ? value : null;
}

// Konsensus dla listy tickerów — równolegle, każdy błąd → null.
export async function getAnalystConsensus(
  tickers: string[],
): Promise<Record<string, AnalystConsensus | null>> {
  const now = Date.now();
  const out: Record<string, AnalystConsensus | null> = {};
  await Promise.all(
    [...new Set(tickers.map((t) => t.toUpperCase()))].map(async (t) => {
      const hit = cache.get(t);
      if (hit && now - hit.fetchedAt < TTL_MS) {
        out[t] = hit.value;
        return;
      }
      try {
        const value = await fetchConsensus(t);
        cache.set(t, { value, fetchedAt: now });
        out[t] = value;
      } catch {
        out[t] = null; // timeout / sieć — bez konsensusu, rekomendacje idą dalej
      }
    }),
  );
  return out;
}
