// ============================================================
// /api/strategy — profil inwestycyjny usera (warstwa C).
//
//   GET  → { strategy: UserStrategy | null }
//   POST → { strategy } → walidacja (validate.ts) → upsert `user_strategy`
//
// Kontrakt URL bez zmian (strategyClient). Za flagą
// `features.strategy_agent.enabled` — przy `false` zwraca 404, a klient
// spada na lokalny mock (zachowanie sprzed v2).
// ============================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isStrategyAgentEnabled } from '@/lib/config';
import { loadStoredStrategy, saveStoredStrategy } from '@/lib/strategy/store';
import { coerceStrategy } from '@/lib/strategy/validate';

const disabled = () => NextResponse.json({ error: 'Strategy agent disabled' }, { status: 404 });

export async function GET(): Promise<NextResponse> {
  if (!isStrategyAgentEnabled()) return disabled();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const strategy = await loadStoredStrategy(supabase, user.id);
  return NextResponse.json({ strategy });
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isStrategyAgentEnabled()) return disabled();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { strategy?: unknown };
  try {
    body = (await req.json()) as { strategy?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const strategy = coerceStrategy(body.strategy);
  if (!strategy) {
    return NextResponse.json(
      { error: 'strategy requires level, risk, budget (USD) and at least one interest' },
      { status: 400 },
    );
  }

  const saved = await saveStoredStrategy(supabase, user.id, strategy);
  if (!saved.ok) {
    console.error('[api/strategy][POST]', saved.error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, strategy });
}
