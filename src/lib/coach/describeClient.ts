// ============================================================
// Klient opisu spółki (GET /api/strategy/describe) — z cache w pamięci
// karty przeglądarki: drugie kliknięcie w ten sam ticker = 0 zapytań.
// ============================================================

export interface TickerInfo {
  ticker: string;
  name: string;
  description: string;
  source: 'cache' | 'model' | 'fallback';
}

const cache = new Map<string, Promise<TickerInfo | null>>();

export function fetchTickerInfo(ticker: string, fetchImpl: typeof fetch = fetch): Promise<TickerInfo | null> {
  const key = ticker.toUpperCase();
  const hit = cache.get(key);
  if (hit) return hit;

  const p = fetchImpl(`/api/strategy/describe?ticker=${encodeURIComponent(key)}`)
    .then(async (res) => (res.ok ? ((await res.json()) as TickerInfo) : null))
    .catch(() => null)
    .then((info) => {
      if (!info) cache.delete(key); // błąd nie zostaje w cache — można spróbować ponownie
      return info;
    });
  cache.set(key, p);
  return p;
}
