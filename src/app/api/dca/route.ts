// ============================================================
// /api/dca — plany cyklicznego zakupu (DCA, „kup za X$ co tydzień").
//   GET    → lista planów zalogowanego usera
//   POST   → utwórz plan { ticker, amountUsd }
//   DELETE → usuń plan (?id=...)
//
// Wszystko per-portfel, chronione RLS (klient z sesją usera). Faktyczny zakup
// wykonuje cron /api/dca/run — tu tylko zarządzamy planami.
// ============================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOrCreatePortfolio } from '@/lib/portfolio/service';
import { getExecutionPrice } from '@/lib/portfolio/prices';
import { planDcaBuy, nextWeeklyRun } from '@/lib/portfolio/dca';
import { executeMarketOrder } from '@/lib/portfolio/execute';
import type { DcaPlan, DcaPlanRequest } from '@/lib/portfolio/types';

interface DcaRow {
  id: string;
  ticker: string;
  amount_usd: number | string;
  status: DcaPlan['status'];
  next_run_at: string;
  last_run_at: string | null;
  created_at: string;
}

function toPlan(r: DcaRow): DcaPlan {
  return {
    id: r.id,
    ticker: r.ticker,
    amountUsd: Number(r.amount_usd),
    status: r.status,
    nextRunAt: r.next_run_at,
    lastRunAt: r.last_run_at,
    createdAt: r.created_at,
  };
}

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const portfolio = await getOrCreatePortfolio(supabase, user.id);
    const { data, error } = await supabase
      .from('dca_plans')
      .select('id, ticker, amount_usd, status, next_run_at, last_run_at, created_at')
      .eq('portfolio_id', portfolio.id)
      .order('created_at', { ascending: false });
    if (error) throw error;

    return NextResponse.json({ plans: (data ?? []).map(toPlan) });
  } catch (err) {
    console.error('[api/dca GET]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Partial<DcaPlanRequest>;
  try {
    body = (await req.json()) as Partial<DcaPlanRequest>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const ticker = body.ticker?.toUpperCase().trim();
  const amountUsd = Number(body.amountUsd);

  if (!ticker) {
    return NextResponse.json({ error: 'Missing ticker' }, { status: 400 });
  }
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
  }

  try {
    const portfolio = await getOrCreatePortfolio(supabase, user.id);

    // Walidacja tickera — musi być realnie notowany (Finnhub zwraca cenę).
    // Cenę zachowujemy do natychmiastowego pierwszego zakupu.
    let price: number;
    try {
      price = await getExecutionPrice(supabase, ticker);
    } catch {
      return NextResponse.json(
        { error: `Unknown ticker: ${ticker}` },
        { status: 400 },
      );
    }

    const now = new Date();
    const { quantity } = planDcaBuy(amountUsd, price, portfolio.cash);

    // Wykonaj pierwszy zakup od razu (jeśli stać).
    if (quantity > 0) {
      await executeMarketOrder(supabase, portfolio, {
        ticker,
        side: 'buy',
        quantity,
        price,
      });
    }

    const next = nextWeeklyRun(now, now);

    const { data, error } = await supabase
      .from('dca_plans')
      .insert({
        portfolio_id: portfolio.id,
        ticker,
        amount_usd: amountUsd,
        last_run_at: quantity > 0 ? now.toISOString() : null,
        next_run_at: next.toISOString(),
      })
      .select('id, ticker, amount_usd, status, next_run_at, last_run_at, created_at')
      .single();
    if (error || !data) throw error ?? new Error('Insert failed');

    return NextResponse.json({ plan: toPlan(data) });
  } catch (err) {
    console.error('[api/dca POST]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  try {
    const portfolio = await getOrCreatePortfolio(supabase, user.id);
    // RLS i tak ogranicza do własnych planów; jawny filtr portfolio_id dla pewności.
    const { error } = await supabase
      .from('dca_plans')
      .delete()
      .eq('id', id)
      .eq('portfolio_id', portfolio.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/dca DELETE]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
