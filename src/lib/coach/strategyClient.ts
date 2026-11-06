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
import type { UserStrategy, Recommendation } from './types';
import { buildPortfolioPlan, planToRecommendations } from '@/lib/strategy/allocate';
import { explainPlan } from '@/lib/strategy/explain';

// ---- Mock fallback (gdy endpoint C jest wyłączony / niedostępny) ----
//
// AI v2: mock to TEN SAM deterministyczny silnik co serwer (allocate.ts +
// explain.ts są czyste, bez I/O), tylko bez żywych cen i konsensusu —
// wagi, role, ryzyka i uzasadnienia się zgadzają, kwoty liczone z wag.
// Wcześniej mock miał własną kopię dopasowania z błędem „energy" → ropa.
export function mockRecommendations(strategy: UserStrategy): Recommendation[] {
  const plan = buildPortfolioPlan(strategy, { positions: [] });
  return explainPlan(plan, strategy, planToRecommendations(plan));
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
