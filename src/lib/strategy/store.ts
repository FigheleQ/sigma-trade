// ============================================================
// Persistencja profilu (warstwa C) — tabela `user_strategy` (migracja 0005).
// Server-only. Za flagą `features.strategy_agent.enabled`: przy `false`
// load zwraca null bez zapytania do DB (zachowanie sprzed v2).
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { isStrategyAgentEnabled } from '@/lib/config';
import type { UserStrategy } from '@/lib/coach/types';
import { coerceStrategy } from './validate';

interface StrategyRow {
  level: string;
  risk: string;
  budget: number | string;
  interests: string[] | null;
  horizon_years: number | null;
  monthly_contribution: number | string | null;
  drawdown_comfort: string | null;
  preferred_instruments: string[] | null;
  dividend_preference: boolean | null;
  exclusions: string[] | null;
}

export async function loadStoredStrategy(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserStrategy | null> {
  if (!isStrategyAgentEnabled()) return null;
  const { data, error } = await supabase
    .from('user_strategy')
    .select(
      'level, risk, budget, interests, horizon_years, monthly_contribution, drawdown_comfort, preferred_instruments, dividend_preference, exclusions',
    )
    .eq('user_id', userId)
    .maybeSingle<StrategyRow>();
  if (error || !data) return null;
  return coerceStrategy({
    level: data.level,
    risk: data.risk,
    budget: Number(data.budget),
    interests: data.interests ?? [],
    horizonYears: data.horizon_years ?? undefined,
    monthlyContribution: data.monthly_contribution != null ? Number(data.monthly_contribution) : undefined,
    drawdownComfort: data.drawdown_comfort ?? undefined,
    preferredInstruments: data.preferred_instruments ?? undefined,
    dividendPreference: data.dividend_preference ?? undefined,
    exclusions: data.exclusions ?? undefined,
  });
}

export async function saveStoredStrategy(
  supabase: SupabaseClient,
  userId: string,
  s: UserStrategy,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('user_strategy').upsert(
    {
      user_id: userId,
      level: s.level,
      risk: s.risk,
      budget: s.budget,
      interests: s.interests,
      horizon_years: s.horizonYears ?? null,
      monthly_contribution: s.monthlyContribution ?? null,
      drawdown_comfort: s.drawdownComfort ?? null,
      preferred_instruments: s.preferredInstruments ?? null,
      dividend_preference: s.dividendPreference ?? null,
      exclusions: s.exclusions ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}
