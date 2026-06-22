// ============================================================
// GET /api/portfolio
// Zwraca pełny stan portfela zalogowanego usera (cash, pozycje, P/L).
// Tworzy portfel z domyślnym balansem przy pierwszym wejściu.
// ============================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOrCreatePortfolio, buildPortfolioState } from '@/lib/portfolio/service';

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const portfolio = await getOrCreatePortfolio(supabase, user.id);
    const state = await buildPortfolioState(supabase, portfolio);
    return NextResponse.json(state);
  } catch (err) {
    console.error('[api/portfolio]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
