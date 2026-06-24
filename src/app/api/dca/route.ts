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
import type { DcaPlan, DcaPlanRequest } from '@/lib/portfolio/types';

interface DcaRow {
  id: string;
  ticker: string;
  amount_usd: number | string;
  carry_usd: number | string;
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
    carryUsd: Number(r.carry_usd),
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
      .select('id, ticker, amount_usd, carry_usd, status, next_run_at, last_run_at, created_at')
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
    return NextResponse.json({ error: 'Brak tickera' }, { status: 400 });
  }
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return NextResponse.json({ error: 'Kwota musi być dodatnia' }, { status: 400 });
  }

  try {
    const portfolio = await getOrCreatePortfolio(supabase, user.id);

    // Walidacja tickera — musi być realnie notowany (Finnhub zwraca cenę).
    try {
      await getExecutionPrice(supabase, ticker);
    } catch {
      return NextResponse.json(
        { error: `Nieznany ticker: ${ticker}` },
        { status: 400 },
      );
    }

    // next_run_at = teraz → pierwszy zakup pójdzie przy najbliższym skanie crona.
    const { data, error } = await supabase
      .from('dca_plans')
      .insert({
        portfolio_id: portfolio.id,
        ticker,
        amount_usd: amountUsd,
        next_run_at: new Date().toISOString(),
      })
      .select('id, ticker, amount_usd, carry_usd, status, next_run_at, last_run_at, created_at')
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
  if (!id) return NextResponse.json({ error: 'Brak id' }, { status: 400 });

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
