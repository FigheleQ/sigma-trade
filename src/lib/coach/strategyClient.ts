// ============================================================
// Klient warstwy C (Strategy) — używany przez panel A (Coach).
//
// Kontrakt z C (zamrożony w types.ts):
//   GET  /api/strategy                 → profil usera (UserStrategy | null)
//   POST /api/strategy                 → zapis profilu
//   POST /api/strategy/recommendations → Recommendation[] dla profilu
//
// Dopóki C nie dostarczy tych route'ów, wołania zwrócą 404 → spadamy na
// LOKALNY MOCK, żeby A nie był zablokowany. Gdy C wejdzie na main, ten
// plik bez zmian zacznie używać prawdziwych danych (mock to tylko fallback).
//
// ⚠️ To plik A — NIE tworzymy tu route'ów C. Zero kolizji z pionem C.
// ============================================================
import type { UserStrategy, Recommendation, RiskTolerance } from './types';
import {
  RECOMMENDATION_CATALOG,
  BROAD_MARKET_KEY,
  DEFAULT_CATEGORY_KEYS,
  type CatalogCategory,
  type CatalogEntry,
} from './recommendationCatalog';

// ---- Mock fallback (gdy endpointy C jeszcze nie istnieją) ----

// Które poziomy ryzyka dopuszczamy dla danego profilu. Dotyczy WSZYSTKICH
// userów (nie tylko początkujących): niskie ryzyko / beginner → bez high-beta;
// im wyżej, tym bardziej dopuszczamy spekulacyjne pozycje.
function allowedRisks(strategy: UserStrategy): Set<RiskTolerance> {
  if (strategy.risk === 'high') return new Set<RiskTolerance>(['low', 'medium', 'high']);
  if (strategy.risk === 'medium') {
    return strategy.level === 'beginner'
      ? new Set<RiskTolerance>(['low', 'medium'])
      : new Set<RiskTolerance>(['low', 'medium', 'high']);
  }
  return new Set<RiskTolerance>(['low', 'medium']); // risk low
}

// Dopasowanie zainteresowań (free-text) do kategorii katalogu po słowach.
function matchedCategories(interests: string[]): CatalogCategory[] {
  const tokens = interests
    .flatMap((i) => i.toLowerCase().split(/[^a-z]+/))
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) return [];

  const hit = (k: string, t: string) => k.length >= 3 && (t.includes(k) || k.includes(t));
  return RECOMMENDATION_CATALOG.filter(
    (c) =>
      c.key !== BROAD_MARKET_KEY &&
      (c.keywords.some((k) => tokens.some((t) => hit(k, t))) ||
        tokens.some((t) => c.label.toLowerCase().includes(t))),
  );
}

function defaultCategories(): CatalogCategory[] {
  return RECOMMENDATION_CATALOG.filter((c) => DEFAULT_CATEGORY_KEYS.includes(c.key));
}

// Waga pozycji: ETF-y i stabilne pozycje ważą więcej, spekulacyjne mniej.
function weightOf(e: CatalogEntry): number {
  if (e.kind === 'etf') return 3;
  if (e.risk === 'low') return 2;
  if (e.risk === 'medium') return 1.5;
  return 1;
}

// Buduje spersonalizowaną, zróżnicowaną listę: fundament (ETF-y) + pozycje
// z dopasowanych kategorii (round-robin dla różnorodności), filtrowane ryzykiem.
export function mockRecommendations(strategy: UserStrategy): Recommendation[] {
  const allowed = allowedRisks(strategy);
  const TARGET = 7;
  const used = new Set<string>();
  const picks: CatalogEntry[] = [];
  const add = (e: CatalogEntry) => {
    if (!used.has(e.ticker)) {
      used.add(e.ticker);
      picks.push(e);
    }
  };

  // 1. Fundament — szerokie ETF-y. Więcej dla początkujących / niskiego ryzyka,
  //    mniej (ale wciąż obecne) dla ofensywnych profili.
  const broad = RECOMMENDATION_CATALOG.find((c) => c.key === BROAD_MARKET_KEY);
  const foundationCount =
    strategy.level === 'beginner' || strategy.risk === 'low' ? 2 : 1;
  broad?.entries
    .filter((e) => allowed.has(e.risk))
    .slice(0, foundationCount)
    .forEach(add);

  // 2. Pozycje z kategorii dopasowanych do zainteresowań (lub domyślnych),
  //    round-robin po kategoriach, żeby nie skupić się na jednej.
  const cats = (() => {
    const m = matchedCategories(strategy.interests);
    return m.length ? m : defaultCategories();
  })();

  for (let idx = 0; picks.length < TARGET; idx++) {
    let progressed = false;
    for (const c of cats) {
      const avail = c.entries.filter((e) => allowed.has(e.risk) && !used.has(e.ticker));
      if (avail[idx]) {
        add(avail[idx]);
        progressed = true;
        if (picks.length >= TARGET) break;
      }
    }
    if (!progressed) break;
  }

  const total = picks.reduce((s, e) => s + weightOf(e), 0) || 1;
  return picks.map((e) => ({
    ticker: e.ticker,
    reason: e.reason,
    suggestedWeight: weightOf(e) / total,
  }));
}

// ---- Klient HTTP z fallbackiem ------------------------------

// Zwraca rekomendacje dla profilu. Najpierw próbuje endpointu C; przy
// 404/błędzie/parsie spada na mock. `fetchImpl` ułatwia testy.
export async function getRecommendations(
  strategy: UserStrategy,
  fetchImpl: typeof fetch = fetch,
): Promise<{ recommendations: Recommendation[]; source: 'api' | 'mock' }> {
  try {
    const res = await fetchImpl('/api/strategy/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy }),
    });
    if (res.ok) {
      const data = (await res.json()) as { recommendations?: Recommendation[] };
      if (Array.isArray(data.recommendations)) {
        return { recommendations: data.recommendations, source: 'api' };
      }
    }
  } catch {
    // sieć/parse — spada na mock
  }
  return { recommendations: mockRecommendations(strategy), source: 'mock' };
}

// Zapisuje profil usera u C (best-effort; ignoruje brak endpointu).
export async function saveStrategy(
  strategy: UserStrategy,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    await fetchImpl('/api/strategy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy }),
    });
  } catch {
    // C jeszcze nie gotowe — onboarding i tak idzie dalej.
  }
}
